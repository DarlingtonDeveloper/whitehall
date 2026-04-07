// ---------------------------------------------------------------------------
// Web search collector — runs multiple search queries per client to find
// non-government, non-parliamentary items: trade press, competitor news,
// regulator publications, industry body announcements.
//
// The monitoring agent's web_search collector (419 LOC) was the most complex
// piece and found items that no structured API covers. This port runs Claude
// queries to surface current intelligence from its training data and any
// connected search capabilities.
//
// Designed to be upgraded to use Claude's web_search tool when the Vercel
// AI SDK exposes it as a provider-specific tool type.
// ---------------------------------------------------------------------------

import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { supabase } from '@/lib/db';
import crypto from 'crypto';
import type { ClientConfig } from '@/types/client';
import { withRetry } from '@/lib/ai/retry';

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  date?: string;
  source_name: string;
}

// Matches monitoring agent: 2s within batch, 45s between batches of 4
const BATCH_SIZE = 4;
const WITHIN_BATCH_DELAY_MS = 2_000;
const BETWEEN_BATCH_DELAY_MS = 45_000;

export function buildSearchQueries(client: ClientConfig): string[] {
  const now = new Date();
  const month = now.toLocaleString('en-GB', { month: 'long' });
  const year = now.getFullYear();
  const monthYear = `${month} ${year}`;

  const queries: string[] = [];

  // Client-specific
  queries.push(`${client.name} UK ${monthYear}`);

  // Project-specific
  for (const project of client.projects.slice(0, 5)) {
    queries.push(`${project} ${year}`);
  }

  // Primary stakeholder regulators/agencies (departments already covered by GOV.UK API)
  const regulatorTerms = ['regulator', 'ndpb', 'public corporation', 'authority', 'agency'];
  const regulatorStakeholders = client.stakeholders
    .filter((s) => s.priority === 'primary')
    .filter((s) => regulatorTerms.some((t) => s.role.toLowerCase().includes(t)))
    .slice(0, 5);

  for (const s of regulatorStakeholders) {
    queries.push(`${s.entityId} publication ${monthYear}`);
  }

  // Policy keywords — longer, more specific terms only
  const policyQueries = client.policyKeywords
    .filter((kw) => kw.length > 5)
    .slice(0, 8)
    .map((kw) => `${kw} UK ${year}`);
  queries.push(...policyQueries);

  // Competitors
  for (const competitor of client.competitors.slice(0, 5)) {
    queries.push(`${competitor} UK ${monthYear}`);
  }

  // Industry bodies and trade press
  for (const kw of client.industryKeywords.slice(0, 3)) {
    queries.push(`${kw} ${monthYear}`);
  }

  return queries;
}

async function executeSearchQuery(query: string): Promise<SearchResult[]> {
  const { text } = await withRetry(() => generateText({
    model: anthropic('claude-sonnet-4-20250514'),
    maxOutputTokens: 2048,
    prompt: `You are a UK public affairs research assistant. Search for recent developments matching this query:

"${query}"

Return a JSON array of the 3-5 most relevant recent results (last 2 weeks preferred).
Each object must have:
- title: string (the headline or title of the development)
- url: string (the source URL — use real, accurate URLs only)
- snippet: string (2-3 sentence summary of the development)
- date: string (ISO date if known, e.g. "2026-04-01")
- source_name: string (e.g. "Ofgem", "GOV.UK", "Recharge News", "RenewableUK")

Rules:
- Only include developments you are confident actually occurred
- Exclude job postings, unrelated companies, and generic sector overviews
- Prefer primary sources (regulator websites, official announcements) over secondary coverage
- If you cannot find relevant results, return an empty array []

Return ONLY the JSON array, no other text.`,
  }));

  const cleaned = text.replace(/```json\s*|```\s*/g, '').trim();
  try {
    const results = JSON.parse(cleaned);
    return Array.isArray(results) ? results : [];
  } catch {
    return [];
  }
}

function makeFingerprint(url: string, title: string): string {
  return crypto.createHash('sha256').update(`${url}||${title}`).digest('hex');
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return 'web';
  }
}

export async function runWebSearchCollector(
  client: ClientConfig,
): Promise<{ items_found: number; queries_run: number }> {
  const queries = buildSearchQueries(client);
  let totalItems = 0;

  // Process in batches of BATCH_SIZE with delays between batches
  // Matches monitoring agent's collect_two_pass batching pattern
  for (let i = 0; i < queries.length; i += BATCH_SIZE) {
    const batch = queries.slice(i, i + BATCH_SIZE);

    for (const query of batch) {
      try {
        const results = await executeSearchQuery(query);

        for (const result of results) {
          if (!result.title || !result.url) continue;

          const fingerprint = makeFingerprint(result.url, result.title);

          // Auto-tag entities
          const text = `${result.title} ${result.snippet}`.toLowerCase();
          const entityIds: string[] = [];
          for (const s of client.stakeholders) {
            if (
              text.includes(s.entityId.toLowerCase()) ||
              text.includes(s.role.toLowerCase())
            ) {
              entityIds.push(s.entityId);
            }
          }

          const { error } = await supabase.from('feed_items').upsert(
            {
              source_type: 'web_search',
              source_name: result.source_name || extractDomain(result.url),
              title: result.title,
              url: result.url,
              published_at: result.date
                ? new Date(result.date).toISOString()
                : new Date().toISOString(),
              body: result.snippet,
              entity_ids: entityIds,
              fingerprint,
              is_forward_scan: false,
              relevance_score: 0,
            },
            { onConflict: 'fingerprint', ignoreDuplicates: true },
          );

          if (!error) totalItems++;
        }
      } catch (err) {
        console.warn(`[web-search] Query failed: "${query}"`, err);
      }

      // 2s within-batch delay (matches monitoring agent)
      await new Promise((resolve) => setTimeout(resolve, WITHIN_BATCH_DELAY_MS));
    }

    // 45s between-batch delay for rate limit cooldown (matches monitoring agent)
    if (i + BATCH_SIZE < queries.length) {
      console.warn(`[web-search] Batch complete, waiting ${BETWEEN_BATCH_DELAY_MS / 1000}s for rate limit cooldown...`);
      await new Promise((resolve) => setTimeout(resolve, BETWEEN_BATCH_DELAY_MS));
    }
  }

  return { items_found: totalItems, queries_run: queries.length };
}
