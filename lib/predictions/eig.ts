import { getServiceClient } from '@/lib/db';
import { posterior } from '@/lib/math/beta';
import { decayedState } from '@/lib/math/indicators';
import { getPrediction } from './log';
import type { EigInput, EigResult, EvidenceGap, IndicatorDriver } from './types';
import type { EvidenceType } from '@/types/politician';

// Evidence types that route to .revealed indicators
const REVEALED_TYPES: EvidenceType[] = [
  'division_vote',
  'register_of_interests',
  'committee_membership',
];

// Evidence types that route to .public indicators
const PUBLIC_TYPES: EvidenceType[] = [
  'chamber_speech',
  'committee_speech',
  'committee_question',
  'written_question_asked',
  'oral_question_asked',
  'amendment_tabled',
  'op_ed',
  'interview',
  'edm_signature',
  'press_release',
  'social_post',
];

/**
 * Compute evidence gaps for a prediction — which indicators would benefit most
 * from additional evidence.
 */
export async function computeEvidenceGaps(input: EigInput): Promise<EigResult> {
  const db = getServiceClient();

  // 1. Fetch the logged prediction to extract indicator drivers
  const prediction = await getPrediction(input.prediction_id);
  if (!prediction) {
    return { prediction_id: input.prediction_id, gaps: [] };
  }

  const output = prediction.output as Record<string, unknown>;
  const drivers = extractDrivers(output, prediction.prediction_type);

  if (drivers.length === 0) {
    return { prediction_id: input.prediction_id, gaps: [] };
  }

  // 2. For each indicator, compute variance reduction from 5 more evidence units
  const gaps: EvidenceGap[] = [];

  for (const driver of drivers) {
    const state = await decayedState(input.politician_id, driver.indicator_id);
    const currentPost = posterior(state.alpha, state.beta);

    // Project: 5 more evidence units at balanced distribution (worst case for reduction)
    const projectedPost = posterior(state.alpha + 2.5, state.beta + 2.5);

    const varianceReduction = currentPost.variance - projectedPost.variance;
    const contributionWeight = driver.diagnostic_strength;
    const priorityScore = contributionWeight * varianceReduction;

    // Suggest evidence types based on indicator suffix
    const suggestedTypes = driver.indicator_id.endsWith('.revealed')
      ? REVEALED_TYPES
      : driver.indicator_id.endsWith('.public')
        ? PUBLIC_TYPES
        : [...REVEALED_TYPES, ...PUBLIC_TYPES];

    gaps.push({
      indicator_id: driver.indicator_id,
      current_variance: round(currentPost.variance),
      projected_variance_n5: round(projectedPost.variance),
      variance_reduction: round(varianceReduction),
      contribution_weight: round(contributionWeight),
      priority_score: round(priorityScore),
      suggested_evidence_types: suggestedTypes,
    });
  }

  // Sort by priority (highest reduction × contribution first)
  gaps.sort((a, b) => b.priority_score - a.priority_score);

  return { prediction_id: input.prediction_id, gaps };
}

/**
 * Extract indicator drivers from a logged prediction output.
 * Handles vote predictions (drivers[]) and position predictions (signals.ideology.indicators[]).
 */
function extractDrivers(
  output: Record<string, unknown>,
  predictionType: string,
): Array<{ indicator_id: string; diagnostic_strength: number }> {
  if (predictionType === 'vote') {
    const drivers = output.drivers as IndicatorDriver[] | undefined;
    return (drivers ?? []).map((d) => ({
      indicator_id: d.indicator_id,
      diagnostic_strength: d.diagnostic_strength,
    }));
  }

  if (predictionType === 'position') {
    const signals = output.signals as Record<string, { indicators?: IndicatorDriver[] }> | undefined;
    if (!signals) return [];
    const all: Array<{ indicator_id: string; diagnostic_strength: number }> = [];
    for (const signal of Object.values(signals)) {
      for (const ind of signal.indicators ?? []) {
        all.push({
          indicator_id: ind.indicator_id,
          diagnostic_strength: ind.diagnostic_strength,
        });
      }
    }
    return all;
  }

  return [];
}

function round(v: number, decimals = 6): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}
