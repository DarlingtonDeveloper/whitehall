/**
 * GOV.UK Atom Feed Collector
 *
 * Fetches publications from ALL major government departments and bodies
 * via their Atom feeds, parses entries, and upserts into Supabase.
 */

import { createClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import * as path from 'path';

import {
  enrichEntityIds as enrichEntityIdsCentral,
} from './entity-enrichment';
import { cleanTitle } from './clean-title';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY in .env.local',
  );
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ── Feed type definitions ────────────────────────────────────────────────

interface GovUKFeedConfig {
  /** GOV.UK organisation slug */
  slug: string;
  /** Human-readable label */
  label: string;
  /** Whitehall entity ID(s) this org maps to */
  entityIds: string[];
  /** Which Atom feeds to pull for this org */
  feedTypes: FeedType[];
}

type FeedType = 'org' | 'policy' | 'news';

interface ParsedEntry {
  title: string;
  url: string;
  published_at: string;
  body: string;
}

// ── GOV.UK slug to Whitehall entity mapping ──────────────────────────────

export const GOVUK_TO_ENTITY: Record<string, string[]> = {
  // Ministerial departments
  'department-for-energy-security-and-net-zero': ['desnz'],
  'department-of-health-and-social-care': ['dhsc'],
  'department-for-education': ['dfe'],
  'department-for-transport': ['dft'],
  'ministry-of-housing-communities-and-local-government': ['dluhc'],
  'department-for-environment-food-rural-affairs': ['defra'],
  'hm-treasury': ['treasury'],
  'home-office': ['home-office'],
  'ministry-of-defence': ['mod'],
  'ministry-of-justice': ['moj'],
  'foreign-commonwealth-development-office': ['fcdo'],
  'cabinet-office': ['co'],
  'department-for-business-and-trade': ['dbt'],
  'department-for-culture-media-and-sport': ['dcms'],
  'department-for-science-innovation-and-technology': ['dsit'],
  'department-for-work-pensions': ['dwp'],
  'northern-ireland-office': ['ni-office'],
  'office-of-the-secretary-of-state-for-scotland': ['scotland-office'],
  'office-of-the-secretary-of-state-for-wales': ['wales-office'],
  // Regulators and key bodies
  'ofgem': ['ofgem'],
  'ofwat': ['ofwat'],
  'ofcom': ['ofcom'],
  'environment-agency': ['environment-agency'],
  'hm-revenue-customs': ['hmrc'],
  'medicines-and-healthcare-products-regulatory-agency': ['mhra'],
  'national-institute-for-health-and-care-excellence': ['nice'],
  'care-quality-commission': ['cqc'],
  'competition-and-markets-authority': ['cma'],
  'planning-inspectorate': ['planning-inspectorate'],
  'nhs-england': ['nhs-improve'],
  'uk-health-security-agency': ['ukhsa'],
  'natural-england': ['natural-england'],
  'food-standards-agency': ['fsa'],
  'health-and-safety-executive': ['hse'],
};

// ── Feed configurations ──────────────────────────────────────────────────

