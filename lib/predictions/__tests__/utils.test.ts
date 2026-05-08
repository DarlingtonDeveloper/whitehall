import { describe, it, expect } from 'vitest';
import { weightedAverage, blend, combinePosteriorCIs, generateCaveats, topEvidence } from '../utils';
import type { AuditedPosterior, Posterior } from '@/types/politician';

describe('weightedAverage', () => {
  it('returns 0.5 for empty input', () => {
    expect(weightedAverage([])).toBe(0.5);
  });

  it('returns the single value for one item', () => {
    expect(weightedAverage([{ value: 0.8, weight: 1.0 }])).toBeCloseTo(0.8);
  });

  it('computes correct weighted average', () => {
    const items = [
      { value: 0.9, weight: 2.0 },
      { value: 0.3, weight: 1.0 },
    ];
    // (0.9*2 + 0.3*1) / (2+1) = 2.1/3 = 0.7
    expect(weightedAverage(items)).toBeCloseTo(0.7);
  });

  it('returns 0.5 when all weights are zero', () => {
    expect(weightedAverage([{ value: 0.9, weight: 0 }, { value: 0.1, weight: 0 }])).toBe(0.5);
  });

  it('handles equal weights like a simple average', () => {
    const items = [
      { value: 0.2, weight: 1.0 },
      { value: 0.6, weight: 1.0 },
      { value: 1.0, weight: 1.0 },
    ];
    expect(weightedAverage(items)).toBeCloseTo(0.6);
  });
});

describe('blend', () => {
  it('returns a when bWeight is 0', () => {
    expect(blend(0.3, 0.9, 0)).toBeCloseTo(0.3);
  });

  it('returns b when bWeight is 1', () => {
    expect(blend(0.3, 0.9, 1)).toBeCloseTo(0.9);
  });

  it('blends 50/50 at weight 0.5', () => {
    expect(blend(0.2, 0.8, 0.5)).toBeCloseTo(0.5);
  });

  it('blends asymmetrically', () => {
    // (1-0.3)*0.4 + 0.3*1.0 = 0.28 + 0.3 = 0.58
    expect(blend(0.4, 1.0, 0.3)).toBeCloseTo(0.58);
  });
});

describe('combinePosteriorCIs', () => {
  it('returns [0,1] for empty input', () => {
    const ci = combinePosteriorCIs([]);
    expect(ci[0]).toBe(0);
    expect(ci[1]).toBe(1);
  });

  it('returns single posterior CI for one item', () => {
    const p: Posterior = { mean: 0.7, variance: 0.01, effective_sample_size: 10, confidence: 0.5, ci_95: [0.5, 0.9] };
    const ci = combinePosteriorCIs([{ posterior: p, weight: 1.0 }]);
    expect(ci[0]).toBeCloseTo(0.5);
    expect(ci[1]).toBeCloseTo(0.9);
  });

  it('averages CIs weighted correctly', () => {
    const p1: Posterior = { mean: 0.8, variance: 0.01, effective_sample_size: 10, confidence: 0.5, ci_95: [0.6, 1.0] };
    const p2: Posterior = { mean: 0.3, variance: 0.01, effective_sample_size: 10, confidence: 0.5, ci_95: [0.1, 0.5] };
    // Equal weight: [0.35, 0.75]
    const ci = combinePosteriorCIs([
      { posterior: p1, weight: 1.0 },
      { posterior: p2, weight: 1.0 },
    ]);
    expect(ci[0]).toBeCloseTo(0.35);
    expect(ci[1]).toBeCloseTo(0.75);
  });

  it('clamps CI to [0,1]', () => {
    const p: Posterior = { mean: 0.99, variance: 0.01, effective_sample_size: 10, confidence: 0.5, ci_95: [0.95, 1.1] };
    const ci = combinePosteriorCIs([{ posterior: p, weight: 1.0 }]);
    expect(ci[1]).toBeLessThanOrEqual(1.0);
  });
});

