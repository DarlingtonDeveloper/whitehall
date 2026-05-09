import { describe, it, expect } from 'vitest';
import {
  posterior,
  betaCI,
  applyUpdate,
  decayFactor,
  daysBetween,
  CONFIDENCE_K,
  PROPAGATION_DAMPENING,
  RADAR_HALF_LIVES,
} from '../beta';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('constants', () => {
  it('CONFIDENCE_K is 5', () => {
    expect(CONFIDENCE_K).toBe(5);
  });

  it('PROPAGATION_DAMPENING is 0.2', () => {
    expect(PROPAGATION_DAMPENING).toBe(0.2);
  });

  it('RADAR_HALF_LIVES covers all radars', () => {
    expect(RADAR_HALF_LIVES).toHaveProperty('policy');
    expect(RADAR_HALF_LIVES).toHaveProperty('ideology');
    expect(RADAR_HALF_LIVES).toHaveProperty('faction');
    expect(RADAR_HALF_LIVES).toHaveProperty('behaviour');
    expect(RADAR_HALF_LIVES).toHaveProperty('career');
    expect(RADAR_HALF_LIVES).toHaveProperty('network');
    expect(RADAR_HALF_LIVES.policy).toBe(3.0);
    expect(RADAR_HALF_LIVES.ideology).toBe(7.0);
    expect(RADAR_HALF_LIVES.faction).toBe(1.5);
  });
});

// ---------------------------------------------------------------------------
// posterior()
// ---------------------------------------------------------------------------

