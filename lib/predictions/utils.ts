import { posterior, betaCI } from '@/lib/math/beta';
import type { AuditedPosterior, Posterior } from '@/types/politician';
import type { KeyEvidence } from './types';

/**
 * Weighted average of values. Returns 0.5 if total weight is zero.
 */
export function weightedAverage(
  items: Array<{ value: number; weight: number }>,
): number {
  let totalWeight = 0;
  let totalValue = 0;
  for (const { value, weight } of items) {
    totalValue += value * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? totalValue / totalWeight : 0.5;
}

/**
 * Blend two values: (1 - bWeight) * a + bWeight * b.
 */
export function blend(a: number, b: number, bWeight: number): number {
  return (1 - bWeight) * a + bWeight * b;
}

/**
 * Combine posterior CIs from multiple indicators into a single CI.
 * Uses weighted average of individual CI bounds.
 */
export function combinePosteriorCIs(
  posteriors: Array<{ posterior: Posterior; weight: number }>,
): [number, number] {
  let totalWeight = 0;
  let loSum = 0;
  let hiSum = 0;

  for (const { posterior: p, weight } of posteriors) {
    loSum += p.ci_95[0] * weight;
    hiSum += p.ci_95[1] * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) return [0, 1];

  return [
    Math.max(0, Math.min(1, loSum / totalWeight)),
    Math.max(0, Math.min(1, hiSum / totalWeight)),
  ];
}

/**
 * Generate human-readable caveats based on indicator quality.
 */
export function generateCaveats(
  indicators: Array<{ evidence_count: number; confidence: number; indicator_id: string }>,
): string[] {
  const caveats: string[] = [];

  const lowEvidence = indicators.filter((i) => i.evidence_count < 5);
  if (lowEvidence.length > 0) {
    caveats.push(
      `${lowEvidence.length} of ${indicators.length} indicator${indicators.length === 1 ? '' : 's'} ` +
      `ha${lowEvidence.length === 1 ? 's' : 've'} fewer than 5 evidence units; CI is wide.`,
    );
  }

  const lowConfidence = indicators.filter((i) => i.confidence < 0.3);
  if (lowConfidence.length === indicators.length && indicators.length > 0) {
    caveats.push('All contributing indicators have low confidence. Treat this prediction as preliminary.');
  }

  if (indicators.length === 0) {
    caveats.push('No indicator data available for this prediction.');
  }

  if (indicators.length === 1) {
    caveats.push('Prediction based on a single indicator. Additional policy dimensions would improve accuracy.');
  }

  return caveats;
}

/**
 * Extract the top-N most influential evidence rows across multiple audited posteriors.
 */
export function topEvidence(
  audited: AuditedPosterior[],
  n: number,
): KeyEvidence[] {
  const all: KeyEvidence[] = [];

  for (const ap of audited) {
    for (const row of ap.contributing_evidence) {
      all.push({
        evidence_id: row.evidence_id,
        evidence_type: row.evidence_type,
        occurred_at: row.occurred_at,
        source_url: row.source_url,
        anchor: row.anchor,
        effective_weight: row.effective_weight,
        indicator_id: ap.indicator_id,
      });
    }
  }

  return all
    .sort((a, b) => b.effective_weight - a.effective_weight)
    .slice(0, n);
}
