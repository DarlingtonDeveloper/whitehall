/**
 * GOV.UK Search API Collector
 *
 * Two-pass collection strategy:
 *   Pass 1 — Pull ALL publications from tracked organisations (no keyword filter)
 *   Pass 2 — Pull by document type across all orgs (catches items from non-tracked orgs)
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

// -- Tracked organisations for Pass 1 ----------------------------------------
// Pull ALL publications from these organisations regardless of keywords.

export const TRACKED_ORGANISATIONS = [
  // Energy (RWE primary)
  'department-for-energy-security-and-net-zero',
  'ofgem',
  'north-sea-transition-authority',
  'nuclear-decommissioning-authority',
  'coal-authority',
  'uk-atomic-energy-authority',

  // Planning (RWE secondary)
  'planning-inspectorate',
  'homes-england',

  // Environment (RWE secondary)
  'department-for-environment-food-rural-affairs',
  'environment-agency',
  'natural-england',
  'marine-management-organisation',

  // Health (Sanofi primary)
  'department-of-health-and-social-care',
  'medicines-and-healthcare-products-regulatory-agency',
  'national-institute-for-health-and-care-excellence',
  'care-quality-commission',
  'nhs-england',
  'uk-health-security-agency',

  // Treasury
  'hm-treasury',

  // Cross-cutting
  'cabinet-office',
  'department-for-science-innovation-and-technology',
  'department-for-business-and-trade',
  'competition-and-markets-authority',
  'national-audit-office',

  // Crown bodies
  'the-crown-estate',
] as const;

/** Document types to collect across all departments (Pass 2). */
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
 * Supports filtering by document type OR by organisation.
 */
async function fetchSearchPage(
  filters: { docType?: string; orgSlug?: string },
  start: number,
  count: number,
  timeoutMs = 20_000,
): Promise<SearchResponse | null> {
  const params = new URLSearchParams({
    order: '-public_timestamp',
    count: String(count),
    start: String(start),
    fields:
      'title,link,public_timestamp,description,content_store_document_type,organisations',
  });

  if (filters.docType) {
    params.set('filter_content_store_document_type', filters.docType);
  }
  if (filters.orgSlug) {
    params.set('filter_organisations', filters.orgSlug);
  }

  const label = filters.orgSlug || filters.docType || 'unknown';
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
      console.warn(`  [WARN] Search API returned ${resp.status} for ${label} (start=${start})`);
      return null;
    }

    return (await resp.json()) as SearchResponse;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('abort')) {
      console.warn(`  [WARN] Search API timed out for ${label} (start=${start})`);
    } else {
      console.warn(`  [WARN] Search API fetch failed for ${label} (start=${start}): ${message}`);
    }
    return null;
  }
}

/**
 * Process a page of search results into upsertable rows.
 */
function processSearchResults(
  results: SearchResult[],
  cutoffIso: string,
  sourceName: string,
): { rows: Array<Record<string, unknown>>; reachedCutoff: boolean } {
  const rows: Array<Record<string, unknown>> = [];
  let reachedCutoff = false;

  for (const result of results) {
    if (!result.link || !result.title) continue;

    const pubDate = result.public_timestamp
      ? new Date(result.public_timestamp).toISOString()
      : null;

    if (pubDate && pubDate < cutoffIso) {
      reachedCutoff = true;
      break;
    }

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
      source_name: sourceName,
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

  return { rows, reachedCutoff };
}

/**
 * Upsert rows in batches.
 */
async function upsertRows(rows: Array<Record<string, unknown>>): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    const { data, error } = await supabase
      .from('feed_items')
      .upsert(batch, { onConflict: 'fingerprint', ignoreDuplicates: true })
      .select('id');

    if (error) {
      console.warn(`    [ERR] Upsert failed: ${error.message}`);
      skipped += batch.length;
      continue;
    }

    const insertedCount = data?.length ?? 0;
    inserted += insertedCount;
    skipped += batch.length - insertedCount;
  }

  return { inserted, skipped };
}

// -- Pass 1: Organisation-based collector ------------------------------------

/**
 * Pull ALL publications from tracked organisations. No keyword filtering —
 * the scoring system decides relevance.
 */