export const GOVUK_FEEDS: GovUKFeedConfig[] = [
  // Ministerial departments — all three feed types
  {
    slug: 'department-for-energy-security-and-net-zero',
    label: 'DESNZ',
    entityIds: ['desnz'],
    feedTypes: ['org', 'policy', 'news'],
  },
  {
    slug: 'department-of-health-and-social-care',
    label: 'DHSC',
    entityIds: ['dhsc'],
    feedTypes: ['org', 'policy', 'news'],
  },
  {
    slug: 'department-for-education',
    label: 'DfE',
    entityIds: ['dfe'],
    feedTypes: ['org', 'policy', 'news'],
  },
  {
    slug: 'department-for-transport',
    label: 'DfT',
    entityIds: ['dft'],
    feedTypes: ['org', 'policy', 'news'],
  },
  {
    slug: 'ministry-of-housing-communities-and-local-government',
    label: 'DLUHC',
    entityIds: ['dluhc'],
    feedTypes: ['org', 'policy', 'news'],
  },
  {
    slug: 'department-for-environment-food-rural-affairs',
    label: 'Defra',
    entityIds: ['defra'],
    feedTypes: ['org', 'policy', 'news'],
  },
  {
    slug: 'hm-treasury',
    label: 'HM Treasury',
    entityIds: ['treasury'],
    feedTypes: ['org', 'policy', 'news'],
  },
  {
    slug: 'home-office',
    label: 'Home Office',
    entityIds: ['home-office'],
    feedTypes: ['org', 'policy', 'news'],
  },
  {
    slug: 'ministry-of-defence',
    label: 'MoD',
    entityIds: ['mod'],
    feedTypes: ['org', 'policy', 'news'],
  },
  {
    slug: 'ministry-of-justice',
    label: 'MoJ',
    entityIds: ['moj'],
    feedTypes: ['org', 'policy', 'news'],
  },
  {
    slug: 'foreign-commonwealth-development-office',
    label: 'FCDO',
    entityIds: ['fcdo'],
    feedTypes: ['org', 'policy', 'news'],
  },
  {
    slug: 'cabinet-office',
    label: 'Cabinet Office',
    entityIds: ['co'],
    feedTypes: ['org', 'policy', 'news'],
  },
  {
    slug: 'department-for-business-and-trade',
    label: 'DBT',
    entityIds: ['dbt'],
    feedTypes: ['org', 'policy', 'news'],
  },
  {
    slug: 'department-for-culture-media-and-sport',
    label: 'DCMS',
    entityIds: ['dcms'],
    feedTypes: ['org', 'policy', 'news'],
  },
  {
    slug: 'department-for-science-innovation-and-technology',
    label: 'DSIT',
    entityIds: ['dsit'],
    feedTypes: ['org', 'policy', 'news'],
  },
  {
    slug: 'department-for-work-pensions',
    label: 'DWP',
    entityIds: ['dwp'],
    feedTypes: ['org', 'policy', 'news'],
  },
  {
    slug: 'northern-ireland-office',
    label: 'NIO',
    entityIds: ['ni-office'],
    feedTypes: ['org', 'news'],
  },
  {
    slug: 'office-of-the-secretary-of-state-for-scotland',
    label: 'Scotland Office',
    entityIds: ['scotland-office'],
    feedTypes: ['org', 'news'],
  },
  {
    slug: 'office-of-the-secretary-of-state-for-wales',
    label: 'Wales Office',
    entityIds: ['wales-office'],
    feedTypes: ['org', 'news'],
  },
  // Regulators and key bodies — org feed only
  {
    slug: 'ofgem',
    label: 'Ofgem',
    entityIds: ['ofgem'],
    feedTypes: ['org'],
  },
  {
    slug: 'ofwat',
    label: 'Ofwat',
    entityIds: ['ofwat'],
    feedTypes: ['org'],
  },
  {
    slug: 'ofcom',
    label: 'Ofcom',
    entityIds: ['ofcom'],
    feedTypes: ['org'],
  },
  {
    slug: 'environment-agency',
    label: 'Environment Agency',
    entityIds: ['environment-agency'],
    feedTypes: ['org'],
  },
  {
    slug: 'hm-revenue-customs',
    label: 'HMRC',
    entityIds: ['hmrc'],
    feedTypes: ['org'],
  },
  {
    slug: 'medicines-and-healthcare-products-regulatory-agency',
    label: 'MHRA',
    entityIds: ['mhra'],
    feedTypes: ['org'],
  },
  {
    slug: 'national-institute-for-health-and-care-excellence',
    label: 'NICE',
    entityIds: ['nice'],
    feedTypes: ['org'],
  },
  {
    slug: 'care-quality-commission',
    label: 'CQC',
    entityIds: ['cqc'],
    feedTypes: ['org'],
  },
  {
    slug: 'competition-and-markets-authority',
    label: 'CMA',
    entityIds: ['cma'],
    feedTypes: ['org'],
  },
  {
    slug: 'planning-inspectorate',
    label: 'Planning Inspectorate',
    entityIds: ['planning-inspectorate'],
    feedTypes: ['org'],
  },
  {
    slug: 'nhs-england',
    label: 'NHS England',
    entityIds: ['nhs-improve'],
    feedTypes: ['org'],
  },
  {
    slug: 'uk-health-security-agency',
    label: 'UKHSA',
    entityIds: ['ukhsa'],
    feedTypes: ['org'],
  },
  {
    slug: 'natural-england',
    label: 'Natural England',
    entityIds: ['natural-england'],
    feedTypes: ['org'],
  },
  {
    slug: 'food-standards-agency',
    label: 'Food Standards Agency',
    entityIds: ['fsa'],
    feedTypes: ['org'],
  },
  {
    slug: 'health-and-safety-executive',
    label: 'HSE',
    entityIds: ['hse'],
    feedTypes: ['org'],
  },
];

// ── URL builders ─────────────────────────────────────────────────────────

function buildFeedUrl(slug: string, type: FeedType): string {
  switch (type) {
    case 'org':
      return `https://www.gov.uk/government/organisations/${slug}.atom`;
    case 'policy':
      return `https://www.gov.uk/search/policy-papers-and-consultations.atom?organisations[]=${slug}`;
    case 'news':
      return `https://www.gov.uk/search/news-and-communications.atom?organisations[]=${slug}`;
  }
}

