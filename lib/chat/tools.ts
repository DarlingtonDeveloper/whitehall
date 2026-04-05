import type { Tool } from '@anthropic-ai/sdk/resources/messages/messages';
import { searchEntities, getEntity, ENTITY_LIST } from '@/data/entities';
import { getClientBySlug, ALL_CLIENTS } from '@/data/clients';
import { getPowers } from '@/data/powers';
import { getRelationships } from '@/data/relationships';
import { supabase } from '@/lib/db';

// ---------------------------------------------------------------------------
// Tool definitions (sent to the Anthropic API)
// ---------------------------------------------------------------------------

export const toolDefinitions: Tool[] = [
  {
    name: 'entity_lookup',
    description:
      'Search for UK government entities by name, ID, or current holder. Returns matching entities with their category, description, current holder, and parent relationships. Use this when the user asks about a specific department, minister, regulator, or public body.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description:
            'Search query — can be an entity name (e.g. "DESNZ"), an entity ID (e.g. "desnz"), or a person name (e.g. "Ed Miliband"). Case-insensitive partial matching.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'feed_search',
    description:
      'Search recent feed items (parliamentary activity, consultations, press releases, appointments). Returns relevant items with title, source, date, and summary. Use this when the user asks about recent activity, news, or developments.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query for feed items — keywords, entity names, or topics.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return. Default 5.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'stakeholder_map',
    description:
      'Get the full stakeholder map for a client, showing all tracked government entities organised by priority level (primary, secondary, tertiary). Use this when the user asks about a client\'s key contacts, decision-makers, or stakeholder relationships.',
    input_schema: {
      type: 'object' as const,
      properties: {
        clientId: {
          type: 'string',
          description:
            'The client slug/ID (e.g. "rwe", "sanofi"). If not provided, lists available clients.',
        },
      },
      required: [],
    },
  },
  {
    name: 'graph_action',
    description:
      'Manipulate the interactive graph visualisation. Use this when the user asks to show, focus on, filter, or highlight entities on the graph. Actions: select_entity (opens entity panel and centres graph), search (filters graph nodes by text), reset (clears all filters), focus_mode (toggle focus mode which hides non-matching nodes).',
    input_schema: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string',
          enum: ['select_entity', 'search', 'reset', 'focus_mode'],
          description: 'The graph action to perform.',
        },
        entityId: {
          type: 'string',
          description: 'Entity ID for select_entity action (e.g. "desnz", "ofgem").',
        },
        query: {
          type: 'string',
          description: 'Search query for search action.',
        },
        enabled: {
          type: 'boolean',
          description: 'Whether to enable or disable focus mode.',
        },
      },
      required: ['action'],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool handlers (execute when Claude invokes a tool)
// ---------------------------------------------------------------------------

interface ToolInput {
  [key: string]: unknown;
}

