import { generateText, tool } from 'ai';
import { z } from 'zod';
import { anthropic } from '@ai-sdk/anthropic';
import { getServiceClient } from '@/lib/db';
import { posterior } from '@/lib/math/beta';
import { decayedState } from '@/lib/math/indicators';
import { withRetry } from '@/lib/ai/retry';
import { CLASSIFIER_MODEL, CLASSIFIER_MAX_TOKENS } from '@/lib/classifier/constants';
import { weightedAverage, blend, generateCaveats } from './utils';
import type {
  PositionPredictionInput,
  PositionPredictionResult,
  IndicatorDriver,
  IssueIndicatorLoad,
  NetworkPeer,
  SignalResult,
  NetworkSignalResult,
} from './types';

const SIGNAL_WEIGHTS = {
  ideology: 0.4,
  adjacent: 0.35,
  network: 0.25,
};

/**
 * Predict a politician's position on an emerging issue without direct evidence.
 * Blends three signals: ideology priors, adjacent policy, and network propagation.
 */
export async function predictPosition(input: PositionPredictionInput): Promise<PositionPredictionResult> {
  const predictionId = crypto.randomUUID();
  const asOf = input.as_of ?? new Date();

  // 1. Classify issue against ideology indicators via LLM
  const issueLoads = await classifyIssueIndicators(input.issue_text);

  // 2. Compute each signal
  const ideology = await computeIdeologySignal(input.politician_id, issueLoads, asOf);
  const adjacent = await computeAdjacentSignal(input.politician_id, issueLoads, asOf);
  const network = await computeNetworkSignal(input.politician_id, issueLoads, asOf);

  // 3. Blend signals — drop any with zero data and redistribute weights
  const signals = [
    { key: 'ideology' as const, result: ideology, baseWeight: SIGNAL_WEIGHTS.ideology },
    { key: 'adjacent' as const, result: adjacent, baseWeight: SIGNAL_WEIGHTS.adjacent },
    { key: 'network' as const, result: network, baseWeight: SIGNAL_WEIGHTS.network },
  ];

  const activeSignals = signals.filter((s) => {
    if (s.key === 'network') return (s.result as NetworkSignalResult).aligned_politicians.length > 0;
    return (s.result as SignalResult).indicators.length > 0;
  });

  const totalActiveWeight = activeSignals.reduce((sum, s) => sum + s.baseWeight, 0);

  let positionScore = 0.5;
  const blendedWeights = { ideology: 0, adjacent: 0, network: 0 };

  if (totalActiveWeight > 0) {
    const items: Array<{ value: number; weight: number }> = [];
    for (const s of activeSignals) {
      const normalizedWeight = s.baseWeight / totalActiveWeight;
      blendedWeights[s.key] = normalizedWeight;
      items.push({ value: s.result.score, weight: normalizedWeight });
    }
    positionScore = weightedAverage(items);
  }

  // 4. Compute confidence from contributing indicators
  const allIndicators = [
    ...ideology.indicators,
    ...adjacent.indicators,
  ];
  const avgConfidence = allIndicators.length > 0
    ? allIndicators.reduce((sum, i) => sum + i.posterior_confidence, 0) / allIndicators.length
    : 0;

  // 5. CI: simple approximation from mean and confidence
  const halfWidth = 0.5 * (1 - avgConfidence);
  const ci: [number, number] = [
    Math.max(0, positionScore - halfWidth),
    Math.min(1, positionScore + halfWidth),
  ];

  // 6. Caveats
  const caveats = generateCaveats(
    allIndicators.map((i) => ({
      evidence_count: i.evidence_count,
      confidence: i.posterior_confidence,
      indicator_id: i.indicator_id,
    })),
  );

  if (issueLoads.length === 0) {
    caveats.push('Could not map issue to any ideology indicators. Prediction based on adjacent policy and network only.');
  }

  return {
    prediction_id: predictionId,
    politician_id: input.politician_id,
    issue_text: input.issue_text,
    position_score: clamp(positionScore),
    confidence: clamp(avgConfidence),
    ci_95: ci,
    signals: {
      ideology,
      adjacent_policy: adjacent,
      network,
    },
    blended_weights: blendedWeights,
    caveats,
    as_of: asOf.toISOString(),
  };
}

// -- Signal 1: Ideology -------------------------------------------------------