// ── Fingerprint helper ───────────────────────────────────────────────────

export function makeFingerprint(url: string, title: string): string {
  return crypto
    .createHash('sha256')
    .update(`${url}||${title}`)
    .digest('hex');
}

// ── RAG status from keywords ─────────────────────────────────────────────

export function determineRagStatus(title: string, body: string): 'RED' | 'AMBER' | 'GREEN' {
  const text = `${title} ${body}`.toLowerCase();

  // RED triggers
  if (
    /\burgent\b/.test(text) ||
    /\bemergency\b/.test(text) ||
    /\bimmediate\s+action\b/.test(text) ||
    /\bsafety\s+alert\b/.test(text) ||
    /\brecall\b/.test(text) ||
    /\benforcement\s+action\b/.test(text)
  ) {
    return 'RED';
  }

  // AMBER triggers
  if (
    /\bconsultation\b/.test(text) ||
    /\bcall\s+for\s+evidence\b/.test(text) ||
    /\bproposed\s+changes?\b/.test(text) ||
    /\bdraft\b/.test(text) ||
    /\breview\b/.test(text) ||
    /\bdelayed?\b/.test(text) ||
    /\bwarning\b/.test(text)
  ) {
    return 'AMBER';
  }

  return 'GREEN';
}

// ── Keyword-based entity enrichment ──────────────────────────────────────

export function enrichEntityIds(
  baseEntityIds: string[],
  title: string,
  body: string,
): string[] {
  return enrichEntityIdsCentral(baseEntityIds, title, body);
}

// ── Atom XML parser (regex-based, no external deps) ──────────────────────

function parseAtomEntries(xml: string): ParsedEntry[] {
  const entries: ParsedEntry[] = [];

  // Split on <entry> tags
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match: RegExpExecArray | null;

  while ((match = entryRegex.exec(xml)) !== null) {
    const block = match[1];

    // Title
    const titleMatch = block.match(/<title[^>]*>([\s\S]*?)<\/title>/);
    const title = titleMatch
      ? decodeXmlEntities(titleMatch[1].trim())
      : 'Untitled';

    // Link — prefer rel="alternate", fall back to first href
    const linkAltMatch = block.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/);
    const linkMatch = linkAltMatch || block.match(/<link[^>]*href="([^"]+)"/);
    const url = linkMatch ? linkMatch[1] : '';

    // Date — try <updated>, then <published>
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

// ── Fetch a single feed with timeout and error handling ──────────────────

async function fetchFeed(url: string, timeoutMs = 15_000): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Whitehall-Monitor/1.0 (government-feed-collector)',
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

// ── Delay helper ─────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Main collector ───────────────────────────────────────────────────────

export async function collectGovUK(): Promise<{ inserted: number; skipped: number }> {
  let totalInserted = 0;
  let totalSkipped = 0;

  console.log(`\n=== GOV.UK Feed Collector ===`);
  console.log(`Configured feeds: ${GOVUK_FEEDS.length} organisations\n`);

  for (const feed of GOVUK_FEEDS) {
    console.log(`[${feed.label}] (${feed.slug})`);

    for (const feedType of feed.feedTypes) {
      const url = buildFeedUrl(feed.slug, feedType);
      const typeLabel =
        feedType === 'org'
          ? 'organisation'
          : feedType === 'policy'
            ? 'policy papers'
            : 'news & comms';

      const xml = await fetchFeed(url);

      if (!xml) {
        console.log(`  ${typeLabel}: skipped (fetch failed)`);
        await delay(300);
        continue;
      }

      const entries = parseAtomEntries(xml);
      if (entries.length === 0) {
        console.log(`  ${typeLabel}: 0 entries`);
        await delay(300);
        continue;
      }

      // Build feed items
      const rows = entries.map((entry) => {
        const entityIds = enrichEntityIds(feed.entityIds, entry.title, entry.body);
        const ragStatus = determineRagStatus(entry.title, entry.body);
        const fingerprint = makeFingerprint(entry.url, entry.title);

        return {
          source_type: 'govuk' as const,
          source_name: `GOV.UK - ${feed.label}`,
          title: cleanTitle(entry.title),
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
      let feedInserted = 0;
      let feedSkipped = 0;
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

      console.log(`  ${typeLabel}: ${entries.length} parsed, ${feedInserted} inserted, ${feedSkipped} skipped`);
      totalInserted += feedInserted;
      totalSkipped += feedSkipped;

      // Be polite — 300ms between requests
      await delay(300);
    }
  }

  console.log(`\n=== GOV.UK Collection Complete ===`);
  console.log(`Total inserted: ${totalInserted}`);
  console.log(`Total skipped:  ${totalSkipped}\n`);

  return { inserted: totalInserted, skipped: totalSkipped };
}
