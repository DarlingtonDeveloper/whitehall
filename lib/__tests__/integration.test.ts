/**
 * Integration test: Evidence -> Classification -> Prediction
 *
 * Validates the full pipeline using a stateful in-memory Supabase mock:
 *   1. Inserts synthetic politician + committee evidence
 *   2. Runs deterministic classifier -> verifies classifications
 *   3. Persists to politician_indicator_evidence -> verifies audit rows
 *   4. Runs vote prediction -> verifies non-trivial P(aye) with drivers
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PoliticianEvidence } from '@/types/politician';

// ---------------------------------------------------------------------------
// Stateful in-memory mock store
// ---------------------------------------------------------------------------

const store: Record<string, Record<string, unknown>[]> = {};

function getRows(table: string): Record<string, unknown>[] {
  if (!store[table]) store[table] = [];
  return store[table];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createQueryBuilder(table: string): any {
  type Filter = { type: string; col: string; val: unknown };
  const filters: Filter[] = [];
  let mode: 'select' | 'insert' | 'upsert' | 'update' = 'select';
  let mutations: unknown = null;
  let mutationOpts: Record<string, unknown> | null = null;
  let orderCol: string | null = null;
  let orderAsc = true;
  let limitN: number | null = null;
  let headMode = false;

  function applyFilters(rows: Record<string, unknown>[]): Record<string, unknown>[] {
    let result = [...rows];
    for (const f of filters) {
      switch (f.type) {
        case 'eq':
          result = result.filter((r) => r[f.col] === f.val);
          break;
        case 'in':
          result = result.filter((r) => (f.val as unknown[]).includes(r[f.col]));
          break;
        case 'is':
          result = result.filter((r) =>
            f.val === null ? r[f.col] == null : r[f.col] === f.val,
          );
          break;
        case 'not_is':
          result = result.filter((r) =>
            f.val === null ? r[f.col] != null : r[f.col] !== f.val,
          );
          break;
        case 'or': {
          const expr = f.val as string;
          const clauses = expr.split(',');
          result = result.filter((r) =>
            clauses.some((clause) => {
              const m = clause.match(/^([a-z_]+)\.(eq|is)\.(.+)$/);
              if (!m) return true;
              const [, col, op, val] = m;
              if (op === 'is' && val === 'null') return r[col] == null;
              if (op === 'eq') return String(r[col]) === val;
              return false;
            }),
          );
          break;
        }
        case 'lte':
          result = result.filter((r) => String(r[f.col]) <= String(f.val));
          break;
        case 'filter': {
          const { op, val: fv } = f.val as { op: string; val: unknown };
          result = result.filter((r) => {
            let actual: unknown;
            if (f.col.includes('->>')) {
              const [jsonCol, jsonKey] = f.col.split('->>');
              actual = (r[jsonCol] as Record<string, unknown>)?.[jsonKey];
            } else {
              actual = r[f.col];
            }
            if (op === 'eq') return String(actual) === String(fv);
            return false;
          });
          break;
        }
        case 'contains': {
          result = result.filter((r) => {
            const arr = r[f.col];
            const vals = f.val;
            if (!Array.isArray(arr) || !Array.isArray(vals)) return false;
            return vals.every((v: unknown) => arr.includes(v));
          });
          break;
        }
      }
    }
    if (orderCol) {
      const col = orderCol;
      result.sort((a, b) => {
        const va = a[col], vb = b[col];
        const cmp = va < vb ? -1 : va > vb ? 1 : 0;
        return orderAsc ? cmp : -cmp;
      });
    }
    if (limitN != null) result = result.slice(0, limitN);
    return result;
  }

  function doInsert() {
    const tableRows = getRows(table);
    const newRows = Array.isArray(mutations)
      ? (mutations as Record<string, unknown>[])
      : [mutations as Record<string, unknown>];
    let maxId = tableRows.reduce(
      (m, r) => Math.max(m, typeof r.id === 'number' ? r.id : 0),
      0,
    );
    for (const row of newRows) {
      const clone = { ...row };
      if (clone.id === undefined) clone.id = ++maxId;
      if (!clone.applied_at) clone.applied_at = new Date().toISOString();
      tableRows.push(clone);
    }
    return { data: null, error: null };
  }

  function doUpsert() {
    const tableRows = getRows(table);
    const newRows = Array.isArray(mutations)
      ? (mutations as Record<string, unknown>[])
      : [mutations as Record<string, unknown>];
    const opts = mutationOpts as { onConflict?: string; ignoreDuplicates?: boolean } | null;
    const conflictCols = opts?.onConflict?.split(',').map((c) => c.trim()) ?? [];
    for (const row of newRows) {
      const idx =
        conflictCols.length > 0
          ? tableRows.findIndex((existing) =>
              conflictCols.every((col) => existing[col] === row[col]),
            )
          : -1;
      if (idx >= 0) {
        if (!opts?.ignoreDuplicates) {
          tableRows[idx] = { ...tableRows[idx], ...row };
        }
      } else {
        tableRows.push({ ...row });
      }
    }
    return { data: null, error: null };
  }

  function doUpdate() {
    const tableRows = getRows(table);
    const data = mutations as Record<string, unknown>;
    let indices = tableRows.map((_, i) => i);
    for (const f of filters) {
      if (f.type === 'eq') {
        indices = indices.filter((i) => tableRows[i][f.col] === f.val);
      }
    }
    for (const idx of indices) {
      Object.assign(tableRows[idx], data);
    }
    return { data: null, error: null };
  }

  function resolve() {
    if (mode === 'insert') return doInsert();
    if (mode === 'upsert') return doUpsert();
    if (mode === 'update') return doUpdate();
    const rows = applyFilters(getRows(table));
    if (headMode) return { data: null, error: null, count: rows.length };
    return { data: rows, error: null, count: rows.length };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {
    select: (_cols?: string, opts?: { count?: string; head?: boolean }) => {
      if (opts?.head) headMode = true;
      return builder;
    },
    eq: (col: string, val: unknown) => { filters.push({ type: 'eq', col, val }); return builder; },
    in: (col: string, val: unknown[]) => { filters.push({ type: 'in', col, val }); return builder; },
    is: (col: string, val: unknown) => { filters.push({ type: 'is', col, val }); return builder; },
    not: (col: string, op: string, val: unknown) => {
      if (op === 'is') filters.push({ type: 'not_is', col, val });
      return builder;
    },
    or: (expr: string) => { filters.push({ type: 'or', col: '', val: expr }); return builder; },
    lte: (col: string, val: unknown) => { filters.push({ type: 'lte', col, val }); return builder; },
    contains: (col: string, val: unknown) => { filters.push({ type: 'contains', col, val }); return builder; },
    filter: (col: string, op: string, val: unknown) => {
      filters.push({ type: 'filter', col, val: { op, val } });
      return builder;
    },
    order: (col: string, opts?: { ascending?: boolean }) => {
      orderCol = col;
      orderAsc = opts?.ascending ?? true;
      return builder;
    },
    limit: (n: number) => { limitN = n; return builder; },
    insert: (data: unknown) => { mode = 'insert'; mutations = data; return builder; },
    upsert: (data: unknown, opts?: unknown) => {
      mode = 'upsert';
      mutations = data;
      mutationOpts = opts as Record<string, unknown>;
      return builder;
    },
    update: (data: unknown) => { mode = 'update'; mutations = data; return builder; },
    single: () => {
      const rows = applyFilters(getRows(table));
      if (rows.length === 0)
        return Promise.resolve({ data: null, error: { code: 'PGRST116', message: 'No rows' } });
      return Promise.resolve({ data: rows[0], error: null });
    },
    maybeSingle: () => {
      const rows = applyFilters(getRows(table));
      return Promise.resolve({ data: rows.length > 0 ? rows[0] : null, error: null });
    },
    then: (
      onFulfilled?: (v: unknown) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => Promise.resolve(resolve()).then(onFulfilled, onRejected),
  };

  return builder;
}

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/db', () => ({
  getServiceClient: () => ({
    from: (table: string) => createQueryBuilder(table),
    rpc: () => Promise.resolve({ error: null }),
  }),
  supabase: {
    from: (table: string) => createQueryBuilder(table),
  },
}));

vi.mock('@/lib/ai/retry', () => ({
  mapWithConcurrency: async (
    items: unknown[],
    _c: number,
    fn: (item: unknown) => Promise<unknown>,
  ) => Promise.all(items.map(fn)),
}));

// Import after mocks
const { classifyEvidence, classifyEvidenceBatch } = await import('@/lib/classifier/pipeline');
const { predictVote } = await import('@/lib/predictions/vote');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POL_ID = 'test-integration-pol';
const COMMITTEE_ID = 'defence';
const INDICATOR_ID = 'defence.military_spending';
const BILL_ID = 'test-defence-bill';
const EVIDENCE_DATE = '2025-01-15T00:00:00Z';

// Fixed query date for deterministic decay
const QUERY_DATE = new Date('2025-06-01T00:00:00Z');

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

function seedStore() {
  for (const key of Object.keys(store)) delete store[key];

  store.politicians = [
    {
      id: POL_ID,
      parliament_member_id: 99999,
      full_name: 'Test Politician',
      display_name: 'Test Politician',
      party: 'Labour',
      house: 'commons',
      constituency: 'Test Town',
      status: 'active',
    },
  ];

  store.committee_indicator_map = [
    {
      committee_id: COMMITTEE_ID,
      indicator_id: INDICATOR_ID,
      membership_anchor: 0.7,
      chair_anchor: 0.85,
      weight_multiplier: 0.6,
    },
  ];

  store.indicator_definitions = [
    {
      id: INDICATOR_ID,
      radar: 'policy',
      policy_area: 'defence',
      label_low: 'Favours reduced military spending',
      label_high: 'Favours increased military spending',
      description: 'Position on military spending',
      half_life_years: 3.0,
    },
    {
      id: `${INDICATOR_ID}.revealed`,
      radar: 'policy',
      policy_area: 'defence',
      label_low: 'Favours reduced military spending',
      label_high: 'Favours increased military spending',
      description: 'Position on military spending (revealed)',
      half_life_years: 3.0,
    },
  ];

  store.bill_policy_mappings = [
    {
      id: 1,
      bill_id: BILL_ID,
      amendment_id: null,
      stage: null,
      indicator_id: INDICATOR_ID,
      aye_anchor: 0.85,
      no_anchor: 0.15,
      diagnostic_strength: 0.8,
      created_by: 'manual',
      reviewed: true,
      notes: null,
    },
  ];

  store.politician_evidence = [
    {
      id: 1,
      politician_id: POL_ID,
      evidence_type: 'committee_membership',
      source: 'test',
      source_id: 'test-committee-1',
      source_url: null,
      occurred_at: EVIDENCE_DATE,
      ingested_at: EVIDENCE_DATE,
      raw_content: 'Defence Committee: member since 2025-01-15',
      parsed: {
        committee_id: COMMITTEE_ID,
        committee_name: 'Defence Committee',
        committee_api_id: 100,
        role: 'member',
        start_date: '2025-01-15',
      },
      topic_tags: ['defence'],
      entity_ids: [],
      fingerprint: 'test-fp-1',
    },
  ];

  store.politician_indicators = [];
  store.politician_indicator_evidence = [];
  store.indicator_correlations = [];
  store.epoch_transitions = [];
  store.classifier_failures = [];
  store.politician_roles = [];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Integration: Evidence -> Classification -> Prediction', () => {
  beforeEach(() => {
    seedStore();
  });

  it('full pipeline: classify committee evidence, persist, predict vote', async () => {
    const evidence = store.politician_evidence[0] as unknown as PoliticianEvidence;

    // ── Step 1: Classify ─────────────────────────────────────────────
    const result = await classifyEvidence(evidence);

    expect(result.classifications).toHaveLength(1);
    expect(result.classifications[0].indicator_id).toBe(`${INDICATOR_ID}.revealed`);
    expect(result.classifications[0].anchor).toBe(0.7);
    expect(result.classifications[0].confidence).toBe(0.7);
    expect(result.classifications[0].raw_weight).toBeCloseTo(0.36); // 0.6 * 0.6
    expect(result.no_classification_reason).toBeUndefined();
    expect(result.cost_usd).toBe(0); // deterministic = no LLM cost

    // ── Step 2: Persist via batch ────────────────────────────────────
    await classifyEvidenceBatch([evidence]);

    // Verify politician_indicators row created with Beta(1,1) prior
    const piRow = store.politician_indicators.find(
      (r) =>
        r.politician_id === POL_ID &&
        r.indicator_id === `${INDICATOR_ID}.revealed`,
    );
    expect(piRow).toBeDefined();
    expect(piRow!.alpha).toBe(1.0);
    expect(piRow!.beta).toBe(1.0);

    // Verify audit trail row in politician_indicator_evidence
    const auditRow = store.politician_indicator_evidence.find(
      (r) =>
        r.politician_id === POL_ID &&
        r.indicator_id === `${INDICATOR_ID}.revealed` &&
        r.evidence_id === 1,
    );
    expect(auditRow).toBeDefined();
    expect(auditRow!.anchor).toBe(0.7);
    expect(auditRow!.effective_weight).toBeCloseTo(0.36);
    expect(auditRow!.classifier_reasoning).toMatch(/committee.*member.*defence/i);

    // ── Step 3: Predict vote ─────────────────────────────────────────
    const prediction = await predictVote({
      politician_id: POL_ID,
      bill_id: BILL_ID,
      as_of: QUERY_DATE,
    });

    // P(aye) should be between 0 and 1
    expect(prediction.p_aye).toBeGreaterThan(0);
    expect(prediction.p_aye).toBeLessThan(1);
    expect(prediction.p_aye + prediction.p_no).toBeCloseTo(1.0);

    // Committee evidence at anchor=0.7 shifts posterior above 0.5.
    // Bill mapping: aye_anchor=0.85 is closer to posterior than no_anchor=0.15,
    // so P(aye) should be above 0.5.
    expect(prediction.p_aye).toBeGreaterThan(0.5);

    // Should have exactly one driver (one bill_policy_mapping)
    expect(prediction.drivers).toHaveLength(1);
    expect(prediction.drivers[0].indicator_id).toBe(`${INDICATOR_ID}.revealed`);
    expect(prediction.drivers[0].evidence_count).toBeGreaterThan(0);

    // No whip data for this synthetic bill
    expect(prediction.whip_adjustment.whipped).toBe(false);

    // Should have caveats (low evidence)
    expect(prediction.caveats.length).toBeGreaterThan(0);
  });

  it('chair role produces higher anchor than regular member', async () => {
    const chairEvidence = {
      ...store.politician_evidence[0],
      parsed: {
        ...(store.politician_evidence[0].parsed as Record<string, unknown>),
        role: 'chair',
      },
    } as unknown as PoliticianEvidence;

    const memberResult = await classifyEvidence(
      store.politician_evidence[0] as unknown as PoliticianEvidence,
    );
    const chairResult = await classifyEvidence(chairEvidence);

    expect(memberResult.classifications[0].anchor).toBe(0.7);
    expect(chairResult.classifications[0].anchor).toBe(0.85);
  });

  it('unmapped committee produces no classification', async () => {
    const evidence = {
      ...store.politician_evidence[0],
      parsed: {
        committee_id: 'unmapped-committee',
        committee_name: 'Unmapped Committee',
        role: 'member',
      },
    } as unknown as PoliticianEvidence;

    const result = await classifyEvidence(evidence);

    expect(result.classifications).toHaveLength(0);
    expect(result.no_classification_reason).toBe('no_mapping');
  });

  it('unmapped bill produces 0.5 prediction with caveat', async () => {
    const prediction = await predictVote({
      politician_id: POL_ID,
      bill_id: 'nonexistent-bill',
      as_of: QUERY_DATE,
    });

    expect(prediction.p_aye).toBe(0.5);
    expect(prediction.p_no).toBe(0.5);
    expect(prediction.drivers).toHaveLength(0);
    expect(prediction.caveats).toContain(
      'No bill_policy_mappings found for this bill. Cannot predict.',
    );
  });

  it('multiple evidence rows shift posterior further from prior', async () => {
    const evidence = store.politician_evidence[0] as unknown as PoliticianEvidence;

    // Classify once
    await classifyEvidenceBatch([evidence]);
    const singlePrediction = await predictVote({
      politician_id: POL_ID,
      bill_id: BILL_ID,
      as_of: QUERY_DATE,
    });

    // Add a second evidence row (different committee, same indicator)
    store.committee_indicator_map.push({
      committee_id: 'foreign-affairs',
      indicator_id: INDICATOR_ID,
      membership_anchor: 0.8,
      chair_anchor: null,
      weight_multiplier: 0.6,
    });

    const secondEvidence = {
      id: 2,
      politician_id: POL_ID,
      evidence_type: 'committee_membership',
      source: 'test',
      source_id: 'test-committee-2',
      source_url: null,
      occurred_at: '2025-02-01T00:00:00Z',
      ingested_at: '2025-02-01T01:00:00Z',
      raw_content: 'Foreign Affairs Committee: member since 2025-02-01',
      parsed: {
        committee_id: 'foreign-affairs',
        committee_name: 'Foreign Affairs Committee',
        role: 'member',
      },
      topic_tags: ['defence'],
      entity_ids: [],
      fingerprint: 'test-fp-2',
    } as unknown as PoliticianEvidence;

    store.politician_evidence.push(secondEvidence as unknown as Record<string, unknown>);
    await classifyEvidenceBatch([secondEvidence]);

    const doublePrediction = await predictVote({
      politician_id: POL_ID,
      bill_id: BILL_ID,
      as_of: QUERY_DATE,
    });

    // More evidence at high anchors should push P(aye) higher
    expect(doublePrediction.p_aye).toBeGreaterThan(singlePrediction.p_aye);
    // Both should be above 0.5
    expect(doublePrediction.p_aye).toBeGreaterThan(0.5);
    expect(singlePrediction.p_aye).toBeGreaterThan(0.5);
  });
});
