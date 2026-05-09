/**
 * RSS / Atom Feed Collector
 *
 * Fetches trade press and industry body publications from RSS and Atom
 * feeds across multiple sectors (energy, health, general government).
 *
 * Covers the last 12 months of published items and upserts into Supabase
 * with source_type = 'trade_press'.
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
const supabase = serviceKey ? createClient(supabaseUrl, serviceKey) : supabaseReadonly;

// ── Feed definitions ──────────────────────────────────────────────────────

interface RssFeedConfig {
  name: string;
  url: string;
  /** Default entity IDs to assign to items from this feed */
  defaultEntityIds: string[];
  /** Sector tag for filtering */
  sector: 'energy' | 'health' | 'general' | 'finance';
}

export const RSS_FEEDS: RssFeedConfig[] = [
  // ── Energy sector ──────────────────────────────────────────────────────
  {
    name: 'Recharge News',
    url: 'https://news.google.com/rss/search?q=site:rechargenews.com&hl=en-GB&gl=GB&ceid=GB:en',
    defaultEntityIds: [],
    sector: 'energy',
  },
  {
    name: 'Windpower Monthly',
    url: 'https://www.windpowermonthly.com/rss',
    defaultEntityIds: [],
    sector: 'energy',
  },
  {
    name: 'Current±',
    url: 'https://www.current-news.co.uk/feed/',
    defaultEntityIds: [],
    sector: 'energy',
  },
  {
    name: 'Utility Week',
    url: 'https://news.google.com/rss/search?q=site:utilityweek.co.uk&hl=en-GB&gl=GB&ceid=GB:en',
    defaultEntityIds: [],
    sector: 'energy',
  },
  {
    name: 'New Power',
    url: 'https://www.newpower.info/feed/',
    defaultEntityIds: [],
    sector: 'energy',
  },
  {
    name: 'RenewableUK',
    url: 'https://news.google.com/rss/search?q=site:renewableuk.com&hl=en-GB&gl=GB&ceid=GB:en',
    defaultEntityIds: [],
    sector: 'energy',
  },
  {
    name: 'Energy UK',
    url: 'https://www.energy-uk.org.uk/feed/',
    defaultEntityIds: [],
    sector: 'energy',
  },
  {
    name: 'Ofgem Blog',
    url: 'https://news.google.com/rss/search?q=site:ofgem.gov.uk+blog&hl=en-GB&gl=GB&ceid=GB:en',
    defaultEntityIds: ['ofgem'],
    sector: 'energy',
  },
  {
    name: 'Climate Change Committee',
    url: 'https://www.theccc.org.uk/feed/',
    defaultEntityIds: ['ccc'],
    sector: 'energy',
  },

  // ── Health / pharma sector ─────────────────────────────────────────────
  {
    name: 'MHRA Press Releases',
    url: 'https://www.gov.uk/government/organisations/medicines-and-healthcare-products-regulatory-agency.atom',
    defaultEntityIds: ['mhra'],
    sector: 'health',
  },
  {
    name: 'NICE News',
    url: 'https://news.google.com/rss/search?q=site:nice.org.uk&hl=en-GB&gl=GB&ceid=GB:en',
    defaultEntityIds: ['nice'],
    sector: 'health',
  },
  {
    name: 'HSJ',
    url: 'https://www.hsj.co.uk/26024.rss',
    defaultEntityIds: [],
    sector: 'health',
  },
  {
    name: 'Pulse Today',
    url: 'https://www.pulsetoday.co.uk/feed/',
    defaultEntityIds: [],
    sector: 'health',
  },
  {
    name: 'PharmaTimes',
    url: 'https://www.pharmatimes.com/rss',
    defaultEntityIds: [],
    sector: 'health',
  },
  {
    name: 'The BMJ News',
    url: 'https://news.google.com/rss/search?q=site:bmj.com&hl=en-GB&gl=GB&ceid=GB:en',
    defaultEntityIds: [],
    sector: 'health',
  },

  // ── General government / public affairs ────────────────────────────────
  {
    name: 'Civil Service World',
    url: 'https://www.civilserviceworld.com/nocache/rss/articles',
    defaultEntityIds: [],
    sector: 'general',
  },
  {
    name: 'Public Finance',
    url: 'https://www.publicfinance.co.uk/rss.xml',
    defaultEntityIds: [],
    sector: 'finance',
  },
  {
    name: 'Institute for Government',
    url: 'https://www.instituteforgovernment.org.uk/rss.xml',
    defaultEntityIds: [],
    sector: 'general',
  },

  // ── Offshore wind specialist ─────────────────────────────────────────
  {
    name: 'Offshore Wind Biz',
    url: 'https://www.offshorewind.biz/feed/',
    defaultEntityIds: [],
    sector: 'energy',
  },
  {
    name: '4C Offshore',
    url: 'https://www.4coffshore.com/news/rss.aspx',
    defaultEntityIds: [],
    sector: 'energy',
  },

  // ── Energy policy ────────────────────────────────────────────────────
  {
    name: 'Carbon Brief',
    url: 'https://www.carbonbrief.org/feed/',
    defaultEntityIds: ['ccc', 'desnz'],
    sector: 'energy',
  },
  {
    name: 'Energy Voice',
    url: 'https://www.energyvoice.com/feed/',
    defaultEntityIds: [],
    sector: 'energy',
  },

  // ── Government blogs ─────────────────────────────────────────────────
  {
    name: 'DESNZ Blog',
    url: 'https://energyindemand.blog.gov.uk/feed/',
    defaultEntityIds: ['desnz'],
    sector: 'energy',
  },

  // ── Health (for Sanofi) ──────────────────────────────────────────────
  {
    name: 'NIHR News',
    url: 'https://www.nihr.ac.uk/news/rss',
    defaultEntityIds: ['dhsc'],
    sector: 'health',
  },
];

