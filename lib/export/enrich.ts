// ---------------------------------------------------------------------------
// LLM enrichment — runs theme analyses in parallel (Sonnet), then a single
// synthesis pass to produce cross-cutting sections. Direct port of the
// monitoring agent's analyse/ pipeline, using the Vercel AI SDK.
// ---------------------------------------------------------------------------

import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import type { ClientConfig } from '@/types/client';
import type { FeedItem } from '@/types/feed';
import type { AnalysisJSON } from './types';
import { buildThemePrompt, buildSynthesisPrompt } from './prompts';
import { logTrace, withTiming } from '@/lib/observability/opik';

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

    const { result: genResult, duration_ms } = await withTiming(() =>
      generateText({
        model: anthropic('claude-sonnet-4-20250514'),
        maxOutputTokens: 4096,
        prompt,
      }),
    );

    const { text } = genResult;

    // Log trace for observability
    await logTrace(
      {
        client_id: client.id,
        theme_id: theme.id,
        step: 'theme_analysis',
        model: 'claude-sonnet-4-20250514',
        items_count: items.length,
      },
      prompt,
      text,
      undefined,
      {
        input_tokens: genResult.usage?.inputTokens ?? 0,
        output_tokens: genResult.usage?.outputTokens ?? 0,
        duration_ms,
      },
    );

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

  const { result: synthesisResult, duration_ms: synthDuration } = await withTiming(() =>
    generateText({
      model: anthropic('claude-sonnet-4-20250514'),
      maxOutputTokens: 4096,
      prompt: synthesisPrompt,
    }),
  );

  const { text: synthesisText } = synthesisResult;

  await logTrace(
    {
      client_id: client.id,
      step: 'synthesis',
      model: 'claude-sonnet-4-20250514',
      items_count: allItems.length,
    },
    synthesisPrompt,
    synthesisText,
    undefined,
    {
      input_tokens: synthesisResult.usage?.inputTokens ?? 0,
      output_tokens: synthesisResult.usage?.outputTokens ?? 0,
      duration_ms: synthDuration,
    },
  );

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
  const itemsAnalysed = (Object.values(sections) as Array<{ items?: unknown[] }>).reduce(
    (sum, s) => sum + (s.items?.length || 0),
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
