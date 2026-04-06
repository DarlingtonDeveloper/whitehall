// ---------------------------------------------------------------------------
// Evaluation layer — direct port of the monitoring agent's evaluate/ module.
// Three checks:
//   1. Template validation (deterministic structural checks, no LLM)
//   2. Factuality check (LLM-as-judge: is the summary grounded in sources?)
//   3. Specificity check (LLM-as-judge: is client_relevance project-specific?)
//
// Traces are logged to Supabase pipeline_traces and optionally forwarded
// to Opik REST API (matching the monitoring agent's @track decorators).
// ---------------------------------------------------------------------------

import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import type { ClientConfig } from '@/types/client';
import type { FeedItem } from '@/types/feed';
import type { AnalysisJSON, AnalysedItem, ThemeSection } from './types';
import { logTrace, withTiming } from '@/lib/observability/opik';

// ---------------------------------------------------------------------------
// 1. Template validator — ~30 deterministic checks matching
//    template_validator.py exactly
// ---------------------------------------------------------------------------

interface ValidationFailure {
  check: string;
  severity: 'error' | 'warning';
  detail: string;
}

export function validateTemplate(analysis: AnalysisJSON): ValidationFailure[] {
  const failures: ValidationFailure[] = [];

  const error = (check: string, detail: string) =>
    failures.push({ check, severity: 'error', detail });
  const warning = (check: string, detail: string) =>
    failures.push({ check, severity: 'warning', detail });

  // ── Executive summary ──
  const es = analysis.executive_summary;
  if (!es) {
    error('exec_summary_exists', 'executive_summary is missing');
  } else {
    if (!es.top_line) {
      error('exec_summary_topline', 'executive_summary.top_line is empty');
    }

    const kd = es.key_developments || [];
    if (kd.length < 4) {
      error('exec_summary_kd_count', `key_developments has ${kd.length} items, expected 4-6`);
    } else if (kd.length > 6) {
      warning('exec_summary_kd_count', `key_developments has ${kd.length} items, expected 4-6`);
    }

    for (let i = 0; i < kd.length; i++) {
      const dev = kd[i];
      for (const field of ['rag', 'development', 'relevance', 'recommended_action', 'section_ref'] as const) {
        if (!dev[field]) {
          error('kd_field_missing', `key_developments[${i}] missing '${field}'`);
        }
      }
      if (!['RED', 'AMBER', 'GREEN'].includes(dev.rag)) {
        error('kd_rag_invalid', `key_developments[${i}] rag='${dev.rag}' invalid`);
      }
    }
  }

  // ── Theme sections — item cards ──
  const sections = analysis.sections || {};
  for (const [themeId, themeData] of Object.entries(sections)) {
    const items = themeData.items || [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const prefix = `sections.${themeId}.items[${i}]`;

      for (const field of ['ref', 'headline', 'date', 'source', 'summary', 'client_relevance', 'recommended_action'] as const) {
        if (!item[field]) {
          error('item_field_missing', `${prefix} missing '${field}'`);
        }
      }

      if (!['IMMEDIATE', 'HIGH', 'STANDARD'].includes(item.escalation)) {
        error('item_escalation_invalid', `${prefix} escalation='${item.escalation}' invalid`);
      }

      if (!item.source_items || item.source_items.length === 0) {
        error('item_no_provenance', `${prefix} has empty source_items`);
      }

      // Summary sentence count (2-4)
      const sentenceCount = (item.summary.match(/[.!?]+/g) || []).length;
      if (sentenceCount < 2) {
        warning('item_summary_short', `${prefix} summary has ~${sentenceCount} sentences, expected 2-4`);
      }

      // Client relevance sentence count (2-3)
      const crCount = (item.client_relevance.match(/[.!?]+/g) || []).length;
      if (crCount < 2) {
        warning('item_cr_short', `${prefix} client_relevance has ~${crCount} sentences, expected 2-3`);
      }

      // Confidence calibration
      if (item.confidence === 1.0) {
        warning('item_confidence_1', `${prefix} confidence is exactly 1.0 (uncalibrated)`);
      } else if (item.confidence === 0.0) {
        warning('item_confidence_0', `${prefix} confidence is exactly 0.0`);
      }
    }

    // Empty section without no_developments flag
    if (items.length === 0 && !themeData.no_developments) {
      warning('empty_section_no_flag', `sections.${themeId} has no items but no_developments is not set`);
    }
  }

  // ── Forward look ──
  if (!analysis.forward_look || analysis.forward_look.length < 1) {
    error('forward_look_empty', 'forward_look has no items');
  }

  // ── Emerging themes ──
  const et = analysis.emerging_themes || [];
  if (et.length < 2) {
    error('emerging_themes_count', `emerging_themes has ${et.length} items, expected 2-4`);
  } else if (et.length > 4) {
    warning('emerging_themes_count', `emerging_themes has ${et.length} items, expected 2-4`);
  }

  // ── Actions tracker ──
  if (!analysis.actions_tracker) {
    error('actions_tracker_missing', 'actions_tracker is missing');
  }

  // ── Coverage summary ──
  if (!analysis.coverage_summary) {
    error('coverage_summary_missing', 'coverage_summary is missing');
  }

  return failures;
}

