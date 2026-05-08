import { describe, it, expect } from 'vitest';

/**
 * Test the swing identification scoring logic in isolation.
 * Uncertainty = 0.6 * closeness_to_0.5 + 0.4 * (1 - confidence)
 * Influence = 0.5 * role_weight + 0.3 * engagement + 0.2 * visibility
 * Swing = uncertainty * influence
 */

const ROLE_WEIGHTS: Record<string, number> = {
  minister: 1.0,
  shadow_minister: 0.9,
  select_committee_chair: 0.85,
  frontbench: 0.7,
  spokesperson: 0.6,
  select_committee_member: 0.5,
  backbench: 0.3,
};

function computeUncertainty(mean: number, confidence: number): number {
  const closeness = 1 - 2 * Math.abs(mean - 0.5);
  const lowConf = 1 - confidence;
  return 0.6 * closeness + 0.4 * lowConf;
}

function computeInfluence(
  roleType: string,
  evidenceCount: number,
  uniqueEvidenceTypes: number,
): number {
  const roleWeight = ROLE_WEIGHTS[roleType] ?? 0.3;
  const engagement = Math.min(evidenceCount / 50, 1.0);
  const visibility = Math.min(uniqueEvidenceTypes / 18, 1.0);
  return 0.5 * roleWeight + 0.3 * engagement + 0.2 * visibility;
}

describe('uncertainty scoring', () => {
  it('maximum uncertainty at mean=0.5, confidence=0', () => {
    const u = computeUncertainty(0.5, 0);
    expect(u).toBeCloseTo(1.0);
  });

  it('minimum uncertainty at mean=0 or 1, confidence=1', () => {
    const u1 = computeUncertainty(0, 1);
    expect(u1).toBeCloseTo(0.0);
    const u2 = computeUncertainty(1, 1);
    expect(u2).toBeCloseTo(0.0);
  });

  it('mean=0.5 with high confidence still has moderate uncertainty', () => {
    const u = computeUncertainty(0.5, 0.8);
    // closeness = 1.0, lowConf = 0.2
    // 0.6*1.0 + 0.4*0.2 = 0.68
    expect(u).toBeCloseTo(0.68);
  });

  it('mean=0.9 with low confidence has moderate uncertainty', () => {
    const u = computeUncertainty(0.9, 0.1);
    // closeness = 1 - 2*0.4 = 0.2, lowConf = 0.9
    // 0.6*0.2 + 0.4*0.9 = 0.12 + 0.36 = 0.48
    expect(u).toBeCloseTo(0.48);
  });

  it('uncertainty is symmetric around 0.5', () => {
    expect(computeUncertainty(0.3, 0.5)).toBeCloseTo(computeUncertainty(0.7, 0.5));
  });
});

describe('influence scoring', () => {
  it('minister with lots of evidence = high influence', () => {
    const inf = computeInfluence('minister', 100, 12);
    // 0.5*1.0 + 0.3*1.0 + 0.2*(12/18) = 0.5 + 0.3 + 0.133 = 0.933
    expect(inf).toBeGreaterThan(0.9);
  });

  it('backbencher with little evidence = low influence', () => {
    const inf = computeInfluence('backbench', 5, 2);
    // 0.5*0.3 + 0.3*(5/50) + 0.2*(2/18) = 0.15 + 0.03 + 0.022 = 0.202
    expect(inf).toBeLessThan(0.25);
  });

  it('shadow minister with moderate evidence', () => {
    const inf = computeInfluence('shadow_minister', 25, 6);
    // 0.5*0.9 + 0.3*0.5 + 0.2*(6/18) = 0.45 + 0.15 + 0.067 = 0.667
    expect(inf).toBeCloseTo(0.667, 2);
  });

  it('engagement caps at 1.0 for >50 evidence items', () => {
    const inf1 = computeInfluence('backbench', 50, 5);
    const inf2 = computeInfluence('backbench', 200, 5);
    expect(inf1).toBeCloseTo(inf2);
  });

  it('visibility caps at 1.0', () => {
    const inf1 = computeInfluence('backbench', 10, 18);
    const inf2 = computeInfluence('backbench', 10, 30);
    expect(inf1).toBeCloseTo(inf2);
  });
});

describe('swing score = uncertainty * influence', () => {
  it('uncertain high-influence politician is top swing', () => {
    const u = computeUncertainty(0.5, 0.1);   // very uncertain
    const i = computeInfluence('minister', 60, 10); // high influence
    const swing = u * i;
    expect(swing).toBeGreaterThan(0.6);
  });

  it('certain politician has low swing regardless of influence', () => {
    const u = computeUncertainty(0.95, 0.9);  // very certain
    const i = computeInfluence('minister', 100, 15);
    const swing = u * i;
    expect(swing).toBeLessThan(0.15);
  });

  it('uncertain low-influence politician has moderate swing', () => {
    const u = computeUncertainty(0.5, 0.1);    // very uncertain
    const i = computeInfluence('backbench', 3, 1); // low influence
    const swing = u * i;
    expect(swing).toBeGreaterThan(0.1);
    expect(swing).toBeLessThan(0.3);
  });

  it('ordering: uncertain minister > uncertain backbencher > certain minister', () => {
    const uncertainMinister = computeUncertainty(0.5, 0.2) * computeInfluence('minister', 40, 8);
    const uncertainBackbench = computeUncertainty(0.5, 0.2) * computeInfluence('backbench', 10, 3);
    const certainMinister = computeUncertainty(0.95, 0.9) * computeInfluence('minister', 40, 8);

    expect(uncertainMinister).toBeGreaterThan(uncertainBackbench);
    expect(uncertainBackbench).toBeGreaterThan(certainMinister);
  });
});
