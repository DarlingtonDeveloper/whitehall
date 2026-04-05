import { tool } from 'ai';
import { z } from 'zod';
import { searchEntities, getEntity } from '@/data/entities';
import { getClientBySlug, ALL_CLIENTS } from '@/data/clients';
import { getPowers } from '@/data/powers';
import { getRelationships } from '@/data/relationships';
import { supabase } from '@/lib/db';

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
      'Search recent feed items (parliamentary activity, consultations, press releases, appointments).',
    inputSchema: z.object({
      query: z
        .string()
        .describe('Search query — keywords, entity names, or topics.'),
      limit: z
        .number()
        .optional()
        .describe('Maximum results. Default 5.'),
    }),
    execute: async ({ query, limit }): Promise<Record<string, unknown>> => {
      return handleFeedSearch(query, limit);
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

async function handleFeedSearch(query: string, limit?: number): Promise<Record<string, unknown>> {
  const maxLimit = Math.min(limit ?? 10, 20);

  try {
    const escaped = query.replace(/[%_]/g, '\\$&');
    const { data, error } = await supabase
      .from('feed_items')
      .select('id, title, url, source_type, source_name, published_at, entity_ids')
      .or(`title.ilike.%${escaped}%,source_name.ilike.%${escaped}%`)
      .order('published_at', { ascending: false })
      .limit(maxLimit);

    if (error) return { error: error.message, query };

    if (!data || data.length === 0) {
      // Fallback: entity-based search
      const entities = searchEntities(query).slice(0, 5);
      if (entities.length > 0) {
        const entityIds = entities.map((e) => e.id);
        const { data: entityData } = await supabase
          .from('feed_items')
          .select('id, title, url, source_type, source_name, published_at, entity_ids')
          .overlaps('entity_ids', entityIds)
          .order('published_at', { ascending: false })
          .limit(maxLimit);

        if (entityData && entityData.length > 0) {
          return {
            query,
            matchedVia: 'entity_ids',
            results: entityData.map((item) => ({
              title: item.title,
              url: item.url,
              source: item.source_name,
              type: item.source_type,
              date: item.published_at,
              entities: item.entity_ids,
            })),
          };
        }
      }
      return { query, results: [], message: 'No feed items found.' };
    }

    return {
      query,
      results: data.map((item) => ({
        title: item.title,
        url: item.url,
        source: item.source_name,
        type: item.source_type,
        date: item.published_at,
        entities: item.entity_ids,
      })),
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Feed search failed', query };
  }
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
