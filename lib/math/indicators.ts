import { getServiceClient } from '@/lib/db';
import {
  posterior,
  applyUpdate,
  decayFactor,
  daysBetween,
  RADAR_HALF_LIVES,
  PROPAGATION_DAMPENING,
} from '@/lib/math/beta';
import type {
  Classification,
  Posterior,
  DecayedState,
  EpochTransition,
  IndicatorCorrelation,
  AuditedPosterior,
  AuditedEvidenceRow,
  EpochEventType,
  PoliticianIndicatorEvidence,
  Radar,
} from '@/types/politician';

// -- Core update (spec §1) ---------------------------------------------------

/**
 * Apply a single classification to a politician's indicator state.
 * Creates the indicator row if it doesn't exist (Beta(1,1) prior).
 * Inserts an audit trail row in politician_indicator_evidence.
 */
export async function applyClassification(
  politicianId: string,
  evidenceId: number,
  c: Classification,
  opts?: { propagationSource?: string },
): Promise<{ alpha: number; beta: number; evidence_count: number }> {
  const db = getServiceClient();

  // Ensure indicator state row exists
  const state = await getOrCreateIndicatorState(politicianId, c.indicator_id);

  // Compute new state
  const updated = applyUpdate(state.alpha, state.beta, c.anchor, c.effective_weight);

  const newCount = state.evidence_count + 1;

  // Write updated state
  const { error: updateErr } = await db
    .from('politician_indicators')
    .update({
      alpha: updated.alpha,
      beta: updated.beta,
      evidence_count: newCount,
      last_updated: new Date().toISOString(),
    })
    .eq('politician_id', politicianId)
    .eq('indicator_id', c.indicator_id);

  if (updateErr) {
    console.warn(`  [ERR] Update indicator ${c.indicator_id} for ${politicianId}: ${updateErr.message}`);
    return { alpha: state.alpha, beta: state.beta, evidence_count: state.evidence_count };
  }

  // Insert audit trail row
  const { error: auditErr } = await db
    .from('politician_indicator_evidence')
    .insert({
      politician_id: politicianId,
      indicator_id: c.indicator_id,
      evidence_id: evidenceId,
      anchor: c.anchor,
      raw_weight: c.raw_weight,
      effective_weight: c.effective_weight,
      classifier_version: c.classifier_version,
      classifier_reasoning: c.classifier_reasoning,
      propagation_source: opts?.propagationSource ?? null,
    });

  if (auditErr) {
    console.warn(`  [ERR] Insert audit row for evidence ${evidenceId} → ${c.indicator_id}: ${auditErr.message}`);
  }

  return { alpha: updated.alpha, beta: updated.beta, evidence_count: newCount };
}

/**
 * Ensure a politician_indicators row exists. Returns current state.
 */
export async function getOrCreateIndicatorState(
  politicianId: string,
  indicatorId: string,
): Promise<{ alpha: number; beta: number; evidence_count: number }> {
  const db = getServiceClient();

  const { data } = await db
    .from('politician_indicators')
    .select('alpha, beta, evidence_count')
    .eq('politician_id', politicianId)
    .eq('indicator_id', indicatorId)
    .limit(1)
    .single();

  if (data) {
    return { alpha: Number(data.alpha), beta: Number(data.beta), evidence_count: data.evidence_count };
  }

  // Create with uniform prior Beta(1, 1)
  const { error } = await db
    .from('politician_indicators')
    .insert({
      politician_id: politicianId,
      indicator_id: indicatorId,
      alpha: 1.0,
      beta: 1.0,
      evidence_count: 0,
      last_updated: new Date().toISOString(),
    });

  if (error) {
    console.warn(`  [ERR] Create indicator state ${indicatorId} for ${politicianId}: ${error.message}`);
  }

  return { alpha: 1.0, beta: 1.0, evidence_count: 0 };
}

// -- Time decay (spec §3) ----------------------------------------------------

