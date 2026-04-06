/**
 * Direct Source Scraper
 *
 * Checks publication and news pages from priority government bodies,
 * regulators, and industry organisations by scraping their websites.
 *
 * Items are upserted with source_type = 'stakeholder'.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

import {
  enrichEntityIds,
  determineRagStatus,
  makeFingerprint,
  stripHtml,
} from './entity-enrichment';
import { cleanTitle, improveStakeholderTitle } from './clean-title';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY in .env.local',
  );
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ── Source definitions ────────────────────────────────────────────────────

interface DirectSourceConfig {
  name: string;
  url: string;
  /** Default entity IDs for items from this source */
  defaultEntityIds: string[];
  /** Max items to collect per run (newest first) */
  maxItems: number;
  sector: 'energy' | 'health' | 'general';
}

export const DIRECT_SOURCES: DirectSourceConfig[] = [
  // ── Energy: Government & Regulatory ────────────────────────────────────
  { name: 'Ofgem Publications', url: 'https://www.ofgem.gov.uk/publications', defaultEntityIds: ['ofgem'], maxItems: 50, sector: 'energy' },
  { name: 'NESO News', url: 'https://www.neso.energy/news-and-events', defaultEntityIds: ['neso'], maxItems: 30, sector: 'energy' },
  { name: 'Crown Estate', url: 'https://www.thecrownestate.co.uk/news', defaultEntityIds: ['crown-estate'], maxItems: 50, sector: 'energy' },
  { name: 'Great British Energy', url: 'https://www.gbe.gov.uk/news-and-publications', defaultEntityIds: ['gbe'], maxItems: 30, sector: 'energy' },
  { name: 'North Sea Transition Authority', url: 'https://www.nstauthority.co.uk/news-publications/news/', defaultEntityIds: ['nsta'], maxItems: 30, sector: 'energy' },
  { name: 'RenewableUK', url: 'https://www.renewableuk.com/news-and-resources/press-releases/', defaultEntityIds: [], maxItems: 30, sector: 'energy' },
  { name: 'Energy UK', url: 'https://www.energy-uk.org.uk/news/', defaultEntityIds: [], maxItems: 20, sector: 'energy' },
  { name: 'OEUK', url: 'https://oeuk.org.uk/category/news/', defaultEntityIds: [], maxItems: 30, sector: 'energy' },
  { name: 'ORE Catapult', url: 'https://ore.catapult.org.uk/media-centre/press-releases/', defaultEntityIds: [], maxItems: 20, sector: 'energy' },
  { name: 'Climate Change Committee', url: 'https://www.theccc.org.uk/news-stories/', defaultEntityIds: ['ccc'], maxItems: 30, sector: 'energy' },

  // ── Health: Regulatory & NHS ───────────────────────────────────────────
  { name: 'MHRA', url: 'https://www.gov.uk/government/organisations/medicines-and-healthcare-products-regulatory-agency', defaultEntityIds: ['mhra'], maxItems: 30, sector: 'health' },
  { name: 'NICE', url: 'https://www.nice.org.uk/news', defaultEntityIds: ['nice'], maxItems: 30, sector: 'health' },
  { name: 'CQC', url: 'https://www.cqc.org.uk/news', defaultEntityIds: ['cqc'], maxItems: 20, sector: 'health' },
  { name: 'NHS England News', url: 'https://www.england.nhs.uk/news/', defaultEntityIds: ['nhs-improve'], maxItems: 20, sector: 'health' },
  { name: 'UKHSA', url: 'https://www.gov.uk/government/organisations/uk-health-security-agency', defaultEntityIds: ['ukhsa'], maxItems: 20, sector: 'health' },

  // ── General: Oversight & audit ─────────────────────────────────────────
  { name: 'National Audit Office', url: 'https://www.nao.org.uk/reports/', defaultEntityIds: ['nao'], maxItems: 30, sector: 'general' },
  { name: 'CMA Publications', url: 'https://www.gov.uk/government/organisations/competition-and-markets-authority', defaultEntityIds: ['cma'], maxItems: 20, sector: 'general' },
  { name: 'Planning Inspectorate', url: 'https://www.gov.uk/government/organisations/planning-inspectorate', defaultEntityIds: ['planning-inspectorate'], maxItems: 30, sector: 'energy' },
];

// ── Scraping helpers ──────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractOrigin(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}`;
  } catch {
    return '';
  }
}

/**
 * Lightweight link extraction from HTML — pulls all <a> tags with href
 * and text longer than minTitleLength characters.  Also captures ~300 chars
 * of surrounding HTML context for date extraction.
 */
function extractLinks(html: string): Array<{ title: string; href: string; context: string }> {
  const links: Array<{ title: string; href: string; context: string }> = [];
  const regex = /<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) !== null) {
    const href = match[1];
    const title = stripHtml(match[2]).trim();
    if (title.length >= 20 && href) {
      // Grab surrounding HTML for date hints (300 chars before + after the <a>)
      const start = Math.max(0, match.index - 300);
      const end = Math.min(html.length, match.index + match[0].length + 300);
      const context = stripHtml(html.slice(start, end));
      links.push({ title, href, context });
    }
  }

  return links;
}

// ── Date extraction ─────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Attempt to extract a publication date from surrounding text context.
 * Tries multiple common date formats. Returns ISO string or null.
 */
