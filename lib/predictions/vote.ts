import { getServiceClient } from '@/lib/db';
import { posterior } from '@/lib/math/beta';
import { decayedState, auditedPosterior } from '@/lib/math/indicators';
import { getBillPolicyMappings } from '@/lib/classifier/deterministic';
import { weightedAverage, blend, combinePosteriorCIs, generateCaveats, topEvidence } from './utils';
import type { VotePredictionInput, VotePredictionResult, WhipAdjustment, IndicatorDriver } from './types';
import type { Posterior, AuditedPosterior } from '@/types/politician';

/**
 * Predict how a politician will vote on a bill/amendment.
 * Returns P(aye) with indicator drivers, whip adjustment, key evidence, and CI.
 */
export async function predictVote(input: VotePredictionInput): Promise<VotePredictionResult> {
  const predictionId = crypto.randomUUID();
  const asOf = input.as_of ?? new Date();

  // 1. Fetch bill → indicator mappings
  const mappings = await getBillPolicyMappings(input.bill_id, input.amendment_id ?? null);

  if (mappings.length === 0) {
    return emptyResult(predictionId, input, asOf, ['No bill_policy_mappings found for this bill. Cannot predict.']);
  }

  // 2. Fetch decayed posteriors for each .revealed indicator
  const indicatorData: Array<{
    mapping: typeof mappings[0];
    state: { alpha: number; beta: number; evidence_count: number };
    post: Posterior;
    indicatorDef: { label_low: string; label_high: string } | null;
  }> = [];

  const db = getServiceClient();

  for (const m of mappings) {
    const revealedId = ensureRevealed(m.indicator_id);
    const state = await decayedState(input.politician_id, revealedId, asOf);
    const post = posterior(state.alpha, state.beta);

    // Fetch label info
    const { data: defData } = await db
      .from('indicator_definitions')
      .select('label_low, label_high')
      .eq('id', m.indicator_id)
      .maybeSingle();

    indicatorData.push({
      mapping: m,
      state,
      post,
      indicatorDef: defData as { label_low: string; label_high: string } | null,
    });
  }

  // 3. Compute per-indicator P(aye) using ratio-of-distances
  const drivers: IndicatorDriver[] = [];
  const pAyeItems: Array<{ value: number; weight: number }> = [];

  for (const { mapping, state, post, indicatorDef } of indicatorData) {
    const distAye = Math.abs(post.mean - mapping.aye_anchor);
    const distNo = Math.abs(post.mean - mapping.no_anchor);
    const denom = distAye + distNo;
    const pAyeI = denom > 0.001 ? distNo / denom : 0.5;

    const weight = mapping.diagnostic_strength;
    pAyeItems.push({ value: pAyeI, weight });

    drivers.push({
      indicator_id: ensureRevealed(mapping.indicator_id),
      label_low: indicatorDef?.label_low ?? '',
      label_high: indicatorDef?.label_high ?? '',
      posterior_mean: post.mean,
      posterior_confidence: post.confidence,
      diagnostic_strength: mapping.diagnostic_strength,
      contribution_to_p_aye: pAyeI * weight,
      evidence_count: state.evidence_count,
    });
  }

  // Sort drivers by |contribution|
  drivers.sort((a, b) => Math.abs(b.contribution_to_p_aye) - Math.abs(a.contribution_to_p_aye));

  // 4. Weighted average across indicators
  const pAyeBase = weightedAverage(pAyeItems);

  // 5. Fetch politician info for whip calculation
  const { data: politician } = await db
    .from('politicians')
    .select('party')
    .eq('id', input.politician_id)
    .maybeSingle();

  const party = politician?.party as string | null;

  // 6. Whip adjustment
  const whipAdj = await computeWhipAdjustment(
    input.politician_id,
    input.bill_id,
    input.amendment_id ?? null,
    party,
  );

  const pAye = whipAdj.weight > 0
    ? blend(pAyeBase, whipAdj.whip_p_aye, whipAdj.weight)
    : pAyeBase;

  // 7. Confidence interval
  const ci = combinePosteriorCIs(
    indicatorData.map(({ post, mapping }) => ({
      posterior: post,
      weight: mapping.diagnostic_strength,
    })),
  );

  // 8. Build audit chain — top 5 evidence items
  const auditedPosteriors: AuditedPosterior[] = [];
  for (const { mapping } of indicatorData) {
    const ap = await auditedPosterior(input.politician_id, ensureRevealed(mapping.indicator_id), asOf);
    auditedPosteriors.push(ap);
  }
  const keyEvidence = topEvidence(auditedPosteriors, 5);

  // 9. Generate caveats
  const caveats = generateCaveats(
    indicatorData.map(({ state, post }) => ({
      evidence_count: state.evidence_count,
      confidence: post.confidence,
      indicator_id: '',
    })),
  );

  return {
    prediction_id: predictionId,
    politician_id: input.politician_id,
    bill_id: input.bill_id,
    amendment_id: input.amendment_id ?? null,
    p_aye: clamp(pAye),
    p_no: clamp(1 - pAye),
    p_aye_base: clamp(pAyeBase),
    ci_95: ci,
    drivers,
    key_evidence: keyEvidence,
    whip_adjustment: whipAdj,
    caveats,
    as_of: asOf.toISOString(),
  };
}

