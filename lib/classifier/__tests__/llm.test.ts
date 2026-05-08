import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PoliticianEvidence, Politician } from '@/types/politician';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGenerateText = vi.fn();

vi.mock('ai', () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
  tool: (def: unknown) => def,
}));

vi.mock('@ai-sdk/anthropic', () => ({
  anthropic: (model: string) => ({ modelId: model }),
}));

let dbQueryResults: Record<string, unknown[] | null> = {};

function mockQueryBuilder(resolvedData: unknown[] | null = []) {
  const builder: Record<string, unknown> = {};
  const methods = ['select', 'eq', 'ilike', 'in', 'is', 'contains', 'order', 'limit', 'maybeSingle'];
  for (const method of methods) {
    builder[method] = vi.fn().mockReturnValue(builder);
  }
  builder.then = vi.fn((resolve: (v: unknown) => void) =>
    resolve({ data: resolvedData, error: null }),
  );
  return builder;
}

vi.mock('@/lib/db', () => ({
  getServiceClient: () => ({
    from: (table: string) => mockQueryBuilder(dbQueryResults[table] ?? []),
  }),
}));

vi.mock('@/lib/ai/retry', () => ({
  withRetry: (fn: () => unknown) => fn(),
}));

const { classifyWithLlm } = await import('../llm');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvidence(overrides: Partial<PoliticianEvidence> = {}): PoliticianEvidence {
  return {
    id: 1,
    politician_id: 'pol-1',
    evidence_type: 'chamber_speech',
    source: 'hansard',
    source_id: 'speech-1',
    source_url: null,
    occurred_at: '2025-03-15T12:00:00Z',
    ingested_at: '2025-03-15T13:00:00Z',
    raw_content: 'The honourable member spoke at length about renewable energy policy.',
    parsed: { debate_id: 'd1', debate_title: 'Energy', contribution_id: 'c1', word_count: 500, intervention: false, position: 'middle' },
    topic_tags: ['energy'],
    entity_ids: [],
    fingerprint: 'fp-1',
    ...overrides,
  } as PoliticianEvidence;
}

function makePolitician(overrides: Partial<Politician> = {}): Politician {
  return {
    id: 'pol-1',
    parliament_member_id: 12345,
    full_name: 'John Smith',
    display_name: 'John Smith',
    party: 'Labour',
    party_history: [],
    house: 'commons',
    constituency: 'Sheffield Central',
    constituency_history: [],
    first_elected: '2019-12-12',
    peerage_date: null,
    portrait_url: null,
    bio: null,
    gender: 'male',
    date_of_birth: '1970-01-01',
    status: 'active',
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbQueryResults = {};
});

// ---------------------------------------------------------------------------
// Early returns
// ---------------------------------------------------------------------------

