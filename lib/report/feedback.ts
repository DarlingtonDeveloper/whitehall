// ---------------------------------------------------------------------------
// Learned signals update from report diffs — closes the feedback loop.
//
// When a reviewer edits a draft report (removing items, adding items,
// changing RAG ratings), those editorial decisions are captured in a
// ReportDiff and used here to incrementally adjust the client's learned
// signals. These signals feed back into computeFeedRelevance (scoring.ts)
// for future report generation.
//
// Signal adjustments:
//   - Items removed:  penalise the source that produced them (-0.01)
//   - Items added:    boost keywords from the added context (+0.01)
//   - RAG upgrades:   record adjusted thresholds for future scoring
// ---------------------------------------------------------------------------

import { supabase } from '@/lib/db';
import type { ClientConfig } from '@/types/client';
import type { ReportDiff } from '@/types/report';
import type { FeedItem } from '@/types/feed';

export async function getLearnedSignals(clientId: string) {
  const { data } = await supabase
    .from('client_learned_signals')
    .select('*')
    .eq('client_id', clientId)
    .single();

  return data ?? {
    client_id: clientId,
    source_boosts: {},
    keyword_boosts: {},
    rag_adjustments: {},
  };
}

export async function updateLearnedSignals(
  clientId: string,
  diff: ReportDiff,
  sourceItems: FeedItem[],
  client: ClientConfig,
): Promise<void> {
  const signals = await getLearnedSignals(clientId);

  // Items removed -> penalise source
  for (const removed of diff.items_removed) {
    // Find the source from feed items that match
    const matchingItems = sourceItems.filter(fi =>
      fi.source_name && removed.item_ref
    );
    for (const fi of matchingItems) {
      signals.source_boosts[fi.source_name] =
        (signals.source_boosts[fi.source_name] || 0) - 0.01;
    }
  }

  // Items added -> boost source and keywords
  for (const added of diff.items_added) {
    // Boost keywords from added items
    for (const kw of client.allKeywords) {
      if (added.item_ref) {
        signals.keyword_boosts[kw] =
          (signals.keyword_boosts[kw] || 0) + 0.01;
      }
    }
  }

  // RAG upgrades -> note for future threshold adjustment
  for (const change of diff.rag_changes) {
    if (change.new_rag === 'RED' && change.old_rag !== 'RED') {
      signals.rag_adjustments[change.item_ref] = {
        red_threshold: 0.6,
        amber_threshold: 0.3,
      };
    }
  }

  // Upsert learned signals
  await supabase
    .from('client_learned_signals')
    .upsert({
      client_id: clientId,
      source_boosts: signals.source_boosts,
      keyword_boosts: signals.keyword_boosts,
      rag_adjustments: signals.rag_adjustments,
      computed_at: new Date().toISOString(),
    });
}
