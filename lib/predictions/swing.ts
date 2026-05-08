import { getServiceClient } from '@/lib/db';
import { posterior } from '@/lib/math/beta';
import { getBillPolicyMappings } from '@/lib/classifier/deterministic';
import type { SwingInput, SwingResult, SwingPolitician } from './types';
import type { RoleType } from '@/types/politician';

const ROLE_WEIGHTS: Record<RoleType, number> = {
  minister: 1.0,
  shadow_minister: 0.9,
  select_committee_chair: 0.85,
  frontbench: 0.7,
  spokesperson: 0.6,
  select_committee_member: 0.5,
  backbench: 0.3,
};

/**
 * Identify swing politicians — those with high uncertainty AND high influence
 * in a policy area or on a specific bill.
 */
export async function identifySwings(input: SwingInput): Promise<SwingResult> {
  const predictionId = crypto.randomUUID();
  const db = getServiceClient();
  const limit = input.limit ?? 20;

  // 1. Determine relevant indicator IDs
  let indicatorIds: string[] = [];

  if (input.bill_id) {
    const mappings = await getBillPolicyMappings(input.bill_id, null);
    indicatorIds = mappings.map((m) => ensureRevealed(m.indicator_id));
  }

  if (indicatorIds.length === 0 && input.policy_area) {
    const { data: defs } = await db
      .from('indicator_definitions')
      .select('id')
      .eq('policy_area', input.policy_area);
    indicatorIds = (defs ?? []).map((d) => ensureRevealed(d.id as string));
  }

  if (indicatorIds.length === 0) {
    return { prediction_id: predictionId, policy_area: input.policy_area ?? null, bill_id: input.bill_id ?? null, swings: [] };
  }

  // 2. Bulk-read from materialized view
  const { data: decayed } = await db
    .from('politician_indicators_decayed')
    .select('politician_id, indicator_id, alpha_decayed, beta_decayed, evidence_count')
    .in('indicator_id', indicatorIds);

  if (!decayed || decayed.length === 0) {
    return { prediction_id: predictionId, policy_area: input.policy_area ?? null, bill_id: input.bill_id ?? null, swings: [] };
  }

  // 3. Group by politician
  const byPolitician = new Map<string, Array<{
    alpha: number; beta: number; evidence_count: number;
  }>>();

  for (const row of decayed) {
    const pid = row.politician_id as string;
    if (!byPolitician.has(pid)) byPolitician.set(pid, []);
    byPolitician.get(pid)!.push({
      alpha: Number(row.alpha_decayed),
      beta: Number(row.beta_decayed),
      evidence_count: row.evidence_count as number,
    });
  }

  // 4. Fetch active politicians
  const politicianIds = [...byPolitician.keys()];
  const { data: politicians } = await db
    .from('politicians')
    .select('id, display_name, party, status')
    .in('id', politicianIds)
    .eq('status', 'active');

  if (!politicians || politicians.length === 0) {
    return { prediction_id: predictionId, policy_area: input.policy_area ?? null, bill_id: input.bill_id ?? null, swings: [] };
  }

  // 5. Fetch current roles
  const { data: roles } = await db
    .from('politician_roles')
    .select('politician_id, role_type')
    .in('politician_id', politicianIds)
    .is('end_date', null);

  const roleMap = new Map<string, RoleType>();
  for (const r of roles ?? []) {
    const current = roleMap.get(r.politician_id as string);
    const rType = r.role_type as RoleType;
    // Keep the highest-priority role
    if (!current || (ROLE_WEIGHTS[rType] ?? 0) > (ROLE_WEIGHTS[current] ?? 0)) {
      roleMap.set(r.politician_id as string, rType);
    }
  }

  // 6. Fetch evidence type diversity per politician
  const { data: evidenceDiversity } = await db
    .from('politician_evidence')
    .select('politician_id, evidence_type')
    .in('politician_id', politicianIds);

  const diversityMap = new Map<string, Set<string>>();
  for (const e of evidenceDiversity ?? []) {
    if (!diversityMap.has(e.politician_id)) diversityMap.set(e.politician_id, new Set());
    diversityMap.get(e.politician_id)!.add(e.evidence_type as string);
  }

  // 7. Compute scores
  const candidates: SwingPolitician[] = [];

  for (const pol of politicians) {
    const indicators = byPolitician.get(pol.id as string);
    if (!indicators || indicators.length === 0) continue;

    // Average posterior across relevant indicators
    let meanSum = 0;
    let confSum = 0;
    let totalEvidence = 0;
    let ciWidthSum = 0;

    for (const ind of indicators) {
      const p = posterior(ind.alpha, ind.beta);
      meanSum += p.mean;
      confSum += p.confidence;
      totalEvidence += ind.evidence_count;
      ciWidthSum += p.ci_95[1] - p.ci_95[0];
    }

    const avgMean = meanSum / indicators.length;
    const avgConf = confSum / indicators.length;
    const avgCiWidth = ciWidthSum / indicators.length;

    // Uncertainty: closeness to 0.5 + low confidence
    const closeness = 1 - 2 * Math.abs(avgMean - 0.5);
    const lowConf = 1 - avgConf;
    const uncertainty = 0.6 * closeness + 0.4 * lowConf;

    // Influence: role + engagement + visibility
    const role = roleMap.get(pol.id as string) ?? 'backbench';
    const roleWeight = ROLE_WEIGHTS[role] ?? 0.3;
    const engagement = Math.min(totalEvidence / 50, 1.0);
    const uniqueTypes = diversityMap.get(pol.id as string)?.size ?? 0;
    const visibility = Math.min(uniqueTypes / 18, 1.0);
    const influence = 0.5 * roleWeight + 0.3 * engagement + 0.2 * visibility;

    const swingScore = uncertainty * influence;

    candidates.push({
      politician_id: pol.id as string,
      politician_name: pol.display_name as string,
      party: pol.party as string | null,
      uncertainty_score: round(uncertainty),
      influence_score: round(influence),
      swing_score: round(swingScore),
      posterior_mean: round(avgMean),
      ci_width: round(avgCiWidth),
      role_type: role,
      evidence_count: totalEvidence,
    });
  }

  // 8. Rank by swing score, take top N
  candidates.sort((a, b) => b.swing_score - a.swing_score);

  return {
    prediction_id: predictionId,
    policy_area: input.policy_area ?? null,
    bill_id: input.bill_id ?? null,
    swings: candidates.slice(0, limit),
  };
}

function ensureRevealed(indicatorId: string): string {
  if (indicatorId.endsWith('.revealed') || indicatorId.endsWith('.public')) {
    return indicatorId;
  }
  return `${indicatorId}.revealed`;
}

function round(v: number, decimals = 4): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}
