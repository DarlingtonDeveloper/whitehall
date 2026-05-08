import { describe, it, expect } from 'vitest';
import { weightedAverage, blend } from '../utils';

/**
 * Test the vote prediction core logic in isolation:
 * - P(aye) computation from ratio-of-distances
 * - Whip blending
 * - Edge cases
 */

// Extracted from vote.ts: compute per-indicator P(aye) using ratio of distances
function computePAye(posteriorMean: number, ayeAnchor: number, noAnchor: number): number {
  const distAye = Math.abs(posteriorMean - ayeAnchor);
  const distNo = Math.abs(posteriorMean - noAnchor);
  const denom = distAye + distNo;
  return denom > 0.001 ? distNo / denom : 0.5;
}

describe('vote P(aye) from indicator distances', () => {
  it('strong pro-aye position → high P(aye)', () => {
    // Politician posterior mean = 0.9, aye_anchor = 0.9, no_anchor = 0.1
    // Close to aye → P(aye) should be high
    const pAye = computePAye(0.9, 0.9, 0.1);
    expect(pAye).toBeGreaterThan(0.85);
  });

  it('strong pro-no position → low P(aye)', () => {
    // Politician posterior mean = 0.1, aye_anchor = 0.9, no_anchor = 0.1
    // Close to no → P(aye) should be low
    const pAye = computePAye(0.1, 0.9, 0.1);
    expect(pAye).toBeLessThan(0.15);
  });

  it('neutral position → P(aye) near 0.5', () => {
    const pAye = computePAye(0.5, 0.9, 0.1);
    expect(pAye).toBeCloseTo(0.5, 1);
  });

  it('inverted anchors: aye_anchor < no_anchor', () => {
    // Some bills: voting aye means opposing the norm
    // aye_anchor = 0.2, no_anchor = 0.8
    // Politician at 0.2 → should be high P(aye)
    const pAye = computePAye(0.2, 0.2, 0.8);
    expect(pAye).toBeGreaterThan(0.85);
  });

  it('equal anchors → returns 0.5', () => {
    const pAye = computePAye(0.7, 0.5, 0.5);
    expect(pAye).toBe(0.5);
  });

  it('exact match to aye_anchor → P(aye) = 1', () => {
    const pAye = computePAye(0.8, 0.8, 0.2);
    expect(pAye).toBe(1.0);
  });

  it('exact match to no_anchor → P(aye) = 0', () => {
    const pAye = computePAye(0.2, 0.8, 0.2);
    expect(pAye).toBe(0.0);
  });
});

describe('vote weighted average across indicators', () => {
  it('single indicator passes through', () => {
    const result = weightedAverage([{ value: 0.75, weight: 1.0 }]);
    expect(result).toBeCloseTo(0.75);
  });

  it('strong indicator dominates weak one', () => {
    const result = weightedAverage([
      { value: 0.9, weight: 0.95 },  // strong: reviewed mapping
      { value: 0.3, weight: 0.3 },   // weak: unreviewed
    ]);
    // Should be closer to 0.9
    expect(result).toBeGreaterThan(0.7);
  });

  it('equal weights produce simple average', () => {
    const result = weightedAverage([
      { value: 0.8, weight: 0.5 },
      { value: 0.4, weight: 0.5 },
    ]);
    expect(result).toBeCloseTo(0.6);
  });
});

describe('whip blending', () => {
  it('no whip → base prediction unmodified', () => {
    const base = 0.6;
    const result = blend(base, 1.0, 0); // weight=0 means no whip influence
    expect(result).toBe(base);
  });

  it('minister whip pulls strongly toward whip direction', () => {
    const base = 0.3; // base predicts no
    const whipPAye = 1.0; // whip says aye
    const weight = 0.95; // minister
    const result = blend(base, whipPAye, weight);
    expect(result).toBeGreaterThan(0.9);
  });

  it('rebel backbencher: whip has moderate effect', () => {
    const base = 0.3;
    const whipPAye = 1.0;
    const rebellionRate = 0.4;
    const weight = (1 - rebellionRate) * 0.7; // 0.42
    const result = blend(base, whipPAye, weight);
    // Should be between base and whip, closer to base
    expect(result).toBeGreaterThan(base);
    expect(result).toBeLessThan(0.8);
  });

  it('loyal backbencher: whip has strong effect', () => {
    const base = 0.3;
    const whipPAye = 1.0;
    const rebellionRate = 0.02;
    const weight = (1 - rebellionRate) * 0.7; // ~0.686
    const result = blend(base, whipPAye, weight);
    expect(result).toBeGreaterThan(0.7);
  });

  it('whip direction no: pulls probability down', () => {
    const base = 0.7; // base predicts aye
    const whipPAye = 0.0; // whip says no
    const weight = 0.6;
    const result = blend(base, whipPAye, weight);
    expect(result).toBeLessThan(0.4);
  });
});

describe('edge cases', () => {
  it('all indicators at Beta(1,1) prior → P(aye) = 0.5', () => {
    // mean = 0.5 for uniform prior
    const pAye = computePAye(0.5, 0.8, 0.2);
    expect(pAye).toBeCloseTo(0.5);
  });

  it('very close anchors → small differences still produce signal', () => {
    // aye_anchor = 0.55, no_anchor = 0.45
    // posterior at 0.54 → very close to aye_anchor (dist=0.01) vs no (dist=0.09)
    // ratio-of-distances: 0.09 / (0.01 + 0.09) = 0.9
    const pAye = computePAye(0.54, 0.55, 0.45);
    expect(pAye).toBeGreaterThan(0.5);
    expect(pAye).toBeCloseTo(0.9, 1);
  });
});
