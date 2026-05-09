import { describe, it, expect, vi } from 'vitest';

// Mock db and opik to avoid needing env vars
vi.mock('@/lib/db', () => ({
  supabase: {},
  getServiceClient: () => ({}),
}));
vi.mock('@/lib/observability/opik', () => ({
  logTrace: vi.fn(),
}));

import { validateTemplate } from '../evaluate';
import type { AnalysisJSON, AnalysedItem, KeyDevelopment, ThemeSection } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<AnalysedItem> = {}): AnalysedItem {
  return {
    ref: '1.1.1',
    headline: 'Test headline',
    date: '01/05/2026',
    source: 'GOV.UK',
    summary: 'Summary sentence one. Sentence two.',
    client_relevance: 'Relevance sentence one. Sentence two.',
    recommended_action: 'Monitor',
    escalation: 'STANDARD',
    rag: 'GREEN',
    confidence: 0.8,
    source_items: ['fingerprint-abc'],
    ...overrides,
  };
}

function makeKD(overrides: Partial<KeyDevelopment> = {}): KeyDevelopment {
  return {
    rag: 'AMBER',
    development: 'New policy announced.',
    relevance: 'Directly impacts client.',
    recommended_action: 'Monitor closely.',
    section_ref: '1.1',
    confidence: 0.85,
    ...overrides,
  };
}

