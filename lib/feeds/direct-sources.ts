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
 * and text longer than minTitleLength characters.
 */
function extractLinks(html: string): Array<{ title: string; href: string }> {
  const links: Array<{ title: string; href: string }> = [];
  const regex = /<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) !== null) {
    const href = match[1];
    const title = stripHtml(match[2]).trim();
    if (title.length >= 20 && href) {
      links.push({ title, href });
    }
  }

  return links;
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

        const entityIds = enrichEntityIds(source.defaultEntityIds, link.title, '');
        const ragStatus = determineRagStatus(link.title, '');
        const fingerprint = makeFingerprint(fullUrl, link.title);

        rows.push({
          source_type: 'stakeholder',
          source_name: source.name,
          title: link.title,
          url: fullUrl,
          published_at: new Date().toISOString(),
          body: null,
          entity_ids: entityIds,
          rag_status: ragStatus.toLowerCase(),
          relevance_score: 0.2,
          fingerprint,
          is_forward_scan: false,
        });

        collected++;
      }

      // Upsert
      let inserted = 0;
      let skipped = 0;

      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const { data, error } = await supabase
          .from('feed_items')
          .upsert(batch, { onConflict: 'fingerprint', ignoreDuplicates: true })
          .select('id');

        if (error) {
          console.warn(`    [ERR] ${source.name} upsert failed: ${error.message}`);
          skipped += batch.length;
          continue;
        }

        inserted += data?.length ?? 0;
        skipped += batch.length - (data?.length ?? 0);
      }

      console.log(`  ${source.name}: ${links.length} links found, ${rows.length} collected (max ${source.maxItems}), ${inserted} inserted`);
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