export async function collectGovUKByOrg(): Promise<{ inserted: number; skipped: number }> {
  let totalInserted = 0;
  let totalSkipped = 0;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 365);
  const cutoffIso = cutoffDate.toISOString();

  console.log(`\n=== GOV.UK Search — Pass 1: By Organisation ===`);
  console.log(`Tracked organisations: ${TRACKED_ORGANISATIONS.length}`);
  console.log(`Cutoff date:           ${cutoffIso.slice(0, 10)} (365 days ago)\n`);

  for (const orgSlug of TRACKED_ORGANISATIONS) {
    let start = 0;
    let totalForOrg = 0;
    let insertedForOrg = 0;
    let skippedForOrg = 0;
    let done = false;

    while (!done) {
      const page = await fetchSearchPage({ orgSlug }, start, PAGE_SIZE);

      if (!page) {
        if (start === 0) break;
        start += PAGE_SIZE;
        await delay(REQUEST_DELAY_MS);
        continue;
      }

      if (start === 0) {
        totalForOrg = page.total;
      }

      if (page.results.length === 0) break;

      const orgLabel = GOVUK_TO_ENTITY[orgSlug]
        ? GOVUK_TO_ENTITY[orgSlug].join(',')
        : orgSlug;
      const { rows, reachedCutoff } = processSearchResults(
        page.results,
        cutoffIso,
        `GOV.UK - ${orgLabel}`,
      );

      const result = await upsertRows(rows);
      insertedForOrg += result.inserted;
      skippedForOrg += result.skipped;

      if (reachedCutoff) done = true;
      start += PAGE_SIZE;
      if (start >= totalForOrg) done = true;

      await delay(REQUEST_DELAY_MS);
    }

    console.log(`  ${orgSlug}: ${insertedForOrg} inserted, ${skippedForOrg} skipped`);
    totalInserted += insertedForOrg;
    totalSkipped += skippedForOrg;

    await delay(REQUEST_DELAY_MS);
  }

  console.log(`\nPass 1 complete: ${totalInserted} inserted, ${totalSkipped} skipped\n`);
  return { inserted: totalInserted, skipped: totalSkipped };
}

// -- Pass 2: Document-type-based collector (supplementary) -------------------

/**
 * Pull by document type across ALL organisations. Catches items from
 * organisations not in the tracked list.
 */
export async function collectGovUKSearch(): Promise<{ inserted: number; skipped: number }> {
  let totalInserted = 0;
  let totalSkipped = 0;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 365);
  const cutoffIso = cutoffDate.toISOString();

  console.log(`\n=== GOV.UK Search — Pass 2: By Document Type ===`);
  console.log(`Document types: ${DOCUMENT_TYPES.length}`);
  console.log(`Cutoff date:    ${cutoffIso.slice(0, 10)} (365 days ago)\n`);

  for (const docType of DOCUMENT_TYPES) {
    console.log(`[${docType}]`);

    let start = 0;
    let totalForType = 0;
    let insertedForType = 0;
    let skippedForType = 0;
    let done = false;

    while (!done) {
      const page = await fetchSearchPage({ docType }, start, PAGE_SIZE);

      if (!page) {
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

      const { rows, reachedCutoff } = processSearchResults(
        page.results,
        cutoffIso,
        `GOV.UK Search - ${docType}`,
      );

      const result = await upsertRows(rows);
      insertedForType += result.inserted;
      skippedForType += result.skipped;

      if (reachedCutoff) done = true;
      start += PAGE_SIZE;
      if (start >= totalForType) done = true;

      await delay(REQUEST_DELAY_MS);
    }

    console.log(`  Inserted: ${insertedForType}, Skipped: ${skippedForType}`);
    totalInserted += insertedForType;
    totalSkipped += skippedForType;

    await delay(REQUEST_DELAY_MS);
  }

  console.log(`\nPass 2 complete: ${totalInserted} inserted, ${totalSkipped} skipped\n`);
  return { inserted: totalInserted, skipped: totalSkipped };
}

// -- Combined collector -------------------------------------------------------

/**
 * Run both passes: org-based (broad) then document-type (supplementary).
 */
export async function collectAllGovUKSearch(): Promise<{ inserted: number; skipped: number }> {
  console.log(`\n${'='.repeat(60)}`);
  console.log('  GOV.UK Search API — Combined Collector');
  console.log(`${'='.repeat(60)}`);

  const orgResult = await collectGovUKByOrg();
  const docResult = await collectGovUKSearch();

  const total = {
    inserted: orgResult.inserted + docResult.inserted,
    skipped: orgResult.skipped + docResult.skipped,
  };

  console.log(`\n=== GOV.UK Search Combined Complete ===`);
  console.log(`Pass 1 (by org):      ${orgResult.inserted} inserted`);
  console.log(`Pass 2 (by doc type): ${docResult.inserted} inserted`);
  console.log(`Total inserted:       ${total.inserted}`);
  console.log(`Total skipped:        ${total.skipped}\n`);

  return total;
}
