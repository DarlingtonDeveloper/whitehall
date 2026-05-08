// -- Person-level record -----------------------------------------------------

export interface Politician {
  id: string;
  parliament_member_id: number | null;
  full_name: string;
  display_name: string;
  party: string | null;
  party_history: PartyEntry[];
  house: 'commons' | 'lords' | 'both' | 'former';
  constituency: string | null;
  constituency_history: ConstituencyEntry[];
  first_elected: string | null;
  peerage_date: string | null;
  portrait_url: string | null;
  bio: string | null;
  gender: string | null;
  date_of_birth: string | null;
  status: 'active' | 'retired' | 'deceased' | 'defeated';
  created_at: string;
  updated_at: string;
}

export interface PartyEntry {
  party: string;
  start_date: string;
  end_date: string | null;
}

export interface ConstituencyEntry {
  constituency: string;
  start_date: string;
  end_date: string | null;
}

// -- Roles -------------------------------------------------------------------

export type RoleType =
  | 'minister'
  | 'shadow_minister'
  | 'spokesperson'
  | 'select_committee_member'
  | 'select_committee_chair'
  | 'frontbench'
  | 'backbench';

export type RoleSource =
  | 'gov-uk-api'
  | 'parliament-api'
  | 'manual'
  | 'hansard-derived';

export interface PoliticianRole {
  id: number;
  politician_id: string;
  role_entity_id: string;
  role_type: RoleType;
  start_date: string;
  end_date: string | null;
  source: RoleSource;
  created_at: string;
}

// -- Evidence ----------------------------------------------------------------

export type EvidenceType =
  | 'division_vote'
  | 'chamber_speech'
  | 'committee_speech'
  | 'committee_question'
  | 'written_question_asked'
  | 'written_question_answered'
  | 'oral_question_asked'
  | 'oral_question_answered'
  | 'edm_signature'
  | 'edm_proposed'
  | 'amendment_tabled'
  | 'op_ed'
  | 'press_release'
  | 'interview'
  | 'register_of_interests'
  | 'appg_membership'
  | 'committee_membership'
  | 'social_post';

export type EvidenceSource =
  | 'hansard'
  | 'parliament-api'
  | 'members-api'
  | 'register'
  | 'govuk'
  | 'rss'
  | 'manual';

export interface PoliticianEvidence {
  id: number;
  politician_id: string;
  evidence_type: EvidenceType;
  source: EvidenceSource;
  source_id: string | null;
  source_url: string | null;
  occurred_at: string;
  ingested_at: string;
  raw_content: string | null;
  parsed: EvidenceParsed;
  topic_tags: string[];
  entity_ids: string[];
  fingerprint: string;
}

// -- Parsed JSONB shapes per evidence type -----------------------------------

export type EvidenceParsed =
  | DivisionVoteParsed
  | SpeechParsed
  | WrittenQuestionParsed
  | CommitteeQuestionParsed
  | EdmSignatureParsed
  | RegisterEntryParsed
  | AppgMembershipParsed
  | Record<string, unknown>;

export interface DivisionVoteParsed {
  division_id: number;
  division_title: string;
  vote: 'aye' | 'no' | 'abstain' | 'absent' | 'teller_aye' | 'teller_no';
  whipped: boolean | null;
  whip_direction: 'aye' | 'no' | null;
  broke_whip: boolean | null;
  bill_ref: string | null;
  amendment_ref: string | null;
}

export interface SpeechParsed {
  debate_id: string;
  debate_title: string;
  contribution_id: string;
  word_count: number;
  intervention: boolean;
  position: 'opening' | 'closing' | 'middle';
}

export interface WrittenQuestionParsed {
  wq_id: string;
  question_text: string;
  answering_body: string;
  answered_at: string | null;
  answer_text: string | null;
  group_id: string | null;
}

export interface CommitteeQuestionParsed {
  committee_id: string;
  session_id: string;
  witness_name: string | null;
  witness_role: string | null;
  question_count: number;
}

export interface EdmSignatureParsed {
  edm_id: string;
  edm_title: string;
  primary_signatory_id: number | null;
}

export interface RegisterEntryParsed {
  category: string;
  description: string;
  value: string | null;
  registered_on: string;
  related_org: string | null;
}