export function handleToolCall(
  toolName: string,
  toolInput: ToolInput,
): string {
  switch (toolName) {
    case 'entity_lookup':
      return handleEntityLookup(toolInput);
    case 'feed_search':
      return handleFeedSearch(toolInput);
    case 'stakeholder_map':
      return handleStakeholderMap(toolInput);
    case 'graph_action':
      return handleGraphAction(toolInput);
    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
}

/** Async variant for tools that need database access */
export async function handleToolCallAsync(
  toolName: string,
  toolInput: ToolInput,
): Promise<string> {
  if (toolName === 'feed_search') {
    return handleFeedSearchAsync(toolInput);
  }
  return handleToolCall(toolName, toolInput);
}

function handleEntityLookup(input: ToolInput): string {
  const query = String(input.query ?? '');

  // Try exact ID match first
  const exact = getEntity(query);
  if (exact) {
    const powers = getPowers(query);
    const rels = getRelationships(query);
    return JSON.stringify({
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
    });
  }

  // Fuzzy search
  const results = searchEntities(query).slice(0, 10);
  if (results.length === 0) {
    return JSON.stringify({
      match: 'none',
      message: `No entities found matching "${query}". Try a different search term or use a known entity ID.`,
      suggestion: 'Common searches: "Treasury", "Home Office", "Ofgem", "Secretary of State"',
    });
  }

  return JSON.stringify({
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
  });
}

function handleFeedSearch(input: ToolInput): string {
  // Synchronous fallback — returns a note to use async version
  return JSON.stringify({ note: 'Querying feed database...', query: String(input.query ?? '') });
}

async function handleFeedSearchAsync(input: ToolInput): Promise<string> {
  const query = String(input.query ?? '');
  const limit = Math.min(Number(input.limit ?? 10), 20);

  try {
    const escaped = query.replace(/[%_]/g, '\\$&');
    const { data, error } = await supabase
      .from('feed_items')
      .select('id, title, url, source_type, source_name, published_at, entity_ids')
      .or(`title.ilike.%${escaped}%,source_name.ilike.%${escaped}%`)
      .order('published_at', { ascending: false })
      .limit(limit);

    if (error) {
      return JSON.stringify({ error: error.message, query });
    }

    if (!data || data.length === 0) {
      // Try entity-based search as fallback
      const entities = searchEntities(query).slice(0, 5);
      if (entities.length > 0) {
        const entityIds = entities.map((e) => e.id);
        const { data: entityData } = await supabase
          .from('feed_items')
          .select('id, title, url, source_type, source_name, published_at, entity_ids')
          .overlaps('entity_ids', entityIds)
          .order('published_at', { ascending: false })
          .limit(limit);

        if (entityData && entityData.length > 0) {
          return JSON.stringify({
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
          });
        }
      }

      return JSON.stringify({ query, results: [], message: 'No feed items found matching this query.' });
    }

    return JSON.stringify({
      query,
      results: data.map((item) => ({
        title: item.title,
        url: item.url,
        source: item.source_name,
        type: item.source_type,
        date: item.published_at,
        entities: item.entity_ids,
      })),
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : 'Feed search failed', query });
  }
}

function handleGraphAction(input: ToolInput): string {
  const action = String(input.action ?? '');
  switch (action) {
    case 'select_entity': {
      const entityId = String(input.entityId ?? '');
      const entity = getEntity(entityId);
      if (!entity) {
        // Try fuzzy match
        const matches = searchEntities(entityId);
        if (matches.length > 0) {
          return JSON.stringify({
            success: true,
            resolved: true,
            entityId: matches[0].id,
            message: `Selected ${matches[0].name} on the graph.`,
          });
        }
        return JSON.stringify({ error: `Entity "${entityId}" not found.` });
      }
      return JSON.stringify({ success: true, entityId: entity.id, message: `Selected ${entity.name} on the graph.` });
    }
    case 'search':
      return JSON.stringify({ success: true, message: `Filtering graph for: "${input.query}"` });
    case 'reset':
      return JSON.stringify({ success: true, message: 'Graph filters cleared.' });
    case 'focus_mode':
      return JSON.stringify({ success: true, message: `Focus mode ${input.enabled ? 'enabled' : 'disabled'}.` });
    default:
      return JSON.stringify({ error: `Unknown graph action: ${action}` });
  }
}

function handleStakeholderMap(input: ToolInput): string {
  const clientId = input.clientId as string | undefined;

  if (!clientId) {
    return JSON.stringify({
      availableClients: ALL_CLIENTS.map((c) => ({
        id: c.id,
        name: c.name,
        sector: c.sector,
      })),
      message: 'Provide a clientId to see their stakeholder map.',
    });
  }

  const client = getClientBySlug(clientId);
  if (!client) {
    return JSON.stringify({
      error: `Client "${clientId}" not found.`,
      availableClients: ALL_CLIENTS.map((c) => ({ id: c.id, name: c.name })),
    });
  }

  const grouped: Record<string, Array<{
    entityId: string;
    name: string;
    holder: string | null;
    role: string;
    notes: string | null;
  }>> = { primary: [], secondary: [], tertiary: [] };

  for (const s of client.stakeholders) {
    const entity = getEntity(s.entityId);
    const entry = {
      entityId: s.entityId,
      name: entity?.name ?? s.entityId,
      holder: entity?.currentHolder ?? null,
      role: s.role,
      notes: s.notes ?? null,
    };
    (grouped[s.priority] ?? []).push(entry);
  }

  return JSON.stringify({
    client: { id: client.id, name: client.name, sector: client.sector },
    stakeholders: grouped,
    totalCount: client.stakeholders.length,
    monitoringThemes: client.monitoringThemes.map((t) => ({
      name: t.name,
      entityCount: t.entityIds.length,
      keywords: t.keywords,
    })),
  });
}