function makeValidAnalysis(): AnalysisJSON {
  return {
    metadata: {
      client_name: 'Test Client',
      reporting_period: 'w/c 1 May 2026',
      report_date: '5 May 2026',
      generated_at: '2026-05-05T00:00:00Z',
      items_collected: 100,
      items_analysed: 50,
      sources_unavailable: [],
    },
    executive_summary: {
      top_line: 'A busy week of policy activity.',
      key_developments: [makeKD(), makeKD(), makeKD(), makeKD()],
    },
    sections: {
      energy: {
        items: [makeItem()],
      },
    },
    forward_look: [
      { date: '15/05/2026', event: 'CfD Round', relevance: 'Key event', preparation: 'Submit' },
    ],
    emerging_themes: ['Theme one', 'Theme two'],
    actions_tracker: [
      { ref: '001', action: 'Monitor', owner: '[Name]', deadline: '15/05/2026', origin: 'Report w/c 1 May', status: 'Open' },
    ],
    coverage_summary: [
      { metric: 'Items collected', this_week: '100', previous_week: '90', trend: 'Up' },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('validateTemplate', () => {
  it('returns no failures for valid analysis', () => {
    const failures = validateTemplate(makeValidAnalysis());
    const errors = failures.filter((f) => f.severity === 'error');
    expect(errors).toHaveLength(0);
  });

  // ── Executive summary ──

  it('errors when executive_summary is missing', () => {
    const analysis = makeValidAnalysis();
    (analysis as Record<string, unknown>).executive_summary = undefined;
    const failures = validateTemplate(analysis);
    expect(failures.some((f) => f.check === 'exec_summary_exists')).toBe(true);
  });

  it('errors when top_line is empty', () => {
    const analysis = makeValidAnalysis();
    analysis.executive_summary.top_line = '';
    const failures = validateTemplate(analysis);
    expect(failures.some((f) => f.check === 'exec_summary_topline')).toBe(true);
  });

  it('errors when key_developments has fewer than 4 items', () => {
    const analysis = makeValidAnalysis();
    analysis.executive_summary.key_developments = [makeKD(), makeKD()];
    const failures = validateTemplate(analysis);
    expect(failures.some((f) => f.check === 'exec_summary_kd_count')).toBe(true);
  });

  it('warns when key_developments has more than 6 items', () => {
    const analysis = makeValidAnalysis();
    analysis.executive_summary.key_developments = Array.from(
      { length: 8 },
      () => makeKD(),
    );
    const failures = validateTemplate(analysis);
    const kd = failures.find((f) => f.check === 'exec_summary_kd_count');
    expect(kd).toBeDefined();
    expect(kd?.severity).toBe('warning');
  });

  it('errors when key_development is missing required fields', () => {
    const analysis = makeValidAnalysis();
    analysis.executive_summary.key_developments = [
      makeKD({ development: '' }),
      makeKD(),
      makeKD(),
      makeKD(),
    ];
    const failures = validateTemplate(analysis);
    expect(failures.some((f) => f.check === 'kd_field_missing')).toBe(true);
  });

  it('errors when key_development has invalid RAG', () => {
    const analysis = makeValidAnalysis();
    analysis.executive_summary.key_developments = [
      makeKD({ rag: 'PURPLE' as 'RED' }),
      makeKD(),
      makeKD(),
      makeKD(),
    ];
    const failures = validateTemplate(analysis);
    expect(failures.some((f) => f.check === 'kd_rag_invalid')).toBe(true);
  });

  // ── Theme sections ──

  it('errors when item is missing required fields', () => {
    const analysis = makeValidAnalysis();
    analysis.sections.energy = {
      items: [makeItem({ headline: '' })],
    };
    const failures = validateTemplate(analysis);
    expect(failures.some((f) => f.check === 'item_field_missing')).toBe(true);
  });

  it('errors when item has invalid escalation', () => {
    const analysis = makeValidAnalysis();
    analysis.sections.energy = {
      items: [makeItem({ escalation: 'URGENT' as 'IMMEDIATE' })],
    };
    const failures = validateTemplate(analysis);
    expect(failures.some((f) => f.check === 'item_escalation_invalid')).toBe(true);
  });

  it('errors when item has no source_items', () => {
    const analysis = makeValidAnalysis();
    analysis.sections.energy = {
      items: [makeItem({ source_items: [] })],
    };
    const failures = validateTemplate(analysis);
    expect(failures.some((f) => f.check === 'item_no_provenance')).toBe(true);
  });

  it('warns when summary has fewer than 2 sentences', () => {
    const analysis = makeValidAnalysis();
    analysis.sections.energy = {
      items: [makeItem({ summary: 'Just one sentence' })],
    };
    const failures = validateTemplate(analysis);
    expect(failures.some((f) => f.check === 'item_summary_short')).toBe(true);
  });

  it('warns when client_relevance has fewer than 2 sentences', () => {
    const analysis = makeValidAnalysis();
    analysis.sections.energy = {
      items: [makeItem({ client_relevance: 'Short' })],
    };
    const failures = validateTemplate(analysis);
    expect(failures.some((f) => f.check === 'item_cr_short')).toBe(true);
  });

  it('warns when confidence is exactly 1.0', () => {
    const analysis = makeValidAnalysis();
    analysis.sections.energy = {
      items: [makeItem({ confidence: 1.0 })],
    };
    const failures = validateTemplate(analysis);
    expect(failures.some((f) => f.check === 'item_confidence_1')).toBe(true);
  });

  it('warns when confidence is exactly 0.0', () => {
    const analysis = makeValidAnalysis();
    analysis.sections.energy = {
      items: [makeItem({ confidence: 0.0 })],
    };
    const failures = validateTemplate(analysis);
    expect(failures.some((f) => f.check === 'item_confidence_0')).toBe(true);
  });

  it('warns when empty section has no no_developments flag', () => {
    const analysis = makeValidAnalysis();
    analysis.sections.empty_theme = { items: [] };
    const failures = validateTemplate(analysis);
    expect(failures.some((f) => f.check === 'empty_section_no_flag')).toBe(true);
  });

  it('does not warn when empty section has no_developments flag', () => {
    const analysis = makeValidAnalysis();
    analysis.sections.empty_theme = { items: [], no_developments: true };
    const failures = validateTemplate(analysis);
    expect(failures.every((f) => f.check !== 'empty_section_no_flag')).toBe(true);
  });

  // ── Forward look ──

  it('errors when forward_look is empty', () => {
    const analysis = makeValidAnalysis();
    analysis.forward_look = [];
    const failures = validateTemplate(analysis);
    expect(failures.some((f) => f.check === 'forward_look_empty')).toBe(true);
  });

  // ── Emerging themes ──

  it('errors when emerging_themes has fewer than 2', () => {
    const analysis = makeValidAnalysis();
    analysis.emerging_themes = ['Only one'];
    const failures = validateTemplate(analysis);
    expect(failures.some((f) => f.check === 'emerging_themes_count')).toBe(true);
  });

  it('warns when emerging_themes has more than 4', () => {
    const analysis = makeValidAnalysis();
    analysis.emerging_themes = ['1', '2', '3', '4', '5'];
    const failures = validateTemplate(analysis);
    const et = failures.find((f) => f.check === 'emerging_themes_count');
    expect(et?.severity).toBe('warning');
  });

  // ── Actions tracker ──

  it('errors when actions_tracker is missing', () => {
    const analysis = makeValidAnalysis();
    (analysis as Record<string, unknown>).actions_tracker = undefined;
    const failures = validateTemplate(analysis);
    expect(failures.some((f) => f.check === 'actions_tracker_missing')).toBe(true);
  });

  // ── Coverage summary ──

  it('errors when coverage_summary is missing', () => {
    const analysis = makeValidAnalysis();
    (analysis as Record<string, unknown>).coverage_summary = undefined;
    const failures = validateTemplate(analysis);
    expect(failures.some((f) => f.check === 'coverage_summary_missing')).toBe(true);
  });
});
