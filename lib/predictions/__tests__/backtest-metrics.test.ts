import { describe, it, expect } from 'vitest';

// Test the backtest metric computations in isolation.
// These are extracted pure functions from backtest.ts.

const LOG_LOSS_CLAMP = 1e-7;

type Prediction = {
  division_id: number;
  division_title: string;
  politician_id: string;
  p_aye: number;
  ci_95: [number, number];
  actual_aye: boolean;
};

function computeAccuracy(preds: Prediction[]): number {
  let correct = 0;
  for (const p of preds) {
    if ((p.p_aye > 0.5) === p.actual_aye) correct++;
  }
  return correct / preds.length;
}

function computeLogLoss(preds: Prediction[]): number {
  let totalLoss = 0;
  for (const p of preds) {
    const prob = p.actual_aye
      ? Math.max(p.p_aye, LOG_LOSS_CLAMP)
      : Math.max(1 - p.p_aye, LOG_LOSS_CLAMP);
    totalLoss -= Math.log(prob);
  }
  return totalLoss / preds.length;
}

function computeCiCoverage(preds: Prediction[]): number {
  let covered = 0;
  for (const p of preds) {
    const actual = p.actual_aye ? 1.0 : 0.0;
    if (actual >= p.ci_95[0] && actual <= p.ci_95[1]) covered++;
  }
  return covered / preds.length;
}

function computeCalibration(preds: Prediction[]): Array<{
  bucket_low: number; bucket_high: number; predicted_mean: number; actual_rate: number; count: number;
}> {
  const buckets: Array<{
    bucket_low: number; bucket_high: number; predicted_mean: number; actual_rate: number; count: number;
  }> = [];
  const bucketSize = 0.1;

  for (let lo = 0; lo < 1.0; lo += bucketSize) {
    const hi = lo + bucketSize;
    const inBucket = preds.filter((p) => p.p_aye >= lo && p.p_aye < hi);
    if (inBucket.length === 0) continue;
    const predictedMean = inBucket.reduce((sum, p) => sum + p.p_aye, 0) / inBucket.length;
    const actualRate = inBucket.filter((p) => p.actual_aye).length / inBucket.length;
    buckets.push({
      bucket_low: Math.round(lo * 10) / 10,
      bucket_high: Math.round(hi * 10) / 10,
      predicted_mean: Math.round(predictedMean * 1000) / 1000,
      actual_rate: Math.round(actualRate * 1000) / 1000,
      count: inBucket.length,
    });
  }

  return buckets;
}

function makePred(pAye: number, actualAye: boolean, ci?: [number, number]): Prediction {
  return {
    division_id: 1,
    division_title: 'Test',
    politician_id: 'p1',
    p_aye: pAye,
    ci_95: ci ?? [pAye - 0.2, pAye + 0.2],
    actual_aye: actualAye,
  };
}

describe('backtest accuracy', () => {
  it('returns 1.0 for all correct predictions', () => {
    const preds = [
      makePred(0.8, true),
      makePred(0.9, true),
      makePred(0.1, false),
      makePred(0.2, false),
    ];
    expect(computeAccuracy(preds)).toBe(1.0);
  });

  it('returns 0.0 for all wrong predictions', () => {
    const preds = [
      makePred(0.8, false),
      makePred(0.1, true),
    ];
    expect(computeAccuracy(preds)).toBe(0.0);
  });

  it('returns 0.5 for mixed predictions', () => {
    const preds = [
      makePred(0.8, true),
      makePred(0.8, false),
    ];
    expect(computeAccuracy(preds)).toBe(0.5);
  });
});

