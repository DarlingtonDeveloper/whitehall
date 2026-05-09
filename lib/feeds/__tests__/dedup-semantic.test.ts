import { describe, it, expect } from 'vitest';
import { deduplicateSemantic } from '../dedup-semantic';
import type { FeedItem } from '@/types/feed';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<FeedItem> & { id: string }): FeedItem {
  return {
    source_type: 'govuk',
    source_name: 'GOV.UK',
    title: 'Default title',
    published_at: '2026-05-01T10:00:00Z',
    entity_ids: ['desnz'],
    relevance_score: 0,
    fingerprint: `fp-${overrides.id}`,
    created_at: '2026-05-01T10:00:00Z',
    is_forward_scan: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('deduplicateSemantic', () => {
  it('returns empty array for empty input', () => {
    expect(deduplicateSemantic([])).toEqual([]);
  });

  it('returns single item unchanged', () => {
    const items = [makeItem({ id: '1' })];
    expect(deduplicateSemantic(items)).toHaveLength(1);
  });

  it('clusters items about the same development', () => {
    const items = [
      makeItem({
        id: '1',
        source_type: 'govuk',
        title: 'Ofgem announces new energy price cap for winter',
        published_at: '2026-05-01T10:00:00Z',
        entity_ids: ['ofgem'],
      }),
      makeItem({
        id: '2',
        source_type: 'trade_press',
        source_name: 'Energy Voice',
        title: 'Ofgem energy price cap announcement for winter period',
        published_at: '2026-05-01T14:00:00Z',
        entity_ids: ['ofgem'],
      }),
    ];

    const result = deduplicateSemantic(items);
    expect(result).toHaveLength(1);
    // Should keep govuk (priority 10) over trade_press (priority 5)
    expect(result[0].source_type).toBe('govuk');
    // Body should mention the other source
    expect(result[0].body).toContain('Also covered by');
    expect(result[0].body).toContain('Energy Voice');
  });

  it('keeps items that are about different topics', () => {
    const items = [
      makeItem({
        id: '1',
        title: 'New offshore wind farm approved by planning inspectorate',
        entity_ids: ['desnz'],
      }),
      makeItem({
        id: '2',
        title: 'NHS waiting list figures reach new record',
        entity_ids: ['dhsc'],
      }),
    ];

    const result = deduplicateSemantic(items);
    expect(result).toHaveLength(2);
  });

  it('does not cluster items more than 3 days apart', () => {
    const items = [
      makeItem({
        id: '1',
        title: 'Ofgem announces new energy price cap changes',
        published_at: '2026-05-01T10:00:00Z',
        entity_ids: ['ofgem'],
      }),
      makeItem({
        id: '2',
        title: 'Ofgem energy price cap changes announced today',
        published_at: '2026-05-06T10:00:00Z', // 5 days later
        entity_ids: ['ofgem'],
      }),
    ];

    const result = deduplicateSemantic(items);
    expect(result).toHaveLength(2);
  });

  it('does not cluster items without shared entities', () => {
    const items = [
      makeItem({
        id: '1',
        title: 'Ofgem announces new energy price cap changes',
        entity_ids: ['ofgem'],
      }),
      makeItem({
        id: '2',
        title: 'Ofgem announces new energy price cap changes',
        entity_ids: ['defra'],
      }),
    ];

    const result = deduplicateSemantic(items);
    expect(result).toHaveLength(2);
  });

  it('does not cluster items with low title overlap', () => {
    const items = [
      makeItem({
        id: '1',
        title: 'Government budget spending review autumn forecast',
        entity_ids: ['desnz'],
      }),
      makeItem({
        id: '2',
        title: 'Offshore wind turbine installation progress report',
        entity_ids: ['desnz'],
      }),
    ];

    const result = deduplicateSemantic(items);
    expect(result).toHaveLength(2);
  });

  it('prefers govuk over trade_press', () => {
    const items = [
      makeItem({
        id: '1',
        source_type: 'trade_press',
        source_name: 'Utility Week',
        title: 'DESNZ clean power strategy published today',
        entity_ids: ['desnz'],
      }),
      makeItem({
        id: '2',
        source_type: 'govuk',
        source_name: 'GOV.UK',
        title: 'DESNZ publishes clean power strategy',
        entity_ids: ['desnz'],
      }),
    ];

    const result = deduplicateSemantic(items);
    expect(result).toHaveLength(1);
    expect(result[0].source_type).toBe('govuk');
  });

  it('handles cluster of three items', () => {
    const items = [
      makeItem({
        id: '1',
        source_type: 'govuk',
        title: 'Ofgem consultation on network charging reform',
        entity_ids: ['ofgem'],
      }),
      makeItem({
        id: '2',
        source_type: 'trade_press',
        source_name: 'Energy Voice',
        title: 'Ofgem launches consultation network charging reform',
        entity_ids: ['ofgem'],
      }),
      makeItem({
        id: '3',
        source_type: 'hansard',
        source_name: 'Hansard',
        title: 'Ofgem network charging reform consultation debate',
        entity_ids: ['ofgem'],
      }),
    ];

    const result = deduplicateSemantic(items);
    expect(result).toHaveLength(1);
    expect(result[0].source_type).toBe('govuk');
    expect(result[0].body).toContain('Also covered by');
  });
});
