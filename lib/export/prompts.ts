// ---------------------------------------------------------------------------
// Prompt templates for theme analysis and cross-theme synthesis.
// Direct port of the monitoring agent's analysis prompts.
// ---------------------------------------------------------------------------

import type { ClientConfig } from '@/types/client';
import type { FeedItem } from '@/types/feed';

// ---------------------------------------------------------------------------
// Theme-specific instructions — appended to the theme analysis prompt to
// elicit theme-specific output structures (routine_mentions, coverage_table,
// competitor table, social metrics). These match the monitoring agent's
// theme_analyser.py prompt fragments exactly.
// ---------------------------------------------------------------------------

export function getThemeInstructions(themeId: string): string {
  const instructions: Record<string, string> = {
    'political_parliamentary': `Also produce a "routine_mentions" array for lower-significance parliamentary references that don't warrant a full item card. Each: {date, type, detail, members, significance}.
Type should be one of: "WQ" (written question), "OQ" (oral question), "Debate", "EDM" (early day motion), "Cttee" (committee), "WS" (written statement).
Significance: "Low", "Medium", "High".`,

    'media_coverage': `Produce a "coverage_table" array: {date, outlet, angle (own words — NEVER the original headline), client_named (e.g. "Yes — positive" or "No — sector story"), action ("Monitor" | "Amplify" | "Respond" | "Correct")}.
Include ALL media items in the coverage_table.
Elevate only the most significant stories (2-3 max) to full item cards in the "items" array.`,

    'competitor_industry': `Produce a "table" array: {organisation, development, relevance, action}.
Include ALL competitor/industry items in the table.
Elevate only the most significant developments (1-2 max) to full item cards in the "items" array.`,

    'social_media': `Produce:
- "summary": 1 paragraph overview
- "metrics": {total_mentions, sentiment_breakdown, top_engagement_post, trend_vs_previous}
- "notable_posts": array of AnalysedItem for any significant social media posts
Note: quantitative metrics are approximate without Meltwater API access — flag this in the summary.`,

    'stakeholder_third_party': `If nothing notable from stakeholders or third parties, set "no_developments": true.`,
  };

  return instructions[themeId] || '';
}

// ---------------------------------------------------------------------------
// Theme analysis prompt — sent once per monitoring theme with its grouped
// feed items. Claude produces AnalysedItem objects plus theme-specific
// structures. This is a direct port of the monitoring agent's theme_analyser.
// ---------------------------------------------------------------------------

export function buildThemePrompt(
  themeId: string,
  themeName: string,
  items: FeedItem[],
  client: ClientConfig,
  sectionNumber: number,
): string {
  const itemsText = items
    .map((item, i) => {
      return `[${i + 1}] ${item.title}
Date: ${item.published_at}
Source: ${item.source_name} (${item.source_type})
URL: ${item.url ?? 'N/A'}
Body: ${item.body?.substring(0, 500) || 'N/A'}
Entity tags: ${item.entity_ids?.join(', ') || 'none'}
Fingerprint: ${item.fingerprint}`;
    })
    .join('\n\n');

  const themeSpecificInstructions = getThemeInstructions(themeId);

  return `You are a senior public affairs analyst at WA Communications, a UK public affairs consultancy.

CLIENT: ${client.name}
SECTOR: ${client.sector}
THEME: ${themeName} (section ${sectionNumber})

CLIENT CONTEXT:
${client.description}

KEY STAKEHOLDERS:
${client.stakeholders
  .filter((s) => s.priority !== 'tertiary')
  .map((s) => `- ${s.entityId}: ${s.role}`)
  .join('\n')}

COLLECTED ITEMS FOR THIS THEME:
${itemsText}

INSTRUCTIONS:
Analyse these items and produce structured intelligence for a weekly monitoring report.

For each significant development, produce an AnalysedItem with:
- ref: sequential reference (e.g. "${sectionNumber}.1", "${sectionNumber}.2")
- headline: concise title
- date: DD/MM/YYYY
- source: where this came from (e.g. "GOV.UK press release, DESNZ" or "Hansard, House of Lords")
- summary: 2-4 sentences. What happened. Plain English, precise about dates, names, amounts.
- client_relevance: 2-3 sentences. Why this matters to ${client.name} SPECIFICALLY — reference specific projects, commercial positions, or pipeline impacts. Do not write generic analysis that could apply to any company in the sector.
- recommended_action: specific action (e.g. "Brief client", "Prepare consultation response", "Monitor", "Amplify via media")
- escalation: "IMMEDIATE" | "HIGH" | "STANDARD"
- rag: "RED" | "AMBER" | "GREEN"
- confidence: float 0-1. How confident are you that your summary accurately represents the source material? Lower this if the source snippet is ambiguous, if you're inferring rather than reporting, or if the claim would need verification.
- source_items: array of fingerprint strings from the items that support this analysis

${themeSpecificInstructions}

ESCALATION TIERS:
- IMMEDIATE: Direct mention of client in Parliament, government announcements directly affecting client projects, national media naming client, coordinated activism.
- HIGH: New consultations/decisions affecting client's sector. Competitor announcements with strategic implications. Industry body statements.
- STANDARD: General sector commentary, think tanks, academic, routine media.

RAG RATINGS:
- RED: Requires client action or poses direct risk
- AMBER: Important, may require action soon
- GREEN: Positive development or opportunity

RULES:
- Summarise, never reproduce source text. Always own words with attribution.
- Do not editorialise or offer political opinion. Facts and analysis only.
- Every item must answer: What happened? Why does it matter to THIS client? What should we do?
- If nothing significant occurred in this theme, return an empty items array.

Return ONLY a JSON object: {"items": [...], "no_developments": true/false}`;
}

