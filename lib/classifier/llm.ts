// ---------------------------------------------------------------------------
// LLM classifier — Claude Sonnet 4 with tool_use for structured output.
//
// Handles all non-deterministic evidence types: speeches, questions, op-eds,
// amendments, social posts, EDMs. Pre-filters candidate indicators by
// topic_tags overlap, then asks the model to classify.
// ---------------------------------------------------------------------------

import { generateText, tool } from 'ai';
import { z } from 'zod';
import { anthropic } from '@ai-sdk/anthropic';
import { getServiceClient } from '@/lib/db';
import { withRetry } from '@/lib/ai/retry';
import type { PoliticianEvidence, Politician } from '@/types/politician';
import type { Classification, ClassifierInput, CandidateIndicator } from './types';
import {
  CLASSIFIER_MODEL,
  CLASSIFIER_MAX_TOKENS,
  MIN_CONFIDENCE,
  ANCHOR_MIN,
  ANCHOR_MAX,
  MAX_CLASSIFICATIONS_PER_EVIDENCE,
  BASE_WEIGHTS,
  SOCIAL_POST_WEIGHT_CAP,
  getVenueAdjustment,
} from './constants';

// ---------------------------------------------------------------------------
// Candidate indicator pre-filtering
// ---------------------------------------------------------------------------

/**
 * Select indicators whose policy_area overlaps the evidence's topic_tags.
 * Falls back to all policy indicators if no tags match (but caps at 15).
 */
async function getCandidateIndicators(
  topicTags: string[],
): Promise<CandidateIndicator[]> {
  const db = getServiceClient();

  if (topicTags.length > 0) {
    // Fetch indicators where policy_area overlaps with any topic tag
    const { data } = await db
      .from('indicator_definitions')
      .select('id, radar, label_low, label_high, description, policy_area')
      .in('policy_area', topicTags);

    if (data && data.length > 0) {
      return data.map(({ id, radar, label_low, label_high, description }) => ({
        id, radar, label_low, label_high, description,
      }));
    }
  }

  // Fallback: return all policy/ideology indicators, capped at 15
  const { data } = await db
    .from('indicator_definitions')
    .select('id, radar, label_low, label_high, description')
    .in('radar', ['policy', 'ideology'])
    .limit(15);

  return (data ?? []).map(({ id, radar, label_low, label_high, description }) => ({
    id, radar, label_low, label_high, description,
  }));
}

/**
 * Fetch recent classifications for this politician on the candidate indicators,
 * to give the model context for spotting inconsistency.
 */