/**
 * Recompute decayed alpha/beta from the evidence log at query time.
 * Applies exponential decay per indicator half-life and epoch dampening.
 */
export async function decayedState(
  politicianId: string,
  indicatorId: string,
  asOf?: Date,
): Promise<DecayedState> {
  const queryDate = asOf ?? new Date();
  const db = getServiceClient();

  // Fetch indicator definition for half-life
  const { data: indDef } = await db
    .from('indicator_definitions')
    .select('radar, half_life_years')
    .eq('id', indicatorId)
    .single();

  const halfLife = indDef ? Number(indDef.half_life_years) : RADAR_HALF_LIVES.policy;

  // Fetch all audit evidence rows for this politician × indicator
  const { data: evidenceRows } = await db
    .from('politician_indicator_evidence')
    .select('id, evidence_id, anchor, effective_weight, applied_at')
    .eq('politician_id', politicianId)
    .eq('indicator_id', indicatorId)
    .order('applied_at', { ascending: true });

  if (!evidenceRows || evidenceRows.length === 0) {
    return { alpha: 1.0, beta: 1.0, evidence_count: 0 };
  }

  // Fetch evidence dates for decay computation
  const evidenceIds = evidenceRows.map((r) => r.evidence_id);
  const { data: evidenceDates } = await db
    .from('politician_evidence')
    .select('id, occurred_at')
    .in('id', evidenceIds);

  const dateMap = new Map<number, Date>();
  for (const e of evidenceDates ?? []) {
    dateMap.set(e.id, new Date(e.occurred_at));
  }

  // Pre-fetch epoch transitions for this politician
  const epochs = await getEpochTransitions(politicianId, queryDate);

  let alpha = 1.0;
  let beta = 1.0;

  for (const row of evidenceRows) {
    const occurredAt = dateMap.get(row.evidence_id) ?? new Date(row.applied_at);
    const decay = decayFactor(occurredAt, queryDate, halfLife);
    const epochDamp = computeEpochDampening(epochs, occurredAt, queryDate);
    const w = Number(row.effective_weight) * decay * epochDamp;
    alpha += Number(row.anchor) * w;
    beta += (1 - Number(row.anchor)) * w;
  }

  return { alpha, beta, evidence_count: evidenceRows.length };
}

// -- Epoch dampening (spec §5.2) ---------------------------------------------

/**
 * Fetch epoch transitions relevant to a politician (personal + global).
 */
export async function getEpochTransitions(
  politicianId: string,
  queryDate: Date,
): Promise<EpochTransition[]> {
  const db = getServiceClient();

  const { data } = await db
    .from('epoch_transitions')
    .select('*')
    .or(`politician_id.eq.${politicianId},politician_id.is.null`)
    .lte('event_date', queryDate.toISOString());

  return (data ?? []).map(rowToEpochTransition);
}

/**
 * Compute epoch dampening multiplier for a single evidence row.
 * Spec §5.2: check pre-event window and post-event dampening for each transition.
 */
export function computeEpochDampening(
  transitions: EpochTransition[],
  evidenceDate: Date,
  queryDate: Date,
): number {
  let dampening = 1.0;

  for (const t of transitions) {
    const tEvent = new Date(t.effective_date);
    const daysBefore = daysBetween(evidenceDate, tEvent);

    // Pre-event window: evidence within N days before the event
    if (daysBefore > 0 && daysBefore <= t.pre_event_window_days) {
      dampening *= t.pre_event_dampening;
    }

    // Post-event dampening: evidence after the event
    if (evidenceDate >= tEvent && t.post_event_dampening < 1.0) {
      dampening *= t.post_event_dampening;
    }
  }

  return dampening;
}

function rowToEpochTransition(row: Record<string, unknown>): EpochTransition {
  return {
    id: row.id as number,
    politician_id: row.politician_id as string | null,
    event_type: row.event_type as EpochEventType,
    event_date: row.event_date as string,
    effective_date: row.effective_date as string,
    pre_event_window_days: row.pre_event_window_days as number,
    pre_event_dampening: Number(row.pre_event_dampening),
    post_event_dampening: Number(row.post_event_dampening),
    source: row.source as string,
    notes: row.notes as string | null,
    created_at: row.created_at as string,
  };
}