// ---------------------------------------------------------------------------
// 2. Factuality check — LLM-as-judge (matches judge.py exactly)
//
// For each AnalysedItem, evaluates ONLY the summary field against source
// material. Client_relevance is evaluated separately for specificity.
// This split is a deliberate design choice from the monitoring agent:
// client_relevance is allowed to add context not in sources (project names,
// commercial positions), so evaluating it for factuality would penalise
// correct behaviour.
// ---------------------------------------------------------------------------

interface EvalResult {
  mean_score: number;
  flagged_items: string[];
  total_checked: number;
  item_details: Array<{
    reference: string;
    score: number;
    reason: string;
  }>;
}

export async function runFactualityCheck(
  analysis: AnalysisJSON,
  sourceItems: FeedItem[],
): Promise<EvalResult> {
  const itemsByFp = new Map(sourceItems.map((item) => [item.fingerprint, item]));

  // Build evaluation cases: each AnalysedItem paired with its source content
  const cases: Array<{
    reference: string;
    summary: string;
    sourceText: string;
  }> = [];

  for (const themeData of Object.values(analysis.sections)) {
    const allItems = [
      ...(themeData.items || []),
      ...(themeData.significant_items || []),
    ];
    for (const item of allItems) {
      const sourceTexts: string[] = [];
      for (const fp of item.source_items || []) {
        const source = itemsByFp.get(fp);
        if (source) sourceTexts.push(source.body || source.title);
      }
      if (sourceTexts.length === 0) continue;

      cases.push({
        reference: item.ref,
        summary: item.summary,
        sourceText: sourceTexts.join('\n'),
      });
    }
  }

  if (cases.length === 0) {
    return { mean_score: 1.0, flagged_items: [], total_checked: 0, item_details: [] };
  }

  const details: EvalResult['item_details'] = [];
  const scores: number[] = [];
  const flagged: string[] = [];

  for (const c of cases) {
    try {
      const { text } = await generateText({
        model: anthropic('claude-sonnet-4-20250514'),
        maxOutputTokens: 256,
        prompt: `You are evaluating whether an analysis summary is factually grounded in the source material.

SOURCE MATERIAL:
${c.sourceText}

ANALYSIS OUTPUT:
${c.summary}

Score 0-1 how well the analysis is supported by the source material. 1.0 = fully supported, 0.0 = completely fabricated.

Return ONLY a JSON object: {"score": <number>, "reason": "<string>"}`,
      });

      const parsed = JSON.parse(text.replace(/```json\s*|```\s*/g, '').trim());
      const score = Number(parsed.score) || 0;
      scores.push(score);
      details.push({ reference: c.reference, score, reason: parsed.reason || '' });
      if (score < 0.7) flagged.push(c.reference);
    } catch {
      scores.push(0.5);
      details.push({ reference: c.reference, score: 0.5, reason: 'Evaluation failed' });
    }
  }

  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  return {
    mean_score: Math.round(mean * 1000) / 1000,
    flagged_items: flagged,
    total_checked: cases.length,
    item_details: details,
  };
}

// ---------------------------------------------------------------------------
// 3. Specificity check — LLM-as-judge (matches judge.py exactly)
//
// Evaluates whether client_relevance text is specific to the client —
// referencing their actual projects, commercial positions, and pipeline
// impacts — rather than generic sector commentary.
// ---------------------------------------------------------------------------