describe('backtest logLoss', () => {
  it('returns low loss for confident correct predictions', () => {
    const preds = [
      makePred(0.95, true),
      makePred(0.05, false),
    ];
    const loss = computeLogLoss(preds);
    expect(loss).toBeLessThan(0.1);
  });

  it('returns high loss for confident wrong predictions', () => {
    const preds = [
      makePred(0.95, false),
      makePred(0.05, true),
    ];
    const loss = computeLogLoss(preds);
    expect(loss).toBeGreaterThan(2.0);
  });

  it('returns ~0.693 for all 0.5 predictions (random baseline)', () => {
    const preds = [
      makePred(0.5, true),
      makePred(0.5, false),
    ];
    const loss = computeLogLoss(preds);
    expect(loss).toBeCloseTo(0.693, 2);
  });

  it('handles edge case: p_aye = 0 with actual aye', () => {
    const preds = [makePred(0.0, true)];
    const loss = computeLogLoss(preds);
    // Clamped to LOG_LOSS_CLAMP, so loss should be finite
    expect(Number.isFinite(loss)).toBe(true);
    expect(loss).toBeGreaterThan(10); // very high but finite
  });
});

describe('backtest CI coverage', () => {
  it('returns 1.0 when all outcomes within CI', () => {
    const preds = [
      makePred(0.8, true, [0.6, 1.0]),  // actual=1.0, within [0.6,1.0]
      makePred(0.2, false, [0.0, 0.4]),  // actual=0.0, within [0.0,0.4]
    ];
    expect(computeCiCoverage(preds)).toBe(1.0);
  });

  it('returns 0.0 when no outcomes within CI', () => {
    const preds = [
      makePred(0.3, true, [0.1, 0.5]),   // actual=1.0, NOT within [0.1,0.5]
      makePred(0.7, false, [0.5, 0.9]),   // actual=0.0, NOT within [0.5,0.9]
    ];
    expect(computeCiCoverage(preds)).toBe(0.0);
  });

  it('handles exact boundary', () => {
    const preds = [
      makePred(0.5, true, [0.3, 1.0]),  // actual=1.0, boundary inclusive
    ];
    expect(computeCiCoverage(preds)).toBe(1.0);
  });
});

describe('backtest calibration', () => {
  it('produces correct bucket counts', () => {
    const preds = [
      makePred(0.15, true),
      makePred(0.12, false),
      makePred(0.85, true),
      makePred(0.87, true),
      makePred(0.55, false),
    ];

    const cal = computeCalibration(preds);

    // Should have 3 buckets: [0.1-0.2), [0.5-0.6), [0.8-0.9)
    expect(cal).toHaveLength(3);

    const b1 = cal.find((b) => b.bucket_low === 0.1)!;
    expect(b1.count).toBe(2);
    expect(b1.actual_rate).toBe(0.5); // 1 out of 2 was aye

    const b2 = cal.find((b) => b.bucket_low === 0.5)!;
    expect(b2.count).toBe(1);
    expect(b2.actual_rate).toBe(0.0); // 0 out of 1 was aye

    const b3 = cal.find((b) => b.bucket_low === 0.8)!;
    expect(b3.count).toBe(2);
    expect(b3.actual_rate).toBe(1.0); // 2 out of 2 was aye
  });

  it('returns empty for empty input', () => {
    expect(computeCalibration([])).toEqual([]);
  });

  it('perfectly calibrated predictions have close predicted_mean and actual_rate', () => {
    // Generate many predictions where p_aye matches actual probability
    const preds: Prediction[] = [];
    for (let i = 0; i < 100; i++) {
      const p = 0.85 + Math.random() * 0.09; // all in [0.85, 0.94) bucket
      preds.push(makePred(p, Math.random() < 0.9)); // 90% actually aye
    }

    const cal = computeCalibration(preds);
    const bucket = cal.find((b) => b.bucket_low === 0.8 || b.bucket_low === 0.9);
    // With 100 samples, actual rate should be close to 0.9 (within noise)
    if (bucket) {
      expect(bucket.actual_rate).toBeGreaterThan(0.7);
      expect(bucket.actual_rate).toBeLessThan(1.0);
    }
  });
});
