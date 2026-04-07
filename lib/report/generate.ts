// ---------------------------------------------------------------------------
// Draft report generation — orchestrates the full pipeline:
//   1. Gather feed items from Supabase
//   2. Score with algorithmic relevance (feed/scoring)
//   3. Group by monitoring theme
//   4. Enrich with Claude (theme analysis + synthesis)
//   5. Evaluate (template validation, factuality, specificity)
//   6. Persist draft to Supabase
//
// Returns the newly created report draft ID.
// ---------------------------------------------------------------------------

import { getClientBySlug } from '@/data/clients';
import { gatherItems, groupByTheme } from '@/lib/export/gather';
import { enrichItems } from '@/lib/export/enrich';
import { evaluateReport } from '@/lib/export/evaluate';
import { supabase } from '@/lib/db';
import { computeFeedRelevance } from '@/lib/feed/scoring';
import { enrichThinItems } from '@/lib/feeds/enrich-content';
import { verifySourceUrls, filterVerifiedItems } from '@/lib/feeds/verify-sources';
import { deduplicateSemantic } from '@/lib/feeds/dedup-semantic';
import { runWebSearchCollector } from '@/lib/feeds/web-search';
import { runForwardScanCollector } from '@/lib/feeds/forward-scan';
import type { LearnedSignals } from '@/lib/feed/scoring';

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

export async function generateDraftReport(
  clientId: string,
  dateRange?: { from: Date; to: Date },
  options?: { runScan?: boolean },
): Promise<string> {
  const client = getClientBySlug(clientId);
  if (!client) throw new Error(`Unknown client: "${clientId}"`);

  const to = dateRange?.to ?? new Date();
  const from = dateRange?.from ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // 0a. Run client scan if requested (web search + forward scan)
  if (options?.runScan !== false) {
    try {
      await Promise.all([
        runWebSearchCollector(client),
        runForwardScanCollector(client),
      ]);
    } catch (err) {
      console.warn('[report] Scan failed (continuing):', err);
    }
  }

  // 0b. Enrich thin items — fetch full page content for items with short body
  try {
    await enrichThinItems();
  } catch (err) {
    console.warn('[report] Content enrichment failed (continuing):', err);
  }

  // 1. Gather items from Supabase
  const items = await gatherItems(client, from, to);

  // 2. Score all items with algorithmic relevance
  const learnedSignals = await getLearnedSignals(clientId);
  const scored = items
    .map(item => ({
      ...item,
      _relevance: computeFeedRelevance(item, client, learnedSignals),
    }))
    .filter(item => item._relevance >= RELEVANCE_THRESHOLD)
    .sort((a, b) => b._relevance - a._relevance)
    .slice(0, 60); // Take more initially — dedup and verification will reduce

  // 2b. Semantic deduplication — cluster same-development items from
  // multiple sources, keep the best source per cluster
  const deduped = deduplicateSemantic(scored);

  // 2c. Source verification — HEAD check all URLs, exclude broken links
  let verified = deduped;
  const brokenItems: typeof deduped = [];
  try {
    const verifications = await verifySourceUrls(
      deduped.map(i => ({ id: i.id, url: i.url ?? null })),
    );
    const { valid, broken } = filterVerifiedItems(deduped, verifications);
    verified = valid;
    brokenItems.push(...broken);
    if (broken.length > 0) {
      console.warn(`[report] ${broken.length} items excluded (broken URLs)`);
    }
  } catch (err) {
    console.warn('[report] Source verification failed (continuing):', err);
  }

  // Take top items after dedup + verification
  const selected = verified.slice(0, MAX_ITEMS);

  // 3. Group by monitoring theme
  const grouped = groupByTheme(selected, client);

  // 4. Enrich with Claude (theme analysis + synthesis)
  const analysis = await enrichItems(grouped, client, { from, to });

  // 4b. Record broken URLs in metadata
  if (brokenItems.length > 0) {
    analysis.metadata.sources_unavailable = brokenItems.map(
      (b) => `${b.title} (${b.url} — broken link)`,
    );
  }

  // 4c. Citation verification — flag any source_items fingerprints not in collected items
  // Matches monitoring agent's _verify_citations
  const validFingerprints = new Set(selected.map(i => i.fingerprint).filter(Boolean));
  for (const section of Object.values(analysis.sections)) {
    const originalCount = section.items?.length ?? 0;
    // Remove items with zero valid source_items (no provenance)
    if (section.items) {
      section.items = section.items.filter((item: { source_items?: string[]; confidence: number; ref: string }) => {
        const validSources = (item.source_items || []).filter(fp => validFingerprints.has(fp));
        if (validSources.length === 0 && (item.source_items || []).length > 0) {
          // Lower confidence for broken citations
          item.confidence = Math.max(0.3, item.confidence - 0.2);
          console.warn(`[report] ${item.ref}: broken source_items citations, confidence reduced`);
        }
        return true; // Keep item but mark as low-confidence
      });
    }
    if (section.items && section.items.length < originalCount) {
      console.warn(`[report] Removed ${originalCount - section.items.length} items with no provenance`);
    }
  }

  // 5. Evaluate
  const evalResult = await evaluateReport(analysis, selected, client);

  // Cap confidence for flagged items
  for (const section of Object.values(analysis.sections)) {
    for (const item of [...(section.items || []), ...(section.significant_items || [])]) {
      if (evalResult.flagged_refs.includes(item.ref)) {
        item.confidence = Math.min(item.confidence, 0.5);
      }
    }
  }

  // 6. Save as draft
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
  return data.id;
}
