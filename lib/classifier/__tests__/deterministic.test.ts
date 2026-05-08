import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PoliticianEvidence } from '@/types/politician';
import type { BillPolicyMapping, OrgIndicatorMapping, AppgIndicatorMapping, CommitteeIndicatorMapping } from '../types';

// ---------------------------------------------------------------------------
// Supabase mock — chainable query builder
// ---------------------------------------------------------------------------

function mockQueryBuilder(resolvedData: unknown[] | null = []) {
  const builder: Record<string, unknown> = {};
  const methods = ['select', 'eq', 'ilike', 'in', 'is', 'contains', 'order', 'limit', 'maybeSingle'];

  for (const method of methods) {
    if (method === 'maybeSingle') {
      builder[method] = vi.fn().mockResolvedValue({
        data: resolvedData?.[0] ?? null,
        error: null,
      });
    } else {
      builder[method] = vi.fn().mockReturnValue(builder);
    }
  }

  // Terminal — .select() already called, chain ends with await
  builder.then = vi.fn((resolve: (v: unknown) => void) =>
    resolve({ data: resolvedData, error: null }),
  );

  return builder;
}

let queryResults: Record<string, unknown[] | null> = {};

vi.mock('@/lib/db', () => ({
  getServiceClient: () => ({
    from: (table: string) => mockQueryBuilder(queryResults[table] ?? []),
  }),
}));

// Import after mocking
const { classifyDivisionVote, classifyRegisterEntry, classifyAppgMembership, classifyCommitteeMembership, getBillPolicyMappings } =
  await import('../deterministic');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvidence(overrides: Partial<PoliticianEvidence>): PoliticianEvidence {
  return {
    id: 1,
    politician_id: 'pol-1',
    evidence_type: 'division_vote',
    source: 'parliament-api',
    source_id: 'div-123',
    source_url: null,
    occurred_at: '2025-03-15T12:00:00Z',
    ingested_at: '2025-03-15T13:00:00Z',
    raw_content: null,
    parsed: {},
    topic_tags: [],
    entity_ids: [],
    fingerprint: 'fp-1',
    ...overrides,
  } as PoliticianEvidence;
}

beforeEach(() => {
  queryResults = {};
});

// ---------------------------------------------------------------------------
// Division votes
// ---------------------------------------------------------------------------