// -- Whip adjustment ----------------------------------------------------------

async function computeWhipAdjustment(
  politicianId: string,
  billId: string,
  amendmentId: string | null,
  party: string | null,
): Promise<WhipAdjustment> {
  const noWhip: WhipAdjustment = {
    whipped: false,
    whip_direction: null,
    rebellion_rate: 0,
    whip_p_aye: 0.5,
    weight: 0,
    is_frontbench: false,
  };

  if (!party) return noWhip;

  // Infer whip direction from same-party members' votes on this bill
  const whipDir = await inferWhipDirection(billId, amendmentId, party);
  if (!whipDir) return noWhip;

  const rebellionRate = await getWhipRebellionRate(politicianId);
  const frontbench = await hasFrontbenchRole(politicianId);

  const whipPAye = whipDir === 'aye' ? 1.0 : 0.0;
  const weight = frontbench ? 0.95 : (1 - rebellionRate) * 0.7;

  return {
    whipped: true,
    whip_direction: whipDir,
    rebellion_rate: rebellionRate,
    whip_p_aye: whipPAye,
    weight: clamp(weight),
    is_frontbench: frontbench,
  };
}

/**
 * Infer whip direction from same-party members' votes on this bill.
 * If >85% of party members voted one way and were whipped, that's the direction.
 */
