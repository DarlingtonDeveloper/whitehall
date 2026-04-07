import { tool } from 'ai';
import { z } from 'zod';
import { searchEntities, getEntity } from '@/data/entities';
import { getClientBySlug, ALL_CLIENTS } from '@/data/clients';
import { getPowers } from '@/data/powers';
import { getRelationships } from '@/data/relationships';
import { supabase } from '@/lib/db';
import { computeFeedRelevance } from '@/lib/feed/scoring';
import { sanitiseFeedContent } from '@/lib/security/sanitise';
import type { FeedItem } from '@/types/feed';

// ---------------------------------------------------------------------------
// Tool definitions using the Vercel AI SDK `tool()` helper.
// Each tool declares a Zod schema for input and an `execute` function.
// The AI SDK handles tool invocation, result passing, and multi-step loops
// automatically — no manual agentic loop needed.
// ---------------------------------------------------------------------------

export const chatTools = {
  entity_lookup: tool({
    description:
      'Search for UK government entities by name, ID, or current holder. Returns matching entities with their category, description, current holder, and parent relationships.',
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          'Search query — entity name, ID, or person name. Case-insensitive.',
        ),
    }),
    execute: async ({ query }): Promise<Record<string, unknown>> => {
      return handleEntityLookup(query);
    },
  }),

  feed_search: tool({
    description:
      'Search recent feed items (parliamentary activity, consultations, press releases, research briefings, petitions). Searches title, body text, and entity tags. Use specific keywords rather than broad queries. You can also pass entity IDs directly to get all recent items for specific government bodies.',
    inputSchema: z.object({
      query: z
        .string()
        .describe('Search query — keywords, entity names, or topics.'),
      entityIds: z
        .array(z.string())
        .optional()
        .describe(
          'Optional entity IDs to search by (e.g. ["desnz", "ofgem"]). Returns items tagged to these entities.',
        ),
      limit: z
        .number()
        .optional()
        .describe('Maximum results. Default 10.'),
      daysBack: z
        .number()
        .optional()
        .describe('How many days back to search. Default 7.'),
    }),
    execute: async ({ query, entityIds, limit, daysBack }): Promise<Record<string, unknown>> => {
      return handleFeedSearch(query, entityIds, limit, daysBack);
    },
  }),

  stakeholder_map: tool({
    description:
      "Get the full stakeholder map for a client, showing tracked government entities by priority level.",
    inputSchema: z.object({
      clientId: z
        .string()
        .optional()
        .describe('Client slug/ID (e.g. "rwe", "sanofi").'),
    }),
    execute: async ({ clientId }): Promise<Record<string, unknown>> => {
      return handleStakeholderMap(clientId);
    },
  }),

  feed_top_items: tool({
    description:
      'Get the highest-relevance feed items for a client over a time period. Returns items pre-scored and ranked by the algorithmic relevance system (entity overlap, keyword matches, source quality, recency, actionable content signals). Use this for briefings, weekly summaries, or "what should we focus on" questions.',
    inputSchema: z.object({
      clientId: z
        .string()
        .describe('Client slug (e.g. "rwe", "sanofi").'),
      daysBack: z
        .number()
        .optional()
        .describe('Days to look back. Default 7.'),
      limit: z
        .number()
        .optional()
        .describe('Max items to return. Default 15.'),
      sourceType: z
        .string()
        .optional()
        .describe('Optional: filter to a source type (govuk, hansard, committee, legislation, trade_press, stakeholder, petition, research).'),
      minScore: z
        .number()
        .optional()
        .describe('Minimum relevance score 0-1. Default 0.20.'),
    }),
    execute: async ({ clientId, daysBack, limit, sourceType, minScore }): Promise<Record<string, unknown>> => {
      return handleFeedTopItems(clientId, daysBack, limit, sourceType, minScore);
    },
  }),

  feed_deadlines: tool({
    description:
      'Find upcoming consultations, calls for evidence, and deadlines relevant to a client. Returns items with future event dates or deadline-related keywords, sorted by closest deadline first.',
    inputSchema: z.object({
      clientId: z
        .string()
        .describe('Client slug (e.g. "rwe", "sanofi").'),
      daysAhead: z
        .number()
        .optional()
        .describe('Days ahead to search. Default 30.'),
    }),
    execute: async ({ clientId, daysAhead }): Promise<Record<string, unknown>> => {
      return handleFeedDeadlines(clientId, daysAhead);
    },
  }),

  graph_action: tool({
    description:
      'Manipulate the interactive graph visualisation. Actions: select_entity, search, reset, focus_mode.',
    inputSchema: z.object({
      action: z
        .enum(['select_entity', 'search', 'reset', 'focus_mode'])
        .describe('The graph action to perform.'),
      entityId: z.string().optional().describe('Entity ID for select_entity.'),
      query: z.string().optional().describe('Search query for search action.'),
      enabled: z.boolean().optional().describe('Enable/disable focus mode.'),
    }),
    execute: async ({ action, entityId, query, enabled }): Promise<Record<string, unknown>> => {
      return handleGraphAction(action, entityId, query, enabled);
    },
  }),
};

