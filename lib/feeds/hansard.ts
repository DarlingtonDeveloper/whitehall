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

import {
  enrichEntityIds as enrichEntityIdsCentral,
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

// ── Hansard API endpoints ────────────────────────────────────────────────

const HANSARD_SPOKEN_URL =
  'https://hansard-api.parliament.uk/search/contributions/Spoken.json';
const HANSARD_WRITTEN_URL =
  'https://hansard-api.parliament.uk/search/contributions/Written.json';

// ── Search terms — broad set covering all departments ────────────────────

const SEARCH_TERMS = [
  // Department full names (catches ALL debates mentioning the department)
  'Department for Energy Security and Net Zero',
  'Department of Health and Social Care',
  'Department for Environment, Food and Rural Affairs',
  'Ministry of Housing, Communities and Local Government',
  'Department for Science, Innovation and Technology',
  'Department for Business and Trade',
  'HM Treasury',
  'Cabinet Office',

  // Department abbreviations (catches shorthand references)
  'DESNZ', 'DHSC', 'DfE', 'DfT', 'DLUHC', 'Defra', 'DSIT', 'DWP', 'DBT',

  // Departments by shorter name
  'Home Office', 'Ministry of Defence', 'Ministry of Justice',
  'Foreign Office',

  // Key topics (supplementary — catches cross-departmental debates)
  'energy', 'NHS', 'planning', 'immigration', 'defence',
  'offshore wind', 'net zero', 'consultation',
  'North Sea', 'grid connection', 'CfD', 'onshore wind',
  'carbon capture', 'nuclear', 'hydrogen',
];

// ── Hansard result types ─────────────────────────────────────────────────

interface HansardContribution {
  ItemId?: string;
  MemberId?: number;
  MemberName?: string;
  HouseId?: number;
  House?: string;
  DebateSection?: string;
  DebateSectionId?: string;
  DebateSectionExtId?: string;
  SittingDate?: string;
  AttributedTo?: string;
  ContributionText?: string;
  ContributionTextFull?: string;
  ContributionExtId?: string;
  SectionTitle?: string;
  Section?: string;
  HansardSection?: string;
  Url?: string;
  ExternalId?: string;
  OrderInDebateSection?: number;
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
  const ids = enrichEntityIdsCentral([], title, body);

  // Fallback: if centralised enrichment found nothing, tag as generic parliament
  if (ids.length === 0) {
    return ['parliament'];
  }

  return ids;
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

function slugify(text: string): string {
  return text
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .replace(/\s+/g, '')
    .slice(0, 80);
}

function buildHansardUrl(contribution: HansardContribution): string {
  if (contribution.Url) {
    if (contribution.Url.startsWith('http')) return contribution.Url;
    return `https://hansard.parliament.uk${contribution.Url}`;
  }

  // Build from House, SittingDate, DebateSectionExtId, DebateSection
  if (contribution.DebateSectionExtId && contribution.SittingDate && contribution.House) {
    const house = contribution.House.toLowerCase().replace(/\s+/g, '');
    const date = contribution.SittingDate.split('T')[0];
    const slug = slugify(contribution.DebateSection || 'debate');
    return `https://hansard.parliament.uk/${house}/${date}/debates/${contribution.DebateSectionExtId}/${slug}`;
  }

  if (contribution.ExternalId) {
    return `https://hansard.parliament.uk/search/contributions/${contribution.ExternalId}`;
  }

  return `https://hansard.parliament.uk/search?searchTerm=${encodeURIComponent(contribution.DebateSection || contribution.SectionTitle || '')}`;
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

// ── Politician evidence ─────────────────────────────────────────────────

let politicianByMemberId: Map<number, string> | null = null;

async function loadPoliticianMap(): Promise<Map<number, string>> {
  if (politicianByMemberId) return politicianByMemberId;

  const { data, error } = await supabase
    .from('politicians')
    .select('id, parliament_member_id')
    .not('parliament_member_id', 'is', null)
    .limit(5000);

  if (error || !data) return new Map();

  politicianByMemberId = new Map(
    data.map((p) => [p.parliament_member_id as number, p.id as string]),
  );
  return politicianByMemberId;
}

function makeEvidenceFingerprint(...parts: string[]): string {
  return crypto
    .createHash('sha256')
    .update(parts.join('||'))
    .digest('hex');
}

async function writeEvidenceRows(rows: Array<Record<string, unknown>>): Promise<number> {
  if (rows.length === 0) return 0;

  let inserted = 0;
  const batchSize = 50;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await supabase
      .from('politician_evidence')
      .upsert(batch, { onConflict: 'fingerprint', ignoreDuplicates: true });

    if (!error) inserted += batch.length;
  }

  return inserted;
}

// ── Main collector ───────────────────────────────────────────────────────

export async function collectHansard(since?: Date): Promise<{ inserted: number; skipped: number }> {
  let totalInserted = 0;
  let totalSkipped = 0;
  const seenFingerprints = new Set<string>();

  const startDate = since ? since.toISOString().split('T')[0] : daysAgo(365);
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
        const title = cleanTitle(c.SectionTitle || c.DebateSection || 'Untitled');
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
          topic_tags: extractTopicTags(title, body),
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

  // ── Write politician evidence rows ────────────────────────────────────
  const polMap = await loadPoliticianMap();
  let evidenceInserted = 0;

  if (polMap.size > 0) {
    const evidenceRows: Array<Record<string, unknown>> = [];
    const seenEvidenceFp = new Set<string>();

    for (const ep of endpoints) {
      for (const term of SEARCH_TERMS) {
        const contributions = await fetchContributions(ep.url, term, startDate, endDate, 50);

        for (const c of contributions) {
          if (!c.MemberId) continue;
          const politicianId = polMap.get(c.MemberId);
          if (!politicianId) continue;

          const contributionId = c.ContributionExtId || c.ItemId || '';
          const fp = makeEvidenceFingerprint(politicianId, 'chamber_speech', contributionId);
          if (seenEvidenceFp.has(fp)) continue;
          seenEvidenceFp.add(fp);

          const title = c.SectionTitle || c.DebateSection || '';
          const text = c.ContributionText ? stripHtml(c.ContributionText) : '';
          const url = buildHansardUrl(c);
          const entityIds = enrichEntityIds(title, text);

          const isCommittee = (c.HansardSection || c.Section || '').toLowerCase().includes('committee');
          const evidenceType = isCommittee ? 'committee_speech' : 'chamber_speech';

          evidenceRows.push({
            politician_id: politicianId,
            evidence_type: evidenceType,
            source: 'hansard',
            source_id: contributionId,
            source_url: url,
            occurred_at: c.SittingDate ? new Date(c.SittingDate).toISOString() : new Date().toISOString(),
            raw_content: text.slice(0, 5000),
            parsed: {
              debate_id: c.DebateSectionExtId || c.DebateSectionId || '',
              debate_title: title,
              contribution_id: contributionId,
              word_count: text.split(/\s+/).length,
              intervention: (c.OrderInDebateSection ?? 0) > 1,
              position: 'middle',
            },
            topic_tags: extractTopicTags(title, text),
            entity_ids: entityIds,
            fingerprint: fp,
          });
        }

        await delay(300);
      }
    }

    evidenceInserted = await writeEvidenceRows(evidenceRows);
    console.log(`  Politician evidence: ${evidenceInserted} speech rows written`);
  }

  console.log(`\n=== Hansard Collection Complete ===`);
  console.log(`Total feed inserted: ${totalInserted}`);
  console.log(`Total feed skipped:  ${totalSkipped}`);
  console.log(`Total evidence:      ${evidenceInserted}\n`);

  return { inserted: totalInserted, skipped: totalSkipped };
}
