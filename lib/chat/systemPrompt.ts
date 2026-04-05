import { getEntity } from '@/data/entities';
import { getClientBySlug } from '@/data/clients';
import { getPowers } from '@/data/powers';
import { getRelationships } from '@/data/relationships';

export function buildSystemPrompt(opts: {
  clientId?: string;
  entityId?: string;
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
- When discussing stakeholders, note their priority level (primary, secondary, tertiary) and relevance.`);

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

  return sections.join('\n');
}
