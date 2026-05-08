// ---------------------------------------------------------------------------
// Classifier pipeline — main entry point.
//
// Routes evidence by type to deterministic or LLM classifier, applies
// public/revealed routing, persists results to politician_indicator_evidence,
// and handles failures via dead-letter queue.
//
// Usage:
//   await classifyEvidence(evidenceRow);           // single
//   await classifyEvidenceBatch(evidenceRows);      // batch (20 at a time)
// ---------------------------------------------------------------------------

import { getServiceClient } from '@/lib/db';
import { mapWithConcurrency } from '@/lib/ai/retry';
import type { PoliticianEvidence, Politician } from '@/types/politician';
import type { Classification, ClassifierResult } from './types';
import {
  DETERMINISTIC_TYPES,
  LLM_TYPES,
  EVIDENCE_ROUTING,
  type IndicatorVariant,
} from './constants';
import {
  classifyDivisionVote,
  classifyRegisterEntry,
  classifyAppgMembership,
  classifyCommitteeMembership,
} from './deterministic';
import { classifyWithLlm } from './llm';
import { getDeterministicVersion, getLlmVersion } from './version';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify a single evidence row. Returns the ClassifierResult with
 * classifications ready for the math layer.
 */
export async function classifyEvidence(
  evidence: PoliticianEvidence,
): Promise<ClassifierResult> {
  const start = performance.now();

  try {
    if (DETERMINISTIC_TYPES.has(evidence.evidence_type)) {
      return await runDeterministic(evidence, start);
    }

    if (LLM_TYPES.has(evidence.evidence_type)) {
      return await runLlm(evidence, start);
    }

    // Unknown evidence type — skip
    return {
      evidence_id: evidence.id,
      classifications: [],
      classifier_version: 'unknown',
      no_classification_reason: `unsupported_type:${evidence.evidence_type}`,
      cost_usd: 0,
      latency_ms: Math.round(performance.now() - start),
    };
  } catch (err) {
    const latency_ms = Math.round(performance.now() - start);
    await recordFailure(evidence.id, err);
    return {
      evidence_id: evidence.id,
      classifications: [],
      classifier_version: 'error',
      no_classification_reason: `error:${err instanceof Error ? err.message : String(err)}`,
      cost_usd: 0,
      latency_ms,
    };
  }
}

/**
 * Classify a batch of evidence rows with bounded concurrency.
 * Persists results to politician_indicator_evidence after each.
 */
export async function classifyEvidenceBatch(
  evidenceRows: PoliticianEvidence[],
  { concurrency = 5 } = {},
): Promise<ClassifierResult[]> {
  return mapWithConcurrency(evidenceRows, concurrency, async (evidence) => {
    const result = await classifyEvidence(evidence);
    if (result.classifications.length > 0) {
      await persistClassifications(evidence, result);
    }
    return result;
  });
}

/**
 * Fetch unclassified evidence and run the classifier pipeline.
 * Designed for cron/queue workers.
 */
export async function processUnclassifiedEvidence(
  { limit = 100 } = {},
): Promise<{ processed: number; classified: number; errors: number }> {
  const db = getServiceClient();

  // Two-step: get IDs already classified or failed, then exclude them.
  // PostgREST doesn't support sub-query NOT IN, so we fetch exclusion sets first.
  const [{ data: classifiedIds }, { data: failedIds }] = await Promise.all([
    db.from('politician_indicator_evidence').select('evidence_id'),
    db.from('classifier_failures').select('evidence_id').eq('resolved', false),
  ]);

  const excludeIds = new Set<number>();
  for (const r of classifiedIds ?? []) excludeIds.add(r.evidence_id);
  for (const r of failedIds ?? []) excludeIds.add(r.evidence_id);

  // Fetch a batch of evidence, then filter client-side
  // Over-fetch to account for exclusions
  const fetchLimit = Math.min(limit * 3, 1000);
  const { data: allEvidence, error } = await db
    .from('politician_evidence')
    .select('*')
    .order('occurred_at', { ascending: false })
    .limit(fetchLimit);

  if (error || !allEvidence?.length) {
    return { processed: 0, classified: 0, errors: 0 };
  }

  const evidenceRows = (allEvidence as PoliticianEvidence[])
    .filter((e) => !excludeIds.has(e.id))
    .slice(0, limit);

  if (evidenceRows.length === 0) {
    return { processed: 0, classified: 0, errors: 0 };
  }

  const results = await classifyEvidenceBatch(evidenceRows);

  return {
    processed: results.length,
    classified: results.filter((r) => r.classifications.length > 0).length,
    errors: results.filter((r) => r.no_classification_reason?.startsWith('error:')).length,
  };
}

// ---------------------------------------------------------------------------
// Internal — deterministic path
// ---------------------------------------------------------------------------

