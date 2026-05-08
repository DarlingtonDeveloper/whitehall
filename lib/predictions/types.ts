import type { EvidenceType, RoleType, Posterior } from '@/types/politician';

// -- Vote prediction ----------------------------------------------------------

export interface VotePredictionInput {
  politician_id: string;
  bill_id: string;
  amendment_id?: string;
  as_of?: Date;
}

export interface VotePredictionResult {
  prediction_id: string;
  politician_id: string;
  bill_id: string;
  amendment_id: string | null;
  p_aye: number;
  p_no: number;
  p_aye_base: number; // before whip blend
  ci_95: [number, number];
  drivers: IndicatorDriver[];
  key_evidence: KeyEvidence[];
  whip_adjustment: WhipAdjustment;
  caveats: string[];
  as_of: string;
}

export interface IndicatorDriver {
  indicator_id: string;
  label_low: string;
  label_high: string;
  posterior_mean: number;
  posterior_confidence: number;
  diagnostic_strength: number;
  contribution_to_p_aye: number;
  evidence_count: number;
}

export interface KeyEvidence {
  evidence_id: number;
  evidence_type: EvidenceType;
  occurred_at: string;
  source_url: string | null;
  anchor: number;
  effective_weight: number;
  indicator_id: string;
}

export interface WhipAdjustment {
  whipped: boolean;
  whip_direction: 'aye' | 'no' | null;
  rebellion_rate: number;
  whip_p_aye: number;
  weight: number;
  is_frontbench: boolean;
}

// -- Position prediction ------------------------------------------------------

export interface PositionPredictionInput {
  politician_id: string;
  issue_text: string;
  as_of?: Date;
}

export interface PositionPredictionResult {
  prediction_id: string;
  politician_id: string;
  issue_text: string;
  position_score: number; // 0 = against, 1 = in favour
  confidence: number;
  ci_95: [number, number];
  signals: {
    ideology: SignalResult;
    adjacent_policy: SignalResult;
    network: NetworkSignalResult;
  };
  blended_weights: { ideology: number; adjacent: number; network: number };
  caveats: string[];
  as_of: string;
}

export interface SignalResult {
  score: number;
  weight: number;
  indicators: IndicatorDriver[];
}

export interface NetworkSignalResult {
  score: number;
  weight: number;
  aligned_politicians: NetworkPeer[];
}

export interface NetworkPeer {
  politician_id: string;
  politician_name: string;
  party: string | null;
  alignment: number;
  shared_divisions: number;
  their_position: number | null;
}

// -- Issue classification (LLM output for position prediction) ----------------

export interface IssueIndicatorLoad {
  indicator_id: string;
  load_direction: number; // -1 = negative, +1 = positive on that indicator
  relevance: number;      // 0..1
  policy_area: string;
}

// -- Coalition mapping --------------------------------------------------------

export interface CoalitionInput {
  policy_area: string;
  k?: number;
  politician_filter?: {
    party?: string;
    house?: string;
    status?: string;
  };
}

export interface CoalitionResult {
  prediction_id: string;
  policy_area: string;
  k: number;
  silhouette_score: number;
  clusters: Cluster[];
}

export interface Cluster {
  id: number;
  centroid: Record<string, number>; // indicator_id -> mean
  members: ClusterMember[];
  defining_indicators: DefiningIndicator[];
}

export interface ClusterMember {
  politician_id: string;
  politician_name: string;
  party: string | null;
  distance_to_centroid: number;
}

export interface DefiningIndicator {
  indicator_id: string;
  label_low: string;
  label_high: string;
  cluster_mean: number;
  other_clusters_mean: number;
}

// -- Swing identification -----------------------------------------------------

export interface SwingInput {
  policy_area?: string;
  bill_id?: string;
  limit?: number;
}

export interface SwingResult {
  prediction_id: string;
  policy_area: string | null;
  bill_id: string | null;
  swings: SwingPolitician[];
}

export interface SwingPolitician {
  politician_id: string;
  politician_name: string;
  party: string | null;
  uncertainty_score: number;
  influence_score: number;
  swing_score: number;
  posterior_mean: number;
  ci_width: number;
  role_type: RoleType | null;
  evidence_count: number;
}

// -- Evidence information gain ------------------------------------------------

export interface EigInput {
  politician_id: string;
  prediction_id: string;
}

export interface EigResult {
  prediction_id: string;
  gaps: EvidenceGap[];
}

export interface EvidenceGap {
  indicator_id: string;
  current_variance: number;
  projected_variance_n5: number;
  variance_reduction: number;
  contribution_weight: number;
  priority_score: number;
  suggested_evidence_types: EvidenceType[];
}

// -- Backtest -----------------------------------------------------------------

export interface BacktestInput {
  division_ids: number[];
  politician_ids?: string[];
}

export interface BacktestResult {
  prediction_id: string;
  n_predictions: number;
  accuracy: number;
  log_loss: number;
  ci_coverage: number;
  calibration: CalibrationBucket[];
  per_division: DivisionBacktest[];
}

export interface CalibrationBucket {
  bucket_low: number;
  bucket_high: number;
  predicted_mean: number;
  actual_rate: number;
  count: number;
}

export interface DivisionBacktest {
  division_id: number;
  division_title: string;
  predictions_made: number;
  accuracy: number;
  mean_log_loss: number;
}

// -- Prediction log -----------------------------------------------------------

export type PredictionType = 'vote' | 'position' | 'coalition' | 'swing' | 'eig' | 'backtest';

export interface PredictionLogEntry {
  id: string;
  prediction_type: PredictionType;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  outcome?: Record<string, unknown>;
  created_at: string;
}