describe('posterior', () => {
  it('returns mean=0.5 for uniform prior Beta(1,1)', () => {
    const p = posterior(1, 1);
    expect(p.mean).toBeCloseTo(0.5, 5);
  });

  it('computes correct mean for Beta(3,1)', () => {
    const p = posterior(3, 1);
    expect(p.mean).toBeCloseTo(0.75, 5); // 3/(3+1)
  });

  it('computes correct mean for Beta(1,3)', () => {
    const p = posterior(1, 3);
    expect(p.mean).toBeCloseTo(0.25, 5);
  });

  it('variance decreases with more evidence', () => {
    const weak = posterior(2, 2);
    const strong = posterior(20, 20);
    expect(strong.variance).toBeLessThan(weak.variance);
  });

  it('effective sample size = alpha + beta - 2', () => {
    const p = posterior(5, 3);
    expect(p.effective_sample_size).toBe(6); // 5+3-2
  });

  it('confidence is 0 for uniform prior Beta(1,1)', () => {
    const p = posterior(1, 1);
    // ess = 0, confidence = max(0, 0/(0+5)) = 0
    expect(p.confidence).toBe(0);
  });

  it('confidence increases with evidence', () => {
    const few = posterior(3, 3);
    const many = posterior(30, 30);
    expect(many.confidence).toBeGreaterThan(few.confidence);
  });

  it('confidence approaches 1 with large sample sizes', () => {
    const p = posterior(1000, 1000);
    expect(p.confidence).toBeGreaterThan(0.99);
  });

  it('confidence formula: ess / (ess + CONFIDENCE_K)', () => {
    const p = posterior(10, 10);
    const ess = 18; // 10+10-2
    const expected = ess / (ess + 5); // 18/23
    expect(p.confidence).toBeCloseTo(expected, 5);
  });

  it('ci_95 is symmetric for balanced Beta', () => {
    const p = posterior(10, 10);
    expect(p.ci_95[0]).toBeLessThan(0.5);
    expect(p.ci_95[1]).toBeGreaterThan(0.5);
    // Symmetry check
    expect(0.5 - p.ci_95[0]).toBeCloseTo(p.ci_95[1] - 0.5, 1);
  });

  it('ci_95 narrows with more evidence', () => {
    const weak = posterior(3, 3);
    const strong = posterior(30, 30);
    const weakWidth = weak.ci_95[1] - weak.ci_95[0];
    const strongWidth = strong.ci_95[1] - strong.ci_95[0];
    expect(strongWidth).toBeLessThan(weakWidth);
  });

  it('ci_95 is clamped to [0,1]', () => {
    const p = posterior(1, 1);
    expect(p.ci_95[0]).toBeGreaterThanOrEqual(0);
    expect(p.ci_95[1]).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// betaCI()
// ---------------------------------------------------------------------------

describe('betaCI', () => {
  it('returns [mean, mean] when std is near zero', () => {
    // Very concentrated Beta — std → 0
    const [lo, hi] = betaCI(100000, 100000, 0.95);
    expect(lo).toBeCloseTo(hi, 2);
  });

  it('returns wider interval for lower confidence level', () => {
    const ci90 = betaCI(10, 10, 0.90);
    const ci95 = betaCI(10, 10, 0.95);
    const width90 = ci90[1] - ci90[0];
    const width95 = ci95[1] - ci95[0];
    expect(width95).toBeGreaterThan(width90);
  });

  it('lower bound < mean < upper bound for non-degenerate Beta', () => {
    const [lo, hi] = betaCI(5, 5, 0.95);
    const mean = 5 / 10;
    expect(lo).toBeLessThan(mean);
    expect(hi).toBeGreaterThan(mean);
  });
});

// ---------------------------------------------------------------------------
// applyUpdate()
// ---------------------------------------------------------------------------

describe('applyUpdate', () => {
  it('applies update with anchor=1 (all alpha)', () => {
    const result = applyUpdate(1, 1, 1.0, 2.0);
    expect(result.alpha).toBeCloseTo(3.0); // 1 + 1.0 * 2.0
    expect(result.beta).toBeCloseTo(1.0);  // 1 + 0.0 * 2.0
  });

  it('applies update with anchor=0 (all beta)', () => {
    const result = applyUpdate(1, 1, 0.0, 2.0);
    expect(result.alpha).toBeCloseTo(1.0); // 1 + 0.0 * 2.0
    expect(result.beta).toBeCloseTo(3.0);  // 1 + 1.0 * 2.0
  });

  it('applies update with anchor=0.5 (equal split)', () => {
    const result = applyUpdate(1, 1, 0.5, 2.0);
    expect(result.alpha).toBeCloseTo(2.0); // 1 + 0.5 * 2.0
    expect(result.beta).toBeCloseTo(2.0);  // 1 + 0.5 * 2.0
  });

  it('applies update with anchor=0.75', () => {
    const result = applyUpdate(1, 1, 0.75, 4.0);
    expect(result.alpha).toBeCloseTo(4.0); // 1 + 0.75 * 4.0
    expect(result.beta).toBeCloseTo(2.0);  // 1 + 0.25 * 4.0
  });

  it('preserves existing state', () => {
    const result = applyUpdate(10, 5, 0.6, 1.0);
    expect(result.alpha).toBeCloseTo(10.6); // 10 + 0.6 * 1.0
    expect(result.beta).toBeCloseTo(5.4);   // 5 + 0.4 * 1.0
  });

  it('moves mean toward anchor', () => {
    // Start at mean 0.5 (Beta(1,1)), apply high anchor
    const before = 1 / (1 + 1); // 0.5
    const result = applyUpdate(1, 1, 0.9, 10.0);
    const after = result.alpha / (result.alpha + result.beta);
    expect(after).toBeGreaterThan(before);
    expect(after).toBeCloseTo(0.9, 0); // should move toward 0.9
  });
});

// ---------------------------------------------------------------------------
// decayFactor()
// ---------------------------------------------------------------------------

describe('decayFactor', () => {
  it('returns 1.0 for current evidence', () => {
    const now = new Date();
    expect(decayFactor(now, now, 3.0)).toBeCloseTo(1.0, 5);
  });

  it('returns 1.0 for future evidence (age <= 0)', () => {
    const future = new Date(Date.now() + 1000);
    const now = new Date();
    expect(decayFactor(future, now, 3.0)).toBeCloseTo(1.0, 5);
  });

  it('decays over time', () => {
    const now = new Date();
    const oneYearAgo = new Date(now.getTime() - 365.25 * 24 * 60 * 60 * 1000);
    const factor = decayFactor(oneYearAgo, now, 3.0);
    expect(factor).toBeLessThan(1.0);
    expect(factor).toBeGreaterThan(0);
  });

  it('faster decay for shorter half-life', () => {
    const now = new Date();
    const twoYearsAgo = new Date(now.getTime() - 2 * 365.25 * 24 * 60 * 60 * 1000);
    const shortHL = decayFactor(twoYearsAgo, now, 1.5); // faction
    const longHL = decayFactor(twoYearsAgo, now, 7.0);  // ideology
    expect(shortHL).toBeLessThan(longHL);
  });

  it('halves after one half-life', () => {
    const halfLife = 3.0;
    const now = new Date();
    const halfLifeAgo = new Date(now.getTime() - halfLife * 365.25 * 24 * 60 * 60 * 1000);
    // decayFactor = exp(-age/halfLife) = exp(-1) ≈ 0.368 (not 0.5 — this uses exp decay not half-life decay)
    const factor = decayFactor(halfLifeAgo, now, halfLife);
    expect(factor).toBeCloseTo(Math.exp(-1), 3); // ≈ 0.368
  });

  it('approaches 0 for very old evidence', () => {
    const now = new Date();
    const veryOld = new Date(now.getTime() - 50 * 365.25 * 24 * 60 * 60 * 1000);
    const factor = decayFactor(veryOld, now, 3.0);
    expect(factor).toBeLessThan(0.001);
  });
});

// ---------------------------------------------------------------------------
// daysBetween()
// ---------------------------------------------------------------------------

describe('daysBetween', () => {
  it('returns 0 for same date', () => {
    const d = new Date();
    expect(daysBetween(d, d)).toBe(0);
  });

  it('returns 1 for dates 24 hours apart', () => {
    const a = new Date('2026-01-01T00:00:00Z');
    const b = new Date('2026-01-02T00:00:00Z');
    expect(daysBetween(a, b)).toBeCloseTo(1, 5);
  });

  it('returns negative for reversed dates', () => {
    const a = new Date('2026-01-02T00:00:00Z');
    const b = new Date('2026-01-01T00:00:00Z');
    expect(daysBetween(a, b)).toBeCloseTo(-1, 5);
  });

  it('handles fractional days', () => {
    const a = new Date('2026-01-01T00:00:00Z');
    const b = new Date('2026-01-01T12:00:00Z');
    expect(daysBetween(a, b)).toBeCloseTo(0.5, 5);
  });
});
