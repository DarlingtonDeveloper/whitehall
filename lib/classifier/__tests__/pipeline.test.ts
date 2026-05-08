import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PoliticianEvidence, Politician } from '@/types/politician';
import type { Classification } from '../types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockClassifyDivisionVote = vi.fn();
const mockClassifyRegisterEntry = vi.fn();
const mockClassifyAppgMembership = vi.fn();
const mockClassifyCommitteeMembership = vi.fn();
const mockClassifyWithLlm = vi.fn();

vi.mock('../deterministic', () => ({
  classifyDivisionVote: (...args: unknown[]) => mockClassifyDivisionVote(...args),
  classifyRegisterEntry: (...args: unknown[]) => mockClassifyRegisterEntry(...args),
  classifyAppgMembership: (...args: unknown[]) => mockClassifyAppgMembership(...args),
  classifyCommitteeMembership: (...args: unknown[]) => mockClassifyCommitteeMembership(...args),
}));

vi.mock('../llm', () => ({
  classifyWithLlm: (...args: unknown[]) => mockClassifyWithLlm(...args),
}));

const insertedRows: Record<string, unknown[]> = {};
const upsertedRows: Record<string, unknown[]> = {};

const fakePolitician = {
  id: 'pol-1', parliament_member_id: 1234, full_name: 'Jane Doe',
  display_name: 'Jane Doe', party: 'Labour', party_history: [],
  house: 'commons', constituency: 'Manchester', constituency_history: [],
  status: 'active', created_at: '', updated_at: '',
};

// Chainable mock that supports arbitrary .method().method().method() chains
// and terminates with .maybeSingle(), await (thenable), or just returns data.
function chainableMock(table: string) {
  const builder: Record<string, unknown> = {};
  const self = () => builder;

  const methods = ['select', 'eq', 'ilike', 'in', 'is', 'contains', 'order', 'limit', 'not'];
  for (const m of methods) {
    builder[m] = vi.fn(self);
  }

  builder.maybeSingle = vi.fn().mockResolvedValue({
    data: table === 'politicians' ? fakePolitician : null,
    error: null,
  });

  builder.insert = vi.fn((rows: unknown) => {
    insertedRows[table] = insertedRows[table] || [];
    insertedRows[table].push(rows);
    return { error: null };
  });

  builder.upsert = vi.fn((rows: unknown) => {
    upsertedRows[table] = upsertedRows[table] || [];
    upsertedRows[table].push(rows);
    return { error: null };
  });

  // thenable — resolves with empty array by default
  builder.then = vi.fn((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null }),
  );

  return builder;
}

vi.mock('@/lib/db', () => ({
  getServiceClient: () => ({
    from: (table: string) => chainableMock(table),
  }),
}));

vi.mock('@/lib/ai/retry', () => ({
  mapWithConcurrency: async (items: unknown[], _c: number, fn: (item: unknown) => Promise<unknown>) => {
    return Promise.all(items.map(fn));
  },
}));