async function computeIdeologySignal(
  politicianId: string,
  issueLoads: IssueIndicatorLoad[],
  asOf: Date,
): Promise<SignalResult> {
  const ideologyLoads = issueLoads.filter((l) => l.indicator_id.includes('ideology'));
  if (ideologyLoads.length === 0) return { score: 0.5, weight: 0, indicators: [] };

  const drivers: IndicatorDriver[] = [];
  const items: Array<{ value: number; weight: number }> = [];

  for (const load of ideologyLoads) {
    const revealedId = ensureVariant(load.indicator_id, '.revealed');
    const state = await decayedState(politicianId, revealedId, asOf);
    const post = posterior(state.alpha, state.beta);

    // If load_direction is positive, high mean = favourable
    // If negative, low mean = favourable
    const aligned = load.load_direction > 0 ? post.mean : 1 - post.mean;
    const weight = load.relevance * post.confidence;

    items.push({ value: aligned, weight });

    drivers.push({
      indicator_id: revealedId,
      label_low: '',
      label_high: '',
      posterior_mean: post.mean,
      posterior_confidence: post.confidence,
      diagnostic_strength: load.relevance,
      contribution_to_p_aye: aligned * weight,
      evidence_count: state.evidence_count,
    });
  }

  return {
    score: weightedAverage(items),
    weight: SIGNAL_WEIGHTS.ideology,
    indicators: drivers,
  };
}

// -- Signal 2: Adjacent policy ------------------------------------------------

async function computeAdjacentSignal(
  politicianId: string,
  issueLoads: IssueIndicatorLoad[],
  asOf: Date,
): Promise<SignalResult> {
  const db = getServiceClient();

  // Get unique policy areas from the issue loads
  const policyAreas = [...new Set(issueLoads.map((l) => l.policy_area))];
  if (policyAreas.length === 0) return { score: 0.5, weight: 0, indicators: [] };

  // Fetch all indicators in those policy areas
  const { data: defs } = await db
    .from('indicator_definitions')
    .select('id, label_low, label_high')
    .in('policy_area', policyAreas);

  if (!defs || defs.length === 0) return { score: 0.5, weight: 0, indicators: [] };

  const drivers: IndicatorDriver[] = [];
  const items: Array<{ value: number; weight: number }> = [];

  for (const def of defs) {
    const revealedId = ensureVariant(def.id as string, '.revealed');
    const state = await decayedState(politicianId, revealedId, asOf);
    const post = posterior(state.alpha, state.beta);

    if (state.evidence_count === 0) continue;

    // Weight by evidence count (more evidence = more signal)
    const weight = Math.min(state.evidence_count / 10, 1.0) * post.confidence;
    items.push({ value: post.mean, weight });

    drivers.push({
      indicator_id: revealedId,
      label_low: def.label_low as string,
      label_high: def.label_high as string,
      posterior_mean: post.mean,
      posterior_confidence: post.confidence,
      diagnostic_strength: weight,
      contribution_to_p_aye: post.mean * weight,
      evidence_count: state.evidence_count,
    });
  }

  return {
    score: weightedAverage(items),
    weight: SIGNAL_WEIGHTS.adjacent,
    indicators: drivers,
  };
}

// -- Signal 3: Network --------------------------------------------------------