// -- Correlation propagation (spec §4.2) -------------------------------------

/**
 * Fetch correlations for a given indicator (both directions).
 */
export async function getCorrelationsFor(
  indicatorId: string,
): Promise<Array<{ target_indicator_id: string; correlation: number }>> {
  const db = getServiceClient();

  const { data } = await db
    .from('indicator_correlations')
    .select('indicator_a, indicator_b, correlation')
    .or(`indicator_a.eq.${indicatorId},indicator_b.eq.${indicatorId}`);

  if (!data) return [];

  return data.map((row) => {
    const isA = row.indicator_a === indicatorId;
    return {
      target_indicator_id: isA ? row.indicator_b : row.indicator_a,
      correlation: Number(row.correlation),
    };
  });
}

/**
 * Propagate a direct classification update to correlated indicators.
 * Spec §4.2: dampened updates with anchor inversion for negative correlations.
 * Spec §4.3: single-hop rule — propagated updates do not themselves propagate.
 */
export async function propagate(
  sourceIndicatorId: string,
  politicianId: string,
  evidenceId: number,
  anchor: number,
  effectiveWeight: number,
  classifierVersion: string,
): Promise<{ propagated: number }> {
  const correlations = await getCorrelationsFor(sourceIndicatorId);
  let propagated = 0;

  for (const { target_indicator_id, correlation } of correlations) {
    const targetAnchor = correlation > 0 ? anchor : 1 - anchor;
    const propagatedWeight = effectiveWeight * Math.abs(correlation) * PROPAGATION_DAMPENING;

    if (propagatedWeight < 0.001) continue; // skip negligible propagations

    await applyClassification(
      politicianId,
      evidenceId,
      {
        indicator_id: target_indicator_id,
        anchor: targetAnchor,
        raw_weight: propagatedWeight,
        effective_weight: propagatedWeight,
        classifier_version: classifierVersion,
        classifier_reasoning: `Propagated from ${sourceIndicatorId} (correlation: ${correlation.toFixed(2)})`,
      },
      { propagationSource: sourceIndicatorId },
    );

    propagated++;
  }

  return { propagated };
}

// -- Audit chain (spec §7) ---------------------------------------------------

/**
 * Compute a full audited posterior for a politician × indicator.
 * Returns the posterior, all contributing evidence with per-row breakdowns,
 * and applied epochs.
 */