// ---------------------------------------------------------------------------
// Tool handler implementations
// ---------------------------------------------------------------------------

function handleEntityLookup(query: string): Record<string, unknown> {
  const exact = getEntity(query);
  if (exact) {
    const powers = getPowers(query);
    const rels = getRelationships(query);
    return {
      match: 'exact',
      entity: {
        id: exact.id,
        name: exact.name,
        category: exact.category,
        subtype: exact.subtype,
        description: exact.description,
        currentHolder: exact.currentHolder ?? null,
        role: exact.role ?? null,
        tags: exact.tags ?? [],
        parents: rels.parents.map((p) => ({ id: p.id, name: p.name })),
        children: rels.children.slice(0, 15).map((c) => ({
          id: c.id,
          name: c.name,
          category: c.category,
        })),
        powerCount: powers?.powers.length ?? 0,
        topPowers: (powers?.powers ?? []).slice(0, 5).map((p) => ({
          title: p.title,
          type: p.powerType,
          description: p.description,
        })),
      },
    };
  }

  const results = searchEntities(query).slice(0, 10);
  if (results.length === 0) {
    return {
      match: 'none',
      message: `No entities found matching "${query}".`,
      suggestion: 'Common searches: "Treasury", "Home Office", "Ofgem", "Secretary of State"',
    };
  }

  return {
    match: 'search',
    count: results.length,
    results: results.map((e) => ({
      id: e.id,
      name: e.name,
      category: e.category,
      subtype: e.subtype,
      currentHolder: e.currentHolder ?? null,
      description: e.description.slice(0, 200),
    })),
  };
}

async function handleFeedSearch(
  query: string,
  entityIds?: string[],
  limit?: number,
  daysBack?: number,
): Promise<Record<string, unknown>> {
  const maxLimit = Math.min(limit ?? 10, 20);
  const cutoff = new Date(
    Date.now() - (daysBack ?? 7) * 24 * 60 * 60 * 1000,
  ).toISOString();

  try {
    const allItems: Array<Record<string, unknown>> = [];
    const seenIds = new Set<string>();

    // Path 1: search by entity IDs (most reliable for client briefings)
    if (entityIds && entityIds.length > 0) {
      const { data } = await supabase
        .from('feed_items')
        .select('id, title, url, source_type, source_name, published_at, entity_ids, body, rag_status')
        .overlaps('entity_ids', entityIds)
        .gte('published_at', cutoff)
        .order('published_at', { ascending: false })
        .limit(maxLimit);

      for (const item of data ?? []) {
        if (!seenIds.has(item.id)) {
          seenIds.add(item.id);
          allItems.push(item);
        }
      }
    }

    // Path 2: keyword search on title and body
    if (allItems.length < maxLimit) {
      const escaped = query.replace(/[%_]/g, '\\$&');
      const remaining = maxLimit - allItems.length;
      const { data, error } = await supabase
        .from('feed_items')
        .select('id, title, url, source_type, source_name, published_at, entity_ids, body, rag_status')
        .or(`title.ilike.%${escaped}%,body.ilike.%${escaped}%,source_name.ilike.%${escaped}%`)
        .gte('published_at', cutoff)
        .order('published_at', { ascending: false })
        .limit(remaining);

      if (error) {
        console.error('[feed_search] query error:', error.message);
      }

      for (const item of data ?? []) {
        if (!seenIds.has(item.id)) {
          seenIds.add(item.id);
          allItems.push(item);
        }
      }
    }

    // Path 3: if keyword search found nothing, try entity name matching
    if (allItems.length === 0) {
      const entities = searchEntities(query).slice(0, 5);
      if (entities.length > 0) {
        const matchedIds = entities.map((e) => e.id);
        const { data } = await supabase
          .from('feed_items')
          .select('id, title, url, source_type, source_name, published_at, entity_ids, body, rag_status')
          .overlaps('entity_ids', matchedIds)
          .gte('published_at', cutoff)
          .order('published_at', { ascending: false })
          .limit(maxLimit);

        for (const item of data ?? []) {
          if (!seenIds.has(item.id)) {
            seenIds.add(item.id);
            allItems.push(item);
          }
        }

        if (allItems.length > 0) {
          return {
            query,
            matchedVia: 'entity_ids',
            matchedEntities: entities.map((e) => e.name),
            results: formatResults(allItems),
          };
        }
      }

      return { query, results: [], message: 'No feed items found for this query or time period.' };
    }

    return {
      query,
      resultCount: allItems.length,
      results: formatResults(allItems),
    };
  } catch (err) {
    console.error('[feed_search] error:', err);
    return { error: err instanceof Error ? err.message : 'Feed search failed', query };
  }
}

