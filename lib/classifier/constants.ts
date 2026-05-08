// ---------------------------------------------------------------------------
// Classifier constants — weights, routing rules, venue adjustments.
// All tunable values live here rather than buried in classifier logic.
// ---------------------------------------------------------------------------

import type { EvidenceType } from '@/types/politician';

// -- Base weights per evidence type ------------------------------------------
// Higher = more diagnostic. Division votes are the gold standard.

export const BASE_WEIGHTS: Record<EvidenceType, number> = {
  division_vote: 3.0,
  committee_question: 2.0,
  amendment_tabled: 1.8,
  chamber_speech: 1.5,
  committee_speech: 1.5,
  written_question_asked: 1.5,
  written_question_answered: 1.5,
  op_ed: 1.5,
  oral_question_asked: 1.2,
  oral_question_answered: 1.2,
  interview: 1.0,
  press_release: 0.6,
  appg_membership: 0.5,
  committee_membership: 0.6,
  social_post: 0.4,
  edm_signature: 0.3,
  edm_proposed: 0.5,
  register_of_interests: 1.0,
};

// -- Public vs revealed routing ----------------------------------------------
// Each evidence type routes to .public, .revealed, or both.

export type IndicatorVariant = 'public' | 'revealed';

interface RoutingRule {
  primary: IndicatorVariant;
  secondary?: IndicatorVariant;
  secondary_weight_factor?: number; // multiplied against raw_weight for secondary
}

export const EVIDENCE_ROUTING: Record<EvidenceType, RoutingRule> = {
  division_vote:            { primary: 'revealed' },
  register_of_interests:    { primary: 'revealed' },
  committee_membership:     { primary: 'revealed' },
  amendment_tabled:         { primary: 'public' },
  chamber_speech:           { primary: 'public' },
  committee_speech:         { primary: 'public' },
  written_question_asked:   { primary: 'public' },
  written_question_answered:{ primary: 'public' },
  oral_question_asked:      { primary: 'public' },
  oral_question_answered:   { primary: 'public' },
  op_ed:                    { primary: 'public' },
  press_release:            { primary: 'public' },
  interview:                { primary: 'public' },
  committee_question:       { primary: 'public', secondary: 'revealed', secondary_weight_factor: 0.5 },
  appg_membership:          { primary: 'public' },
  edm_signature:            { primary: 'public' },
  edm_proposed:             { primary: 'public' },
  social_post:              { primary: 'public' },
};

// -- Evidence types that use deterministic classifiers -----------------------

export const DETERMINISTIC_TYPES: Set<EvidenceType> = new Set([
  'division_vote',
  'register_of_interests',
  'appg_membership',
  'committee_membership',
]);

// -- Evidence types that use LLM classifiers ---------------------------------

export const LLM_TYPES: Set<EvidenceType> = new Set([
  'chamber_speech',
  'committee_speech',
  'committee_question',
  'written_question_asked',
  'written_question_answered',
  'oral_question_asked',
  'oral_question_answered',
  'amendment_tabled',
  'op_ed',
  'press_release',
  'interview',
  'social_post',
  'edm_signature',
  'edm_proposed',
]);

// -- Venue adjustments for interviews ----------------------------------------
// Normalised source name → weight multiplier.

const VENUE_MAP: Record<string, number> = {
  'today':       1.0,
  'newsnight':   1.0,
  'ft':          1.0,
  'financial times': 1.0,
  'times':       1.0,
  'the times':   1.0,
  'bbc':         1.0,
  'sky news':    0.9,
  'itv':         0.9,
  'channel 4':   0.9,
  'guardian':     0.9,
  'telegraph':   0.9,
  'gb news':     0.6,
  'talktv':      0.6,
  'talk tv':     0.6,
  'talk radio':  0.6,
  'lbc':         0.7,
  'spectator':   0.7,
  'new statesman': 0.7,
  'trade press': 0.8,
  'constituency': 0.7,
  'local':       0.7,
  'podcast':     0.6,
};

/**
 * Returns a venue-based weight adjustment for interview evidence.
 * Non-interview types return 1.0.
 */
export function getVenueAdjustment(sourceUrl: string | null, evidenceType: EvidenceType): number {
  if (evidenceType !== 'interview') return 1.0;
  if (!sourceUrl) return 0.8; // unknown venue gets moderate discount

  const lower = sourceUrl.toLowerCase();
  for (const [venue, multiplier] of Object.entries(VENUE_MAP)) {
    if (lower.includes(venue)) return multiplier;
  }
  return 0.8; // unrecognised venue
}

// -- Post-processing thresholds ----------------------------------------------

/** Drop LLM classifications below this confidence. */
export const MIN_CONFIDENCE = 0.6;

/** Clamp anchor values to this range (never emit exactly 0 or 1). */
export const ANCHOR_MIN = 0.05;
export const ANCHOR_MAX = 0.95;

/** Maximum classifications per evidence row from LLM. */
export const MAX_CLASSIFICATIONS_PER_EVIDENCE = 4;

/** Social post hard weight cap. */
export const SOCIAL_POST_WEIGHT_CAP = 0.5;

/** LLM model for classification. */
export const CLASSIFIER_MODEL = 'claude-sonnet-4-20250514' as const;

/** Max output tokens for classifier calls. */
export const CLASSIFIER_MAX_TOKENS = 1500;
