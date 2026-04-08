/**
 * Parliamentary Research Briefings Collector
 *
 * Fetches research briefings from the House of Commons Library and
 * House of Lords Library via the Parliament Search API.
 *
 * These briefings provide authoritative, non-partisan analysis of policy
 * areas and are invaluable for context in monitoring reports.
 *
 * API: https://commonslibrary.parliament.uk/research-briefings/
 *      https://lordslibrary.parliament.uk/
 *
 * Items are upserted with source_type = 'research'.
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

// ── Feed definitions ──────────────────────────────────────────────────────

interface BriefingsFeedConfig {
  name: string;
  /** RSS/Atom feed URL */
  url: string;
  /** Default entity IDs */
  defaultEntityIds: string[];
}

const BRIEFINGS_FEEDS: BriefingsFeedConfig[] = [
  {
    name: 'Commons Library',
    url: 'https://commonslibrary.parliament.uk/feed/',
    defaultEntityIds: [],
  },
  {
    name: 'Lords Library',
    url: 'https://lordslibrary.parliament.uk/feed/',
    defaultEntityIds: [],
  },
];

// Additionally, the Commons Library search API lets us pull topic-specific briefings
const COMMONS_LIBRARY_SEARCH = 'https://commonslibrary.parliament.uk/research-briefings/';

// Topics to search for — these are URL slugs used by the library
const TOPIC_SEARCHES = [
  { query: 'energy', entityIds: ['desnz'] },
  { query: 'health', entityIds: ['dhsc'] },
  { query: 'environment', entityIds: ['defra'] },
  { query: 'transport', entityIds: ['dft'] },
  { query: 'education', entityIds: ['dfe'] },
  { query: 'housing', entityIds: ['dluhc'] },
  { query: 'defence', entityIds: ['mod'] },
  { query: 'immigration', entityIds: ['home-office'] },
  { query: 'NHS', entityIds: ['dhsc', 'nhs-improve'] },
  { query: 'offshore wind', entityIds: ['desnz'] },
  { query: 'nuclear', entityIds: ['desnz'] },
  { query: 'pharmaceutical', entityIds: ['mhra', 'dhsc'] },
];

// ── Parsing helpers ───────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ParsedItem {
  title: string;
  url: string;
  published_at: string | null;
  body: string;
}

function parseRssXml(xml: string): ParsedItem[] {
  const items: ParsedItem[] = [];

  let blocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((m) => m[1]);
  if (blocks.length === 0) {
    blocks = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)].map((m) => m[1]);
  }

  for (const block of blocks) {
    const titleMatch = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    let title = titleMatch
      ? stripHtml(titleMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'))
      : '';
    title = title.trim();

    const linkMatch =
      block.match(/<link[^>]*>([\s\S]*?)<\/link>/i) ||
      block.match(/<link[^>]*href="([^"]+)"/i);
    const url = linkMatch
      ? linkMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim()
      : '';

    const descMatch =
      block.match(/<description[^>]*>([\s\S]*?)<\/description>/i) ||
      block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i) ||
      block.match(/<content:encoded[^>]*>([\s\S]*?)<\/content:encoded>/i) ||
      block.match(/<content[^>]*>([\s\S]*?)<\/content>/i);
    let body = '';
    if (descMatch) {
      body = stripHtml(descMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'));
    }

    const dateMatch =
      block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) ||
      block.match(/<published[^>]*>([\s\S]*?)<\/published>/i) ||
      block.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i) ||
      block.match(/<dc:date[^>]*>([\s\S]*?)<\/dc:date>/i);

    let published_at: string | null = null;
    if (dateMatch) {
      try {
        published_at = new Date(dateMatch[1].trim()).toISOString();
      } catch {
        // skip
      }
    }

    if (!title || !url) continue;
    items.push({ title, url, published_at, body: body.slice(0, 3000) });
  }

  return items;
}

// ── Main collector ────────────────────────────────────────────────────────

const BATCH_SIZE = 25;

