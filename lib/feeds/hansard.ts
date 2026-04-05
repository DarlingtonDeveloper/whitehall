/**
 * Hansard Feed Collector
 *
 * Fetches parliamentary contributions (spoken and written) from the
 * Hansard API, covering all major government departments and key topics.
 */

import { createClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY in .env.local',
  );
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ── Hansard API endpoints ────────────────────────────────────────────────

const HANSARD_SPOKEN_URL =
  'https://hansard-api.parliament.uk/search/contributions/Spoken.json';
const HANSARD_WRITTEN_URL =
  'https://hansard-api.parliament.uk/search/contributions/Written.json';

// ── Search terms — broad set covering all departments ────────────────────

const SEARCH_TERMS = [
  // Department abbreviations
  'DESNZ', 'DHSC', 'DfE', 'DfT', 'DLUHC', 'Defra', 'DSIT', 'DWP', 'DBT',
  // Departments by name
  'Home Office', 'Ministry of Defence', 'Ministry of Justice', 'Treasury',
  'Foreign Office', 'Cabinet Office',
  // Key topics
  'energy', 'NHS', 'planning', 'immigration', 'defence',
  'offshore wind', 'net zero', 'consultation',
];

// ── Keyword-to-entity mapping ────────────────────────────────────────────

const KEYWORD_ENTITY_MAP: [RegExp, string][] = [
  [/\bDESNZ\b|energy security|net zero|clean power|offshore wind|onshore wind|energy\b/i, 'desnz'],
  [/\bDHSC\b|health and social care|NHS\b/i, 'dhsc'],
  [/\bDfE\b|department for education|school|curriculum/i, 'dfe'],
  [/\bDfT\b|department for transport|rail|road|aviation/i, 'dft'],
  [/\bDLUHC\b|housing|planning\b|local government|levelling up/i, 'dluhc'],
  [/\bDefra\b|environment|biodiversity|farming|water quality/i, 'defra'],
  [/\bTreasury\b|fiscal|budget/i, 'treasury'],
  [/\bHome Office\b|immigration\b|policing|border/i, 'home-office'],
  [/\bMinistry of Defence\b|MoD\b|armed forces|military|defence\b/i, 'mod'],
  [/\bMinistry of Justice\b|MoJ\b|prisons|courts|sentencing/i, 'moj'],
  [/\bForeign Office\b|FCDO\b|overseas development/i, 'fcdo'],
  [/\bCabinet Office\b|civil service reform/i, 'co'],
  [/\bDBT\b|business and trade|trade policy/i, 'dbt'],
  [/\bDCMS\b|culture.{0,10}media|creative industries/i, 'dcms'],
  [/\bDSIT\b|science.{0,10}innovation|technology policy/i, 'dsit'],
  [/\bDWP\b|work and pensions|universal credit|state pension/i, 'dwp'],
  [/\bOfgem\b|energy regulation/i, 'ofgem'],
  [/\bMHRA\b|medicines regulation/i, 'mhra'],
  [/\bNICE\b|health technology/i, 'nice'],
  [/\bCQC\b|care quality/i, 'cqc'],
  [/\bCMA\b|competition.{0,10}markets/i, 'cma'],
  [/\bNHS England\b|NHSE\b/i, 'nhs-improve'],
  [/\bconsultation\b/i, ''],
  [/\bnuclear\b|Sizewell|Hinkley/i, 'desnz'],
  [/\bhydrogen\b/i, 'desnz'],
  [/\bCCUS\b|carbon capture/i, 'desnz'],
];

// ── Hansard result types ─────────────────────────────────────────────────

interface HansardContribution {
  ItemId?: string;
  MemberName?: string;
  HouseId?: number;
  DebateSection?: string;
  SittingDate?: string;
  AttributedTo?: string;
  ContributionText?: string;
  SectionTitle?: string;
  Url?: string;
  ExternalId?: string;
}

interface HansardResponse {
  TotalResults?: number;
  Results?: HansardContribution[];
}

// ── Helpers ──────────────────────────────────────────────────────────────

function makeFingerprint(url: string, title: string): string {
  return crypto
    .createHash('sha256')
    .update(`${url}||${title}`)
    .digest('hex');
}

