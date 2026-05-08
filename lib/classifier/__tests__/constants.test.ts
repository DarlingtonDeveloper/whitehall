import { describe, it, expect } from 'vitest';
import {
  BASE_WEIGHTS,
  EVIDENCE_ROUTING,
  DETERMINISTIC_TYPES,
  LLM_TYPES,
  getVenueAdjustment,
  MIN_CONFIDENCE,
  ANCHOR_MIN,
  ANCHOR_MAX,
  SOCIAL_POST_WEIGHT_CAP,
} from '../constants';
import type { EvidenceType } from '@/types/politician';

// All 18 evidence types from the type definition
const ALL_EVIDENCE_TYPES: EvidenceType[] = [
  'division_vote', 'chamber_speech', 'committee_speech', 'committee_question',
  'written_question_asked', 'written_question_answered', 'oral_question_asked',
  'oral_question_answered', 'edm_signature', 'edm_proposed', 'amendment_tabled',
  'op_ed', 'press_release', 'interview', 'register_of_interests',
  'appg_membership', 'committee_membership', 'social_post',
];

describe('BASE_WEIGHTS', () => {
  it('covers every evidence type', () => {
    for (const type of ALL_EVIDENCE_TYPES) {
      expect(BASE_WEIGHTS[type]).toBeDefined();
      expect(BASE_WEIGHTS[type]).toBeGreaterThan(0);
    }
  });

  it('division_vote has the highest weight', () => {
    const max = Math.max(...Object.values(BASE_WEIGHTS));
    expect(BASE_WEIGHTS.division_vote).toBe(max);
  });

  it('social_post has a low weight', () => {
    expect(BASE_WEIGHTS.social_post).toBeLessThanOrEqual(0.5);
  });
});

describe('EVIDENCE_ROUTING', () => {
  it('covers every evidence type', () => {
    for (const type of ALL_EVIDENCE_TYPES) {
      expect(EVIDENCE_ROUTING[type]).toBeDefined();
      expect(EVIDENCE_ROUTING[type].primary).toMatch(/^(public|revealed)$/);
    }
  });

  it('division_vote routes to revealed only', () => {
    expect(EVIDENCE_ROUTING.division_vote.primary).toBe('revealed');
    expect(EVIDENCE_ROUTING.division_vote.secondary).toBeUndefined();
  });

  it('chamber_speech routes to public only', () => {
    expect(EVIDENCE_ROUTING.chamber_speech.primary).toBe('public');
    expect(EVIDENCE_ROUTING.chamber_speech.secondary).toBeUndefined();
  });

  it('committee_question has dual routing (public + revealed at half weight)', () => {
    const r = EVIDENCE_ROUTING.committee_question;
    expect(r.primary).toBe('public');
    expect(r.secondary).toBe('revealed');
    expect(r.secondary_weight_factor).toBe(0.5);
  });

  it('register_of_interests routes to revealed', () => {
    expect(EVIDENCE_ROUTING.register_of_interests.primary).toBe('revealed');
  });
});

describe('DETERMINISTIC_TYPES / LLM_TYPES', () => {
  it('every evidence type is in exactly one set', () => {
    for (const type of ALL_EVIDENCE_TYPES) {
      const inDet = DETERMINISTIC_TYPES.has(type);
      const inLlm = LLM_TYPES.has(type);
      expect(inDet || inLlm).toBe(true);
      expect(inDet && inLlm).toBe(false);
    }
  });

  it('deterministic types are the expected four', () => {
    expect(DETERMINISTIC_TYPES.size).toBe(4);
    expect(DETERMINISTIC_TYPES.has('division_vote')).toBe(true);
    expect(DETERMINISTIC_TYPES.has('register_of_interests')).toBe(true);
    expect(DETERMINISTIC_TYPES.has('appg_membership')).toBe(true);
    expect(DETERMINISTIC_TYPES.has('committee_membership')).toBe(true);
  });
});

describe('getVenueAdjustment', () => {
  it('returns 1.0 for non-interview evidence', () => {
    expect(getVenueAdjustment('https://gb.news/interview', 'chamber_speech')).toBe(1.0);
    expect(getVenueAdjustment(null, 'division_vote')).toBe(1.0);
  });

  it('returns 0.8 for null source URL on interview', () => {
    expect(getVenueAdjustment(null, 'interview')).toBe(0.8);
  });

  it('returns 1.0 for BBC interview', () => {
    expect(getVenueAdjustment('https://www.bbc.co.uk/news/interview', 'interview')).toBe(1.0);
  });

  it('returns 0.6 for GB News interview', () => {
    // Venue map key is "gb news" (with space) — URL must contain that substring
    expect(getVenueAdjustment('https://www.gb news.com/politics/interview', 'interview')).toBe(0.6);
  });

  it('returns 0.9 for Sky News interview', () => {
    expect(getVenueAdjustment('https://news.sky news.com/story/mp-interview', 'interview')).toBe(0.9);
  });

  it('returns 0.7 for LBC interview', () => {
    expect(getVenueAdjustment('https://www.lbc.co.uk/interview', 'interview')).toBe(0.7);
  });

  it('returns 0.8 for unrecognised venue', () => {
    expect(getVenueAdjustment('https://unknown-outlet.com/story', 'interview')).toBe(0.8);
  });

  it('returns 0.8 for URL without matching venue key', () => {
    // "gbnews.com" doesn't match "gb news" (space) — falls to default
    expect(getVenueAdjustment('https://www.gbnews.com/politics', 'interview')).toBe(0.8);
  });

  it('is case insensitive', () => {
    expect(getVenueAdjustment('https://www.BBC.CO.UK/news', 'interview')).toBe(1.0);
    expect(getVenueAdjustment('https://example.com/GB News/show', 'interview')).toBe(0.6);
  });
});

describe('threshold constants', () => {
  it('MIN_CONFIDENCE is between 0 and 1', () => {
    expect(MIN_CONFIDENCE).toBeGreaterThan(0);
    expect(MIN_CONFIDENCE).toBeLessThan(1);
  });

  it('anchor range does not include 0 or 1', () => {
    expect(ANCHOR_MIN).toBeGreaterThan(0);
    expect(ANCHOR_MAX).toBeLessThan(1);
    expect(ANCHOR_MIN).toBeLessThan(ANCHOR_MAX);
  });

  it('social post weight cap is reasonable', () => {
    expect(SOCIAL_POST_WEIGHT_CAP).toBeGreaterThan(0);
    expect(SOCIAL_POST_WEIGHT_CAP).toBeLessThan(BASE_WEIGHTS.division_vote);
  });
});
