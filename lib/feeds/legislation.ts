/**
 * Legislation.gov.uk Atom Feed Collector
 *
 * Fetches new and updated legislation from legislation.gov.uk Atom feeds,
 * covering UK Acts, Statutory Instruments, Draft SIs, Impact Assessments,
 * and devolved legislation (Wales, Scotland, Northern Ireland).
 *
 * Paginates through each feed until entries are older than 12 months or
 * no more entries are found.
 */

import { createClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import * as path from 'path';

import {
  enrichEntityIds as enrichEntityIdsCentral,
} from './entity-enrichment';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY in .env.local',
  );
}

const supabase = createClient(supabaseUrl, supabaseKey);

// -- Feed type definitions --------------------------------------------------

interface LegislationFeedConfig {
  /** Base URL of the Atom feed (without pagination) */
  url: string;
  /** Human-readable label for source_name */
  label: string;
}

interface ParsedEntry {
  title: string;
  url: string;
  published_at: string;
  body: string;
}

// -- Feed configurations ----------------------------------------------------

export const LEGISLATION_FEEDS: LegislationFeedConfig[] = [
  {
    url: 'https://www.legislation.gov.uk/new/data.feed',
    label: 'Legislation - New Legislation',
  },
  {
    url: 'https://www.legislation.gov.uk/ukpga/data.feed',
    label: 'Legislation - UK Acts',
  },
  {
    url: 'https://www.legislation.gov.uk/uksi/data.feed',
    label: 'Legislation - Statutory Instruments',
  },
  {
    url: 'https://www.legislation.gov.uk/ukdsi/data.feed',
    label: 'Legislation - Draft Statutory Instruments',
  },
  {
    url: 'https://www.legislation.gov.uk/ukia/data.feed',
    label: 'Legislation - Impact Assessments',
  },
  {
    url: 'https://www.legislation.gov.uk/wsi/data.feed',
    label: 'Legislation - Wales Statutory Instruments',
  },
  {
    url: 'https://www.legislation.gov.uk/asp/data.feed',
    label: 'Legislation - Scotland Acts',
  },
  {
    url: 'https://www.legislation.gov.uk/ssi/data.feed',
    label: 'Legislation - Scotland Statutory Instruments',
  },
  {
    url: 'https://www.legislation.gov.uk/nisr/data.feed',
    label: 'Legislation - NI Statutory Rules',
  },
];

// -- Keyword-to-entity mapping for legislation tagging ----------------------

const KEYWORD_ENTITY_MAP: [RegExp, string][] = [
  [/\bDESNZ\b|energy security|net zero|clean power|offshore wind|onshore wind|electricity|gas/i, 'desnz'],
  [/\bDHSC\b|health and social care|NHS workforce|public health|medicines|pharmacy/i, 'dhsc'],
  [/\bDfE\b|department for education|schools|curriculum|higher education|student/i, 'dfe'],
  [/\bDfT\b|department for transport|railways|roads|aviation|shipping|motor vehicle/i, 'dft'],
  [/\bDLUHC\b|housing|planning|local government|levelling up|building safety|tenants/i, 'dluhc'],
  [/\bDefra\b|environment|biodiversity|water quality|farming|agriculture|fisheries|waste/i, 'defra'],
  [/\bHM Treasury\b|treasury|fiscal|finance act|taxation/i, 'treasury'],
  [/\bHome Office\b|immigration|policing|borders|asylum|extradition|firearms/i, 'home-office'],
  [/\bMoD\b|ministry of defence|armed forces|military|defence/i, 'mod'],
  [/\bMoJ\b|ministry of justice|prisons|courts|sentencing|criminal justice|legal aid/i, 'moj'],
  [/\bFCDO\b|foreign.{0,10}commonwealth|overseas development|sanctions|diplomatic/i, 'fcdo'],
  [/\bCabinet Office\b|civil service/i, 'co'],
  [/\bDBT\b|business and trade|trade policy|export|import duties|tariff/i, 'dbt'],
  [/\bDCMS\b|culture.{0,10}media|sport|creative industries|broadcasting|gambling/i, 'dcms'],
  [/\bDSIT\b|science.{0,10}innovation|technology policy|artificial intelligence/i, 'dsit'],
  [/\bDWP\b|work and pensions|universal credit|state pension|social security|employment support/i, 'dwp'],
  [/\bOfgem\b|energy regulation|price cap|RIIO/i, 'ofgem'],
  [/\bOfwat\b|water regulation/i, 'ofwat'],
  [/\bOfcom\b|telecoms regulation|broadband|spectrum|communications act/i, 'ofcom'],
  [/\bEnvironment Agency\b|flood risk|pollution incident/i, 'environment-agency'],
  [/\bHMRC\b|tax.{0,10}(policy|reform|revenue)|customs|VAT|income tax/i, 'hmrc'],
  [/\bMHRA\b|medicines regulation|drug approval/i, 'mhra'],
  [/\bCQC\b|care quality|inspection regime/i, 'cqc'],
  [/\bCMA\b|competition.{0,10}markets|merger (inquiry|review)/i, 'cma'],
  [/\bHSE\b|health and safety executive|workplace safety/i, 'hse'],
  [/\bNHS\b/i, 'dhsc'],
  [/\bnuclear\b|Sizewell|Hinkley/i, 'desnz'],
  [/\bhydrogen\b/i, 'desnz'],
  [/\bCCUS\b|carbon capture/i, 'desnz'],
];