// ── Parsing helpers ───────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRssDate(dateStr: string): string | null {
  if (!dateStr) return null;

  // RFC 2822 (RSS standard)
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d.toISOString();
  } catch {
    // fall through
  }

  return null;
}

interface ParsedRssItem {
  title: string;
  url: string;
  published_at: string | null;
  body: string;
}

function parseRssXml(xml: string): ParsedRssItem[] {
  const items: ParsedRssItem[] = [];

  // Try RSS <item> blocks first, then Atom <entry> blocks
  let blocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((m) => m[1]);
  if (blocks.length === 0) {
    blocks = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)].map((m) => m[1]);
  }

  for (const block of blocks) {
    // Title
    const titleMatch = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    let title = titleMatch ? stripHtml(titleMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')) : '';
    title = title.trim();

    // Link
    const linkMatch =
      block.match(/<link[^>]*>([\s\S]*?)<\/link>/i) ||
      block.match(/<link[^>]*href="([^"]+)"/i);
    const url = linkMatch ? linkMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : '';

    // Description / summary / content
    const descMatch =
      block.match(/<description[^>]*>([\s\S]*?)<\/description>/i) ||
      block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i) ||
      block.match(/<content[^>]*>([\s\S]*?)<\/content>/i);
    let body = '';
    if (descMatch) {
      body = stripHtml(descMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'));
    }

    // Date
    const dateMatch =
      block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) ||
      block.match(/<published[^>]*>([\s\S]*?)<\/published>/i) ||
      block.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i);
    const published_at = dateMatch ? parseRssDate(dateMatch[1].trim()) : null;

    if (!title || !url) continue;

    items.push({ title, url, published_at, body: body.slice(0, 2000) });
  }

  return items;
}

// ── Main collector ────────────────────────────────────────────────────────

const BATCH_SIZE = 25;

export async function collectRss(since?: Date): Promise<{ inserted: number; skipped: number }> {
  let totalInserted = 0;
  let totalSkipped = 0;

  const cutoffDate = since ?? new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

  console.log(`\n=== RSS / Trade Press Collector ===`);
  console.log(`Feeds configured: ${RSS_FEEDS.length}`);
  console.log(`Cutoff date: ${cutoffDate.toISOString().slice(0, 10)} (365 days ago)\n`);

  for (const feed of RSS_FEEDS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);

      const resp = await fetch(feed.url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Whitehall-Monitor/1.0 (rss-collector)',
          Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
        },
      });

      clearTimeout(timer);

      if (!resp.ok) {
        console.warn(`  [WARN] ${feed.name}: HTTP ${resp.status}`);
        continue;
      }

      const xml = await resp.text();
      const parsed = parseRssXml(xml);

      const rows: Array<Record<string, unknown>> = [];

      for (const item of parsed) {
        // Skip items older than cutoff
        if (item.published_at) {
          const itemDate = new Date(item.published_at);
          if (itemDate < cutoffDate) continue;
        }

        const entityIds = enrichEntityIds(feed.defaultEntityIds, item.title, item.body);
        const ragStatus = determineRagStatus(item.title, item.body);
        const fingerprint = makeFingerprint(item.url, item.title);

        rows.push({
          source_type: 'trade_press',
          source_name: feed.name,
          title: cleanTitle(item.title),
          url: item.url,
          published_at: item.published_at || new Date().toISOString(),
          body: item.body || null,
          entity_ids: entityIds,
          topic_tags: extractTopicTags(item.title, item.body),
          rag_status: ragStatus.toLowerCase(),
          relevance_score: 0.2,
          fingerprint,
          is_forward_scan: false,
        });
      }

      // Upsert in batches
      let inserted = 0;
      let skipped = 0;

      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const { data, error } = await supabase
          .from('feed_items')
          .upsert(batch, { onConflict: 'fingerprint', ignoreDuplicates: true })
          .select('id');

        if (error) {
          console.warn(`    [ERR] ${feed.name} upsert failed: ${error.message}`);
          skipped += batch.length;
          continue;
        }

        inserted += data?.length ?? 0;
        skipped += batch.length - (data?.length ?? 0);
      }

      console.log(`  ${feed.name}: ${parsed.length} parsed, ${inserted} inserted, ${skipped} skipped`);
      totalInserted += inserted;
      totalSkipped += skipped;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`  [WARN] ${feed.name}: ${message}`);
    }

    await delay(300);
  }

  console.log(`\n=== RSS Collection Complete ===`);
  console.log(`Total inserted: ${totalInserted}`);
  console.log(`Total skipped:  ${totalSkipped}\n`);

  return { inserted: totalInserted, skipped: totalSkipped };
}