function extractDateFromContext(context: string): string | null {
  // "26 March 2026", "1 Jan 2025", "26th March 2026"
  const dmy = context.match(
    /(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})/i,
  );
  if (dmy) {
    const d = parseInt(dmy[1], 10);
    const m = MONTHS[dmy[2].toLowerCase()];
    const y = parseInt(dmy[3], 10);
    if (m !== undefined && y >= 2020 && y <= 2030) {
      return new Date(y, m, d, 12, 0, 0).toISOString();
    }
  }

  // "March 26, 2026", "Jan 1, 2025"
  const mdy = context.match(
    /(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i,
  );
  if (mdy) {
    const m = MONTHS[mdy[1].toLowerCase()];
    const d = parseInt(mdy[2], 10);
    const y = parseInt(mdy[3], 10);
    if (m !== undefined && y >= 2020 && y <= 2030) {
      return new Date(y, m, d, 12, 0, 0).toISOString();
    }
  }

  // ISO-ish: "2026-03-26", "2025-01-15"
  const iso = context.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const y = parseInt(iso[1], 10);
    const m = parseInt(iso[2], 10) - 1;
    const d = parseInt(iso[3], 10);
    if (y >= 2020 && y <= 2030) {
      return new Date(y, m, d, 12, 0, 0).toISOString();
    }
  }

  // "26/03/2026" or "26.03.2026" (DD/MM/YYYY — UK format)
  const ukDate = context.match(/(\d{1,2})[/.](\d{1,2})[/.](\d{4})/);
  if (ukDate) {
    const d = parseInt(ukDate[1], 10);
    const m = parseInt(ukDate[2], 10) - 1;
    const y = parseInt(ukDate[3], 10);
    if (y >= 2020 && y <= 2030 && m >= 0 && m <= 11 && d >= 1 && d <= 31) {
      return new Date(y, m, d, 12, 0, 0).toISOString();
    }
  }

  return null;
}

// ── Main collector ────────────────────────────────────────────────────────

const BATCH_SIZE = 25;

export async function collectDirectSources(): Promise<{ inserted: number; skipped: number }> {
  let totalInserted = 0;
  let totalSkipped = 0;

  console.log(`\n=== Direct Source Scraper ===`);
  console.log(`Sources configured: ${DIRECT_SOURCES.length}\n`);

  for (const source of DIRECT_SOURCES) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);

      const resp = await fetch(source.url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Whitehall-Monitor/1.0 (direct-source-scraper)',
          Accept: 'text/html',
        },
      });

      clearTimeout(timer);

      if (!resp.ok) {
        console.warn(`  [WARN] ${source.name}: HTTP ${resp.status}`);
        continue;
      }

      const html = await resp.text();
      const links = extractLinks(html);

      const rows: Array<Record<string, unknown>> = [];
      const origin = extractOrigin(source.url);

      // No keyword filtering — collect all links, capped by maxItems.
      // These are curated publication pages; let the scorer decide relevance.
      let collected = 0;

      for (const link of links) {
        if (collected >= source.maxItems) break;

        // Resolve relative URLs
        let fullUrl = link.href;
        if (fullUrl.startsWith('/')) {
          fullUrl = `${origin}${fullUrl}`;
        } else if (!fullUrl.startsWith('http')) {
          continue;
        }

        const cleaned = cleanTitle(link.title);
        const improved = improveStakeholderTitle(cleaned, source.name, null);
        const entityIds = enrichEntityIds(source.defaultEntityIds, improved, '');
        const ragStatus = determineRagStatus(improved, '');
        const fingerprint = makeFingerprint(fullUrl, cleaned);
        const publishedAt = extractDateFromContext(link.context) ?? new Date().toISOString();

        rows.push({
          source_type: 'stakeholder',
          source_name: source.name,
          title: improved,
          url: fullUrl,
          published_at: publishedAt,
          body: null,
          entity_ids: entityIds,
          rag_status: ragStatus.toLowerCase(),
          relevance_score: 0.2,
          fingerprint,
          is_forward_scan: false,
        });

        collected++;
      }

      // Deduplicate by fingerprint (same link can appear multiple times on a page)
      const seen = new Set<string>();
      const dedupedRows = rows.filter((r) => {
        const fp = r.fingerprint as string;
        if (seen.has(fp)) return false;
        seen.add(fp);
        return true;
      });

      // Upsert
      let inserted = 0;
      let skipped = 0;

      for (let i = 0; i < dedupedRows.length; i += BATCH_SIZE) {
        const batch = dedupedRows.slice(i, i + BATCH_SIZE);
        const { data, error } = await supabase
          .from('feed_items')
          .upsert(batch, { onConflict: 'fingerprint', ignoreDuplicates: false })
          .select('id');

        if (error) {
          console.warn(`    [ERR] ${source.name} upsert failed: ${error.message}`);
          skipped += batch.length;
          continue;
        }

        inserted += data?.length ?? 0;
        skipped += batch.length - (data?.length ?? 0);
      }

      console.log(`  ${source.name}: ${links.length} links found, ${dedupedRows.length} collected (max ${source.maxItems}), ${inserted} inserted`);
      totalInserted += inserted;
      totalSkipped += skipped;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`  [WARN] ${source.name}: ${message}`);
    }

    await delay(400);
  }

  console.log(`\n=== Direct Source Collection Complete ===`);
  console.log(`Total inserted: ${totalInserted}`);
  console.log(`Total skipped:  ${totalSkipped}\n`);

  return { inserted: totalInserted, skipped: totalSkipped };
}