// -- Fingerprint helper -----------------------------------------------------

export function makeFingerprint(url: string, title: string): string {
  return crypto
    .createHash('sha256')
    .update(`${url}||${title}`)
    .digest('hex');
}

// -- RAG status for legislation ---------------------------------------------

/**
 * Most legislation defaults to AMBER (new regulation / proposed changes).
 * RED for urgent/enforcement keywords. GREEN for minor or routine items.
 */
export function determineLegislationRagStatus(
  title: string,
  body: string,
): 'RED' | 'AMBER' | 'GREEN' {
  const text = `${title} ${body}`.toLowerCase();

  // RED triggers - urgent enforcement or safety
  if (
    /\burgent\b/.test(text) ||
    /\bemergency\b/.test(text) ||
    /\bimmediate\s+action\b/.test(text) ||
    /\benforcement\b/.test(text) ||
    /\bprohibition\b/.test(text) ||
    /\bsafety\s+alert\b/.test(text) ||
    /\brecall\b/.test(text) ||
    /\bpenalt(y|ies)\b/.test(text) ||
    /\bbreach\b/.test(text) ||
    /\bsanctions?\b/.test(text)
  ) {
    return 'RED';
  }

  // GREEN - routine corrections, commencement orders, minor amendments
  if (
    /\bcorrection\s+slip\b/.test(text) ||
    /\bcommencement\s+(order|regulations?)\b/.test(text) ||
    /\btransitional\s+provisions?\b/.test(text)
  ) {
    return 'GREEN';
  }

  // Default: AMBER — new regulation warrants attention
  return 'AMBER';
}

// -- Entity enrichment — delegates to centralised entity-enrichment.ts ------

export function enrichEntityIds(
  baseEntityIds: string[],
  title: string,
  body: string,
): string[] {
  return enrichEntityIdsCentral(baseEntityIds, title, body);
}

// -- Atom XML parser (regex-based, no external deps) ------------------------

function parseAtomEntries(xml: string): ParsedEntry[] {
  const entries: ParsedEntry[] = [];

  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match: RegExpExecArray | null;

  while ((match = entryRegex.exec(xml)) !== null) {
    const block = match[1];

    // Title
    const titleMatch = block.match(/<title[^>]*>([\s\S]*?)<\/title>/);
    const title = titleMatch
      ? decodeXmlEntities(titleMatch[1].trim())
      : 'Untitled';

    // Link - prefer rel="alternate", fall back to first href
    const linkAltMatch = block.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/);
    const linkMatch = linkAltMatch || block.match(/<link[^>]*href="([^"]+)"/);
    const url = linkMatch ? linkMatch[1] : '';

    // Date - try <updated>, then <published>
    const updatedMatch = block.match(/<updated>([\s\S]*?)<\/updated>/);
    const publishedMatch = block.match(/<published>([\s\S]*?)<\/published>/);
    const dateStr = (updatedMatch || publishedMatch)?.[1]?.trim() || '';
    const published_at = dateStr ? new Date(dateStr).toISOString() : new Date().toISOString();

    // Summary or content
    const summaryMatch = block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/);
    const contentMatch = block.match(/<content[^>]*>([\s\S]*?)<\/content>/);
    const rawBody = (summaryMatch || contentMatch)?.[1]?.trim() || '';
    const body = stripHtml(decodeXmlEntities(rawBody)).slice(0, 2000);

    if (url) {
      entries.push({ title, url, published_at, body });
    }
  }

  return entries;
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function stripHtml(str: string): string {
  return str.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

// -- Fetch a single feed with timeout and error handling --------------------

async function fetchFeed(url: string, timeoutMs = 15_000): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Whitehall-Monitor/1.0 (legislation-feed-collector)',
        Accept: 'application/atom+xml, application/xml, text/xml',
      },
    });

    clearTimeout(timer);

    if (!resp.ok) {
      console.warn(`  [WARN] ${url} returned ${resp.status}`);
      return null;
    }

    return await resp.text();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('abort')) {
      console.warn(`  [WARN] ${url} timed out after ${timeoutMs}ms`);
    } else {
      console.warn(`  [WARN] ${url} fetch failed: ${message}`);
    }
    return null;
  }
}

