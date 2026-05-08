import {
  applyClassification,
  propagate,
  refreshMaterializedView,
} from '@/lib/math/indicators';
import type { Classification } from '@/types/politician';

// -- Update pipeline (spec §8.1) ---------------------------------------------

/**
 * Process a set of classifications for a single evidence row.
 * For each classification: apply the update, then propagate if direct.
 */
export async function processClassifications(
  politicianId: string,
  evidenceId: number,
  classifications: Classification[],
): Promise<{ direct_updates: number; propagated_updates: number; errors: number }> {
  let direct_updates = 0;
  let propagated_updates = 0;
  let errors = 0;

  for (const c of classifications) {
    try {
      await applyClassification(politicianId, evidenceId, c);
      direct_updates++;

      // Propagate to correlated indicators (single-hop: only for direct evidence)
      const { propagated } = await propagate(
        c.indicator_id,
        politicianId,
        evidenceId,
        c.anchor,
        c.effective_weight,
        c.classifier_version,
      );
      propagated_updates += propagated;
    } catch (err) {
      console.warn(`  [ERR] Process classification ${c.indicator_id} for evidence ${evidenceId}:`, err);
      errors++;
    }
  }

  return { direct_updates, propagated_updates, errors };
}

export interface EvidenceBatchItem {
  politicianId: string;
  evidenceId: number;
  classifications: Classification[];
}

/**
 * Process a batch of evidence items through the classification pipeline.
 * Logs progress every 50 items.
 */
export async function processEvidenceBatch(
  items: EvidenceBatchItem[],
): Promise<{ total_direct: number; total_propagated: number; total_errors: number }> {
  let total_direct = 0;
  let total_propagated = 0;
  let total_errors = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const result = await processClassifications(
      item.politicianId,
      item.evidenceId,
      item.classifications,
    );

    total_direct += result.direct_updates;
    total_propagated += result.propagated_updates;
    total_errors += result.errors;

    if ((i + 1) % 50 === 0) {
      console.log(`  [MATH] Processed ${i + 1}/${items.length} evidence items`);
    }
  }

  return { total_direct, total_propagated, total_errors };
}

/**
 * Run the full update pipeline: process batch then refresh materialized view.
 * Spec §8.1: classifications → apply → propagate → refresh view.
 */
export async function runFullPipeline(items: EvidenceBatchItem[]): Promise<void> {
  console.log(`[MATH] Starting pipeline for ${items.length} evidence items`);
  const start = Date.now();

  const result = await processEvidenceBatch(items);

  console.log(
    `[MATH] Batch complete: ${result.total_direct} direct, ` +
    `${result.total_propagated} propagated, ${result.total_errors} errors`,
  );

  console.log('[MATH] Refreshing materialized view...');
  const refreshStart = Date.now();
  await refreshMaterializedView();
  console.log(`[MATH] Materialized view refreshed in ${Date.now() - refreshStart}ms`);

  console.log(`[MATH] Pipeline complete in ${Date.now() - start}ms`);
}
