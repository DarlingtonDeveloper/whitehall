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
    .slice(0, MAX_ITEMS);

  // 3. Group by monitoring theme
  const grouped = groupByTheme(scored, client);

  // 4. Enrich with Claude (theme analysis + synthesis)
  const analysis = await enrichItems(grouped, client, { from, to });

  // 5. Evaluate
  const evalResult = await evaluateReport(analysis, scored, client);
  console.log('[report] Evaluation:', {
    template: evalResult.template_validation.passed,
    factuality: evalResult.factuality.mean_score,
    specificity: evalResult.specificity.mean_score,
    overall: evalResult.overall_pass,
  });

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
      feed_item_ids: scored.map(i => i.id),
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to save draft: ${error.message}`);
  return data.id;
}
