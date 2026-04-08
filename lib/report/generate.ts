// ---------------------------------------------------------------------------
// Draft report generation — reads from Supabase (already collected) and
// produces a scored, deduplicated, AI-enriched report draft.
//
// Collection is fully decoupled: /api/cron/collect runs structured collectors
// on a schedule, /api/scan handles manual web search + forward scan, and
// scripts/collect-all.ts covers the long-running weekly prep.
//
// This function never fetches from external sources.
// ---------------------------------------------------------------------------

import { getClientBySlug } from '@/data/clients';
import { gatherItems, groupByTheme } from '@/lib/export/gather';
import { enrichItems } from '@/lib/export/enrich';
import { evaluateReport } from '@/lib/export/evaluate';
import { supabase } from '@/lib/db';
import { computeFeedRelevance } from '@/lib/feed/scoring';
import { deduplicateSemantic } from '@/lib/feeds/dedup-semantic';
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
): Promise<string> {
  const client = getClientBySlug(clientId);
  if (!client) throw new Error(`Unknown client: "${clientId}"`);

  const to = dateRange?.to ?? new Date();
  const from = dateRange?.from ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // 1. Gather items from Supabase (already collected)
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
    .slice(0, 60);

  // 3. Semantic deduplication
  const deduped = deduplicateSemantic(scored);

  // 4. Take top items
  const selected = deduped.slice(0, MAX_ITEMS);

  // 5. Group by monitoring theme
  const grouped = groupByTheme(selected, client);

  // 6. Enrich with Claude (theme analysis + synthesis)
  const analysis = await enrichItems(grouped, client, { from, to });

  // 6b. Citation verification — flag any source_items fingerprints not in collected items
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

  // 7. Evaluate
  const evalResult = await evaluateReport(analysis, selected, client);

  // Cap confidence for flagged items
  for (const section of Object.values(analysis.sections)) {
    for (const item of [...(section.items || []), ...(section.significant_items || [])]) {
      if (evalResult.flagged_refs.includes(item.ref)) {
        item.confidence = Math.min(item.confidence, 0.5);
      }
    }
  }

  // 8. Save as draft
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
