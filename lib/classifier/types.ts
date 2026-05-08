// ---------------------------------------------------------------------------
// Classifier output types — shared contract between deterministic and LLM
// classifiers. Both produce Classification[] for downstream consumption.
// ---------------------------------------------------------------------------

import type { EvidenceType, IndicatorDefinition, PoliticianEvidence } from '@/types/politician';

export interface Classification {
  indicator_id: string;
  anchor: number;        // 0..1, position implied by this evidence
  raw_weight: number;    // base weight for evidence type, before decay
  confidence: number;    // 0..1, classifier's confidence
  reasoning: string;     // <=200 chars, audit trail
}

export interface ClassifierResult {
  evidence_id: number;
  classifications: Classification[];
  classifier_version: string;
  no_classification_reason?: string;
  cost_usd: number;
  latency_ms: number;
}

/** Input bundle for the LLM classifier. */
export interface ClassifierInput {
  evidence: {
    type: EvidenceType;
    content: string;
    occurred_at: string;
    source_url: string | null;
    parsed: Record<string, unknown>;
  };
  politician: {
    name: string;
    party: string | null;
    current_role: string | null;
    constituency: string | null;
  };
  candidate_indicators: Array<{
    id: string;
    radar: string;
    label_low: string;
    label_high: string;
    description: string;
  }>;
  context_window: {
    recent: Array<{ indicator_id: string; anchor: number; date: string }>;
  };
}

// -- Mapping table row types --------------------------------------------------

export interface BillPolicyMapping {
  id: number;
  bill_id: string;
  amendment_id: string | null;
  stage: string | null;
  indicator_id: string;
  aye_anchor: number;
  no_anchor: number;
  diagnostic_strength: number;
  created_by: 'auto-llm' | 'manual' | 'imported';
  reviewed: boolean;
  notes: string | null;
  created_at: string;
}

export interface OrgIndicatorMapping {
  org_name: string;
  org_aliases: string[];
  indicator_id: string;
  anchor: number;
  weight_multiplier: number;
  rationale: string;
}

export interface AppgIndicatorMapping {
  appg_id: string;
  indicator_id: string;
  anchor: number;
  weight_multiplier: number;
}

export interface CommitteeIndicatorMapping {
  committee_id: string;
  indicator_id: string;
  membership_anchor: number;
  chair_anchor: number | null;
  weight_multiplier: number;
}

export interface ClassifierFailure {
  id: number;
  evidence_id: number;
  classifier_version: string;
  error_type: string;
  error_message: string | null;
  retry_count: number;
  resolved: boolean;
  created_at: string;
}

/** Pre-filtered indicator for candidate selection. */
export type CandidateIndicator = Pick<
  IndicatorDefinition,
  'id' | 'radar' | 'label_low' | 'label_high' | 'description'
>;