function formatResults(
  items: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return items.map((item) => ({
    title: sanitiseFeedContent(String(item.title ?? '')),
    url: item.url,
    source: item.source_name,
    type: item.source_type,
    date: item.published_at,
    entities: item.entity_ids,
    rag_status: item.rag_status,
    body_preview: typeof item.body === 'string'
      ? sanitiseFeedContent(item.body.slice(0, 200))
      : null,
  }));
}

function handleGraphAction(
  action: string,
  entityId?: string,
  query?: string,
  enabled?: boolean,
): Record<string, unknown> {
  switch (action) {
    case 'select_entity': {
      const id = entityId ?? '';
      const entity = getEntity(id);
      if (!entity) {
        const matches = searchEntities(id);
        if (matches.length > 0) {
          return { success: true, resolved: true, entityId: matches[0].id, message: `Selected ${matches[0].name} on the graph.` };
        }
        return { error: `Entity "${id}" not found.` };
      }
      return { success: true, entityId: entity.id, message: `Selected ${entity.name} on the graph.` };
    }
    case 'search':
      return { success: true, message: `Filtering graph for: "${query}"` };
    case 'reset':
      return { success: true, message: 'Graph filters cleared.' };
    case 'focus_mode':
      return { success: true, message: `Focus mode ${enabled ? 'enabled' : 'disabled'}.` };
    default:
      return { error: `Unknown graph action: ${action}` };
  }
}