describe('classifyDivisionVote', () => {
  it('returns empty for absent votes', async () => {
    const evidence = makeEvidence({
      parsed: { division_id: 1, division_title: 'Test', vote: 'absent', whipped: null, whip_direction: null, broke_whip: null, bill_ref: 'bill-1', amendment_ref: null },
    });
    const result = await classifyDivisionVote(evidence);
    expect(result).toEqual([]);
  });

  it('returns empty for abstain votes', async () => {
    const evidence = makeEvidence({
      parsed: { division_id: 1, division_title: 'Test', vote: 'abstain', whipped: null, whip_direction: null, broke_whip: null, bill_ref: 'bill-1', amendment_ref: null },
    });
    const result = await classifyDivisionVote(evidence);
    expect(result).toEqual([]);
  });

  it('returns empty for teller votes', async () => {
    const evidence = makeEvidence({
      parsed: { division_id: 1, division_title: 'Test', vote: 'teller_aye', whipped: null, whip_direction: null, broke_whip: null, bill_ref: 'bill-1', amendment_ref: null },
    });
    const result = await classifyDivisionVote(evidence);
    expect(result).toEqual([]);
  });

  it('returns empty when no bill_ref', async () => {
    const evidence = makeEvidence({
      parsed: { division_id: 1, division_title: 'Test', vote: 'aye', whipped: null, whip_direction: null, broke_whip: null, bill_ref: null, amendment_ref: null },
    });
    const result = await classifyDivisionVote(evidence);
    expect(result).toEqual([]);
  });

  it('returns empty when no mappings found', async () => {
    queryResults['bill_policy_mappings'] = [];
    const evidence = makeEvidence({
      parsed: { division_id: 1, division_title: 'Test', vote: 'aye', whipped: null, whip_direction: null, broke_whip: null, bill_ref: 'unmapped-bill', amendment_ref: null },
    });
    const result = await classifyDivisionVote(evidence);
    expect(result).toEqual([]);
  });

  it('classifies aye vote using aye_anchor from mapping', async () => {
    const mapping: BillPolicyMapping = {
      id: 1, bill_id: 'bill-1', amendment_id: null, stage: null,
      indicator_id: 'policy.energy.fossil_fuel_extraction',
      aye_anchor: 0.85, no_anchor: 0.15, diagnostic_strength: 1.0,
      created_by: 'manual', reviewed: true, notes: null, created_at: '',
    };
    queryResults['bill_policy_mappings'] = [mapping];

    const evidence = makeEvidence({
      parsed: { division_id: 1, division_title: 'Test', vote: 'aye', whipped: null, whip_direction: null, broke_whip: null, bill_ref: 'bill-1', amendment_ref: null },
    });
    const result = await classifyDivisionVote(evidence);

    expect(result).toHaveLength(1);
    expect(result[0].indicator_id).toBe('policy.energy.fossil_fuel_extraction');
    expect(result[0].anchor).toBe(0.85);
    expect(result[0].confidence).toBe(0.95);
    expect(result[0].raw_weight).toBe(3.0); // 3.0 * 1.0 * 1.0
  });

  it('classifies no vote using no_anchor', async () => {
    const mapping: BillPolicyMapping = {
      id: 1, bill_id: 'bill-1', amendment_id: null, stage: null,
      indicator_id: 'policy.energy.fossil_fuel_extraction',
      aye_anchor: 0.85, no_anchor: 0.15, diagnostic_strength: 1.0,
      created_by: 'manual', reviewed: true, notes: null, created_at: '',
    };
    queryResults['bill_policy_mappings'] = [mapping];

    const evidence = makeEvidence({
      parsed: { division_id: 1, division_title: 'Test', vote: 'no', whipped: null, whip_direction: null, broke_whip: null, bill_ref: 'bill-1', amendment_ref: null },
    });
    const result = await classifyDivisionVote(evidence);

    expect(result[0].anchor).toBe(0.15);
  });

  it('halves weight for unreviewed mappings', async () => {
    const mapping: BillPolicyMapping = {
      id: 1, bill_id: 'bill-1', amendment_id: null, stage: null,
      indicator_id: 'policy.energy.fossil_fuel_extraction',
      aye_anchor: 0.8, no_anchor: 0.2, diagnostic_strength: 1.0,
      created_by: 'auto-llm', reviewed: false, notes: null, created_at: '',
    };
    queryResults['bill_policy_mappings'] = [mapping];

    const evidence = makeEvidence({
      parsed: { division_id: 1, division_title: 'Test', vote: 'aye', whipped: null, whip_direction: null, broke_whip: null, bill_ref: 'bill-1', amendment_ref: null },
    });
    const result = await classifyDivisionVote(evidence);

    expect(result[0].raw_weight).toBe(1.5); // 3.0 * 1.0 * 0.5
    expect(result[0].confidence).toBe(0.7);
  });

  it('applies diagnostic_strength to weight', async () => {
    const mapping: BillPolicyMapping = {
      id: 1, bill_id: 'bill-1', amendment_id: null, stage: null,
      indicator_id: 'policy.energy.fossil_fuel_extraction',
      aye_anchor: 0.8, no_anchor: 0.2, diagnostic_strength: 0.5,
      created_by: 'manual', reviewed: true, notes: null, created_at: '',
    };
    queryResults['bill_policy_mappings'] = [mapping];

    const evidence = makeEvidence({
      parsed: { division_id: 1, division_title: 'Test', vote: 'aye', whipped: null, whip_direction: null, broke_whip: null, bill_ref: 'bill-1', amendment_ref: null },
    });
    const result = await classifyDivisionVote(evidence);

    expect(result[0].raw_weight).toBe(1.5); // 3.0 * 0.5 * 1.0
  });

  it('returns multiple classifications for multiple mappings', async () => {
    queryResults['bill_policy_mappings'] = [
      { id: 1, bill_id: 'bill-1', amendment_id: null, stage: null, indicator_id: 'ind-a', aye_anchor: 0.9, no_anchor: 0.1, diagnostic_strength: 1.0, created_by: 'manual', reviewed: true, notes: null, created_at: '' },
      { id: 2, bill_id: 'bill-1', amendment_id: null, stage: null, indicator_id: 'ind-b', aye_anchor: 0.7, no_anchor: 0.3, diagnostic_strength: 0.8, created_by: 'manual', reviewed: true, notes: null, created_at: '' },
    ];

    const evidence = makeEvidence({
      parsed: { division_id: 1, division_title: 'Test', vote: 'aye', whipped: null, whip_direction: null, broke_whip: null, bill_ref: 'bill-1', amendment_ref: null },
    });
    const result = await classifyDivisionVote(evidence);

    expect(result).toHaveLength(2);
    expect(result[0].indicator_id).toBe('ind-a');
    expect(result[1].indicator_id).toBe('ind-b');
  });
});

// ---------------------------------------------------------------------------
// Register of interests
// ---------------------------------------------------------------------------