// ---------------------------------------------------------------------------
// Synthesis prompt — receives all theme analysis results and produces the
// cross-cutting sections: executive summary, forward look, emerging themes,
// actions tracker, coverage summary. Direct port of synthesiser.py.
// ---------------------------------------------------------------------------

export function buildSynthesisPrompt(
  themeResults: Record<string, unknown>,
  forwardItems: FeedItem[],
  client: ClientConfig,
  reportingPeriod: string,
): string {
  const forwardText =
    forwardItems
      .map(
        (item) =>
          `- ${item.title} (${item.published_at}) [${item.source_name}]`,
      )
      .join('\n') || 'No forward-looking items collected.';

  return `You are a senior public affairs analyst at WA Communications.

CLIENT: ${client.name}
REPORTING PERIOD: ${reportingPeriod}

THEME ANALYSIS RESULTS:
${JSON.stringify(themeResults, null, 2)}

FORWARD-LOOKING ITEMS:
${forwardText}

Produce:

1. EXECUTIVE SUMMARY
   - top_line: 3-5 sentences. The single most important development first. If you had 30 seconds in a lift with the client, what would you say?
   - key_developments: the 4-6 most significant items across ALL themes. Each needs: rag ("RED"|"AMBER"|"GREEN"), development (string), relevance (string), recommended_action (string), section_ref (reference to the theme item e.g. "2.1"), confidence (float 0-1).

2. FORWARD LOOK
   Array of upcoming events/milestones in the next 2-4 weeks. Each: date, event, relevance, preparation. Include consultation deadlines, committee sessions, planned announcements, competitor milestones, political calendar dates.

3. EMERGING THEMES
   2-4 paragraphs. Step back from individual items. Are there broader patterns? Is the political mood shifting? Is a previously quiet stakeholder becoming vocal? Is a policy window opening or closing? Is media framing changing?

4. ACTIONS TRACKER
   Derive actions from the analysis. Each: ref ("001", "002"...), action, owner ("[Name]"), deadline, origin ("Report ${reportingPeriod}"), status ("Open").

5. COVERAGE SUMMARY
   Array of metrics. Each: metric, this_week, previous_week ("[Baseline TBC]"), trend.
   Required metrics:
   - Total media mentions (${client.name})
   - National media mentions
   - Trade/specialist mentions
   - Parliamentary mentions (${client.name} + key issues)
   - Competitor share of voice (top 3)

Return ONLY a JSON object with keys: executive_summary, forward_look, emerging_themes, actions_tracker, coverage_summary.`;
}