async function handleFeedTopItems(
  clientId: string,
  daysBack?: number,
  limit?: number,
  sourceType?: string,
  minScore?: number,
): Promise<Record<string, unknown>> {
  const client = getClientBySlug(clientId);
  if (!client) {
    return { error: `Client "${clientId}" not found.`, availableClients: ALL_CLIENTS.map((c) => c.id) };
  }

  const days = daysBack ?? 7;
  const maxItems = Math.min(limit ?? 15, 30);
  const threshold = minScore ?? 0.20;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const stakeholderIds = client.stakeholders.map((s) => s.entityId);

  try {
    // Fetch items per source type to avoid stakeholder homepage content
    // flooding out legislation, hansard, GOV.UK items from the window.
    const HIGH_VALUE_TYPES = ['govuk', 'hansard', 'committee', 'legislation', 'trade_press', 'research', 'petition', 'forward_scan'];

    const seen = new Set<string>();
    const allFetched: FeedItem[] = [];

    if (sourceType) {
      // Single source type filter
      const { data, error: err } = await supabase
        .from('feed_items')
        .select('*')
        .overlaps('entity_ids', stakeholderIds)
        .eq('source_type', sourceType)
        .gte('published_at', cutoff)
        .order('published_at', { ascending: false })
        .limit(200);
      if (err) {
        console.error('[feed_top_items] query error:', err.message);
        return { error: err.message };
      }
      for (const item of (data ?? []) as FeedItem[]) {
        if (!seen.has(item.id)) { seen.add(item.id); allFetched.push(item); }
      }
    } else {
      // Fetch high-value source types (govuk, hansard, legislation, etc.)
      const { data: hvItems } = await supabase
        .from('feed_items')
        .select('*')
        .overlaps('entity_ids', stakeholderIds)
        .in('source_type', HIGH_VALUE_TYPES)
        .gte('published_at', cutoff)
        .order('published_at', { ascending: false })
        .limit(300);

      for (const item of (hvItems ?? []) as FeedItem[]) {
        if (!seen.has(item.id)) { seen.add(item.id); allFetched.push(item); }
      }

      // Fetch stakeholder/web_search items separately (lower limit)
      const { data: stItems } = await supabase
        .from('feed_items')
        .select('*')
        .overlaps('entity_ids', stakeholderIds)
        .in('source_type', ['stakeholder', 'web_search'])
        .gte('published_at', cutoff)
        .order('published_at', { ascending: false })
        .limit(100);

      for (const item of (stItems ?? []) as FeedItem[]) {
        if (!seen.has(item.id)) { seen.add(item.id); allFetched.push(item); }
      }
    }

    const items = allFetched;
    if (items.length === 0) {
      return { clientId, days, results: [], message: 'No items found for this period.' };
    }

    // Build word-boundary regexes for client name and project terms
    const clientNameLower = client.name.toLowerCase();
    const clientNameRe = new RegExp(`\\b${clientNameLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    const projectCoreTerms = (client.projects ?? [])
      .map((p) => p.replace(/\s*(offshore|onshore|wind\s*farm|wind|renewables|energy|power|plant|project|farm|uk)\s*/gi, ' ').trim().toLowerCase())
      .filter((t) => t.length >= 4);
    const projectRegexes = projectCoreTerms.map(
      (t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'),
    );

    // Score each item with the algorithmic scorer
    const scored = (items as FeedItem[])
      .map((item) => {
        const score = computeFeedRelevance(item, client);
        const titleLower = item.title.toLowerCase();
        const mentionsClient = clientNameRe.test(titleLower);
        const mentionsProject = projectRegexes.some((re) => re.test(titleLower));
        return { item, score, mentionsClient, mentionsProject };
      })
      .filter((s) => s.score >= threshold);

    // Sort: items mentioning client/projects first, then by score
    scored.sort((a, b) => {
      const aBoost = (a.mentionsClient || a.mentionsProject) ? 1 : 0;
      const bBoost = (b.mentionsClient || b.mentionsProject) ? 1 : 0;
      if (aBoost !== bBoost) return bBoost - aBoost;
      return b.score - a.score;
    });

    const topItems = scored.slice(0, maxItems);

    const results = topItems.map(({ item, score, mentionsClient, mentionsProject }, i) => {
      const date = new Date(item.published_at).toLocaleDateString('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric',
      });
      const textLower = `${item.title} ${item.body || ''}`.toLowerCase();
      const isConsultation =
        textLower.includes('consultation') ||
        textLower.includes('call for evidence');
      const isDeadline =
        textLower.includes('deadline') ||
        textLower.includes('application') ||
        textLower.includes('selection process') ||
        textLower.includes('respond by') ||
        textLower.includes('closes');

      return {
        rank: i + 1,
        relevance_score: Math.round(score * 100),
        title: sanitiseFeedContent(item.title),
        url: item.url ?? null,
        source_name: item.source_name,
        source_type: item.source_type,
        date,
        published_at: item.published_at,
        entity_ids: item.entity_ids,
        mentions_client: mentionsClient,
        mentions_project: mentionsProject,
        is_consultation: isConsultation,
        has_deadline_language: isDeadline,
        event_date: item.event_date ?? null,
        body_preview: item.body ? sanitiseFeedContent(item.body.substring(0, 300)) : null,
      };
    });

    return {
      clientId,
      clientName: client.name,
      days,
      totalScored: items.length,
      returnedCount: results.length,
      minScoreUsed: threshold,
      projectItemsFound: scored.filter((s) => s.mentionsProject).length,
      results,
    };
  } catch (err) {
    console.error('[feed_top_items] error:', err);
    return { error: err instanceof Error ? err.message : 'Failed to fetch top items' };
  }
}

async function handleFeedDeadlines(
  clientId: string,
  daysAhead?: number,
): Promise<Record<string, unknown>> {
  const client = getClientBySlug(clientId);
  if (!client) {
    return { error: `Client "${clientId}" not found.` };
  }

  const ahead = daysAhead ?? 30;
  const stakeholderIds = client.stakeholders.map((s) => s.entityId);
  const now = new Date().toISOString();
  const futureLimit = new Date(Date.now() + ahead * 24 * 60 * 60 * 1000).toISOString();

  try {
    const seen = new Set<string>();
    const allItems: Array<Record<string, unknown>> = [];

    // 1. Items with future event_date (note: event_date may be sparsely populated)
    const { data: forwardItems } = await supabase
      .from('feed_items')
      .select('*')
      .overlaps('entity_ids', stakeholderIds)
      .gte('event_date', now)
      .lte('event_date', futureLimit)
      .order('event_date', { ascending: true })
      .limit(50);

    for (const item of (forwardItems ?? []) as FeedItem[]) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        allItems.push(formatDeadlineItem(item, client));
      }
    }

    // 2. Search title AND body for deadline-related keywords.
    // Only search high-value source types — stakeholder/web_search body text
    // is too noisy (job pages, about pages match "application"/"apply").
    const HIGH_VALUE_SOURCES = ['govuk', 'hansard', 'committee', 'legislation', 'trade_press', 'research', 'petition', 'forward_scan'];
    const deadlineKeywords = [
      'consultation', 'call for evidence', 'deadline', 'respond by', 'closes',
      'selection process', 'expression of interest', 'closing date',
    ];
    const titleConditions = deadlineKeywords.map((kw) => `title.ilike.%${kw}%`).join(',');
    const bodyConditions = deadlineKeywords.map((kw) => `body.ilike.%${kw}%`).join(',');

    // Use higher limit — committee scraping can produce many pages matching
    // "call for evidence", so we need to reach back to recent GOV.UK items.
    const { data: consultations } = await supabase
      .from('feed_items')
      .select('*')
      .overlaps('entity_ids', stakeholderIds)
      .in('source_type', HIGH_VALUE_SOURCES)
      .or(`${titleConditions},${bodyConditions}`)
      .gte('published_at', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString())
      .order('published_at', { ascending: false })
      .limit(200);

    for (const item of (consultations ?? []) as FeedItem[]) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        allItems.push(formatDeadlineItem(item, client));
      }
    }

    if (allItems.length === 0) {
      return {
        clientId,
        clientName: client.name,
        daysAhead: ahead,
        results: [],
        message: 'No upcoming deadlines or consultations found matching keyword search. Note: structured event_date field is not yet populated in the database, so this relies on keyword matching in titles and body text. Deadlines mentioned only in body paragraphs may be missed.',
      };
    }

    // Sort by relevance score descending, then take top 20
    allItems.sort((a, b) => (b.relevance_score as number) - (a.relevance_score as number));
    const topResults = allItems.slice(0, 20);

    return {
      clientId,
      clientName: client.name,
      daysAhead: ahead,
      resultCount: topResults.length,
      totalMatched: allItems.length,
      note: 'Deadlines are identified by keyword matching (consultation, call for evidence, deadline, selection process, etc.) in title and body text. The structured event_date field is not yet populated. Results sorted by relevance to client.',
      results: topResults,
    };
  } catch (err) {
    console.error('[feed_deadlines] error:', err);
    return { error: err instanceof Error ? err.message : 'Failed to fetch deadlines' };
  }
}

function formatDeadlineItem(item: FeedItem, client: Parameters<typeof computeFeedRelevance>[1]): Record<string, unknown> {
  const score = computeFeedRelevance(item, client);
  const daysUntil = item.event_date
    ? Math.ceil((new Date(item.event_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;

  return {
    title: sanitiseFeedContent(item.title),
    url: item.url ?? null,
    source_name: item.source_name,
    source_type: item.source_type,
    published_at: item.published_at,
    event_date: item.event_date ?? null,
    days_until: daysUntil,
    is_urgent: daysUntil !== null && daysUntil < 14,
    relevance_score: Math.round(score * 100),
    entity_ids: item.entity_ids,
    body_preview: item.body ? sanitiseFeedContent(item.body.substring(0, 300)) : null,
  };
}

function handleStakeholderMap(clientId?: string): Record<string, unknown> {
  if (!clientId) {
    return {
      availableClients: ALL_CLIENTS.map((c) => ({ id: c.id, name: c.name, sector: c.sector })),
      message: 'Provide a clientId to see their stakeholder map.',
    };
  }

  const client = getClientBySlug(clientId);
  if (!client) {
    return {
      error: `Client "${clientId}" not found.`,
      availableClients: ALL_CLIENTS.map((c) => ({ id: c.id, name: c.name })),
    };
  }

  const grouped: Record<string, unknown[]> = { primary: [], secondary: [], tertiary: [] };
  for (const s of client.stakeholders) {
    const entity = getEntity(s.entityId);
    (grouped[s.priority] ?? []).push({
      entityId: s.entityId,
      name: entity?.name ?? s.entityId,
      holder: entity?.currentHolder ?? null,
      role: s.role,
      notes: s.notes ?? null,
    });
  }

  return {
    client: { id: client.id, name: client.name, sector: client.sector },
    stakeholders: grouped,
    totalCount: client.stakeholders.length,
    monitoringThemes: client.monitoringThemes.map((t) => ({
      name: t.name,
      entityCount: t.entityIds.length,
      keywords: t.keywords,
    })),
  };
}
