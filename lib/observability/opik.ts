// ---------------------------------------------------------------------------
// Observability — structured tracing for every Claude call in the pipeline.
//
// The monitoring agent used Opik @track decorators for full tracing. This
// module provides equivalent observability by logging traces to Supabase
// (always available) and optionally to Opik via REST API when configured.
//
// Tracing never breaks the pipeline — all errors are caught and logged.
// ---------------------------------------------------------------------------

import { supabase } from '@/lib/db';

export interface TraceMetadata {
  client_id: string;
  report_id?: string;
  theme_id?: string;
  step: 'theme_analysis' | 'synthesis' | 'factuality_eval' | 'specificity_eval' | 'web_search' | 'forward_scan';
  model: string;
  items_count?: number;
}

export interface TraceScores {
  factuality?: number;
  specificity?: number;
  confidence?: number;
}

export interface TraceUsage {
  input_tokens: number;
  output_tokens: number;
  duration_ms: number;
}

/**
 * Log a Claude call trace. Always writes to Supabase `pipeline_traces` table.
 * Optionally forwards to Opik REST API if OPIK_API_KEY is configured.
 */
export async function logTrace(
  metadata: TraceMetadata,
  input: string,
  output: string,
  scores?: TraceScores,
  usage?: TraceUsage,
): Promise<void> {
  const trace = {
    ...metadata,
    input_preview: input.slice(0, 2000),
    output_preview: output.slice(0, 2000),
    scores: scores || null,
    input_tokens: usage?.input_tokens ?? null,
    output_tokens: usage?.output_tokens ?? null,
    duration_ms: usage?.duration_ms ?? null,
    created_at: new Date().toISOString(),
  };

  // Always log to Supabase
  try {
    await supabase.from('pipeline_traces').insert(trace);
  } catch (err) {
    console.warn('[trace] Failed to persist trace:', err);
  }

  // Optionally forward to Opik
  const opikKey = process.env.OPIK_API_KEY;
  const opikUrl = process.env.OPIK_API_URL || 'http://localhost:5173';
  if (opikKey) {
    try {
      await fetch(`${opikUrl}/api/v1/traces`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${opikKey}`,
        },
        body: JSON.stringify({
          project_name: 'whitehall-reports',
          name: `${metadata.step}/${metadata.theme_id || 'all'}`,
          input: { prompt: trace.input_preview },
          output: { response: trace.output_preview },
          metadata: {
            client_id: metadata.client_id,
            report_id: metadata.report_id,
            model: metadata.model,
          },
          metrics: {
            ...scores,
            input_tokens: usage?.input_tokens,
            output_tokens: usage?.output_tokens,
            duration_ms: usage?.duration_ms,
          },
        }),
      });
    } catch {
      // Opik forwarding failure is non-critical
    }
  }
}

/**
 * Helper to time an async operation and return duration in ms.
 */
export async function withTiming<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; duration_ms: number }> {
  const start = performance.now();
  const result = await fn();
  return { result, duration_ms: Math.round(performance.now() - start) };
}