async function computeNetworkSignal(
  politicianId: string,
  issueLoads: IssueIndicatorLoad[],
  asOf: Date,
): Promise<NetworkSignalResult> {
  const db = getServiceClient();

  // Fetch top voting alignment partners
  const { data: alignments } = await db
    .from('politician_voting_alignment')
    .select('politician_a, politician_b, alignment, shared_divisions')
    .or(`politician_a.eq.${politicianId},politician_b.eq.${politicianId}`)
    .gt('alignment', 0.5)
    .gt('shared_divisions', 20)
    .order('alignment', { ascending: false })
    .limit(10);

  if (!alignments || alignments.length === 0) {
    return { score: 0.5, weight: 0, aligned_politicians: [] };
  }

  // Get the "other" politician in each alignment pair
  const peers = alignments.map((a) => ({
    id: a.politician_a === politicianId ? a.politician_b : a.politician_a,
    alignment: Number(a.alignment),
    shared_divisions: a.shared_divisions as number,
  }));

  // Fetch peer names
  const peerIds = peers.map((p) => p.id);
  const { data: peerInfo } = await db
    .from('politicians')
    .select('id, display_name, party')
    .in('id', peerIds);

  const nameMap = new Map(
    (peerInfo ?? []).map((p) => [p.id, { name: p.display_name as string, party: p.party as string | null }]),
  );

  // Get relevant indicator IDs from issue loads
  const indicatorIds = issueLoads.map((l) => ensureVariant(l.indicator_id, '.revealed'));

  const networkPeers: NetworkPeer[] = [];
  const items: Array<{ value: number; weight: number }> = [];

  for (const peer of peers) {
    // Check if this peer has position data on relevant indicators
    let peerScore: number | null = null;
    let totalWeight = 0;

    for (const indId of indicatorIds) {
      const state = await decayedState(peer.id, indId, asOf);
      if (state.evidence_count > 0) {
        const post = posterior(state.alpha, state.beta);
        const w = post.confidence;
        if (peerScore === null) peerScore = 0;
        peerScore += post.mean * w;
        totalWeight += w;
      }
    }

    if (peerScore !== null && totalWeight > 0) {
      peerScore /= totalWeight;
    }

    const info = nameMap.get(peer.id);
    networkPeers.push({
      politician_id: peer.id,
      politician_name: info?.name ?? '',
      party: info?.party ?? null,
      alignment: peer.alignment,
      shared_divisions: peer.shared_divisions,
      their_position: peerScore,
    });

    if (peerScore !== null) {
      items.push({
        value: peerScore,
        weight: peer.alignment * (peer.shared_divisions / 100),
      });
    }
  }

  return {
    score: weightedAverage(items),
    weight: SIGNAL_WEIGHTS.network,
    aligned_politicians: networkPeers,
  };
}

// -- LLM issue classification -------------------------------------------------

const issueClassificationSchema = z.object({
  indicator_loads: z.array(z.object({
    indicator_id: z.string(),
    load_direction: z.number().min(-1).max(1),
    relevance: z.number().min(0).max(1),
    policy_area: z.string(),
  })),
});

async function classifyIssueIndicators(issueText: string): Promise<IssueIndicatorLoad[]> {
  const db = getServiceClient();

  // Fetch ideology indicators
  const { data: indicators } = await db
    .from('indicator_definitions')
    .select('id, radar, policy_area, label_low, label_high, description')
    .in('radar', ['ideology', 'policy']);

  if (!indicators || indicators.length === 0) return [];

  const indicatorList = indicators
    .map((i) => `- ${i.id} [${i.radar}/${i.policy_area}]: "${i.label_low}" (0) <-> "${i.label_high}" (1) — ${i.description}`)
    .join('\n');

  const prompt = `You are classifying a political issue against position indicators.

ISSUE:
"""
${issueText}
"""

CANDIDATE INDICATORS:
${indicatorList}

For each indicator that this issue loads on, output:
- indicator_id (must match exactly)
- load_direction: -1.0 (issue pushes toward label_low) to +1.0 (toward label_high)
- relevance: 0.0 to 1.0 (how strongly does this issue relate to this indicator?)
- policy_area: the indicator's policy_area field

Rules:
1. Only include indicators with relevance >= 0.3
2. Output at most 6 indicators
3. Consider both direct policy alignment and ideological dimensions
4. Output JSON only via the tool call. No prose.`;

  try {
    const { toolCalls } = await withRetry(() =>
      generateText({
        model: anthropic(CLASSIFIER_MODEL),
        maxOutputTokens: CLASSIFIER_MAX_TOKENS,
        temperature: 0,
        tools: {
          classify_issue: tool({
            description: 'Classify which indicators this issue loads on',
            inputSchema: issueClassificationSchema,
          }),
        },
        toolChoice: { type: 'tool', toolName: 'classify_issue' },
        prompt,
      }),
    );

    const result = toolCalls?.[0]?.input as z.infer<typeof issueClassificationSchema> | undefined;
    if (!result) return [];

    // Validate indicator IDs exist
    const validIds = new Set(indicators.map((i) => i.id as string));
    return result.indicator_loads
      .filter((l) => validIds.has(l.indicator_id))
      .slice(0, 6);
  } catch (err) {
    console.warn('[PREDICTIONS] Issue classification LLM call failed:', err);
    return [];
  }
}

// -- Helpers ------------------------------------------------------------------

function ensureVariant(indicatorId: string, variant: string): string {
  if (indicatorId.endsWith('.revealed') || indicatorId.endsWith('.public')) {
    return indicatorId;
  }
  return `${indicatorId}${variant}`;
}

function clamp(v: number): number {
  return Math.max(0, Math.min(1, v));
}
