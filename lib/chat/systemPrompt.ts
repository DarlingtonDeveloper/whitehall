import { getEntity } from '@/data/entities';
import { getClientBySlug } from '@/data/clients';
import { getPowers } from '@/data/powers';
import { getRelationships } from '@/data/relationships';

/* ------------------------------------------------------------------ */
/*  View state passed from the client                                  */
/* ------------------------------------------------------------------ */

export interface ChatViewState {
  feedDateRange: string;
  feedSortMode: string;
  feedSearchText: string | null;
  feedActiveFilter: {
    label: string;
    sourceType?: string;
    titleContains?: string;
  } | null;
  disabledSourceIds: string[];
  selectedEntityId: string | null;
  topVisibleItems: Array<{ title: string; source_type: string }>;
  lastClickedItem: {
    title: string;
    source_type: string;
    published_at: string;
  } | null;
  topPulseEntities: Array<{
    entityId: string;
    score: number;
    level: string;
  }>;
}

/* ------------------------------------------------------------------ */
/*  Prompt builder                                                     */
/* ------------------------------------------------------------------ */

export function buildSystemPrompt(opts: {
  clientId?: string;
  entityId?: string;
  viewState?: ChatViewState;
}): string {
  const sections: string[] = [];

  // Base prompt
  sections.push(`You are the intelligence assistant for Whitehall, a political intelligence platform built for WA Communications, a UK public affairs consultancy.

Your role is to help analysts understand the UK government landscape: departments, ministers, regulators, public bodies, their powers, relationships, and relevance to clients.

You have access to a structured dataset of UK government entities including:
- Ministerial departments and their secretary of state
- Ministers and their portfolios
- Non-departmental public bodies (NDPBs), executive agencies, and regulators
- Parliamentary select committees
- Cross-government groups and units

Guidelines:
- Be precise and cite specific entities, roles, and powers where relevant.
- When referring to government entities, use their full official name.
- If you are unsure about something, say so rather than guessing.
- Present information in a structured, scannable format — use bullet points and bold for key terms.
- Keep answers concise but thorough. Analysts are experienced and prefer density over fluff.
- When discussing powers, cite the source legislation where available.
- When discussing stakeholders, note their priority level (primary, secondary, tertiary) and relevance.
- When mentioning feed items or sources, always include clickable links using markdown format: [title](url).
- You can manipulate the interactive graph using the graph_action tool. Use it when the user asks to "show me", "focus on", "find on the graph", "filter to", or "highlight" entities. For example, if the user says "show me DESNZ on the graph", call graph_action with action=select_entity. If they say "filter the graph to regulators", use action=search with query="regulator".`);

  // Client context
  if (opts.clientId) {
    const client = getClientBySlug(opts.clientId);
    if (client) {
      const stakeholderLines = client.stakeholders.map((s) => {
        const entity = getEntity(s.entityId);
        const name = entity ? entity.name : s.entityId;
        const holder = entity?.currentHolder ? ` (${entity.currentHolder})` : '';
        return `  - [${s.priority.toUpperCase()}] ${name}${holder} — ${s.role}`;
      });

      sections.push(`\n--- CLIENT CONTEXT ---
You are currently assisting with analysis for **${client.name}** (${client.sector} sector).
${client.description}

Key stakeholder map:
${stakeholderLines.join('\n')}

Policy keywords: ${client.policyKeywords.join(', ')}
Industry keywords: ${client.industryKeywords.join(', ')}
Competitors: ${client.competitors.join(', ')}
Projects: ${client.projects.join(', ')}

When answering questions, prioritise information relevant to ${client.name}'s interests and stakeholder relationships.`);
    }
  }

  // Entity context
  if (opts.entityId) {
    const entity = getEntity(opts.entityId);
    if (entity) {
      const powerRecord = getPowers(opts.entityId);
      const relationships = getRelationships(opts.entityId);

      let entitySection = `\n--- ENTITY CONTEXT ---
You are currently viewing the entity: **${entity.name}** (${entity.id})
Category: ${entity.category} | Subtype: ${entity.subtype}
${entity.description}`;

      if (entity.currentHolder) {
        entitySection += `\nCurrent holder: ${entity.currentHolder}`;
      }

      if (entity.role) {
        entitySection += `\nRole: ${entity.role}`;
      }

      if (relationships.parents.length > 0) {
        entitySection += `\nParent entities: ${relationships.parents.map((p) => p.name).join(', ')}`;
      }

      if (relationships.children.length > 0) {
        entitySection += `\nChild entities: ${relationships.children.map((c) => c.name).join(', ')}`;
      }

      if (powerRecord && powerRecord.powers.length > 0) {
        const powerLines = powerRecord.powers.slice(0, 10).map((p) => {
          const sourceInfo = p.sources
            .map((s) => `${s.title}${s.section ? ` ${s.section}` : ''}`)
            .join('; ');
          return `  - [${p.powerType.toUpperCase()}] ${p.title}: ${p.description} (Source: ${sourceInfo})`;
        });
        entitySection += `\n\nPowers and duties (${powerRecord.powers.length} total, showing first 10):\n${powerLines.join('\n')}`;
      }

      sections.push(entitySection);
    }
  }

  // View state — what the user is currently looking at
  if (opts.viewState) {
    const vs = opts.viewState;
    const lines: string[] = [];

    if (vs.feedDateRange !== 'all') {
      lines.push(`Feed showing: last ${vs.feedDateRange}`);
    }
    if (vs.feedSortMode === 'relevance') {
      lines.push('Feed sorted by: relevance (algorithmic scoring)');
    }
    if (vs.feedSearchText) {
      lines.push(`Feed search: "${vs.feedSearchText}"`);
    }
    if (vs.feedActiveFilter) {
      lines.push(`Feed filtered to: ${vs.feedActiveFilter.label}`);
    }
    if (vs.lastClickedItem) {
      const lc = vs.lastClickedItem;
      lines.push(
        `User last clicked: "${lc.title}" (${lc.source_type}, ${lc.published_at})`,
      );
    }
    if (vs.disabledSourceIds.length > 0) {
      lines.push(
        `User has disabled these stakeholders from feed: ${vs.disabledSourceIds.join(', ')}`,
      );
    }
    if (vs.topPulseEntities.length > 0) {
      lines.push('Most active entities this week:');
      for (const e of vs.topPulseEntities.slice(0, 5)) {
        lines.push(
          `  - ${e.entityId}: ${e.level} activity (score ${e.score.toFixed(1)})`,
        );
      }
    }
    if (vs.topVisibleItems.length > 0) {
      lines.push('Top items currently visible in feed:');
      for (const item of vs.topVisibleItems.slice(0, 5)) {
        lines.push(`  - "${item.title}" (${item.source_type})`);
      }
    }

    if (lines.length > 0) {
      sections.push(`\n--- CURRENT VIEW STATE ---\n${lines.join('\n')}`);
    }
  }

  return sections.join('\n');
}