describe('generateCaveats', () => {
  it('returns no caveats for strong indicators', () => {
    const indicators = [
      { evidence_count: 20, confidence: 0.8, indicator_id: 'a' },
      { evidence_count: 15, confidence: 0.7, indicator_id: 'b' },
    ];
    expect(generateCaveats(indicators)).toHaveLength(0);
  });

  it('warns about low evidence counts', () => {
    const indicators = [
      { evidence_count: 2, confidence: 0.8, indicator_id: 'a' },
      { evidence_count: 3, confidence: 0.7, indicator_id: 'b' },
    ];
    const caveats = generateCaveats(indicators);
    expect(caveats.some((c) => c.includes('fewer than 5'))).toBe(true);
  });

  it('warns about all low confidence', () => {
    const indicators = [
      { evidence_count: 20, confidence: 0.1, indicator_id: 'a' },
      { evidence_count: 15, confidence: 0.2, indicator_id: 'b' },
    ];
    const caveats = generateCaveats(indicators);
    expect(caveats.some((c) => c.includes('low confidence'))).toBe(true);
  });

  it('warns about no indicator data', () => {
    expect(generateCaveats([])).toEqual(['No indicator data available for this prediction.']);
  });

  it('warns about single indicator', () => {
    const caveats = generateCaveats([{ evidence_count: 10, confidence: 0.5, indicator_id: 'a' }]);
    expect(caveats.some((c) => c.includes('single indicator'))).toBe(true);
  });
});

describe('topEvidence', () => {
  it('returns empty for empty input', () => {
    expect(topEvidence([], 5)).toEqual([]);
  });

  it('extracts and sorts by effective_weight', () => {
    const audited: AuditedPosterior[] = [
      {
        politician_id: 'p1',
        indicator_id: 'ind1',
        as_of: '2025-01-01',
        posterior: { mean: 0.5, variance: 0.01, effective_sample_size: 5, confidence: 0.5, ci_95: [0.3, 0.7] },
        alpha: 3, beta: 3,
        contributing_evidence: [
          {
            evidence_id: 1, evidence_type: 'division_vote', source_url: null,
            occurred_at: '2024-01-01', anchor: 0.8, raw_weight: 3, effective_weight: 2.5,
            contribution_to_alpha: 2.0, contribution_to_beta: 0.5,
            classifier_version: 'v1', classifier_reasoning: null,
            decay_factor: 0.9, epoch_dampening: 1.0, propagation_source: null,
          },
          {
            evidence_id: 2, evidence_type: 'chamber_speech', source_url: 'http://example.com',
            occurred_at: '2024-06-01', anchor: 0.6, raw_weight: 1.5, effective_weight: 1.2,
            contribution_to_alpha: 0.72, contribution_to_beta: 0.48,
            classifier_version: 'v1', classifier_reasoning: null,
            decay_factor: 0.95, epoch_dampening: 1.0, propagation_source: null,
          },
        ],
        propagated_from: [],
        applied_epochs: [],
      },
    ];

    const top = topEvidence(audited, 1);
    expect(top).toHaveLength(1);
    expect(top[0].evidence_id).toBe(1);
    expect(top[0].effective_weight).toBe(2.5);
    expect(top[0].indicator_id).toBe('ind1');
  });

  it('respects the n limit', () => {
    const evidence = Array.from({ length: 10 }, (_, i) => ({
      evidence_id: i, evidence_type: 'division_vote' as const, source_url: null,
      occurred_at: '2024-01-01', anchor: 0.5, raw_weight: 1, effective_weight: i,
      contribution_to_alpha: 0.5, contribution_to_beta: 0.5,
      classifier_version: 'v1', classifier_reasoning: null,
      decay_factor: 1, epoch_dampening: 1, propagation_source: null,
    }));

    const audited: AuditedPosterior[] = [{
      politician_id: 'p1', indicator_id: 'ind1', as_of: '2025-01-01',
      posterior: { mean: 0.5, variance: 0.01, effective_sample_size: 5, confidence: 0.5, ci_95: [0.3, 0.7] },
      alpha: 3, beta: 3,
      contributing_evidence: evidence,
      propagated_from: [],
      applied_epochs: [],
    }];

    const top = topEvidence(audited, 3);
    expect(top).toHaveLength(3);
    // Sorted descending by effective_weight
    expect(top[0].effective_weight).toBe(9);
    expect(top[1].effective_weight).toBe(8);
    expect(top[2].effective_weight).toBe(7);
  });
});