export interface AppgMembershipParsed {
  appg_id: string;
  appg_name: string;
  role: 'chair' | 'vice_chair' | 'officer' | 'member';
}

// -- Indicators --------------------------------------------------------------

export type Radar = 'policy' | 'ideology' | 'faction' | 'behaviour' | 'career' | 'network';

export interface IndicatorDefinition {
  id: string;
  radar: Radar;
  policy_area: string | null;
  label_low: string;
  label_high: string;
  description: string;
  half_life_years: number;
  created_at: string;
}

export interface PoliticianIndicator {
  politician_id: string;
  indicator_id: string;
  alpha: number;
  beta: number;
  evidence_count: number;
  last_updated: string;
}

export interface PoliticianIndicatorEvidence {
  id: number;
  politician_id: string;
  indicator_id: string;
  evidence_id: number;
  anchor: number;
  raw_weight: number;
  effective_weight: number;
  applied_at: string;
  classifier_version: string;
  classifier_reasoning: string | null;
  propagation_source: string | null;
}

// -- Classification (classifier output) --------------------------------------

export interface Classification {
  indicator_id: string;
  anchor: number;
  raw_weight: number;
  effective_weight: number;
  classifier_version: string;
  classifier_reasoning: string | null;
}

// -- Derived quantities ------------------------------------------------------

export interface Posterior {
  mean: number;
  variance: number;
  effective_sample_size: number;
  confidence: number;
  ci_95: [number, number];
}

export interface DecayedState {
  alpha: number;
  beta: number;
  evidence_count: number;
}

// -- Indicator correlations --------------------------------------------------

export type CorrelationSource =
  | 'hand_coded'
  | 'derived_from_voting'
  | 'derived_from_classifications';

export interface IndicatorCorrelation {
  indicator_a: string;
  indicator_b: string;
  correlation: number;
  source: CorrelationSource;
  notes: string | null;
  updated_at: string;
}

// -- Epoch transitions -------------------------------------------------------

export type EpochEventType =
  | 'general_election'
  | 'leadership_change'
  | 'cabinet_reshuffle'
  | 'role_change'
  | 'defection'
  | 'resignation'
  | 'scandal'
  | 'whip_withdrawn'
  | 'whip_restored';

export interface EpochTransition {
  id: number;
  politician_id: string | null;
  event_type: EpochEventType;
  event_date: string;
  effective_date: string;
  pre_event_window_days: number;
  pre_event_dampening: number;
  post_event_dampening: number;
  source: string;
  notes: string | null;
  created_at: string;
}

// -- Cross-politician voting alignment ---------------------------------------

export interface PoliticianVotingAlignment {
  politician_a: string;
  politician_b: string;
  alignment: number;
  shared_divisions: number;
  computed_at: string;
}

// -- Audit chain -------------------------------------------------------------

export interface AuditedEvidenceRow {
  evidence_id: number;
  evidence_type: EvidenceType;
  source_url: string | null;
  occurred_at: string;
  anchor: number;
  raw_weight: number;
  effective_weight: number;
  contribution_to_alpha: number;
  contribution_to_beta: number;
  classifier_version: string;
  classifier_reasoning: string | null;
  decay_factor: number;
  epoch_dampening: number;
  propagation_source: string | null;
}

export interface AuditedPosterior {
  politician_id: string;
  indicator_id: string;
  as_of: string;
  posterior: Posterior;
  alpha: number;
  beta: number;
  contributing_evidence: AuditedEvidenceRow[];
  propagated_from: AuditedEvidenceRow[];
  applied_epochs: Array<{ event_type: EpochEventType; event_date: string; dampening: number }>;
}

// -- Match review queue ------------------------------------------------------

export interface PoliticianMatchReview {
  id: number;
  entity_id: string;
  entity_name: string;
  current_holder: string;
  candidate_ids: MemberCandidate[];
  status: 'pending' | 'resolved' | 'skipped';
  resolved_politician_id: string | null;
  notes: string | null;
  created_at: string;
}

export interface MemberCandidate {
  member_id: number;
  name: string;
  party: string | null;
  constituency: string | null;
  house: string;
  score: number;
}