export async function collectResearchBriefings(since?: Date): Promise<{ inserted: number; skipped: number }> {
  let totalInserted = 0;
  let totalSkipped = 0;

  const cutoffDate = since ?? new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

  console.log(`\n=== Research Briefings Collector ===`);
  console.log(`RSS feeds: ${BRIEFINGS_FEEDS.length}`);
  console.log(`Topic searches: ${TOPIC_SEARCHES.length}`);
  console.log(`Cutoff: ${cutoffDate.toISOString().slice(0, 10)}\n`);

  // ── Part 1: RSS feeds from Commons and Lords Libraries ─────────────────

  for (const feed of BRIEFINGS_FEEDS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);

      const resp = await fetch(feed.url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Whitehall-Monitor/1.0 (research-briefings)',
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
        if (item.published_at) {
          const itemDate = new Date(item.published_at);
          if (itemDate < cutoffDate) continue;
        }

        const entityIds = enrichEntityIds(feed.defaultEntityIds, item.title, item.body);
        const ragStatus = determineRagStatus(item.title, item.body);
        const fingerprint = makeFingerprint(item.url, item.title);

        rows.push({
          source_type: 'research',
          source_name: feed.name,
          title: cleanTitle(item.title),
          url: item.url,
          published_at: item.published_at || new Date().toISOString(),
          body: item.body || null,
          entity_ids: entityIds,
          rag_status: ragStatus.toLowerCase(),
          relevance_score: 0.25,
          fingerprint,
          is_forward_scan: false,
        });
      }

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

      console.log(`  ${feed.name} RSS: ${parsed.length} parsed, ${inserted} inserted`);
      totalInserted += inserted;
      totalSkipped += skipped;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`  [WARN] ${feed.name}: ${message}`);
    }

    await delay(300);
  }

  // ── Part 2: Topic-specific searches via Commons Library ────────────────

  for (const topic of TOPIC_SEARCHES) {
    try {
      const searchUrl = `${COMMONS_LIBRARY_SEARCH}?query=${encodeURIComponent(topic.query)}&feed=rss`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);

      const resp = await fetch(searchUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Whitehall-Monitor/1.0 (research-briefings)',
          Accept: 'application/rss+xml, application/xml, text/xml, text/html',
        },
      });

      clearTimeout(timer);

      if (!resp.ok) {
        // Some topic searches may not support RSS — that's fine
        continue;
      }

      const contentType = resp.headers.get('content-type') || '';
      if (!contentType.includes('xml') && !contentType.includes('rss')) {
        // Got HTML instead of RSS — skip
        continue;
      }

      const xml = await resp.text();
      const parsed = parseRssXml(xml);

      const rows: Array<Record<string, unknown>> = [];

      for (const item of parsed) {
        if (item.published_at) {
          const itemDate = new Date(item.published_at);
          if (itemDate < cutoffDate) continue;
        }

        const entityIds = enrichEntityIds(topic.entityIds, item.title, item.body);
        const ragStatus = determineRagStatus(item.title, item.body);
        const fingerprint = makeFingerprint(item.url, item.title);

        rows.push({
          source_type: 'research',
          source_name: `Commons Library — ${topic.query}`,
          title: cleanTitle(item.title),
          url: item.url,
          published_at: item.published_at || new Date().toISOString(),
          body: item.body || null,
          entity_ids: entityIds,
          rag_status: ragStatus.toLowerCase(),
          relevance_score: 0.25,
          fingerprint,
          is_forward_scan: false,
        });
      }

      let inserted = 0;
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const { data, error } = await supabase
          .from('feed_items')
          .upsert(batch, { onConflict: 'fingerprint', ignoreDuplicates: true })
          .select('id');

        if (error) continue;
        inserted += data?.length ?? 0;
      }

      if (inserted > 0) {
        console.log(`  Commons Library "${topic.query}": ${inserted} inserted`);
      }
      totalInserted += inserted;
    } catch {
      // Topic search failures are non-critical
    }

    await delay(300);
  }

  console.log(`\n=== Research Briefings Collection Complete ===`);
  console.log(`Total inserted: ${totalInserted}`);
  console.log(`Total skipped:  ${totalSkipped}\n`);

  return { inserted: totalInserted, skipped: totalSkipped };
}