export async function runSpecificityCheck(
  analysis: AnalysisJSON,
  client: ClientConfig,
): Promise<EvalResult> {
  const clientContext = [
    `Client: ${client.name}`,
    `Sector: ${client.sector}`,
    `Projects: ${client.projects.join(', ')}`,
    `Competitors: ${client.competitors.join(', ')}`,
  ].join('\n');

  const cases: Array<{ reference: string; clientRelevance: string }> = [];
  for (const themeData of Object.values(analysis.sections)) {
    const allItems = [
      ...(themeData.items || []),
      ...(themeData.significant_items || []),
    ];
    for (const item of allItems) {
      if (item.client_relevance) {
        cases.push({ reference: item.ref, clientRelevance: item.client_relevance });
      }
    }
  }

  if (cases.length === 0) {
    return { mean_score: 1.0, flagged_items: [], total_checked: 0, item_details: [] };
  }

  const details: EvalResult['item_details'] = [];
  const scores: number[] = [];
  const flagged: string[] = [];

  for (const c of cases) {
    try {
      const { text } = await generateText({
        model: anthropic('claude-sonnet-4-20250514'),
        maxOutputTokens: 256,
        prompt: `You are evaluating a public affairs monitoring report for ${client.name}.

The following 'client relevance' text should explain why a development matters specifically to ${client.name} — referencing their specific projects, commercial position, pipeline, or strategic priorities.

CLIENT CONTEXT:
${clientContext}

CLIENT RELEVANCE TEXT TO EVALUATE:
${c.clientRelevance}

SCORING:
- 1.0: Highly specific. References specific projects (e.g. ${client.projects[0] || 'key project'}), specific commercial positions, or specific pipeline impacts.
- 0.7: Moderately specific. References the client's sector position but not projects.
- 0.4: Generic. Could apply to any company in this sector.
- 0.1: Completely generic. Could apply to any company.

Return ONLY a JSON object: {"score": <number>, "reason": "<string>"}`,
      });

      const parsed = JSON.parse(text.replace(/```json\s*|```\s*/g, '').trim());
      const score = Number(parsed.score) || 0;
      scores.push(score);
      details.push({ reference: c.reference, score, reason: parsed.reason || '' });
      if (score < 0.5) flagged.push(c.reference);
    } catch {
      scores.push(0.5);
      details.push({ reference: c.reference, score: 0.5, reason: 'Evaluation failed' });
    }
  }

  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  return {
    mean_score: Math.round(mean * 1000) / 1000,
    flagged_items: flagged,
    total_checked: cases.length,
    item_details: details,
  };
}

// ---------------------------------------------------------------------------
// Full evaluation pipeline — matches evaluate/__init__.py
// ---------------------------------------------------------------------------

export interface EvaluationResult {
  template_validation: {
    passed: boolean;
    errors: ValidationFailure[];
    warnings: ValidationFailure[];
  };
  factuality: EvalResult;
  specificity: EvalResult;
  overall_pass: boolean;
  flagged_refs: string[];
}

export async function evaluateReport(
  analysis: AnalysisJSON,
  sourceItems: FeedItem[],
  client: ClientConfig,
): Promise<EvaluationResult> {
  // 1. Template validation (deterministic, instant)
  const failures = validateTemplate(analysis);
  const errors = failures.filter((f) => f.severity === 'error');
  const warnings = failures.filter((f) => f.severity === 'warning');

  // 2. Factuality check (LLM-as-judge)
  let factuality: EvalResult;
  try {
    factuality = await runFactualityCheck(analysis, sourceItems);
  } catch (e) {
    console.error('Factuality check failed:', e);
    factuality = { mean_score: 0, flagged_items: [], total_checked: 0, item_details: [] };
  }

  // 3. Specificity check (LLM-as-judge)
  let specificity: EvalResult;
  try {
    specificity = await runSpecificityCheck(analysis, client);
  } catch (e) {
    console.error('Specificity check failed:', e);
    specificity = { mean_score: 0, flagged_items: [], total_checked: 0, item_details: [] };
  }

  // Overall pass/fail — same thresholds as the monitoring agent
  const overall_pass =
    errors.length === 0 &&
    factuality.mean_score > 0.7 &&
    specificity.mean_score > 0.5;

  const flagged_refs = [
    ...new Set([...factuality.flagged_items, ...specificity.flagged_items]),
  ];

  // Log evaluation scores for observability
  await logTrace(
    {
      client_id: client.id,
      step: 'factuality_eval',
      model: 'claude-sonnet-4-20250514',
    },
    `Evaluated ${factuality.total_checked} items`,
    `Mean: ${factuality.mean_score}, Flagged: ${factuality.flagged_items.join(', ')}`,
    { factuality: factuality.mean_score, specificity: specificity.mean_score },
  );

  return {
    template_validation: { passed: errors.length === 0, errors, warnings },
    factuality,
    specificity,
    overall_pass,
    flagged_refs,
  };
}
