import type { Tool } from '@anthropic-ai/sdk/resources/messages/messages';
import { searchEntities, getEntity, ENTITY_LIST } from '@/data/entities';
import { getClientBySlug, ALL_CLIENTS } from '@/data/clients';
import { getPowers } from '@/data/powers';
import { getRelationships } from '@/data/relationships';

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
    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
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
  const query = String(input.query ?? '');
  const limit = Number(input.limit ?? 5);

  // Mock feed data — in production this would query a database
  const mockItems = [
    {
      title: `Parliamentary question on ${query}`,
      source: 'House of Commons',
      date: '2026-04-03',
      summary: `Written question tabled regarding ${query} policy and implementation timelines.`,
      type: 'parliamentary',
    },
    {
      title: `Consultation: ${query} regulatory framework review`,
      source: 'GOV.UK',
      date: '2026-04-01',
      summary: `Open consultation on proposed changes to the ${query} regulatory framework. Closing date: 2026-05-15.`,
      type: 'consultation',
    },
    {
      title: `Select committee evidence session on ${query}`,
      source: 'Parliament',
      date: '2026-03-28',
      summary: `The relevant select committee took oral evidence on ${query} from industry stakeholders and departmental officials.`,
      type: 'committee',
    },
  ];

  return JSON.stringify({
    note: 'Feed search returns mock data — live feed integration is pending.',
    query,
    results: mockItems.slice(0, limit),
  });
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
