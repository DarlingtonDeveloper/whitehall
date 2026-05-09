import { describe, it, expect } from 'vitest';
import { computeReportDiff } from '../diff';
import type { AnalysisJSON, AnalysedItem, ThemeSection } from '@/lib/export/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<AnalysedItem> = {}): AnalysedItem {
  return {
    ref: '1.1.1',
    headline: 'Test headline',
    date: '01/05/2026',
    source: 'GOV.UK',
    summary: 'Test summary sentence one. Sentence two.',
    client_relevance: 'Relevant to client. Specific reason.',
    recommended_action: 'Monitor',
    escalation: 'STANDARD',
    rag: 'GREEN',
    confidence: 0.8,
    source_items: ['fingerprint-abc'],
    ...overrides,
  };
}

function makeAnalysis(
  sections: Record<string, Partial<ThemeSection>> = {},
): AnalysisJSON {
  const fullSections: Record<string, ThemeSection> = {};
  for (const [id, s] of Object.entries(sections)) {
    fullSections[id] = { items: [], ...s };
  }

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
      top_line: 'Test top line.',
      key_developments: [],
    },
    sections: fullSections,
    forward_look: [],
    emerging_themes: [],
    actions_tracker: [],
    coverage_summary: [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('computeReportDiff', () => {
  it('returns empty diff for identical reports', () => {
    const item = makeItem();
    const analysis = makeAnalysis({ energy: { items: [item] } });
    const diff = computeReportDiff(analysis, analysis);

    expect(diff.items_removed).toHaveLength(0);
    expect(diff.items_added).toHaveLength(0);
    expect(diff.rag_changes).toHaveLength(0);
    expect(diff.field_edits).toHaveLength(0);
  });

  it('detects removed items', () => {
    const item = makeItem({ source_items: ['fp-1'] });
    const original = makeAnalysis({ energy: { items: [item] } });
    const edited = makeAnalysis({ energy: { items: [] } });

    const diff = computeReportDiff(original, edited);
    expect(diff.items_removed).toHaveLength(1);
    expect(diff.items_removed[0].section_id).toBe('energy');
    expect(diff.items_removed[0].item_ref).toBe('1.1.1');
  });

  it('detects added items', () => {
    const newItem = makeItem({ ref: '2.1.1', source_items: ['fp-new'] });
    const original = makeAnalysis({ energy: { items: [] } });
    const edited = makeAnalysis({ energy: { items: [newItem] } });

    const diff = computeReportDiff(original, edited);
    expect(diff.items_added).toHaveLength(1);
    expect(diff.items_added[0].section_id).toBe('energy');
  });

  it('detects RAG changes', () => {
    const original = makeAnalysis({
      energy: { items: [makeItem({ rag: 'GREEN', source_items: ['fp-1'] })] },
    });
    const edited = makeAnalysis({
      energy: { items: [makeItem({ rag: 'RED', source_items: ['fp-1'] })] },
    });

    const diff = computeReportDiff(original, edited);
    expect(diff.rag_changes).toHaveLength(1);
    expect(diff.rag_changes[0].old_rag).toBe('GREEN');
    expect(diff.rag_changes[0].new_rag).toBe('RED');
  });

  it('detects headline edits', () => {
    const original = makeAnalysis({
      energy: {
        items: [
          makeItem({ headline: 'Original headline', source_items: ['fp-1'] }),
        ],
      },
    });
    const edited = makeAnalysis({
      energy: {
        items: [
          makeItem({ headline: 'Updated headline', source_items: ['fp-1'] }),
        ],
      },
    });

    const diff = computeReportDiff(original, edited);
    expect(diff.field_edits).toHaveLength(1);
    expect(diff.field_edits[0].field).toBe('headline');
    expect(diff.field_edits[0].old_value).toBe('Original headline');
    expect(diff.field_edits[0].new_value).toBe('Updated headline');
  });

  it('detects summary edits', () => {
    const original = makeAnalysis({
      energy: {
        items: [makeItem({ summary: 'Old summary.', source_items: ['fp-1'] })],
      },
    });
    const edited = makeAnalysis({
      energy: {
        items: [
          makeItem({ summary: 'New improved summary.', source_items: ['fp-1'] }),
        ],
      },
    });

    const diff = computeReportDiff(original, edited);
    expect(diff.field_edits.some((e) => e.field === 'summary')).toBe(true);
  });

  it('detects client_relevance edits', () => {
    const original = makeAnalysis({
      energy: {
        items: [
          makeItem({
            client_relevance: 'Generic.',
            source_items: ['fp-1'],
          }),
        ],
      },
    });
    const edited = makeAnalysis({
      energy: {
        items: [
          makeItem({
            client_relevance: 'Specific to Sofia project.',
            source_items: ['fp-1'],
          }),
        ],
      },
    });

    const diff = computeReportDiff(original, edited);
    expect(diff.field_edits.some((e) => e.field === 'client_relevance')).toBe(true);
  });

  it('detects recommended_action edits', () => {
    const original = makeAnalysis({
      energy: {
        items: [
          makeItem({
            recommended_action: 'Monitor',
            source_items: ['fp-1'],
          }),
        ],
      },
    });
    const edited = makeAnalysis({
      energy: {
        items: [
          makeItem({
            recommended_action: 'Escalate to board',
            source_items: ['fp-1'],
          }),
        ],
      },
    });

    const diff = computeReportDiff(original, edited);
    expect(
      diff.field_edits.some((e) => e.field === 'recommended_action'),
    ).toBe(true);
  });

  it('matches by fingerprint, not ref', () => {
    const original = makeAnalysis({
      energy: {
        items: [
          makeItem({ ref: '1.1.1', headline: 'Old', source_items: ['fp-1'] }),
        ],
      },
    });
    const edited = makeAnalysis({
      energy: {
        items: [
          makeItem({
            ref: '2.1.1', // different ref, same fingerprint
            headline: 'New',
            source_items: ['fp-1'],
          }),
        ],
      },
    });

    const diff = computeReportDiff(original, edited);
    // Should detect field edit, not add+remove
    expect(diff.items_removed).toHaveLength(0);
    expect(diff.items_added).toHaveLength(0);
    expect(diff.field_edits.some((e) => e.field === 'headline')).toBe(true);
  });

  it('handles items across multiple sections', () => {
    const original = makeAnalysis({
      energy: { items: [makeItem({ source_items: ['fp-1'] })] },
      health: { items: [makeItem({ ref: '2.1.1', source_items: ['fp-2'] })] },
    });
    const edited = makeAnalysis({
      energy: { items: [] }, // removed
      health: { items: [makeItem({ ref: '2.1.1', source_items: ['fp-2'] })] }, // kept
    });

    const diff = computeReportDiff(original, edited);
    expect(diff.items_removed).toHaveLength(1);
    expect(diff.items_removed[0].section_id).toBe('energy');
  });

  it('falls back to ref when source_items is empty', () => {
    const original = makeAnalysis({
      energy: {
        items: [makeItem({ ref: 'X.1', source_items: [], headline: 'A' })],
      },
    });
    const edited = makeAnalysis({
      energy: {
        items: [makeItem({ ref: 'X.1', source_items: [], headline: 'B' })],
      },
    });

    const diff = computeReportDiff(original, edited);
    expect(diff.field_edits.some((e) => e.field === 'headline')).toBe(true);
  });
});
