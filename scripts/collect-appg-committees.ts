/**
 * Collect Select Committee Memberships from Parliament Biography API.
 *
 * For each politician, fetches their Biography from the Members API and
 * extracts current committee memberships (endDate === null, house === 1).
 *
 * Note: The APPG register has no public API. APPG membership data would
 * require scraping the Parliamentary Commissioner's PDF/HTML register.
 * The Committees API (committees-api.parliament.uk) uses different member
 * IDs than the Members API, so Biography is the reliable source.
 *
 * Usage: npx tsx scripts/collect-appg-committees.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import * as path from 'path';

import {
  enrichEntityIds as enrichEntityIdsCentral,
  extractTopicTags,
} from '../lib/feeds/entity-enrichment';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY');
}

const supabaseReadonly = createClient(supabaseUrl, supabaseKey);
const supabase = serviceKey ? createClient(supabaseUrl, serviceKey) : supabaseReadonly;

// -- Config -------------------------------------------------------------------

const MEMBERS_API = 'https://members-api.parliament.uk/api/Members';
const BATCH_SIZE = 25;
const API_DELAY_MS = 200;

// -- Helpers ------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeFingerprint(...parts: string[]): string {
  return crypto
    .createHash('sha256')
    .update(parts.join('||'))
    .digest('hex');
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/\bcommittee\b/gi, '')
    .replace(/\bselect\b/gi, '')
    .replace(/\bhouse of commons\b/gi, '')
    .replace(/\bthe\b/gi, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .replace(/-+/g, '-');
}

async function fetchJson<T>(url: string, label: string): Promise<T | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);

    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Whitehall-Monitor/1.0 (committee-collector)',
        Accept: 'application/json',
      },
    });

    clearTimeout(timer);

    if (!resp.ok) {
      console.warn(`  [WARN] ${label}: HTTP ${resp.status}`);
      return null;
    }

    return (await resp.json()) as T;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('abort')) {
      console.warn(`  [WARN] ${label}: timed out`);
    } else {
      console.warn(`  [WARN] ${label}: ${message}`);
    }
    return null;
  }
}

// -- Types --------------------------------------------------------------------

interface BiographyEntry {
  house: number;
  name: string;
  id: number;
  startDate: string;
  endDate: string | null;
  additionalInfo: string | null;
  additionalInfoLink: string | null;
}

interface BiographyResponse {
  value: {
    representations: unknown[];
    houseMemberships: BiographyEntry[];
    governmentPosts: BiographyEntry[];
    oppositionPosts: BiographyEntry[];
    committeeMemberships?: BiographyEntry[];
  };
}

interface PoliticianRow {
  id: string;
  parliament_member_id: number;
}

// -- Politician map -----------------------------------------------------------

async function loadPoliticians(): Promise<Map<number, string>> {
  const { data, error } = await supabase
    .from('politicians')
    .select('id, parliament_member_id')
    .not('parliament_member_id', 'is', null)
    .eq('status', 'active')
    .limit(5000);

  if (error || !data) {
    console.error('  [ERR] Failed to load politicians:', error?.message);
    return new Map();
  }

  const map = new Map<number, string>();
  for (const p of data as PoliticianRow[]) {
    map.set(p.parliament_member_id, p.id);
  }
  return map;
}

// -- Upsert -------------------------------------------------------------------

async function upsertEvidence(rows: Array<Record<string, unknown>>): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    const { data, error } = await supabase
      .from('politician_evidence')
      .upsert(batch, { onConflict: 'fingerprint', ignoreDuplicates: true })
      .select('id');

    if (error) {
      console.warn(`    [ERR] Evidence upsert batch ${i}: ${error.message}`);
      skipped += batch.length;
      continue;
    }

    const insertedCount = data?.length ?? 0;
    inserted += insertedCount;
    skipped += batch.length - insertedCount;
  }

  return { inserted, skipped };
}

// -- Collect committees -------------------------------------------------------

function inferRole(entry: BiographyEntry): 'chair' | 'member' {
  const info = (entry.additionalInfo || '').toLowerCase();
  if (info.includes('chair')) return 'chair';
  return 'member';
}

async function collectCommittees(
  polMap: Map<number, string>,
): Promise<Array<Record<string, unknown>>> {
  console.log('\n--- Committee Memberships (Biography API) ---');

  const politicians = Array.from(polMap.entries());
  console.log(`  Fetching biographies for ${politicians.length} politicians...`);

  const allRows: Array<Record<string, unknown>> = [];
  let fetched = 0;
  let withCommittees = 0;

  for (const [memberId, politicianId] of politicians) {
    const bio = await fetchJson<BiographyResponse>(
      `${MEMBERS_API}/${memberId}/Biography`,
      `Bio ${memberId}`,
    );
    fetched++;

    if (fetched % 50 === 0) {
      console.log(`  ... ${fetched}/${politicians.length} biographies (${allRows.length} committee rows so far)`);
    }

    if (!bio?.value?.committeeMemberships) {
      await delay(API_DELAY_MS);
      continue;
    }

    // Filter to current memberships (no endDate) in the Commons (house=1)
    const current = bio.value.committeeMemberships.filter(
      (cm) => cm.endDate === null && cm.house === 1,
    );

    if (current.length > 0) withCommittees++;

    for (const cm of current) {
      const committeeId = slugify(cm.name);
      const role = inferRole(cm);
      const startDate = cm.startDate?.split('T')[0] ?? new Date().toISOString().split('T')[0];

      allRows.push({
        politician_id: politicianId,
        evidence_type: 'committee_membership',
        source: 'members-api',
        source_id: `committee-${cm.id}-member-${memberId}`,
        source_url: `https://members.parliament.uk/member/${memberId}/committees`,
        occurred_at: new Date(cm.startDate || Date.now()).toISOString(),
        raw_content: `${cm.name}: ${role} since ${startDate}`,
        parsed: {
          committee_id: committeeId,
          committee_name: cm.name,
          committee_api_id: cm.id,
          role,
          start_date: startDate,
        },
        topic_tags: extractTopicTags(cm.name, ''),
        entity_ids: enrichEntityIdsCentral([], cm.name, ''),
        fingerprint: makeFingerprint(politicianId, 'committee_membership', String(cm.id)),
      });
    }

    await delay(API_DELAY_MS);
  }

  console.log(`  Fetched ${fetched} biographies`);
  console.log(`  ${withCommittees} politicians have current committee memberships`);
  console.log(`  ${allRows.length} total committee evidence rows`);

  return allRows;
}

// -- Main ---------------------------------------------------------------------

async function main() {
  console.log('=== Collecting Committee Memberships ===\n');

  const polMap = await loadPoliticians();
  console.log(`Loaded ${polMap.size} politicians with Parliament member IDs`);

  if (polMap.size === 0) {
    console.error('No politicians found. Run the members collector first.');
    process.exit(1);
  }

  const rows = await collectCommittees(polMap);

  if (rows.length === 0) {
    console.log('\nNo evidence rows to insert.');
    return;
  }

  // Upsert
  console.log(`\n--- Upserting ${rows.length} evidence rows ---`);
  const { inserted, skipped } = await upsertEvidence(rows);
  console.log(`  Inserted: ${inserted}`);
  console.log(`  Skipped (duplicates): ${skipped}`);

  // Indicator coverage
  const { data: mappedCommittees } = await supabase
    .from('committee_indicator_map')
    .select('committee_id');
  const mappedIds = new Set((mappedCommittees ?? []).map((m) => m.committee_id));

  const committeeIds = new Set(rows.map((r) => (r.parsed as Record<string, unknown>).committee_id as string));
  const matched = [...committeeIds].filter((id) => mappedIds.has(id));
  const unmatched = [...committeeIds].filter((id) => !mappedIds.has(id));

  console.log(`\n--- Indicator Coverage ---`);
  console.log(`  ${matched.length} committees matched to indicators: ${matched.join(', ')}`);
  if (unmatched.length > 0) {
    console.log(`  ${unmatched.length} without indicator mappings: ${unmatched.slice(0, 10).join(', ')}${unmatched.length > 10 ? '...' : ''}`);
  }

  // Verify
  const { count: total } = await supabase
    .from('politician_evidence')
    .select('*', { count: 'exact', head: true })
    .eq('evidence_type', 'committee_membership');

  console.log(`\n--- Total committee_membership evidence in DB: ${total ?? 0} rows ---`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
