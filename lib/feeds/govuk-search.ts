/**
 * GOV.UK Search API Collector
 *
 * Fetches 12 months of historical publications from the GOV.UK Search API
 * across all departments and document types, then upserts into Supabase.
 *
 * Unlike the Atom feed collector (govuk.ts) which only gets recent items,
 * this collector paginates through the full Search API to backfill
 * historical data.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

import {
  GOVUK_TO_ENTITY,
  makeFingerprint,
  enrichEntityIds,
  determineRagStatus,
} from './govuk';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY in .env.local',
  );
}

const supabase = createClient(supabaseUrl, supabaseKey);

// -- Constants ----------------------------------------------------------------

const SEARCH_BASE_URL = 'https://www.gov.uk/api/search.json';

const PAGE_SIZE = 200;

const REQUEST_DELAY_MS = 300;

const BATCH_SIZE = 25;

/** Document types to collect across all departments. */
export const DOCUMENT_TYPES = [
  'news_story',
  'press_release',
  'speech',
  'written_statement',
  'government_response',
  'policy_paper',
  'open_consultation',
  'closed_consultation',
  'consultation_outcome',
  'guidance',
  'regulation',
  'corporate_report',
  'transparency',
  'foi_release',
  'national_statistics',
  'official_statistics',
  'statistical_data_set',
  'research',
] as const;

export type SearchDocumentType = (typeof DOCUMENT_TYPES)[number];

// -- Types --------------------------------------------------------------------

interface SearchResult {
  title?: string;
  link?: string;
  public_timestamp?: string;
  description?: string;
  content_store_document_type?: string;
  organisations?: Array<{
    slug?: string;
    title?: string;
    organisation_brand?: string;
  }>;
}

interface SearchResponse {
  results: SearchResult[];
  total: number;
}

// -- Helpers ------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolves entity IDs for a search result by matching its organisation slugs
 * against GOVUK_TO_ENTITY.
 */
function resolveEntityIds(result: SearchResult): string[] {
  const ids = new Set<string>();

  if (result.organisations) {
    for (const org of result.organisations) {
      if (org.slug && GOVUK_TO_ENTITY[org.slug]) {
        for (const id of GOVUK_TO_ENTITY[org.slug]) {
          ids.add(id);
        }
      }
    }
  }

  return Array.from(ids);
}

/**
 * Fetch a single page from the GOV.UK Search API.
 */
async function fetchSearchPage(
  docType: string,
  start: number,
  count: number,
  timeoutMs = 20_000,
): Promise<SearchResponse | null> {
  const params = new URLSearchParams({
    filter_content_store_document_type: docType,
    order: '-public_timestamp',
    count: String(count),
    start: String(start),
    fields:
      'title,link,public_timestamp,description,content_store_document_type,organisations',
  });

  const url = `${SEARCH_BASE_URL}?${params.toString()}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Whitehall-Monitor/1.0 (govuk-search-collector)',
        Accept: 'application/json',
      },
    });

    clearTimeout(timer);

    if (!resp.ok) {
      console.warn(`  [WARN] Search API returned ${resp.status} for ${docType} (start=${start})`);
      return null;
    }

    return (await resp.json()) as SearchResponse;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('abort')) {
      console.warn(`  [WARN] Search API timed out for ${docType} (start=${start})`);
    } else {
      console.warn(`  [WARN] Search API fetch failed for ${docType} (start=${start}): ${message}`);
    }
    return null;
  }
}

// -- Main collector -----------------------------------------------------------

export async function collectGovUKSearch(): Promise<{ inserted: number; skipped: number }> {
  let totalInserted = 0;
  let totalSkipped = 0;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 365);
  const cutoffIso = cutoffDate.toISOString();

  console.log(`\n=== GOV.UK Search API Collector ===`);
  console.log(`Document types: ${DOCUMENT_TYPES.length}`);
  console.log(`Cutoff date:    ${cutoffIso.slice(0, 10)} (365 days ago)\n`);

  for (const docType of DOCUMENT_TYPES) {
    console.log(`[${docType}]`);

    let start = 0;
    let totalForType = 0;
    let insertedForType = 0;
    let skippedForType = 0;
    let reachedCutoff = false;

    // Paginate through all results
    while (true) {
      const page = await fetchSearchPage(docType, start, PAGE_SIZE);

      if (!page) {
        // Request failed; skip to next page (or break if first page)
        if (start === 0) break;
        start += PAGE_SIZE;
        await delay(REQUEST_DELAY_MS);
        continue;
      }

      if (start === 0) {
        totalForType = page.total;
        console.log(`  Total results from API: ${totalForType}`);
      }

      if (page.results.length === 0) break;

      // Filter and map results
      const rows: Array<Record<string, unknown>> = [];

      for (const result of page.results) {
        // Skip items without required fields
        if (!result.link || !result.title) continue;

        // Check cutoff date
        const pubDate = result.public_timestamp
          ? new Date(result.public_timestamp).toISOString()
          : null;

        if (pubDate && pubDate < cutoffIso) {
          reachedCutoff = true;
          break;
        }

        // Skip if no valid timestamp at all
        if (!pubDate) continue;

        const fullUrl = result.link.startsWith('http')
          ? result.link
          : `https://www.gov.uk${result.link}`;

        const description = result.description || '';
        const baseEntityIds = resolveEntityIds(result);
        const entityIds = enrichEntityIds(baseEntityIds, result.title, description);
        const ragStatus = determineRagStatus(result.title, description);
        const fingerprint = makeFingerprint(fullUrl, result.title);

        rows.push({
          source_type: 'govuk',
          source_name: `GOV.UK Search - ${docType}`,
          title: result.title,
          url: fullUrl,
          published_at: pubDate,
          body: description.slice(0, 2000) || null,
          entity_ids: entityIds,
          rag_status: ragStatus.toLowerCase(),
          relevance_score: 0.3,
          fingerprint,
          is_forward_scan: false,
        });
      }

      // Upsert in batches of 25
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);

        const { data, error } = await supabase
          .from('feed_items')
          .upsert(batch, { onConflict: 'fingerprint', ignoreDuplicates: true })
          .select('id');

        if (error) {
          console.warn(`    [ERR] Upsert failed: ${error.message}`);
          skippedForType += batch.length;
          continue;
        }

        const insertedCount = data?.length ?? 0;
        insertedForType += insertedCount;
        skippedForType += batch.length - insertedCount;
      }

      // Stop if we've gone past the cutoff or exhausted results
      if (reachedCutoff) break;

      start += PAGE_SIZE;
      if (start >= totalForType) break;

      // Be polite
      await delay(REQUEST_DELAY_MS);
    }

    console.log(`  Inserted: ${insertedForType}, Skipped: ${skippedForType}`);
    totalInserted += insertedForType;
    totalSkipped += skippedForType;

    // Delay between document types
    await delay(REQUEST_DELAY_MS);
  }

  console.log(`\n=== GOV.UK Search Collection Complete ===`);
  console.log(`Total inserted: ${totalInserted}`);
  console.log(`Total skipped:  ${totalSkipped}\n`);

  return { inserted: totalInserted, skipped: totalSkipped };
}