async function runDeterministic(
  evidence: PoliticianEvidence,
  start: number,
): Promise<ClassifierResult> {
  let rawClassifications: Classification[];

  switch (evidence.evidence_type) {
    case 'division_vote':
      rawClassifications = await classifyDivisionVote(evidence);
      break;
    case 'register_of_interests':
      rawClassifications = await classifyRegisterEntry(evidence);
      break;
    case 'appg_membership':
      rawClassifications = await classifyAppgMembership(evidence);
      break;
    case 'committee_membership':
      rawClassifications = await classifyCommitteeMembership(evidence);
      break;
    default:
      rawClassifications = [];
  }

  const classifications = applyRouting(rawClassifications, evidence.evidence_type);

  return {
    evidence_id: evidence.id,
    classifications,
    classifier_version: getDeterministicVersion(),
    no_classification_reason: classifications.length === 0 ? 'no_mapping' : undefined,
    cost_usd: 0,
    latency_ms: Math.round(performance.now() - start),
  };
}

// ---------------------------------------------------------------------------
// Internal — LLM path
// ---------------------------------------------------------------------------

async function runLlm(
  evidence: PoliticianEvidence,
  start: number,
): Promise<ClassifierResult> {
  const politician = await fetchPolitician(evidence.politician_id);
  if (!politician) {
    return {
      evidence_id: evidence.id,
      classifications: [],
      classifier_version: getLlmVersion(),
      no_classification_reason: 'politician_not_found',
      cost_usd: 0,
      latency_ms: Math.round(performance.now() - start),
    };
  }

  const { classifications: raw, no_classification_reason, cost_usd, latency_ms } =
    await classifyWithLlm(evidence, politician);

  const classifications = applyRouting(raw, evidence.evidence_type);

  return {
    evidence_id: evidence.id,
    classifications,
    classifier_version: getLlmVersion(),
    no_classification_reason: classifications.length === 0
      ? (no_classification_reason ?? 'no_classification')
      : undefined,
    cost_usd,
    latency_ms,
  };
}

// ---------------------------------------------------------------------------
// Public/revealed routing
// ---------------------------------------------------------------------------

/**
 * Apply public/revealed suffix routing to indicator_ids.
 * An indicator_id like "policy.energy.fossil_fuel_extraction" becomes
 * "policy.energy.fossil_fuel_extraction.public" or ".revealed" based on
 * the evidence type routing rules.
 *
 * If the evidence type has a secondary route (e.g. committee_question),
 * duplicate the classification with adjusted weight.
 */
function applyRouting(
  classifications: Classification[],
  evidenceType: PoliticianEvidence['evidence_type'],
): Classification[] {
  const routing = EVIDENCE_ROUTING[evidenceType];
  if (!routing) return classifications;

  const result: Classification[] = [];

  for (const c of classifications) {
    // Skip if indicator already has .public/.revealed suffix
    if (c.indicator_id.endsWith('.public') || c.indicator_id.endsWith('.revealed')) {
      result.push(c);
      continue;
    }

    // Primary route
    result.push({
      ...c,
      indicator_id: `${c.indicator_id}.${routing.primary}`,
    });

    // Secondary route (half weight by default)
    if (routing.secondary) {
      result.push({
        ...c,
        indicator_id: `${c.indicator_id}.${routing.secondary}`,
        raw_weight: c.raw_weight * (routing.secondary_weight_factor ?? 0.5),
      });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

async function persistClassifications(
  evidence: PoliticianEvidence,
  result: ClassifierResult,
): Promise<void> {
  const db = getServiceClient();

  const rows = result.classifications.map((c) => ({
    politician_id: evidence.politician_id,
    indicator_id: c.indicator_id,
    evidence_id: evidence.id,
    anchor: c.anchor,
    raw_weight: c.raw_weight,
    effective_weight: c.raw_weight, // math layer will adjust with decay later
    classifier_version: result.classifier_version,
    classifier_reasoning: c.reasoning,
  }));

  // Ensure politician_indicators rows exist for each indicator
  const indicatorIds = [...new Set(rows.map((r) => r.indicator_id))];
  for (const indicatorId of indicatorIds) {
    await db
      .from('politician_indicators')
      .upsert(
        {
          politician_id: evidence.politician_id,
          indicator_id: indicatorId,
          alpha: 1.0,
          beta: 1.0,
          evidence_count: 0,
          last_updated: new Date().toISOString(),
        },
        { onConflict: 'politician_id,indicator_id', ignoreDuplicates: true },
      );
  }

  // Insert classification evidence rows
  const { error } = await db
    .from('politician_indicator_evidence')
    .insert(rows);

  if (error) {
    console.error('[classifier:persist] Failed to persist classifications:', error);
  }
}

async function fetchPolitician(politicianId: string): Promise<Politician | null> {
  const db = getServiceClient();
  const { data, error } = await db
    .from('politicians')
    .select('*')
    .eq('id', politicianId)
    .maybeSingle();

  if (error || !data) return null;
  return data as Politician;
}

// ---------------------------------------------------------------------------
// Failure handling — dead-letter queue
// ---------------------------------------------------------------------------

async function recordFailure(
  evidenceId: number,
  err: unknown,
): Promise<void> {
  const db = getServiceClient();

  const errorType = err instanceof Error
    ? (err.message.includes('rate limit') || err.message.includes('429')
      ? 'rate_limit'
      : err.message.includes('parse')
        ? 'parse_error'
        : 'unknown')
    : 'unknown';

  const { error } = await db
    .from('classifier_failures')
    .insert({
      evidence_id: evidenceId,
      classifier_version: getLlmVersion(),
      error_type: errorType,
      error_message: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
    });

  if (error) {
    console.error('[classifier:failure] Failed to record failure:', error);
  }
}