describe('classifyRegisterEntry', () => {
  it('returns empty when no related_org', async () => {
    const evidence = makeEvidence({
      evidence_type: 'register_of_interests',
      parsed: { category: 'donations', description: 'Some donation', value: '£5000', registered_on: '2024-01-01', related_org: null },
    });
    const result = await classifyRegisterEntry(evidence);
    expect(result).toEqual([]);
  });

  it('returns empty when org has no mapping', async () => {
    queryResults['org_indicator_map'] = [];
    const evidence = makeEvidence({
      evidence_type: 'register_of_interests',
      parsed: { category: 'donations', description: 'Donation from unknown', value: '£5000', registered_on: '2024-01-01', related_org: 'Unknown Corp' },
    });
    const result = await classifyRegisterEntry(evidence);
    expect(result).toEqual([]);
  });

  it('classifies when org is mapped', async () => {
    const mapping: OrgIndicatorMapping = {
      org_name: 'bp', org_aliases: ['british petroleum'],
      indicator_id: 'policy.energy.fossil_fuel_extraction',
      anchor: 0.85, weight_multiplier: 1.0, rationale: 'Major fossil fuel company',
    };
    queryResults['org_indicator_map'] = [mapping];

    const evidence = makeEvidence({
      evidence_type: 'register_of_interests',
      parsed: { category: 'employment_outside_parliament', description: 'Consultancy', value: null, registered_on: '2024-01-01', related_org: 'BP' },
    });
    const result = await classifyRegisterEntry(evidence);

    expect(result).toHaveLength(1);
    expect(result[0].anchor).toBe(0.85);
    expect(result[0].confidence).toBe(0.85);
    expect(result[0].raw_weight).toBe(1.0); // 1.0 * 1.0
  });
});

// ---------------------------------------------------------------------------
// APPG membership
// ---------------------------------------------------------------------------

describe('classifyAppgMembership', () => {
  it('returns empty when no mapping exists', async () => {
    queryResults['appg_indicator_map'] = [];
    const evidence = makeEvidence({
      evidence_type: 'appg_membership',
      parsed: { appg_id: 'appg-unmapped', appg_name: 'Unknown APPG', role: 'member' },
    });
    const result = await classifyAppgMembership(evidence);
    expect(result).toEqual([]);
  });

  it('classifies when APPG is mapped', async () => {
    const mapping: AppgIndicatorMapping = {
      appg_id: 'appg-energy', indicator_id: 'policy.energy.renewables',
      anchor: 0.7, weight_multiplier: 0.5,
    };
    queryResults['appg_indicator_map'] = [mapping];

    const evidence = makeEvidence({
      evidence_type: 'appg_membership',
      parsed: { appg_id: 'appg-energy', appg_name: 'APPG on Renewable Energy', role: 'member' },
    });
    const result = await classifyAppgMembership(evidence);

    expect(result).toHaveLength(1);
    expect(result[0].indicator_id).toBe('policy.energy.renewables');
    expect(result[0].anchor).toBe(0.7);
    expect(result[0].raw_weight).toBe(0.25); // 0.5 * 0.5
    expect(result[0].confidence).toBe(0.75);
  });
});

// ---------------------------------------------------------------------------
// Committee membership
// ---------------------------------------------------------------------------

describe('classifyCommitteeMembership', () => {
  it('returns empty when no committee_id in parsed', async () => {
    const evidence = makeEvidence({
      evidence_type: 'committee_membership',
      parsed: {},
    });
    const result = await classifyCommitteeMembership(evidence);
    expect(result).toEqual([]);
  });

  it('returns empty when committee has no mapping', async () => {
    queryResults['committee_indicator_map'] = [];
    const evidence = makeEvidence({
      evidence_type: 'committee_membership',
      parsed: { committee_id: 'esc', role: 'member' },
    });
    const result = await classifyCommitteeMembership(evidence);
    expect(result).toEqual([]);
  });

  it('classifies member with membership_anchor', async () => {
    const mapping: CommitteeIndicatorMapping = {
      committee_id: 'esc', indicator_id: 'behaviour.committee.engagement',
      membership_anchor: 0.6, chair_anchor: 0.9, weight_multiplier: 0.6,
    };
    queryResults['committee_indicator_map'] = [mapping];

    const evidence = makeEvidence({
      evidence_type: 'committee_membership',
      parsed: { committee_id: 'esc', role: 'member' },
    });
    const result = await classifyCommitteeMembership(evidence);

    expect(result).toHaveLength(1);
    expect(result[0].anchor).toBe(0.6);
    expect(result[0].raw_weight).toBeCloseTo(0.36); // 0.6 * 0.6
  });

  it('uses chair_anchor for chairs', async () => {
    const mapping: CommitteeIndicatorMapping = {
      committee_id: 'esc', indicator_id: 'behaviour.committee.engagement',
      membership_anchor: 0.6, chair_anchor: 0.9, weight_multiplier: 0.6,
    };
    queryResults['committee_indicator_map'] = [mapping];

    const evidence = makeEvidence({
      evidence_type: 'committee_membership',
      parsed: { committee_id: 'esc', role: 'chair' },
    });
    const result = await classifyCommitteeMembership(evidence);

    expect(result[0].anchor).toBe(0.9);
  });

  it('falls back to membership_anchor when chair_anchor is null', async () => {
    const mapping: CommitteeIndicatorMapping = {
      committee_id: 'esc', indicator_id: 'behaviour.committee.engagement',
      membership_anchor: 0.6, chair_anchor: null, weight_multiplier: 0.6,
    };
    queryResults['committee_indicator_map'] = [mapping];

    const evidence = makeEvidence({
      evidence_type: 'committee_membership',
      parsed: { committee_id: 'esc', role: 'chair' },
    });
    const result = await classifyCommitteeMembership(evidence);

    expect(result[0].anchor).toBe(0.6);
  });
});