export async function auditedPosterior(
  politicianId: string,
  indicatorId: string,
  asOf?: Date,
): Promise<AuditedPosterior> {
  const queryDate = asOf ?? new Date();
  const db = getServiceClient();

  // Fetch indicator definition
  const { data: indDef } = await db
    .from('indicator_definitions')
    .select('radar, half_life_years')
    .eq('id', indicatorId)
    .single();

  const halfLife = indDef ? Number(indDef.half_life_years) : RADAR_HALF_LIVES.policy;

  // Fetch all audit evidence rows
  const { data: auditRows } = await db
    .from('politician_indicator_evidence')
    .select('*')
    .eq('politician_id', politicianId)
    .eq('indicator_id', indicatorId)
    .order('applied_at', { ascending: true });

  if (!auditRows || auditRows.length === 0) {
    const p = posterior(1.0, 1.0);
    return {
      politician_id: politicianId,
      indicator_id: indicatorId,
      as_of: queryDate.toISOString(),
      posterior: p,
      alpha: 1.0,
      beta: 1.0,
      contributing_evidence: [],
      propagated_from: [],
      applied_epochs: [],
    };
  }

  // Fetch evidence metadata (type, source_url, occurred_at)
  const evidenceIds = auditRows.map((r) => r.evidence_id);
  const { data: evidenceMeta } = await db
    .from('politician_evidence')
    .select('id, evidence_type, source_url, occurred_at')
    .in('id', evidenceIds);

  const metaMap = new Map<number, { evidence_type: string; source_url: string | null; occurred_at: string }>();
  for (const e of evidenceMeta ?? []) {
    metaMap.set(e.id, {
      evidence_type: e.evidence_type,
      source_url: e.source_url,
      occurred_at: e.occurred_at,
    });
  }

  // Fetch epochs
  const epochs = await getEpochTransitions(politicianId, queryDate);

  // Build evidence chain with per-row breakdowns
  let alpha = 1.0;
  let beta = 1.0;
  const contributing: AuditedEvidenceRow[] = [];
  const propagatedFrom: AuditedEvidenceRow[] = [];
  const appliedEpochSet = new Map<string, { event_type: EpochEventType; event_date: string; dampening: number }>();

  for (const row of auditRows) {
    const meta = metaMap.get(row.evidence_id);
    const occurredAt = meta ? new Date(meta.occurred_at) : new Date(row.applied_at);
    const decay = decayFactor(occurredAt, queryDate, halfLife);
    const epochDamp = computeEpochDampening(epochs, occurredAt, queryDate);
    const w = Number(row.effective_weight) * decay * epochDamp;
    const contribAlpha = Number(row.anchor) * w;
    const contribBeta = (1 - Number(row.anchor)) * w;

    alpha += contribAlpha;
    beta += contribBeta;

    // Track which epochs affected this evidence row
    for (const t of epochs) {
      const tEvent = new Date(t.effective_date);
      const daysBefore = daysBetween(occurredAt, tEvent);
      const inPreWindow = daysBefore > 0 && daysBefore <= t.pre_event_window_days;
      const inPostWindow = occurredAt >= tEvent && t.post_event_dampening < 1.0;
      if (inPreWindow || inPostWindow) {
        const key = `${t.event_type}-${t.event_date}`;
        if (!appliedEpochSet.has(key)) {
          appliedEpochSet.set(key, {
            event_type: t.event_type,
            event_date: t.event_date,
            dampening: inPreWindow ? t.pre_event_dampening : t.post_event_dampening,
          });
        }
      }
    }

    const auditRow: AuditedEvidenceRow = {
      evidence_id: row.evidence_id,
      evidence_type: (meta?.evidence_type ?? 'unknown') as AuditedEvidenceRow['evidence_type'],
      source_url: meta?.source_url ?? null,
      occurred_at: meta?.occurred_at ?? row.applied_at,
      anchor: Number(row.anchor),
      raw_weight: Number(row.raw_weight),
      effective_weight: w,
      contribution_to_alpha: contribAlpha,
      contribution_to_beta: contribBeta,
      classifier_version: row.classifier_version,
      classifier_reasoning: row.classifier_reasoning,
      decay_factor: decay,
      epoch_dampening: epochDamp,
      propagation_source: row.propagation_source,
    };

    if (row.propagation_source) {
      propagatedFrom.push(auditRow);
    } else {
      contributing.push(auditRow);
    }
  }

  const p = posterior(alpha, beta);

  return {
    politician_id: politicianId,
    indicator_id: indicatorId,
    as_of: queryDate.toISOString(),
    posterior: p,
    alpha,
    beta,
    contributing_evidence: contributing,
    propagated_from: propagatedFrom,
    applied_epochs: Array.from(appliedEpochSet.values()),
  };
}

// -- Materialized view refresh -----------------------------------------------

/**
 * Refresh the politician_indicators_decayed materialized view.
 * Calls the refresh_indicators_decayed() RPC function in Postgres.
 */
export async function refreshMaterializedView(): Promise<void> {
  const db = getServiceClient();
  const { error } = await db.rpc('refresh_indicators_decayed');
  if (error) {
    console.warn(`  [ERR] Refresh materialized view: ${error.message}`);
  }
}