function stripHtml(str: string): string {
  return str.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

function enrichEntityIds(title: string, body: string): string[] {
  const ids = new Set<string>();
  const text = `${title} ${body}`;

  for (const [pattern, entityId] of KEYWORD_ENTITY_MAP) {
    if (entityId && pattern.test(text)) {
      ids.add(entityId);
    }
  }

  // If nothing matched, tag as generic parliament
  if (ids.size === 0) {
    ids.add('parliament');
  }

  return Array.from(ids);
}

function determineRagStatus(title: string, body: string): 'RED' | 'AMBER' | 'GREEN' {
  const text = `${title} ${body}`.toLowerCase();

  if (
    /\burgent question\b/.test(text) ||
    /\bemergency debate\b/.test(text) ||
    /\bimmediate\b/.test(text) ||
    /\bsafety\s+alert\b/.test(text)
  ) {
    return 'RED';
  }

  if (
    /\bconsultation\b/.test(text) ||
    /\bcall for evidence\b/.test(text) ||
    /\bcommittee stage\b/.test(text) ||
    /\bsecond reading\b/.test(text) ||
    /\bwritten statement\b/.test(text) ||
    /\bproposed\b/.test(text)
  ) {
    return 'AMBER';
  }

  return 'GREEN';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Fetch contributions for a single search term and endpoint ────────────

async function fetchContributions(
  endpoint: string,
  searchTerm: string,
  startDate: string,
  endDate: string,
  take = 50,
): Promise<HansardContribution[]> {
  const params = new URLSearchParams({
    searchTerm,
    startDate,
    endDate,
    take: String(take),
  });

  const url = `${endpoint}?${params.toString()}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);

    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Whitehall-Monitor/1.0 (hansard-collector)',
        Accept: 'application/json',
      },
    });

    clearTimeout(timer);

    if (!resp.ok) {
      console.warn(`  [WARN] Hansard ${searchTerm}: HTTP ${resp.status}`);
      return [];
    }

    const data: HansardResponse = await resp.json();
    return data.Results ?? [];
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('abort')) {
      console.warn(`  [WARN] Hansard ${searchTerm}: timed out`);
    } else {
      console.warn(`  [WARN] Hansard ${searchTerm}: ${message}`);
    }
    return [];
  }
}

// ── Build a Hansard URL from contribution data ───────────────────────────

function buildHansardUrl(contribution: HansardContribution): string {
  if (contribution.Url) {
    // Ensure it's a full URL
    if (contribution.Url.startsWith('http')) return contribution.Url;
    return `https://hansard.parliament.uk${contribution.Url}`;
  }

  // Fallback: construct from ExternalId
  if (contribution.ExternalId) {
    return `https://hansard.parliament.uk/search/contributions/${contribution.ExternalId}`;
  }

  return `https://hansard.parliament.uk/search?searchTerm=${encodeURIComponent(contribution.SectionTitle || '')}`;
}

// ── Build source name from house ID ──────────────────────────────────────

function getSourceName(houseId?: number, isWritten = false): string {
  if (isWritten) return 'Hansard - Written';
  switch (houseId) {
    case 1:
      return 'Hansard - House of Commons';
    case 2:
      return 'Hansard - House of Lords';
    default:
      return 'Hansard';
  }
}

// ── Main collector ───────────────────────────────────────────────────────

export async function collectHansard(): Promise<{ inserted: number; skipped: number }> {
  let totalInserted = 0;
  let totalSkipped = 0;
  const seenFingerprints = new Set<string>();

  const startDate = daysAgo(30);
  const endDate = daysAgo(0);

  console.log(`\n=== Hansard Feed Collector ===`);
  console.log(`Date range: ${startDate} to ${endDate}`);
  console.log(`Search terms: ${SEARCH_TERMS.length}\n`);

  const endpoints: { url: string; label: string; isWritten: boolean }[] = [
    { url: HANSARD_SPOKEN_URL, label: 'Spoken', isWritten: false },
    { url: HANSARD_WRITTEN_URL, label: 'Written', isWritten: true },
  ];

  for (const ep of endpoints) {
    console.log(`--- ${ep.label} contributions ---`);

    for (const term of SEARCH_TERMS) {
      const contributions = await fetchContributions(
        ep.url,
        term,
        startDate,
        endDate,
        50,
      );

      if (contributions.length === 0) {
        console.log(`  "${term}": 0 results`);
        await delay(300);
        continue;
      }

      // Convert to feed items, dedup by fingerprint
      const rows: Array<Record<string, unknown>> = [];

      for (const c of contributions) {
        const title = c.SectionTitle || c.DebateSection || 'Untitled';
        const url = buildHansardUrl(c);
        const fingerprint = makeFingerprint(url, title);

        // Skip if we already saw this item in this collection run
        if (seenFingerprints.has(fingerprint)) continue;
        seenFingerprints.add(fingerprint);

        const bodyParts: string[] = [];
        if (c.AttributedTo) bodyParts.push(c.AttributedTo);
        if (c.ContributionText) bodyParts.push(stripHtml(c.ContributionText));
        const body = bodyParts.join(' — ').slice(0, 2000);

        const entityIds = enrichEntityIds(title, body);
        const ragStatus = determineRagStatus(title, body);
        const publishedAt = c.SittingDate
          ? new Date(c.SittingDate).toISOString()
          : new Date().toISOString();

        rows.push({
          source_type: 'hansard',
          source_name: getSourceName(c.HouseId, ep.isWritten),
          title,
          url,
          published_at: publishedAt,
          body: body || null,
          entity_ids: entityIds,
          rag_status: ragStatus.toLowerCase(),
          relevance_score: 0.3,
          fingerprint,
          is_forward_scan: false,
        });
      }

      if (rows.length === 0) {
        console.log(`  "${term}": ${contributions.length} results, 0 new`);
        await delay(300);
        continue;
      }

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

      console.log(
        `  "${term}": ${contributions.length} results, ${rows.length} unique, ${feedInserted} inserted, ${feedSkipped} skipped`,
      );
      totalInserted += feedInserted;
      totalSkipped += feedSkipped;

      // Be polite — 300ms between requests
      await delay(300);
    }
  }

  console.log(`\n=== Hansard Collection Complete ===`);
  console.log(`Total inserted: ${totalInserted}`);
  console.log(`Total skipped:  ${totalSkipped}\n`);

  return { inserted: totalInserted, skipped: totalSkipped };
}
