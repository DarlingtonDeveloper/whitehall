// ---------------------------------------------------------------------------
// Forward scan collector — finds future-dated events (consultation deadlines,
// committee sessions, conferences, FID timelines) using the client's
// configured forwardScanQueries.
//
// Items are stored with is_forward_scan: true and event_date set to the
// future date. These feed the forward look section in reports.
// ---------------------------------------------------------------------------

import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { supabase } from '@/lib/db';
import crypto from 'crypto';
import type { ClientConfig } from '@/types/client';

interface ForwardResult {
  title: string;
  url: string;
  snippet: string;
  date?: string;
  event_date: string;
  source_name: string;
}

const DELAY_MS = 1_000;

function makeFingerprint(url: string, title: string): string {
  return crypto.createHash('sha256').update(`${url}||${title}`).digest('hex');
}

export async function runForwardScanCollector(
  client: ClientConfig,
): Promise<{ items_found: number; queries_run: number }> {
  const queries = client.forwardScanQueries || [];
  if (queries.length === 0) return { items_found: 0, queries_run: 0 };

  let totalItems = 0;

  for (const query of queries) {
    try {
      const { text } = await generateText({
        model: anthropic('claude-sonnet-4-20250514'),
        maxOutputTokens: 2048,
        prompt: `You are a UK public affairs research assistant. Find upcoming events and deadlines for:

"${query}"

Return a JSON array of future-dated events in the next 2-8 weeks.
Each object must have:
- title: string (the event or deadline name)
- url: string (source URL — use real, accurate URLs only)
- snippet: string (1-2 sentence description)
- date: string (ISO date of publication/announcement, e.g. "2026-04-01")
- event_date: string (ISO date of the FUTURE event/deadline, e.g. "2026-05-15")
- source_name: string (e.g. "Ofgem", "Parliament UK", "DESNZ")

Rules:
- ONLY include items with a clear future date
- Prefer consultation deadlines, committee sessions, planned publications, conference dates
- If you cannot find relevant upcoming events, return an empty array []

Return ONLY the JSON array, no other text.`,
      });

      const cleaned = text.replace(/```json\s*|```\s*/g, '').trim();
      let results: ForwardResult[];
      try {
        const parsed = JSON.parse(cleaned);
        results = Array.isArray(parsed) ? parsed : [];
      } catch {
        continue;
      }

      for (const result of results) {
        if (!result.title || !result.event_date) continue;

        const fingerprint = makeFingerprint(
          result.url || result.title,
          result.title,
        );

        // Auto-tag entities
        const text = `${result.title} ${result.snippet || ''}`.toLowerCase();
        const entityIds: string[] = [];
        for (const s of client.stakeholders) {
          if (text.includes(s.entityId.toLowerCase())) {
            entityIds.push(s.entityId);
          }
        }

        const { error } = await supabase.from('feed_items').upsert(
          {
            source_type: 'forward_scan',
            source_name: result.source_name || 'Forward scan',
            title: result.title,
            url: result.url || null,
            published_at: result.date
              ? new Date(result.date).toISOString()
              : new Date().toISOString(),
            body: result.snippet || null,
            entity_ids: entityIds,
            fingerprint,
            is_forward_scan: true,
            event_date: new Date(result.event_date).toISOString(),
            relevance_score: 0,
          },
          { onConflict: 'fingerprint', ignoreDuplicates: true },
        );

        if (!error) totalItems++;
      }
    } catch (err) {
      console.warn(`[forward-scan] Query failed: "${query}"`, err);
    }

    await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
  }

  return { items_found: totalItems, queries_run: queries.length };
}
