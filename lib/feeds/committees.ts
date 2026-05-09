/**
 * Select Committee Web Scraper
 *
 * Scrapes publication/inquiry pages from key parliamentary select committees
 * across multiple policy areas. Items are upserted with source_type = 'committee'.
 *
 * Supplements the structured Parliament APIs (parliament.ts) which cover
 * Bills, Written Questions, Divisions, and Statements but miss committee
 * inquiry pages, evidence sessions, and publications listed only on the
 * committee websites.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

import {
  enrichEntityIds,
  determineRagStatus,
  makeFingerprint,
  stripHtml,
  extractTopicTags,
} from './entity-enrichment';
import { cleanTitle } from './clean-title';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY in .env.local',
  );
}

const supabaseReadonly = createClient(supabaseUrl, supabaseKey);
// Use service role for all writes (RLS blocks anon inserts)
const supabase = serviceKey ? createClient(supabaseUrl, serviceKey) : supabaseReadonly;

// ── Committee definitions ─────────────────────────────────────────────────

interface CommitteeConfig {
  name: string;
  /** Committee page URL on committees.parliament.uk */
  url: string;
  /** Keywords to match in link text — items must contain at least one */
  keywords: string[];
  /** Default entity IDs to assign */
  defaultEntityIds: string[];
  sector: 'energy' | 'health' | 'general' | 'finance';
}

export const COMMITTEES: CommitteeConfig[] = [
  // ── Energy-related committees ──────────────────────────────────────────
  {
    name: 'Energy Security and Net Zero Committee',
    url: 'https://committees.parliament.uk/committee/664/energy-security-and-net-zero-committee/',
    keywords: ['energy', 'wind', 'offshore', 'power', 'grid', 'net zero',
      'resilience', 'hydrogen', 'nuclear', 'CfD', 'REMA'],
    defaultEntityIds: ['desnz'],
    sector: 'energy',
  },
  {
    name: 'Environmental Audit Committee',
    url: 'https://committees.parliament.uk/committee/62/environmental-audit-committee/',
    keywords: ['energy', 'climate', 'environment', 'biodiversity', 'carbon',
      'emissions', 'green', 'sustainability'],
    defaultEntityIds: ['defra'],
    sector: 'energy',
  },
  {
    name: 'Business and Trade Committee',
    url: 'https://committees.parliament.uk/committee/365/business-and-trade-committee/',
    keywords: ['energy', 'supply chain', 'industry', 'investment', 'trade',
      'manufacturing', 'industrial strategy'],
    defaultEntityIds: ['dbt'],
    sector: 'energy',
  },
  {
    name: 'Science, Innovation and Technology Committee',
    url: 'https://committees.parliament.uk/committee/673/science-innovation-and-technology-committee/',
    keywords: ['energy', 'technology', 'innovation', 'digital', 'AI',
      'data', 'research', 'R&D'],
    defaultEntityIds: ['dsit'],
    sector: 'energy',
  },
  {
    name: 'Lords Industry and Regulators Committee',
    url: 'https://committees.parliament.uk/committee/517/industry-and-regulators-committee/',
    keywords: ['energy', 'regulation', 'ofgem', 'industry', 'infrastructure',
      'investment', 'utilities'],
    defaultEntityIds: [],
    sector: 'energy',
  },
  {
    name: 'Welsh Affairs Committee',
    url: 'https://committees.parliament.uk/committee/46/welsh-affairs-committee/',
    keywords: ['energy', 'wind', 'wales', 'marine', 'port', 'freeport',
      'celtic sea', 'tidal'],
    defaultEntityIds: [],
    sector: 'energy',
  },
  {
    name: 'Scottish Affairs Committee',
    url: 'https://committees.parliament.uk/committee/136/scottish-affairs-committee/',
    keywords: ['energy', 'wind', 'scotland', 'oil', 'gas', 'transition',
      'ScotWind', 'INTOG'],
    defaultEntityIds: [],
    sector: 'energy',
  },

  // ── Health-related committees ──────────────────────────────────────────
  {
    name: 'Health and Social Care Committee',
    url: 'https://committees.parliament.uk/committee/81/health-and-social-care-committee/',
    keywords: ['health', 'NHS', 'social care', 'medicine', 'pharmaceutical',
      'vaccine', 'workforce', 'mental health', 'waiting', 'patient safety'],
    defaultEntityIds: ['dhsc'],
    sector: 'health',
  },
  {
    name: 'Lords Science and Technology Committee',
    url: 'https://committees.parliament.uk/committee/193/science-and-technology-committee/',
    keywords: ['health', 'science', 'research', 'technology', 'clinical',
      'life sciences', 'genomics', 'AI', 'data'],
    defaultEntityIds: [],
    sector: 'health',
  },

  // ── General oversight ──────────────────────────────────────────────────
  {
    name: 'Public Accounts Committee',
    url: 'https://committees.parliament.uk/committee/127/public-accounts-committee/',
    keywords: ['government', 'spending', 'value', 'audit', 'department',
      'efficiency', 'NHS', 'energy', 'defence', 'welfare'],
    defaultEntityIds: [],
    sector: 'general',
  },
  {
    name: 'Treasury Committee',
    url: 'https://committees.parliament.uk/committee/158/treasury-committee/',
    keywords: ['economy', 'fiscal', 'monetary', 'inflation', 'growth',
      'regulation', 'financial', 'budget', 'investment'],
    defaultEntityIds: ['treasury'],
    sector: 'finance',
  },
  {
    name: 'Public Administration and Constitutional Affairs Committee',
    url: 'https://committees.parliament.uk/committee/327/public-administration-and-constitutional-affairs-committee/',
    keywords: ['civil service', 'government', 'reform', 'standards',
      'transparency', 'appointments', 'machinery'],
    defaultEntityIds: ['co'],
    sector: 'general',
  },
];

