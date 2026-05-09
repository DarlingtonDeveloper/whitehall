import { describe, it, expect } from 'vitest';
import { generateSuggestions } from '../suggestions';
import type { ClientConfig } from '@/types/client';
import type { Entity } from '@/types/entity';
import type { FeedItem } from '@/types/feed';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClient(overrides: Partial<ClientConfig> = {}): ClientConfig {
  return {
    id: 'client-1',
    name: 'Acme Energy',
    sector: 'energy',
    description: 'Energy company',
    stakeholders: [
      { entityId: 'desnz', priority: 'primary', role: 'Regulator' },
      { entityId: 'ofgem', priority: 'secondary', role: 'Market regulator' },
    ],
    projects: [],
    competitors: [],
    policyKeywords: [],
    industryKeywords: [],
    forwardScanQueries: [],
    monitoringThemes: [],
    allKeywords: [],
    ...overrides,
  };
}

function makeEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    id: 'desnz',
    name: 'Department for Energy Security and Net Zero',
    category: 'department',
    subtype: 'ministerial',
    description: 'Energy department',
    parentIds: [],
    ...overrides,
  };
}

function makeRecentItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    id: 'item-1',
    source_type: 'govuk',
    source_name: 'GOV.UK',
    title: 'Test item',
    published_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days ago
    entity_ids: [],
    relevance_score: 0,
    fingerprint: 'fp-1',
    created_at: new Date().toISOString(),
    is_forward_scan: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateSuggestions', () => {
  it('returns generic suggestions when no context', () => {
    const suggestions = generateSuggestions({});
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.some((s) => s.includes('departments'))).toBe(true);
    expect(suggestions.some((s) => s.includes('consultations'))).toBe(true);
  });

  it('returns at most 4 suggestions', () => {
    const client = makeClient();
    const items = [
      makeRecentItem({ title: 'Consultation on energy policy' }),
      makeRecentItem({ id: '2', source_type: 'hansard', title: 'Debate' }),
      makeRecentItem({ id: '3', source_type: 'committee', title: 'Committee' }),
      makeRecentItem({ id: '4', source_type: 'trade_press', title: 'Trade' }),
      makeRecentItem({ id: '5', source_type: 'petition', title: 'Petition' }),
    ];
    const suggestions = generateSuggestions({
      client,
      recentFeedItems: items,
    });
    expect(suggestions.length).toBeLessThanOrEqual(4);
  });

  it('suggests consultation response when consultations exist', () => {
    const client = makeClient();
    const items = [
      makeRecentItem({ title: 'Consultation on offshore wind CfD design' }),
    ];
    const suggestions = generateSuggestions({
      client,
      recentFeedItems: items,
    });
    expect(suggestions.some((s) => s.includes('consultation'))).toBe(true);
    expect(suggestions.some((s) => s.includes('Acme Energy'))).toBe(true);
  });

  it('suggests parliamentary items when hansard items exist', () => {
    const client = makeClient();
    const items = [
      makeRecentItem({ id: '1', source_type: 'hansard', title: 'Energy debate' }),
      makeRecentItem({ id: '2', source_type: 'hansard', title: 'Question time' }),
    ];
    const suggestions = generateSuggestions({
      client,
      recentFeedItems: items,
    });
    expect(suggestions.some((s) => s.includes('parliamentary'))).toBe(true);
    expect(suggestions.some((s) => s.includes('2'))).toBe(true);
  });

  it('suggests committee activity when committee items exist', () => {
    const client = makeClient();
    const items = [
      makeRecentItem({ source_type: 'committee', title: 'Committee report' }),
    ];
    const suggestions = generateSuggestions({
      client,
      recentFeedItems: items,
    });
    expect(suggestions.some((s) => s.includes('Committee'))).toBe(true);
  });

  it('suggests trade press coverage', () => {
    const client = makeClient();
    const items = [
      makeRecentItem({ id: '1', source_type: 'trade_press', title: 'Industry news' }),
    ];
    const suggestions = generateSuggestions({
      client,
      recentFeedItems: items,
    });
    expect(suggestions.some((s) => s.includes('trade press'))).toBe(true);
  });

  it('suggests petition risk', () => {
    const client = makeClient();
    const items = [
      makeRecentItem({ source_type: 'petition', title: 'Stop offshore wind' }),
    ];
    const suggestions = generateSuggestions({
      client,
      recentFeedItems: items,
    });
    expect(suggestions.some((s) => s.includes('petition'))).toBe(true);
    expect(suggestions.some((s) => s.includes('reputational'))).toBe(true);
  });

  it('suggests hot entities when pulse scores are high', () => {
    const client = makeClient();
    const items = [makeRecentItem()];
    const pulseScores = new Map([
      ['desnz', 8],
      ['ofgem', 3], // below threshold
    ]);
    const suggestions = generateSuggestions({
      client,
      recentFeedItems: items,
      pulseScores,
    });
    expect(suggestions.some((s) => s.includes('active'))).toBe(true);
  });

  it('provides generic fallback when client has no recent items', () => {
    const client = makeClient();
    const oldItems = [
      makeRecentItem({
        published_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(), // 10 days ago — outside window
      }),
    ];
    const suggestions = generateSuggestions({
      client,
      recentFeedItems: oldItems,
    });
    expect(suggestions.some((s) => s.includes('paying attention'))).toBe(true);
  });

  it('includes entity-specific suggestions', () => {
    const entity = makeEntity({ currentHolder: 'Ed Miliband' });
    const suggestions = generateSuggestions({ entity });
    expect(suggestions.some((s) => s.includes('Ed Miliband'))).toBe(true);
    expect(suggestions.some((s) => s.includes('relationships'))).toBe(true);
    expect(suggestions.some((s) => s.includes('changed'))).toBe(true);
  });

  it('includes entity name for relationship suggestion', () => {
    const entity = makeEntity({ name: 'Ofgem' });
    const suggestions = generateSuggestions({ entity });
    expect(suggestions.some((s) => s.includes('Ofgem'))).toBe(true);
  });

  it('omits current holder suggestion when no holder', () => {
    const entity = makeEntity({ currentHolder: undefined });
    const suggestions = generateSuggestions({ entity });
    expect(suggestions.every((s) => !s.includes('said recently'))).toBe(true);
  });

  it('handles call for evidence in title', () => {
    const client = makeClient();
    const items = [
      makeRecentItem({ title: 'Call for evidence: grid connections' }),
    ];
    const suggestions = generateSuggestions({
      client,
      recentFeedItems: items,
    });
    expect(suggestions.some((s) => s.includes('consultation'))).toBe(true);
  });
});
