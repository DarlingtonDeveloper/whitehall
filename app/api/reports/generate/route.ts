import { NextResponse } from 'next/server';
import { getClientBySlug, ALL_CLIENTS } from '@/data/clients';
import { gatherItems, groupByTheme } from '@/lib/export/gather';
import { enrichItems } from '@/lib/export/enrich';
import { evaluateReport } from '@/lib/export/evaluate';
import { enrichThinItems } from '@/lib/feeds/enrich-content';
import { verifySourceUrls, filterVerifiedItems } from '@/lib/feeds/verify-sources';
import { deduplicateSemantic } from '@/lib/feeds/dedup-semantic';
import { runWebSearchCollector } from '@/lib/feeds/web-search';
import { runForwardScanCollector } from '@/lib/feeds/forward-scan';
import { computeFeedRelevance } from '@/lib/feed/scoring';
import { supabase } from '@/lib/db';
import { checkRateLimit } from '@/lib/security/rateLimit';
import { logAudit } from '@/lib/audit';
import type { LearnedSignals } from '@/lib/feed/scoring';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const RELEVANCE_THRESHOLD = 0.25;
const MAX_ITEMS = 40;

async function getLearnedSignals(clientId: string): Promise<LearnedSignals | undefined> {
  const { data } = await supabase
    .from('client_learned_signals')
    .select('source_boosts, keyword_boosts, rag_adjustments')
    .eq('client_id', clientId)
    .single();
  if (!data) return undefined;
  return data as LearnedSignals;
}

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY is not configured.' },
      { status: 503 },
    );
  }

  let body: { clientId?: string; from?: string; to?: string } = {};
  try {
    body = await request.json();
  } catch {
    // Empty body = generate for all clients (cron mode)
  }

  const { clientId, from: fromStr, to: toStr } = body;

  // Rate limiting: 5 report generations per hour
  const ip = request.headers.get('x-forwarded-for') || 'anonymous';
  if (!checkRateLimit(`report-gen:${ip}`, 5, 3_600_000)) {
    logAudit('rate_limit_hit', 'report_generate', clientId, { ip }, request);
    return NextResponse.json(
      { error: 'Rate limit exceeded. Max 5 report generations per hour.' },
      { status: 429 },
    );
  }

  // Non-streaming fallback for cron (all clients) mode
  if (!clientId) {
    const { generateDraftReport } = await import('@/lib/report/generate');
    const results: Array<{ clientId: string; draftId?: string; error?: string }> = [];
    for (const c of ALL_CLIENTS) {
      try {
        const draftId = await generateDraftReport(c.id);
        results.push({ clientId: c.id, draftId });
      } catch (error) {
        results.push({
          clientId: c.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return NextResponse.json({ results });
  }

  // Single client — streaming mode
  const client = getClientBySlug(clientId);
  if (!client) {
    return NextResponse.json(
      { error: `Unknown client: "${clientId}"` },
      { status: 400 },
    );
  }

  const to = toStr ? new Date(toStr) : new Date();
  const from = fromStr ? new Date(fromStr) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function sendProgress(step: string, detail?: string) {
        const data = JSON.stringify({ step, detail, timestamp: Date.now() });
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      }

      try {
        // Step 1: Scan
        sendProgress('scan', 'Running web search and forward scan...');
        try {
          const [webResult, forwardResult] = await Promise.all([
            runWebSearchCollector(client),
            runForwardScanCollector(client),
          ]);
          sendProgress('scan_complete', `Found ${webResult.items_found + forwardResult.items_found} new items`);
        } catch (err) {
          sendProgress('scan_complete', 'Scan failed (continuing)');
          console.warn('[report] Scan failed:', err);
        }

        // Step 2: Enrich thin items
        sendProgress('enrich_content', 'Fetching full page content for thin items...');
        try {
          const enrichResult = await enrichThinItems();
          sendProgress('enrich_content_complete', `${enrichResult.enriched} items enriched`);
        } catch {
          sendProgress('enrich_content_complete', 'Content enrichment skipped');
        }

        // Step 3: Gather
        sendProgress('gather', 'Querying feed items for client stakeholders...');
        const items = await gatherItems(client, from, to);
        sendProgress('gather_complete', `${items.length} items found`);

        // Step 4: Score
        sendProgress('score', 'Scoring items by relevance...');
        const learnedSignals = await getLearnedSignals(clientId);
        const scored = items
          .map(item => ({
            ...item,
            _relevance: computeFeedRelevance(item, client, learnedSignals),
          }))
          .filter(item => item._relevance >= RELEVANCE_THRESHOLD)
          .sort((a, b) => b._relevance - a._relevance)
          .slice(0, 60);
        sendProgress('score_complete', `${scored.length} items above threshold`);

        // Step 5: Dedup
        sendProgress('dedup', 'Removing duplicate coverage...');
        const deduped = deduplicateSemantic(scored);
        sendProgress('dedup_complete', `${deduped.length} unique items`);

        // Step 6: Verify
        sendProgress('verify', 'Checking source URLs...');
        let verified = deduped;
        const brokenItems: typeof deduped = [];
        try {
          const verifications = await verifySourceUrls(
            deduped.map(i => ({ id: i.id, url: i.url ?? null })),
          );
          const { valid, broken } = filterVerifiedItems(deduped, verifications);
          verified = valid;
          brokenItems.push(...broken);
          sendProgress('verify_complete', `${verified.length} verified, ${broken.length} excluded`);
        } catch {
          sendProgress('verify_complete', 'Verification skipped');
        }

        const selected = verified.slice(0, MAX_ITEMS);

        // Step 7: Group
        sendProgress('group', 'Grouping by monitoring theme...');
        const grouped = groupByTheme(selected, client);
        const themeCount = Object.keys(grouped).length;
        sendProgress('group_complete', `${themeCount} themes`);

        // Step 8: Enrich with Claude
        sendProgress('enrich', `Analysing ${themeCount} themes with AI...`);
        const analysis = await enrichItems(grouped, client, { from, to });

        if (brokenItems.length > 0) {
          analysis.metadata.sources_unavailable = brokenItems.map(
            (b) => `${b.title} (${b.url} — broken link)`,
          );
        }
        sendProgress('enrich_complete', 'All themes analysed');

        // Step 9: Evaluate
        sendProgress('evaluate', 'Running quality checks...');
        const evalResult = await evaluateReport(analysis, selected, client);

        for (const section of Object.values(analysis.sections)) {
          for (const item of [...(section.items || []), ...(section.significant_items || [])]) {
            if (evalResult.flagged_refs.includes(item.ref)) {
              item.confidence = Math.min(item.confidence, 0.5);
            }
          }
        }
        sendProgress('evaluate_complete', evalResult.overall_pass ? 'Checks passed' : 'Issues flagged');

        // Step 10: Save
        sendProgress('save', 'Saving report draft...');
        const { data, error } = await supabase
          .from('report_drafts')
          .insert({
            client_id: clientId,
            status: 'draft',
            date_range_from: from.toISOString(),
            date_range_to: to.toISOString(),
            sections: analysis,
            original_sections: analysis,
            feed_item_ids: selected.map(i => i.id),
          })
          .select('id')
          .single();

        if (error) throw new Error(`Failed to save draft: ${error.message}`);

        sendProgress('complete', data.id);
        controller.close();
      } catch (err) {
        sendProgress('error', err instanceof Error ? err.message : String(err));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