// ── Scraping helpers ──────────────────────────────────────────────────────

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractLinks(html: string): Array<{ title: string; href: string }> {
  const links: Array<{ title: string; href: string }> = [];
  const regex = /<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) !== null) {
    const href = match[1];
    const title = stripHtml(match[2]).trim();
    if (title.length >= 15 && href) {
      links.push({ title, href });
    }
  }

  return links;
}

// ── Main collector ────────────────────────────────────────────────────────

const BATCH_SIZE = 25;

export async function collectCommittees(): Promise<{ inserted: number; skipped: number }> {
  let totalInserted = 0;
  let totalSkipped = 0;

  console.log(`\n=== Select Committee Scraper ===`);
  console.log(`Committees configured: ${COMMITTEES.length}\n`);

  for (const committee of COMMITTEES) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);

      const resp = await fetch(committee.url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Whitehall-Monitor/1.0 (committee-scraper)',
          Accept: 'text/html',
        },
      });

      clearTimeout(timer);

      if (!resp.ok) {
        console.warn(`  [WARN] ${committee.name}: HTTP ${resp.status}`);
        continue;
      }

      const html = await resp.text();
      const links = extractLinks(html);

      const rows: Array<Record<string, unknown>> = [];

      for (const link of links) {
        const titleLower = link.title.toLowerCase();
        if (!committee.keywords.some((kw) => titleLower.includes(kw.toLowerCase()))) {
          continue;
        }

        // Resolve URL
        let fullUrl = link.href;
        if (fullUrl.startsWith('/')) {
          fullUrl = `https://committees.parliament.uk${fullUrl}`;
        } else if (!fullUrl.startsWith('http')) {
          continue;
        }

        const title = cleanTitle(`${committee.name}: ${link.title}`);
        const entityIds = enrichEntityIds(committee.defaultEntityIds, title, '');
        const ragStatus = determineRagStatus(title, '');
        const fingerprint = makeFingerprint(fullUrl, link.title);

        rows.push({
          source_type: 'committee',
          source_name: committee.name,
          title,
          url: fullUrl,
          published_at: new Date().toISOString(),
          body: null,
          entity_ids: entityIds,
          topic_tags: extractTopicTags(title, ''),
          rag_status: ragStatus.toLowerCase(),
          relevance_score: 0.25,
          fingerprint,
          is_forward_scan: false,
        });
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
          console.warn(`    [ERR] ${committee.name} upsert failed: ${error.message}`);
          skipped += batch.length;
          continue;
        }

        inserted += data?.length ?? 0;
        skipped += batch.length - (data?.length ?? 0);
      }

      console.log(`  ${committee.name}: ${links.length} links, ${rows.length} matched, ${inserted} inserted`);
      totalInserted += inserted;
      totalSkipped += skipped;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`  [WARN] ${committee.name}: ${message}`);
    }

    await delayMs(400);
  }

  console.log(`\n=== Committee Collection Complete ===`);
  console.log(`Total inserted: ${totalInserted}`);
  console.log(`Total skipped:  ${totalSkipped}\n`);

  return { inserted: totalInserted, skipped: totalSkipped };
}