async function getRecentClassifications(
  politicianId: string,
  indicatorIds: string[],
  limit = 10,
): Promise<Array<{ indicator_id: string; anchor: number; date: string }>> {
  if (indicatorIds.length === 0) return [];

  const db = getServiceClient();
  const { data } = await db
    .from('politician_indicator_evidence')
    .select('indicator_id, anchor, applied_at')
    .eq('politician_id', politicianId)
    .in('indicator_id', indicatorIds)
    .order('applied_at', { ascending: false })
    .limit(limit);

  return (data ?? []).map((r: { indicator_id: string; anchor: number; applied_at: string }) => ({
    indicator_id: r.indicator_id,
    anchor: Number(r.anchor),
    date: r.applied_at,
  }));
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

function buildPrompt(input: ClassifierInput): string {
  const indicatorList = input.candidate_indicators
    .map((ind) => `- ${ind.id}: "${ind.label_low}" (0) ← → "${ind.label_high}" (1) — ${ind.description}`)
    .join('\n');

  const recentBlock = input.context_window.recent.length > 0
    ? `\nRECENT CLASSIFICATIONS FOR THIS POLITICIAN:\n${input.context_window.recent
        .map((r) => `- ${r.indicator_id}: anchor=${r.anchor} (${r.date})`)
        .join('\n')}\n`
    : '';

  return `You are classifying political evidence against position indicators.

EVIDENCE:
Type: ${input.evidence.type}
Date: ${input.evidence.occurred_at}
Politician: ${input.politician.name} (${input.politician.party ?? 'unknown party'}, ${input.politician.current_role ?? 'backbench'})
Content:
"""
${input.evidence.content}
"""

CANDIDATE INDICATORS (pick zero or more):
${indicatorList}
${recentBlock}
For each indicator that this evidence informs, output:
- indicator_id (must match exactly)
- anchor: 0.0 (low end) to 1.0 (high end) — position implied
- confidence: 0.0 to 1.0 — your confidence in this classification
- reasoning: <=200 chars

Rules:
1. If unsure, output nothing for that indicator.
2. Do not infer from politician identity (party, role) alone — only from evidence content.
3. Performative or rhetorical statements should get lower confidence.
4. Direct policy statements get higher confidence than implications.
5. If the evidence contradicts the candidate's prior classifications, lower confidence and note it.
6. Output JSON only. No prose.`;
}

// ---------------------------------------------------------------------------
// Tool schema for structured output (AI SDK v6 — Zod + tool())
// ---------------------------------------------------------------------------

const classificationSchema = z.object({
  indicator_id: z.string(),
  anchor: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(200),
});

const classifyToolSchema = z.object({
  classifications: z.array(classificationSchema),
  no_classification_reason: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Main LLM classifier
// ---------------------------------------------------------------------------

interface LlmClassifierOutput {
  classifications: Classification[];
  no_classification_reason?: string;
  cost_usd: number;
  latency_ms: number;
}

export async function classifyWithLlm(
  evidence: PoliticianEvidence,
  politician: Politician,
): Promise<LlmClassifierOutput> {
  const start = performance.now();

  // Skip if no content to classify
  if (!evidence.raw_content?.trim()) {
    return {
      classifications: [],
      no_classification_reason: 'empty_content',
      cost_usd: 0,
      latency_ms: Math.round(performance.now() - start),
    };
  }

  // Skip if no topic tags (no candidate indicators to match against)
  if (!evidence.topic_tags?.length) {
    return {
      classifications: [],
      no_classification_reason: 'no_topic_tags',
      cost_usd: 0,
      latency_ms: Math.round(performance.now() - start),
    };
  }

  const candidates = await getCandidateIndicators(evidence.topic_tags);
  if (candidates.length === 0) {
    return {
      classifications: [],
      no_classification_reason: 'no_matching_indicators',
      cost_usd: 0,
      latency_ms: Math.round(performance.now() - start),
    };
  }

  const recent = await getRecentClassifications(
    evidence.politician_id,
    candidates.map((c) => c.id),
  );

  // Resolve current role from politician_roles
  const currentRole = politician.party
    ? `${politician.party} MP`
    : null;

  const input: ClassifierInput = {
    evidence: {
      type: evidence.evidence_type,
      content: evidence.raw_content,
      occurred_at: evidence.occurred_at,
      source_url: evidence.source_url,
      parsed: evidence.parsed as Record<string, unknown>,
    },
    politician: {
      name: politician.display_name,
      party: politician.party,
      current_role: currentRole,
      constituency: politician.constituency,
    },
    candidate_indicators: candidates,
    context_window: { recent },
  };

  const prompt = buildPrompt(input);

  const { toolCalls, usage } = await withRetry(() =>
    generateText({
      model: anthropic(CLASSIFIER_MODEL),
      maxOutputTokens: CLASSIFIER_MAX_TOKENS,
      temperature: 0,
      tools: {
        classify_evidence: tool({
          description: 'Emit indicator classifications for the evidence',
          inputSchema: classifyToolSchema,
        }),
      },
      toolChoice: { type: 'tool', toolName: 'classify_evidence' },
      prompt,
    }),
  );

  const latency_ms = Math.round(performance.now() - start);

  // Estimate cost: Sonnet 4 pricing ~$3/1M input, $15/1M output
  const inputTokens = usage?.inputTokens ?? 0;
  const outputTokens = usage?.outputTokens ?? 0;
  const cost_usd = (inputTokens * 3 + outputTokens * 15) / 1_000_000;

  // Extract tool call result
  const toolCall = toolCalls?.[0];
  if (!toolCall) {
    return {
      classifications: [],
      no_classification_reason: 'no_tool_call',
      cost_usd,
      latency_ms,
    };
  }

  const result = toolCall.input as z.infer<typeof classifyToolSchema>;

  // Validate indicator_ids exist in candidate set
  const validIds = new Set(candidates.map((c) => c.id));
  const validClassifications = result.classifications.filter((c) => validIds.has(c.indicator_id));

  // Post-process: apply weights, confidence threshold, clamping, dedup, cap
  const processed = postProcess(validClassifications, evidence);

  return {
    classifications: processed,
    no_classification_reason: processed.length === 0
      ? (result.no_classification_reason ?? 'low_confidence')
      : undefined,
    cost_usd,
    latency_ms,
  };
}

// ---------------------------------------------------------------------------
// Post-processing
// ---------------------------------------------------------------------------

function postProcess(
  raw: Array<{ indicator_id: string; anchor: number; confidence: number; reasoning: string }>,
  evidence: PoliticianEvidence,
): Classification[] {
  let classifications: Classification[] = raw
    // Drop below confidence threshold
    .filter((c) => c.confidence >= MIN_CONFIDENCE)
    // Clamp anchors
    .map((c) => ({
      indicator_id: c.indicator_id,
      anchor: Math.max(ANCHOR_MIN, Math.min(ANCHOR_MAX, c.anchor)),
      confidence: c.confidence,
      reasoning: c.reasoning.slice(0, 200),
      raw_weight: computeRawWeight(c.confidence, evidence),
    }));

  // Dedup: keep highest confidence per indicator
  const byIndicator = new Map<string, Classification>();
  for (const c of classifications) {
    const existing = byIndicator.get(c.indicator_id);
    if (!existing || c.confidence > existing.confidence) {
      byIndicator.set(c.indicator_id, c);
    }
  }
  classifications = Array.from(byIndicator.values());

  // Cap at max per evidence
  if (classifications.length > MAX_CLASSIFICATIONS_PER_EVIDENCE) {
    classifications.sort((a, b) => b.confidence - a.confidence);
    classifications = classifications.slice(0, MAX_CLASSIFICATIONS_PER_EVIDENCE);
  }

  return classifications;
}

function computeRawWeight(confidence: number, evidence: PoliticianEvidence): number {
  const base = BASE_WEIGHTS[evidence.evidence_type] ?? 1.0;
  const venue = getVenueAdjustment(evidence.source_url, evidence.evidence_type);
  let weight = base * confidence * venue;

  // Social post hard cap
  if (evidence.evidence_type === 'social_post') {
    weight = Math.min(weight, SOCIAL_POST_WEIGHT_CAP);
  }

  return Math.round(weight * 1000) / 1000;
}
