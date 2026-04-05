// ---------------------------------------------------------------------------
// LLM enrichment — runs theme analyses in parallel (Sonnet), then a single
// synthesis pass to produce cross-cutting sections. Direct port of the
// monitoring agent's analyse/ pipeline.
// ---------------------------------------------------------------------------

import Anthropic from '@anthropic-ai/sdk';
import type { ClientConfig } from '@/types/client';
import type { FeedItem } from '@/types/feed';
import type { AnalysisJSON } from './types';
import { buildThemePrompt, buildSynthesisPrompt } from './prompts';

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function formatReportingPeriod(from: Date): string {
  return `w/c ${from.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`;
}

/**
 * Strip markdown code fences that Claude sometimes wraps JSON in,
 * then parse. Falls back to a safe default on failure.
 */
function parseJsonResponse<T>(text: string, fallback: T): T {
  const cleaned = text.replace(/```json\s*|```\s*/g, '').trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    console.error('Failed to parse LLM JSON response:', cleaned.slice(0, 200));
    return fallback;
  }
}

export async function enrichItems(
  groupedItems: Record<string, FeedItem[]>,
  client: ClientConfig,
  dateRange: { from: Date; to: Date },
): Promise<AnalysisJSON> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const anthropic = new Anthropic({ apiKey });
  const reportingPeriod = formatReportingPeriod(dateRange.from);

  // Map theme IDs to section numbers (2.1, 2.2, etc.)
  const themeOrder = client.monitoringThemes.map((t, i) => ({
    ...t,
    sectionNumber: i + 1,
  }));

  // -----------------------------------------------------------------------
  // Run theme analyses in parallel — one Sonnet call per theme
  // -----------------------------------------------------------------------
  const themePromises = themeOrder.map(async (theme) => {
    const items = groupedItems[theme.id] || [];
    if (items.length === 0) {
      return {
        themeId: theme.id,
        result: { items: [], no_developments: true },
      };
    }

    const prompt = buildThemePrompt(
      theme.id,
      theme.name,
      items,
      client,
      theme.sectionNumber,
    );

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    const text =
      response.content[0].type === 'text' ? response.content[0].text : '';

    return {
      themeId: theme.id,
      result: parseJsonResponse(text, {
        items: [],
        no_developments: true,
      }),
    };
  });

  const themeResults = await Promise.all(themePromises);

  // Build sections object keyed by theme ID
  const sections: Record<string, unknown> = {};
  for (const { themeId, result } of themeResults) {
    sections[themeId] = result;
  }

  // -----------------------------------------------------------------------
  // Identify forward-scan items for the forward look section
  // -----------------------------------------------------------------------
  const allItems = Object.values(groupedItems).flat();
  const forwardItems = allItems.filter(
    (item) =>
      item.is_forward_scan ||
      (item.event_date && new Date(item.event_date) > new Date()),
  );

  // -----------------------------------------------------------------------
  // Synthesis pass — one Sonnet call to produce executive summary, forward
  // look, emerging themes, actions tracker, coverage summary
  // -----------------------------------------------------------------------
  const synthesisPrompt = buildSynthesisPrompt(
    sections,
    forwardItems,
    client,
    reportingPeriod,
  );

  const synthesisResponse = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: [{ role: 'user', content: synthesisPrompt }],
  });

  const synthesisText =
    synthesisResponse.content[0].type === 'text'
      ? synthesisResponse.content[0].text
      : '';

  const synthesis = parseJsonResponse(synthesisText, {
    executive_summary: { top_line: '', key_developments: [] },
    forward_look: [],
    emerging_themes: [],
    actions_tracker: [],
    coverage_summary: [],
  });

  // -----------------------------------------------------------------------
  // Assemble final analysis JSON matching the monitoring agent schema
  // -----------------------------------------------------------------------
  const itemsAnalysed = Object.values(sections).reduce(
    (sum: number, s: any) => sum + (s.items?.length || 0),
    0,
  );

  return {
    metadata: {
      client_name: client.name,
      reporting_period: reportingPeriod,
      report_date: formatDate(new Date()),
      generated_at: new Date().toISOString(),
      items_collected: allItems.length,
      items_analysed: itemsAnalysed,
      sources_unavailable: [],
    },
    executive_summary: synthesis.executive_summary,
    sections: sections as AnalysisJSON['sections'],
    forward_look: synthesis.forward_look,
    emerging_themes: synthesis.emerging_themes,
    actions_tracker: synthesis.actions_tracker,
    coverage_summary: synthesis.coverage_summary,
  };
}