describe('classifyWithLlm — early returns', () => {
  it('returns empty_content when raw_content is null', async () => {
    const result = await classifyWithLlm(
      makeEvidence({ raw_content: null }),
      makePolitician(),
    );
    expect(result.classifications).toEqual([]);
    expect(result.no_classification_reason).toBe('empty_content');
    expect(result.cost_usd).toBe(0);
  });

  it('returns empty_content when raw_content is whitespace', async () => {
    const result = await classifyWithLlm(
      makeEvidence({ raw_content: '   ' }),
      makePolitician(),
    );
    expect(result.no_classification_reason).toBe('empty_content');
  });

  it('returns no_topic_tags when topic_tags is empty', async () => {
    const result = await classifyWithLlm(
      makeEvidence({ topic_tags: [] }),
      makePolitician(),
    );
    expect(result.no_classification_reason).toBe('no_topic_tags');
  });

  it('returns no_matching_indicators when DB returns no candidates', async () => {
    dbQueryResults['indicator_definitions'] = [];
    const result = await classifyWithLlm(
      makeEvidence(),
      makePolitician(),
    );
    expect(result.no_classification_reason).toBe('no_matching_indicators');
    expect(mockGenerateText).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Successful classification
// ---------------------------------------------------------------------------

describe('classifyWithLlm — successful classification', () => {
  beforeEach(() => {
    dbQueryResults['indicator_definitions'] = [
      { id: 'policy.energy.renewables', radar: 'policy', label_low: 'Anti-renewables', label_high: 'Pro-renewables', description: 'Support for renewable energy', policy_area: 'energy' },
    ];
    dbQueryResults['politician_indicator_evidence'] = [];
  });

  it('calls generateText and returns processed classifications', async () => {
    mockGenerateText.mockResolvedValue({
      toolCalls: [{
        toolName: 'classify_evidence',
        input: {
          classifications: [
            { indicator_id: 'policy.energy.renewables', anchor: 0.8, confidence: 0.85, reasoning: 'Strong pro-renewables rhetoric' },
          ],
        },
      }],
      usage: { inputTokens: 500, outputTokens: 100 },
    });

    const result = await classifyWithLlm(makeEvidence(), makePolitician());

    expect(result.classifications).toHaveLength(1);
    expect(result.classifications[0].indicator_id).toBe('policy.energy.renewables');
    expect(result.classifications[0].anchor).toBe(0.8);
    expect(result.classifications[0].confidence).toBe(0.85);
    expect(result.cost_usd).toBeGreaterThan(0);
    expect(result.no_classification_reason).toBeUndefined();
  });

  it('filters out classifications with invalid indicator_id', async () => {
    mockGenerateText.mockResolvedValue({
      toolCalls: [{
        toolName: 'classify_evidence',
        input: {
          classifications: [
            { indicator_id: 'policy.energy.renewables', anchor: 0.8, confidence: 0.85, reasoning: 'Valid' },
            { indicator_id: 'nonexistent.indicator', anchor: 0.5, confidence: 0.9, reasoning: 'Hallucinated' },
          ],
        },
      }],
      usage: { inputTokens: 500, outputTokens: 100 },
    });

    const result = await classifyWithLlm(makeEvidence(), makePolitician());
    expect(result.classifications).toHaveLength(1);
    expect(result.classifications[0].indicator_id).toBe('policy.energy.renewables');
  });

  it('returns no_tool_call when model produces no tool calls', async () => {
    mockGenerateText.mockResolvedValue({
      toolCalls: [],
      usage: { inputTokens: 500, outputTokens: 50 },
    });

    const result = await classifyWithLlm(makeEvidence(), makePolitician());
    expect(result.classifications).toEqual([]);
    expect(result.no_classification_reason).toBe('no_tool_call');
  });
});

// ---------------------------------------------------------------------------
// Post-processing
// ---------------------------------------------------------------------------

describe('classifyWithLlm — post-processing', () => {
  beforeEach(() => {
    dbQueryResults['indicator_definitions'] = [
      { id: 'ind-a', radar: 'policy', label_low: 'Low A', label_high: 'High A', description: 'Indicator A', policy_area: 'energy' },
      { id: 'ind-b', radar: 'policy', label_low: 'Low B', label_high: 'High B', description: 'Indicator B', policy_area: 'energy' },
      { id: 'ind-c', radar: 'policy', label_low: 'Low C', label_high: 'High C', description: 'Indicator C', policy_area: 'energy' },
      { id: 'ind-d', radar: 'policy', label_low: 'Low D', label_high: 'High D', description: 'Indicator D', policy_area: 'energy' },
      { id: 'ind-e', radar: 'policy', label_low: 'Low E', label_high: 'High E', description: 'Indicator E', policy_area: 'energy' },
    ];
    dbQueryResults['politician_indicator_evidence'] = [];
  });

  it('drops classifications below MIN_CONFIDENCE (0.6)', async () => {
    mockGenerateText.mockResolvedValue({
      toolCalls: [{
        toolName: 'classify_evidence',
        input: {
          classifications: [
            { indicator_id: 'ind-a', anchor: 0.8, confidence: 0.3, reasoning: 'Uncertain' },
            { indicator_id: 'ind-b', anchor: 0.7, confidence: 0.85, reasoning: 'Confident' },
          ],
        },
      }],
      usage: { inputTokens: 500, outputTokens: 100 },
    });

    const result = await classifyWithLlm(makeEvidence(), makePolitician());
    expect(result.classifications).toHaveLength(1);
    expect(result.classifications[0].indicator_id).toBe('ind-b');
  });

  it('clamps anchors to [0.05, 0.95]', async () => {
    mockGenerateText.mockResolvedValue({
      toolCalls: [{
        toolName: 'classify_evidence',
        input: {
          classifications: [
            { indicator_id: 'ind-a', anchor: 0.0, confidence: 0.9, reasoning: 'Extreme low' },
            { indicator_id: 'ind-b', anchor: 1.0, confidence: 0.9, reasoning: 'Extreme high' },
          ],
        },
      }],
      usage: { inputTokens: 500, outputTokens: 100 },
    });

    const result = await classifyWithLlm(makeEvidence(), makePolitician());
    expect(result.classifications[0].anchor).toBe(0.05);
    expect(result.classifications[1].anchor).toBe(0.95);
  });

  it('deduplicates: keeps highest confidence per indicator', async () => {
    mockGenerateText.mockResolvedValue({
      toolCalls: [{
        toolName: 'classify_evidence',
        input: {
          classifications: [
            { indicator_id: 'ind-a', anchor: 0.3, confidence: 0.7, reasoning: 'First' },
            { indicator_id: 'ind-a', anchor: 0.8, confidence: 0.9, reasoning: 'Second — higher confidence' },
          ],
        },
      }],
      usage: { inputTokens: 500, outputTokens: 100 },
    });

    const result = await classifyWithLlm(makeEvidence(), makePolitician());
    expect(result.classifications).toHaveLength(1);
    expect(result.classifications[0].confidence).toBe(0.9);
    expect(result.classifications[0].anchor).toBe(0.8);
  });

  it('caps at 4 classifications per evidence', async () => {
    mockGenerateText.mockResolvedValue({
      toolCalls: [{
        toolName: 'classify_evidence',
        input: {
          classifications: [
            { indicator_id: 'ind-a', anchor: 0.5, confidence: 0.7, reasoning: 'A' },
            { indicator_id: 'ind-b', anchor: 0.5, confidence: 0.8, reasoning: 'B' },
            { indicator_id: 'ind-c', anchor: 0.5, confidence: 0.9, reasoning: 'C' },
            { indicator_id: 'ind-d', anchor: 0.5, confidence: 0.65, reasoning: 'D' },
            { indicator_id: 'ind-e', anchor: 0.5, confidence: 0.95, reasoning: 'E' },
          ],
        },
      }],
      usage: { inputTokens: 500, outputTokens: 100 },
    });

    const result = await classifyWithLlm(makeEvidence(), makePolitician());
    expect(result.classifications).toHaveLength(4);
    // Should keep the 4 highest confidence
    const confidences = result.classifications.map((c) => c.confidence);
    expect(confidences).not.toContain(0.65); // lowest dropped
  });

  it('truncates reasoning to 200 chars', async () => {
    const longReasoning = 'A'.repeat(300);
    mockGenerateText.mockResolvedValue({
      toolCalls: [{
        toolName: 'classify_evidence',
        input: {
          classifications: [
            { indicator_id: 'ind-a', anchor: 0.5, confidence: 0.9, reasoning: longReasoning },
          ],
        },
      }],
      usage: { inputTokens: 500, outputTokens: 100 },
    });

    const result = await classifyWithLlm(makeEvidence(), makePolitician());
    expect(result.classifications[0].reasoning.length).toBeLessThanOrEqual(200);
  });

  it('applies social_post weight cap', async () => {
    mockGenerateText.mockResolvedValue({
      toolCalls: [{
        toolName: 'classify_evidence',
        input: {
          classifications: [
            { indicator_id: 'ind-a', anchor: 0.8, confidence: 0.95, reasoning: 'Strong signal from tweet' },
          ],
        },
      }],
      usage: { inputTokens: 500, outputTokens: 100 },
    });

    const result = await classifyWithLlm(
      makeEvidence({ evidence_type: 'social_post' }),
      makePolitician(),
    );
    expect(result.classifications[0].raw_weight).toBeLessThanOrEqual(0.5);
  });

  it('applies venue adjustment for interviews', async () => {
    mockGenerateText.mockResolvedValue({
      toolCalls: [{
        toolName: 'classify_evidence',
        input: {
          classifications: [
            { indicator_id: 'ind-a', anchor: 0.7, confidence: 0.9, reasoning: 'Policy statement in interview' },
          ],
        },
      }],
      usage: { inputTokens: 500, outputTokens: 100 },
    });

    const bbcResult = await classifyWithLlm(
      makeEvidence({ evidence_type: 'interview', source_url: 'https://bbc.co.uk/interview' }),
      makePolitician(),
    );
    const gbResult = await classifyWithLlm(
      makeEvidence({ evidence_type: 'interview', source_url: 'https://gbnews.com/show' }),
      makePolitician(),
    );

    expect(bbcResult.classifications[0].raw_weight).toBeGreaterThan(gbResult.classifications[0].raw_weight);
  });
});