// -- Delay helper -----------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// -- Check whether all entries in a page are older than the cutoff ----------

function hasEntriesOlderThan(entries: ParsedEntry[], cutoffDate: Date): boolean {
  return entries.every((e) => new Date(e.published_at) < cutoffDate);
}

// -- Main collector ---------------------------------------------------------

/** Safety cap: some feeds (e.g. Scotland Acts) have 50k+ entries with
 *  recent <updated> dates. 200 pages = 4,000 items is more than enough
 *  for a 12-month window. */
const MAX_PAGES = 200;

export async function collectLegislation(): Promise<{ inserted: number; skipped: number }> {
  let totalInserted = 0;
  let totalSkipped = 0;

  // 12-month cutoff
  const cutoffDate = new Date();
  cutoffDate.setMonth(cutoffDate.getMonth() - 12);

  console.log(`\n=== Legislation.gov.uk Feed Collector ===`);
  console.log(`Configured feeds: ${LEGISLATION_FEEDS.length}`);
  console.log(`Cutoff date: ${cutoffDate.toISOString().slice(0, 10)}\n`);

  for (const feed of LEGISLATION_FEEDS) {
    console.log(`[${feed.label}]`);

    let page = 1;
    let feedInserted = 0;
    let feedSkipped = 0;
    let feedParsed = 0;

    // Paginate until no entries or all entries older than 12 months
    while (true) {
      const paginatedUrl = page === 1
        ? feed.url
        : `${feed.url}?page=${page}`;

      const xml = await fetchFeed(paginatedUrl);

      if (!xml) {
        console.log(`  page ${page}: skipped (fetch failed)`);
        break;
      }

      const entries = parseAtomEntries(xml);

      if (entries.length === 0) {
        console.log(`  page ${page}: 0 entries (end of feed)`);
        break;
      }

      // Filter out entries older than cutoff
      const recentEntries = entries.filter(
        (e) => new Date(e.published_at) >= cutoffDate,
      );

      if (recentEntries.length === 0) {
        console.log(`  page ${page}: ${entries.length} entries all older than cutoff, stopping`);
        break;
      }

      feedParsed += recentEntries.length;

      // Build rows for upsert
      const rows = recentEntries.map((entry) => {
        const entityIds = enrichEntityIds([], entry.title, entry.body);
        const ragStatus = determineLegislationRagStatus(entry.title, entry.body);
        const fingerprint = makeFingerprint(entry.url, entry.title);

        return {
          source_type: 'legislation' as const,
          source_name: feed.label,
          title: entry.title,
          url: entry.url,
          published_at: entry.published_at,
          body: entry.body || null,
          entity_ids: entityIds,
          rag_status: ragStatus.toLowerCase(),
          relevance_score: 0.3,
          fingerprint,
          is_forward_scan: false,
        };
      });

      // Upsert in batches of 25
      const batchSize = 25;

      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);

        const { data, error } = await supabase
          .from('feed_items')
          .upsert(batch, { onConflict: 'fingerprint', ignoreDuplicates: true })
          .select('id');

        if (error) {
          console.warn(`    [ERR] Upsert failed: ${error.message}`);
          feedSkipped += batch.length;
          continue;
        }

        const insertedCount = data?.length ?? 0;
        feedInserted += insertedCount;
        feedSkipped += batch.length - insertedCount;
      }

      console.log(`  page ${page}: ${entries.length} parsed, ${recentEntries.length} recent`);

      // If the entire page had entries older than the cutoff, stop
      if (hasEntriesOlderThan(entries, cutoffDate)) {
        break;
      }

      page++;

      // Safety cap to prevent runaway pagination on feeds with
      // constantly-refreshed <updated> dates
      if (page > MAX_PAGES) {
        console.log(`  reached ${MAX_PAGES} page cap, stopping`);
        break;
      }

      // 500ms delay between requests - be polite to legislation.gov.uk
      await delay(500);
    }

    console.log(`  total: ${feedParsed} parsed, ${feedInserted} inserted, ${feedSkipped} skipped`);
    totalInserted += feedInserted;
    totalSkipped += feedSkipped;

    // 500ms delay between feeds
    await delay(500);
  }

  console.log(`\n=== Legislation Collection Complete ===`);
  console.log(`Total inserted: ${totalInserted}`);
  console.log(`Total skipped:  ${totalSkipped}\n`);

  return { inserted: totalInserted, skipped: totalSkipped };
}
