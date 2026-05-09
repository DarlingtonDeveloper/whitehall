import { describe, it, expect } from 'vitest';
import { computeFeedRelevance, type LearnedSignals } from '../scoring';
import type { FeedItem } from '@/types/feed';
import type { ClientConfig } from '@/types/client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    id: 'item-1',
    source_type: 'govuk',
    source_name: 'GOV.UK',
    title: 'Government announces new policy',
    url: 'https://gov.uk/example',
    published_at: new Date().toISOString(), // recent by default
    body: 'Detailed body content about energy policy.',
    entity_ids: [],
    relevance_score: 0,
    fingerprint: 'abc123',
    created_at: new Date().toISOString(),
    is_forward_scan: false,
    ...overrides,
  };
}

function makeClient(overrides: Partial<ClientConfig> = {}): ClientConfig {
  return {
    id: 'client-1',
    name: 'Acme Energy',
    sector: 'energy',
    description: 'Energy company',
    stakeholders: [
      { entityId: 'desnz', priority: 'primary', role: 'Regulator' },
      { entityId: 'ofgem', priority: 'secondary', role: 'Market regulator' },
      { entityId: 'defra', priority: 'tertiary', role: 'Environment' },
    ],
    projects: ['Sofia offshore wind', 'Rampion Extension'],
    competitors: ['SSE', 'Orsted'],
    policyKeywords: ['offshore wind', 'CfD'],
    industryKeywords: ['energy', 'renewables'],
    forwardScanQueries: [],
    monitoringThemes: [],
    allKeywords: ['offshore wind', 'CfD', 'energy', 'renewables'],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('computeFeedRelevance', () => {
  describe('entity overlap scoring (up to 0.30)', () => {
    it('scores primary stakeholder at 0.15', () => {
      const item = makeItem({ entity_ids: ['desnz'] });
      const client = makeClient();
      const score = computeFeedRelevance(item, client);
      // Should include: entity (0.15) + source (0.10) + recency (0.15) = 0.40
      // But primary floor is 0.30, and natural score is higher
      expect(score).toBeGreaterThanOrEqual(0.30);
    });

    it('scores secondary stakeholder at 0.08', () => {
      const item = makeItem({ entity_ids: ['ofgem'], title: 'Unrelated topic' });
      const client = makeClient();
      const score = computeFeedRelevance(item, client);
      // entity (0.08) + source (0.10) + recency (0.15) = 0.33
      expect(score).toBeGreaterThanOrEqual(0.20); // secondary floor
    });

    it('scores tertiary stakeholder at 0.03', () => {
      const item = makeItem({
        entity_ids: ['defra'],
        title: 'Unrelated topic xyz',
        body: 'nothing relevant',
      });
      const client = makeClient();
      const score = computeFeedRelevance(item, client);
      // entity (0.03) + source (0.10) + recency (0.15) = 0.28
      expect(score).toBeLessThan(0.35);
    });

    it('caps entity contribution at 0.30', () => {
      // 3 primary stakeholders = 3 * 0.15 = 0.45, capped to 0.30
      const client = makeClient({
        stakeholders: [
          { entityId: 'desnz', priority: 'primary', role: 'a' },
          { entityId: 'ofgem', priority: 'primary', role: 'b' },
          { entityId: 'defra', priority: 'primary', role: 'c' },
        ],
      });
      const item = makeItem({
        entity_ids: ['desnz', 'ofgem', 'defra'],
        title: 'Unrelated topic 12345',
        body: 'nothing here',
      });
      const score = computeFeedRelevance(item, client);
      // entity capped at 0.30 + source 0.10 + recency 0.15 = max 0.55
      expect(score).toBeLessThanOrEqual(0.60);
    });

    it('returns 0 entity contribution for non-stakeholder entities', () => {
      const item = makeItem({
        entity_ids: ['treasury'],
        title: 'Budget statement 12345',
        body: 'nothing relevant at all xyz',
      });
      const client = makeClient();
      const score = computeFeedRelevance(item, client);
      // no entity overlap, source 0.10, recency 0.15 = 0.25
      expect(score).toBeCloseTo(0.25, 1);
    });
  });

  describe('keyword matching (up to 0.25)', () => {
    it('adds 0.04 per keyword match', () => {
      const item = makeItem({
        title: 'Offshore wind and CfD allocation round',
        body: 'energy sector renewables expansion',
        entity_ids: [],
      });
      const client = makeClient();
      const score = computeFeedRelevance(item, client);
      // 4 keywords matched × 0.04 = 0.16 for keywords
      // + source (0.10) + recency (0.15) = 0.41
      expect(score).toBeGreaterThan(0.35);
    });

    it('caps keyword contribution at 0.25', () => {
      const client = makeClient({
        allKeywords: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
      });
      const item = makeItem({
        title: 'a b c d e f g h',
        body: '',
        entity_ids: [],
      });
      // 8 × 0.04 = 0.32, capped at 0.25
      // + source (0.10) + recency (0.15) = 0.50
      const score = computeFeedRelevance(item, client);
      expect(score).toBeLessThanOrEqual(0.55);
    });
  });

  describe('source type quality (up to 0.10)', () => {
    it('govuk scores 0.10', () => {
      const govukItem = makeItem({ source_type: 'govuk', entity_ids: [], title: 'xyz', body: '' });
      const tradeItem = makeItem({ source_type: 'trade_press', entity_ids: [], title: 'xyz', body: '' });
      const client = makeClient({ allKeywords: [] });

      const govukScore = computeFeedRelevance(govukItem, client);
      const tradeScore = computeFeedRelevance(tradeItem, client);
      // govuk (0.10) vs trade_press (0.06)
      expect(govukScore).toBeGreaterThan(tradeScore);
    });

    it('unknown source type defaults to 0.03', () => {
      const item = makeItem({
        source_type: 'unknown_source' as FeedItem['source_type'],
        entity_ids: [],
        title: 'xyz',
        body: '',
      });
      const client = makeClient({ allKeywords: [] });
      const score = computeFeedRelevance(item, client);
      // source (0.03) + recency (0.15) = 0.18
      expect(score).toBeCloseTo(0.18, 1);
    });
  });

  describe('recency decay (up to 0.15)', () => {
    it('scores 0.15 for items < 6 hours old', () => {
      const item = makeItem({
        published_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2h
        entity_ids: [],
        title: 'xyz',
        body: '',
      });
      const client = makeClient({ allKeywords: [] });
      const score = computeFeedRelevance(item, client);
      // source (0.10 govuk) + recency (0.15) = 0.25
      expect(score).toBeCloseTo(0.25, 1);
    });

    it('scores 0.12 for items < 24 hours old', () => {
      const item = makeItem({
        published_at: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(), // 12h
        entity_ids: [],
        title: 'xyz',
        body: '',
      });
      const client = makeClient({ allKeywords: [] });
      const score = computeFeedRelevance(item, client);
      // source (0.10) + recency (0.12) = 0.22
      expect(score).toBeCloseTo(0.22, 1);
    });

    it('scores 0.01 for items > 7 days old', () => {
      const item = makeItem({
        published_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(), // 10d
        entity_ids: [],
        title: 'xyz',
        body: '',
      });
      const client = makeClient({ allKeywords: [] });
      const score = computeFeedRelevance(item, client);
      // source (0.10) + recency (0.01) = 0.11
      expect(score).toBeCloseTo(0.11, 1);
    });
  });

  describe('actionable content bonus (up to 0.10)', () => {
    it('adds 0.10 for consultation', () => {
      const item = makeItem({
        title: 'Consultation on energy regulation',
        entity_ids: [],
        body: '',
      });
      const client = makeClient({ allKeywords: [] });
      const score = computeFeedRelevance(item, client);
      // source (0.10) + recency (0.15) + actionable (0.10) = 0.35
      expect(score).toBeCloseTo(0.35, 1);
    });

    it('adds 0.10 for call for evidence', () => {
      const item = makeItem({
        title: 'Call for evidence on net zero',
        entity_ids: [],
        body: '',
      });
      const client = makeClient({ allKeywords: [] });
      const score = computeFeedRelevance(item, client);
      expect(score).toBeCloseTo(0.35, 1);
    });

    it('adds 0.05 for statement', () => {
      const item = makeItem({
        title: 'Ministerial statement on grid connections',
        entity_ids: [],
        body: '',
      });
      const client = makeClient({ allKeywords: [] });
      const score = computeFeedRelevance(item, client);
      // source (0.10) + recency (0.15) + actionable (0.05) = 0.30
      expect(score).toBeCloseTo(0.30, 1);
    });
  });

  describe('learned signals (up to 0.10)', () => {
    it('applies source boost', () => {
      const signals: LearnedSignals = {
        source_boosts: { 'GOV.UK': 0.04 },
        keyword_boosts: {},
        rag_adjustments: {},
      };
      const item = makeItem({ entity_ids: [], title: 'xyz', body: '' });
      const client = makeClient({ allKeywords: [] });

      const withSignals = computeFeedRelevance(item, client, signals);
      const without = computeFeedRelevance(item, client);
      expect(withSignals).toBeGreaterThan(without);
      expect(withSignals - without).toBeCloseTo(0.04, 2);
    });

    it('applies keyword boost', () => {
      const signals: LearnedSignals = {
        source_boosts: {},
        keyword_boosts: { 'offshore wind': 0.03 },
        rag_adjustments: {},
      };
      const item = makeItem({
        title: 'Offshore wind developments',
        entity_ids: [],
        body: '',
      });
      const client = makeClient({ allKeywords: ['offshore wind'] });

      const withSignals = computeFeedRelevance(item, client, signals);
      const without = computeFeedRelevance(item, client);
      expect(withSignals).toBeGreaterThan(without);
    });

    it('caps source boost at 0.05', () => {
      const signals: LearnedSignals = {
        source_boosts: { 'GOV.UK': 0.10 },
        keyword_boosts: {},
        rag_adjustments: {},
      };
      const item = makeItem({ entity_ids: [], title: 'xyz', body: '' });
      const client = makeClient({ allKeywords: [] });

      const withSignals = computeFeedRelevance(item, client, signals);
      const without = computeFeedRelevance(item, client);
      expect(withSignals - without).toBeCloseTo(0.05, 2); // capped
    });
  });

  describe('source floors', () => {
    it('floors at 0.60 when client name is mentioned', () => {
      const item = makeItem({
        title: 'Acme Energy announces new project',
        entity_ids: [],
        body: '',
        source_type: 'web_search',
        published_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(), // old
      });
      const client = makeClient();
      const score = computeFeedRelevance(item, client);
      expect(score).toBeGreaterThanOrEqual(0.60);
    });

    it('floors at 0.60 when project name is mentioned', () => {
      const item = makeItem({
        title: 'Sofia project receives planning approval',
        entity_ids: [],
        body: '',
        source_type: 'web_search',
        published_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      });
      const client = makeClient();
      const score = computeFeedRelevance(item, client);
      expect(score).toBeGreaterThanOrEqual(0.60);
    });

    it('floors at 0.30 for primary stakeholder entity', () => {
      const item = makeItem({
        entity_ids: ['desnz'],
        title: 'Generic unrelated title xyz',
        body: '',
        source_type: 'web_search',
        published_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      });
      const client = makeClient();
      const score = computeFeedRelevance(item, client);
      expect(score).toBeGreaterThanOrEqual(0.30);
    });

    it('floors at 0.20 for secondary stakeholder entity', () => {
      const item = makeItem({
        entity_ids: ['ofgem'],
        title: 'Generic unrelated title xyz',
        body: '',
        source_type: 'web_search',
        published_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      });
      const client = makeClient();
      const score = computeFeedRelevance(item, client);
      expect(score).toBeGreaterThanOrEqual(0.20);
    });

    it('does not apply secondary floor when primary is also present', () => {
      const item = makeItem({
        entity_ids: ['desnz', 'ofgem'],
        title: 'Generic unrelated title xyz',
        body: '',
        source_type: 'web_search',
        published_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      });
      const client = makeClient();
      const score = computeFeedRelevance(item, client);
      // primary floor (0.30) applies, not secondary (0.20)
      expect(score).toBeGreaterThanOrEqual(0.30);
    });
  });

  describe('score bounds', () => {
    it('never exceeds 1.0', () => {
      const item = makeItem({
        title: 'Acme Energy offshore wind CfD energy renewables consultation call for evidence',
        body: 'offshore wind CfD energy renewables',
        entity_ids: ['desnz', 'ofgem', 'defra'],
      });
      const client = makeClient();
      const signals: LearnedSignals = {
        source_boosts: { 'GOV.UK': 0.10 },
        keyword_boosts: { 'offshore wind': 0.10, 'CfD': 0.10, 'energy': 0.10, 'renewables': 0.10 },
        rag_adjustments: {},
      };
      const score = computeFeedRelevance(item, client, signals);
      expect(score).toBeLessThanOrEqual(1.0);
    });

    it('returns positive score even for completely unrelated items', () => {
      const item = makeItem({
        title: 'Completely unrelated gardening article',
        body: 'Roses and tulips',
        entity_ids: [],
        source_type: 'web_search',
        published_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      });
      const client = makeClient({ allKeywords: [] });
      const score = computeFeedRelevance(item, client);
      // source (0.05) + recency (0.01) = 0.06
      expect(score).toBeGreaterThan(0);
    });
  });
});