const { classifyEvidence, classifyEvidenceBatch } = await import('../pipeline');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvidence(overrides: Partial<PoliticianEvidence> = {}): PoliticianEvidence {
  return {
    id: 1,
    politician_id: 'pol-1',
    evidence_type: 'division_vote',
    source: 'parliament-api',
    source_id: 'div-1',
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

function makeClassification(overrides: Partial<Classification> = {}): Classification {
  return {
    indicator_id: 'policy.energy.renewables',
    anchor: 0.75,
    raw_weight: 1.5,
    confidence: 0.85,
    reasoning: 'Test classification',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(insertedRows)) delete insertedRows[key];
  for (const key of Object.keys(upsertedRows)) delete upsertedRows[key];
});

// ---------------------------------------------------------------------------
// Routing to correct classifier
// ---------------------------------------------------------------------------

describe('classifyEvidence — routing', () => {
  it('routes division_vote to deterministic classifier', async () => {
    mockClassifyDivisionVote.mockResolvedValue([makeClassification()]);

    const result = await classifyEvidence(makeEvidence({ evidence_type: 'division_vote' }));

    expect(mockClassifyDivisionVote).toHaveBeenCalled();
    expect(mockClassifyWithLlm).not.toHaveBeenCalled();
    expect(result.classifications.length).toBeGreaterThan(0);
  });

  it('routes register_of_interests to deterministic classifier', async () => {
    mockClassifyRegisterEntry.mockResolvedValue([]);

    await classifyEvidence(makeEvidence({ evidence_type: 'register_of_interests' }));

    expect(mockClassifyRegisterEntry).toHaveBeenCalled();
    expect(mockClassifyWithLlm).not.toHaveBeenCalled();
  });

  it('routes appg_membership to deterministic classifier', async () => {
    mockClassifyAppgMembership.mockResolvedValue([]);

    await classifyEvidence(makeEvidence({ evidence_type: 'appg_membership' }));

    expect(mockClassifyAppgMembership).toHaveBeenCalled();
  });

  it('routes committee_membership to deterministic classifier', async () => {
    mockClassifyCommitteeMembership.mockResolvedValue([]);

    await classifyEvidence(makeEvidence({ evidence_type: 'committee_membership' }));

    expect(mockClassifyCommitteeMembership).toHaveBeenCalled();
  });

  it('routes chamber_speech to LLM classifier', async () => {
    mockClassifyWithLlm.mockResolvedValue({
      classifications: [makeClassification()],
      cost_usd: 0.005,
      latency_ms: 1200,
    });

    const result = await classifyEvidence(makeEvidence({ evidence_type: 'chamber_speech' }));

    expect(mockClassifyWithLlm).toHaveBeenCalled();
    expect(mockClassifyDivisionVote).not.toHaveBeenCalled();
    expect(result.classifications.length).toBeGreaterThan(0);
  });

  it('routes written_question_asked to LLM classifier', async () => {
    mockClassifyWithLlm.mockResolvedValue({
      classifications: [], no_classification_reason: 'low_confidence',
      cost_usd: 0.003, latency_ms: 800,
    });

    await classifyEvidence(makeEvidence({ evidence_type: 'written_question_asked' }));
    expect(mockClassifyWithLlm).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Public/revealed routing
// ---------------------------------------------------------------------------

describe('classifyEvidence — public/revealed routing', () => {
  it('appends .revealed suffix for division_vote', async () => {
    mockClassifyDivisionVote.mockResolvedValue([
      makeClassification({ indicator_id: 'policy.energy.extraction' }),
    ]);

    const result = await classifyEvidence(makeEvidence({ evidence_type: 'division_vote' }));

    expect(result.classifications[0].indicator_id).toBe('policy.energy.extraction.revealed');
  });

  it('appends .public suffix for chamber_speech', async () => {
    mockClassifyWithLlm.mockResolvedValue({
      classifications: [makeClassification({ indicator_id: 'policy.energy.extraction' })],
      cost_usd: 0.005, latency_ms: 1200,
    });

    const result = await classifyEvidence(makeEvidence({ evidence_type: 'chamber_speech' }));

    expect(result.classifications[0].indicator_id).toBe('policy.energy.extraction.public');
  });

  it('creates dual classifications for committee_question (public + revealed)', async () => {
    mockClassifyWithLlm.mockResolvedValue({
      classifications: [makeClassification({ indicator_id: 'policy.energy.extraction', raw_weight: 2.0 })],
      cost_usd: 0.005, latency_ms: 1200,
    });

    const result = await classifyEvidence(makeEvidence({ evidence_type: 'committee_question' }));

    expect(result.classifications).toHaveLength(2);

    const pub = result.classifications.find((c) => c.indicator_id.endsWith('.public'));
    const rev = result.classifications.find((c) => c.indicator_id.endsWith('.revealed'));

    expect(pub).toBeDefined();
    expect(rev).toBeDefined();
    expect(rev!.raw_weight).toBe(pub!.raw_weight * 0.5);
  });

  it('does not double-suffix indicators that already have .public/.revealed', async () => {
    mockClassifyDivisionVote.mockResolvedValue([
      makeClassification({ indicator_id: 'policy.energy.extraction.revealed' }),
    ]);

    const result = await classifyEvidence(makeEvidence({ evidence_type: 'division_vote' }));

    // Should NOT become .revealed.revealed
    expect(result.classifications[0].indicator_id).toBe('policy.energy.extraction.revealed');
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('classifyEvidence — error handling', () => {
  it('catches errors and returns error result', async () => {
    mockClassifyDivisionVote.mockRejectedValue(new Error('DB connection failed'));

    const result = await classifyEvidence(makeEvidence({ evidence_type: 'division_vote' }));

    expect(result.classifications).toEqual([]);
    expect(result.classifier_version).toBe('error');
    expect(result.no_classification_reason).toContain('error:');
    expect(result.no_classification_reason).toContain('DB connection failed');
  });

  it('returns no_mapping when deterministic classifier finds no mappings', async () => {
    mockClassifyDivisionVote.mockResolvedValue([]);

    const result = await classifyEvidence(makeEvidence({ evidence_type: 'division_vote' }));

    expect(result.classifications).toEqual([]);
    expect(result.no_classification_reason).toBe('no_mapping');
  });
});

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

describe('classifyEvidence — result shape', () => {
  it('always includes evidence_id', async () => {
    mockClassifyDivisionVote.mockResolvedValue([]);

    const result = await classifyEvidence(makeEvidence({ id: 42 }));
    expect(result.evidence_id).toBe(42);
  });

  it('always includes classifier_version', async () => {
    mockClassifyDivisionVote.mockResolvedValue([]);

    const result = await classifyEvidence(makeEvidence());
    expect(result.classifier_version).toBeTruthy();
    expect(result.classifier_version).not.toBe('');
  });

  it('always includes cost_usd and latency_ms', async () => {
    mockClassifyDivisionVote.mockResolvedValue([]);

    const result = await classifyEvidence(makeEvidence());
    expect(typeof result.cost_usd).toBe('number');
    expect(typeof result.latency_ms).toBe('number');
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Batch processing
// ---------------------------------------------------------------------------

describe('classifyEvidenceBatch', () => {
  it('processes multiple evidence rows', async () => {
    mockClassifyDivisionVote.mockResolvedValue([makeClassification()]);

    const results = await classifyEvidenceBatch([
      makeEvidence({ id: 1 }),
      makeEvidence({ id: 2 }),
      makeEvidence({ id: 3 }),
    ]);

    expect(results).toHaveLength(3);
    expect(results[0].evidence_id).toBe(1);
    expect(results[1].evidence_id).toBe(2);
    expect(results[2].evidence_id).toBe(3);
  });

  it('handles mixed success and empty results', async () => {
    mockClassifyDivisionVote
      .mockResolvedValueOnce([makeClassification()])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeClassification()]);

    const results = await classifyEvidenceBatch([
      makeEvidence({ id: 1 }),
      makeEvidence({ id: 2 }),
      makeEvidence({ id: 3 }),
    ]);

    expect(results[0].classifications.length).toBeGreaterThan(0);
    expect(results[1].classifications).toEqual([]);
    expect(results[2].classifications.length).toBeGreaterThan(0);
  });
});