async function inferWhipDirection(
  billId: string,
  amendmentId: string | null,
  party: string,
): Promise<'aye' | 'no' | null> {
  const db = getServiceClient();

  // Find division votes on this bill by members of the same party
  // Try bill_ref first, fall back to division_id (Parliament API often has null bill_ref)
  let { data: votes } = await db
    .from('politician_evidence')
    .select('parsed, politician_id')
    .eq('evidence_type', 'division_vote')
    .filter('parsed->>bill_ref', 'eq', billId);

  if (!votes || votes.length === 0) {
    // Fall back to division_id
    const res = await db
      .from('politician_evidence')
      .select('parsed, politician_id')
      .eq('evidence_type', 'division_vote')
      .filter('parsed->>division_id', 'eq', billId);
    votes = res.data;
  }

  if (!votes || votes.length === 0) return null;

  // Filter to same-party politicians
  const politicianIds = [...new Set(votes.map((v) => v.politician_id))];
  const { data: politicians } = await db
    .from('politicians')
    .select('id, party')
    .in('id', politicianIds)
    .eq('party', party);

  if (!politicians || politicians.length === 0) return null;

  const partySet = new Set(politicians.map((p) => p.id));
  const partyVotes = votes.filter((v) => partySet.has(v.politician_id));

  // Filter by amendment if specified
  const relevant = amendmentId
    ? partyVotes.filter((v) => (v.parsed as Record<string, unknown>)?.amendment_ref === amendmentId)
    : partyVotes.filter((v) => !(v.parsed as Record<string, unknown>)?.amendment_ref);

  if (relevant.length < 3) return null; // not enough data

  // Count whipped votes by direction
  let whippedAye = 0;
  let whippedNo = 0;
  for (const v of relevant) {
    const parsed = v.parsed as Record<string, unknown>;
    if (parsed.whipped) {
      if (parsed.whip_direction === 'aye') whippedAye++;
      else if (parsed.whip_direction === 'no') whippedNo++;
    }
  }

  const total = whippedAye + whippedNo;
  if (total >= 3) {
    if (whippedAye / total > 0.85) return 'aye';
    if (whippedNo / total > 0.85) return 'no';
  }

  // Fallback: infer from raw vote direction when whip metadata is missing
  // If >85% of party members voted the same way, treat it as an implicit whip
  let rawAye = 0;
  let rawNo = 0;
  for (const v of relevant) {
    const parsed = v.parsed as Record<string, unknown>;
    const vote = parsed.vote as string;
    if (vote === 'aye') rawAye++;
    else if (vote === 'no') rawNo++;
  }

  const rawTotal = rawAye + rawNo;
  if (rawTotal < 3) return null;

  if (rawAye / rawTotal > 0.85) return 'aye';
  if (rawNo / rawTotal > 0.85) return 'no';

  return null; // genuinely mixed — likely a free vote
}

/**
 * Get the politician's historical whip rebellion rate.
 * Counts broke_whip=true vs total whipped division votes.
 */
async function getWhipRebellionRate(politicianId: string): Promise<number> {
  const db = getServiceClient();

  const { data: votes } = await db
    .from('politician_evidence')
    .select('parsed')
    .eq('politician_id', politicianId)
    .eq('evidence_type', 'division_vote');

  if (!votes || votes.length === 0) return 0;

  let whipped = 0;
  let rebellions = 0;

  for (const v of votes) {
    const parsed = v.parsed as Record<string, unknown>;
    if (parsed.whipped) {
      whipped++;
      if (parsed.broke_whip) rebellions++;
    }
  }

  return whipped > 0 ? rebellions / whipped : 0;
}

/**
 * Check if the politician currently holds a frontbench role.
 */
async function hasFrontbenchRole(politicianId: string): Promise<boolean> {
  const db = getServiceClient();

  const { data } = await db
    .from('politician_roles')
    .select('role_type')
    .eq('politician_id', politicianId)
    .is('end_date', null)
    .in('role_type', ['minister', 'shadow_minister', 'frontbench'])
    .limit(1);

  return (data?.length ?? 0) > 0;
}

// -- Helpers ------------------------------------------------------------------

/**
 * Ensure an indicator ID has the .revealed suffix.
 */
function ensureRevealed(indicatorId: string): string {
  if (indicatorId.endsWith('.revealed') || indicatorId.endsWith('.public')) {
    return indicatorId;
  }
  return `${indicatorId}.revealed`;
}

function clamp(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function emptyResult(
  predictionId: string,
  input: VotePredictionInput,
  asOf: Date,
  caveats: string[],
): VotePredictionResult {
  return {
    prediction_id: predictionId,
    politician_id: input.politician_id,
    bill_id: input.bill_id,
    amendment_id: input.amendment_id ?? null,
    p_aye: 0.5,
    p_no: 0.5,
    p_aye_base: 0.5,
    ci_95: [0, 1],
    drivers: [],
    key_evidence: [],
    whip_adjustment: {
      whipped: false,
      whip_direction: null,
      rebellion_rate: 0,
      whip_p_aye: 0.5,
      weight: 0,
      is_frontbench: false,
    },
    caveats,
    as_of: asOf.toISOString(),
  };
}
