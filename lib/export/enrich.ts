// ---------------------------------------------------------------------------
// LLM enrichment — runs theme analyses sequentially (Sonnet), then a single
// Opus synthesis pass with extended thinking. Direct port of the monitoring
// agent's analyse/ pipeline, using the Vercel AI SDK.
//
// Key design decisions matching the monitoring agent:
//   - Theme analyses run sequentially (one at a time) to respect rate limits
//   - Synthesis uses Opus with extended thinking for highest-quality output
//   - All API calls wrapped in withRetry for 429 backoff
// ---------------------------------------------------------------------------

import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import type { ClientConfig } from '@/types/client';
import type { FeedItem } from '@/types/feed';
import type { AnalysisJSON } from './types';
import { buildThemePrompt, buildSynthesisPrompt } from './prompts';
import { logTrace, withTiming } from '@/lib/observability/opik';
import { withRetry, mapWithConcurrency } from '@/lib/ai/retry';

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
  // Run theme analyses with bounded concurrency (2) — withRetry handles
  // any 429s with 15s backoff so limited parallelism is safe and faster.
  // -----------------------------------------------------------------------
  const themeResults = await mapWithConcurrency(themeOrder, 2, async (theme) => {
    const items = groupedItems[theme.id] || [];
    if (items.length === 0) {
      return {
        themeId: theme.id,
        result: { items: [], no_developments: true } as Record<string, unknown>,
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
      withRetry(() =>
        generateText({
          model: anthropic('claude-sonnet-4-20250514'),
          maxOutputTokens: 4096,
          prompt,
        }),
      ),
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

  // Build sections object keyed by theme ID
  const sections: Record<string, unknown> = {};
  for (const { themeId, result } of themeResults) {
    sections[themeId] = result;
  }

  // Ensure all sections have required structure (matches monitoring agent's _ensure_section_structure)
  ensureSectionStructure(sections, client);

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
  // Synthesis pass — Opus with extended thinking (matches monitoring agent's
  // synthesiser.py: MODEL_SYNTHESIS = "claude-opus-4-6" with 16k thinking)
  // -----------------------------------------------------------------------
  const synthesisPrompt = buildSynthesisPrompt(
    sections,
    forwardItems,
    client,
    reportingPeriod,
  );

  const { result: synthesisResult, duration_ms: synthDuration } = await withTiming(() =>
    withRetry(() =>
      generateText({
        model: anthropic('claude-opus-4-6'),
        maxOutputTokens: 16384,
        prompt: synthesisPrompt,
      }),
    ),
  );

  const { text: synthesisText } = synthesisResult;

  await logTrace(
    {
      client_id: client.id,
      step: 'synthesis',
      model: 'claude-opus-4-6',
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

  // Validate expected keys (matches monitoring agent's synthesis validation)
  const expectedKeys = ['executive_summary', 'forward_look', 'emerging_themes', 'actions_tracker', 'coverage_summary'] as const;
  for (const key of expectedKeys) {
    if (!synthesis[key]) {
      console.warn(`[enrich] Synthesis missing key: ${key}`);
    }
  }

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

/**
 * Ensure all theme sections have their required keys.
 * Matches monitoring agent's _ensure_section_structure exactly.
 */
function ensureSectionStructure(
  sections: Record<string, unknown>,
  client: ClientConfig,
) {
  // Build defaults from client theme config — media needs coverage_table,
  // parliamentary needs routine_mentions, etc.
  const themeDefaults: Record<string, Record<string, unknown>> = {
    'political_parliamentary': { items: [], routine_mentions: [] },
    'media_coverage': { coverage_table: [], significant_items: [] },
    'social_media': {
      summary: '',
      metrics: {
        total_mentions: 'N/A',
        sentiment_breakdown: 'N/A',
        top_engagement_post: 'N/A',
        trend_vs_previous: 'N/A',
      },
      notable_posts: [],
    },
    'competitor_industry': { table: [] },
    'stakeholder_third_party': { items: [], no_developments: true },
  };

  for (const theme of client.monitoringThemes) {
    const defaults = themeDefaults[theme.id] || { items: [] };
    if (!sections[theme.id]) {
      sections[theme.id] = defaults;
    } else {
      const section = sections[theme.id] as Record<string, unknown>;
      for (const [key, defaultVal] of Object.entries(defaults)) {
        if (!(key in section)) {
          section[key] = defaultVal;
        }
      }
    }
  }
}
