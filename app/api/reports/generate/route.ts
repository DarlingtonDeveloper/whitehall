import { NextResponse } from 'next/server';
import { getClientBySlug, ALL_CLIENTS } from '@/data/clients';
import { gatherItems, groupByTheme } from '@/lib/export/gather';
import { enrichItems } from '@/lib/export/enrich';
import { evaluateReport } from '@/lib/export/evaluate';
import { deduplicateSemantic } from '@/lib/feeds/dedup-semantic';
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
        // Step 1: Gather
        sendProgress('gather', 'Querying feed items...');
        const items = await gatherItems(client, from, to);
        sendProgress('gather_complete', `${items.length} items found`);

        // Step 2: Score
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

        // Step 3: Dedup
        sendProgress('dedup', 'Removing duplicate coverage...');
        const deduped = deduplicateSemantic(scored);
        sendProgress('dedup_complete', `${deduped.length} unique items`);

        const selected = deduped.slice(0, MAX_ITEMS);

        // Step 4: Group
        sendProgress('group', 'Grouping by monitoring theme...');
        const grouped = groupByTheme(selected, client);
        const themeCount = Object.keys(grouped).length;
        sendProgress('group_complete', `${themeCount} themes`);

        // Step 5: Enrich with Claude
        sendProgress('enrich', `Analysing ${themeCount} themes with AI...`);
        const analysis = await enrichItems(grouped, client, { from, to });
        sendProgress('enrich_complete', 'All themes analysed');

        // Step 6: Evaluate
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

        // Step 7: Save
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
