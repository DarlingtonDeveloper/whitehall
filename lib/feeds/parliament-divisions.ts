/**
 * Parliament Divisions Collector — Person-Level
 *
 * Fetches individual vote records from the Commons and Lords Votes APIs
 * and writes `politician_evidence` rows with evidence_type = 'division_vote'.
 *
 * This complements the existing `collectDivisions()` in parliament.ts which
 * writes division summaries to feed_items. This collector writes per-person
 * vote evidence.
 *
 * Backfill: pass `{ backfillYears: 10 }` for historical data.
 *
 * Commons Votes API: https://commonsvotes-api.parliament.uk
 * Lords Votes API:   https://lordsvotes-api.parliament.uk
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

// -- API endpoints -----------------------------------------------------------

const COMMONS_DIVISIONS_API = 'https://commonsvotes-api.parliament.uk/data/divisions.json';
const LORDS_DIVISIONS_API = 'https://lordsvotes-api.parliament.uk/data/Divisions';

// -- Helpers -----------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeFingerprint(...parts: string[]): string {
  return crypto
    .createHash('sha256')
    .update(parts.join('||'))
    .digest('hex');
}

function monthsAgo(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().split('T')[0];
}

async function fetchJson<T>(url: string, label: string): Promise<T | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);

    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Whitehall-Monitor/1.0 (divisions-collector)',
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

async function upsertEvidence(rows: Array<Record<string, unknown>>): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;
  const batchSize = 50;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);

    const { data, error } = await supabase
      .from('politician_evidence')
      .upsert(batch, { onConflict: 'fingerprint', ignoreDuplicates: true })
      .select('id');

    if (error) {
      console.warn(`    [ERR] Evidence upsert failed: ${error.message}`);
      skipped += batch.length;
      continue;
    }

    const insertedCount = data?.length ?? 0;
    inserted += insertedCount;
    skipped += batch.length - insertedCount;
  }

  return { inserted, skipped };
}

// -- Types -------------------------------------------------------------------

interface CommonsDivisionDetail {
  DivisionId: number;
  Title: string;
  Date: string;
  AyeCount: number;
  NoCount: number;
  AyeTellers: Array<{ MemberId: number; Name: string; Party: string }>;
  NoTellers: Array<{ MemberId: number; Name: string; Party: string }>;
  Ayes: Array<{ MemberId: number; Name: string; Party: string }>;
  Noes: Array<{ MemberId: number; Name: string; Party: string }>;
}

interface CommonsDivisionListItem {
  DivisionId: number;
  Title: string;
  Date: string;
  AyeCount: number;
  NoCount: number;
}

interface LordsDivisionDetail {
  DivisionId: number;
  Title: string;
  Date: string;
  AuthorityCount: number;
  NotAuthorityCount: number;
  Contents: Array<{ MemberId: number; Name: string; Party: string }>;
  NotContents: Array<{ MemberId: number; Name: string; Party: string }>;
  ContentTellers: Array<{ MemberId: number; Name: string; Party: string }>;
  NotContentTellers: Array<{ MemberId: number; Name: string; Party: string }>;
}

interface LordsDivisionListItem {
  DivisionId: number;
  Title: string;
  Date: string;
  AuthorityCount: number;
  NotAuthorityCount: number;
}

// -- Politician lookup cache -------------------------------------------------

let politicianByMemberId: Map<number, string> | null = null;

async function loadPoliticianMap(): Promise<Map<number, string>> {
  if (politicianByMemberId) return politicianByMemberId;

  const { data, error } = await supabase
    .from('politicians')
    .select('id, parliament_member_id')
    .not('parliament_member_id', 'is', null);

  if (error || !data) {
    console.error('  [ERR] Failed to load politician map:', error?.message);
    return new Map();
  }

  politicianByMemberId = new Map(
    data.map((p) => [p.parliament_member_id as number, p.id as string]),
  );

  console.log(`  Loaded ${politicianByMemberId.size} politician→member mappings`);
  return politicianByMemberId;
}

// -- Whip detection ----------------------------------------------------------

/**
 * Given a list of voters with party affiliations, detect the majority
 * vote direction for each party. If >85% of a party voted one way,
 * that's the whip direction.
 */
function detectPartyWhips(
  ayes: Array<{ Party: string }>,
  noes: Array<{ Party: string }>,
): Map<string, 'aye' | 'no'> {
  const partyCounts = new Map<string, { aye: number; no: number }>();

  for (const v of ayes) {
    const c = partyCounts.get(v.Party) ?? { aye: 0, no: 0 };
    c.aye++;
    partyCounts.set(v.Party, c);
  }
  for (const v of noes) {
    const c = partyCounts.get(v.Party) ?? { aye: 0, no: 0 };
    c.no++;
    partyCounts.set(v.Party, c);
  }

  const whips = new Map<string, 'aye' | 'no'>();
  for (const [party, counts] of partyCounts) {
    const total = counts.aye + counts.no;
    if (total < 5) continue; // Too few voters to infer whip
    const ayeRatio = counts.aye / total;
    if (ayeRatio > 0.85) {
      whips.set(party, 'aye');
    } else if (ayeRatio < 0.15) {
      whips.set(party, 'no');
    }
  }

  return whips;
}

// -- Commons divisions -------------------------------------------------------

async function processCommonsDivision(
  divisionId: number,
  polMap: Map<number, string>,
): Promise<Array<Record<string, unknown>>> {
  const detail = await fetchJson<CommonsDivisionDetail>(
    `${COMMONS_DIVISIONS_API}/${divisionId}`,
    `Division ${divisionId}`,
  );

  if (!detail) return [];

  const divisionTitle = detail.Title || '';
  const divisionDate = detail.Date?.split('T')[0] || new Date().toISOString().split('T')[0];
  const divisionUrl = `https://votes.parliament.uk/votes/commons/division/${divisionId}`;

  const entityIds = enrichEntityIdsCentral([], divisionTitle, '');

  // Detect whips
  const allAyes = [...(detail.Ayes || []), ...(detail.AyeTellers || [])];
  const allNoes = [...(detail.Noes || []), ...(detail.NoTellers || [])];
  const partyWhips = detectPartyWhips(allAyes, allNoes);

  const rows: Array<Record<string, unknown>> = [];

  function addVote(
    memberId: number,
    memberParty: string,
    vote: 'aye' | 'no' | 'teller_aye' | 'teller_no',
  ) {
    const politicianId = polMap.get(memberId);
    if (!politicianId) return; // Not in our politician set

    const baseVote = vote.startsWith('teller_') ? (vote === 'teller_aye' ? 'aye' : 'no') : vote;
    const whipDirection = partyWhips.get(memberParty) ?? null;
    const brokeWhip = whipDirection !== null ? baseVote !== whipDirection : null;

    rows.push({
      politician_id: politicianId,
      evidence_type: 'division_vote',
      source: 'parliament-api',
      source_id: `commons-division-${divisionId}-member-${memberId}`,
      source_url: divisionUrl,
      occurred_at: new Date(divisionDate).toISOString(),
      raw_content: `${divisionTitle}: voted ${vote}`,
      parsed: {
        division_id: divisionId,
        division_title: divisionTitle,
        vote,
        whipped: whipDirection !== null,
        whip_direction: whipDirection,
        broke_whip: brokeWhip,
        bill_ref: null,
        amendment_ref: null,
      },
      topic_tags: [],
      entity_ids: entityIds,
      fingerprint: makeFingerprint(politicianId, 'division_vote', `commons-${divisionId}-${memberId}`),
    });
  }

  for (const v of (detail.Ayes || [])) addVote(v.MemberId, v.Party, 'aye');
  for (const v of (detail.Noes || [])) addVote(v.MemberId, v.Party, 'no');
  for (const v of (detail.AyeTellers || [])) addVote(v.MemberId, v.Party, 'teller_aye');
  for (const v of (detail.NoTellers || [])) addVote(v.MemberId, v.Party, 'teller_no');

  return rows;
}

// -- Lords divisions ---------------------------------------------------------

async function processLordsDivision(
  divisionId: number,
  polMap: Map<number, string>,
): Promise<Array<Record<string, unknown>>> {
  const detail = await fetchJson<LordsDivisionDetail>(
    `${LORDS_DIVISIONS_API}/${divisionId}`,
    `Lords Division ${divisionId}`,
  );

  if (!detail) return [];

  const divisionTitle = detail.Title || '';
  const divisionDate = detail.Date?.split('T')[0] || new Date().toISOString().split('T')[0];
  const divisionUrl = `https://votes.parliament.uk/votes/lords/division/${divisionId}`;

  const entityIds = enrichEntityIdsCentral([], divisionTitle, '');

  const allAyes = [...(detail.Contents || []), ...(detail.ContentTellers || [])];
  const allNoes = [...(detail.NotContents || []), ...(detail.NotContentTellers || [])];
  const partyWhips = detectPartyWhips(allAyes, allNoes);

  const rows: Array<Record<string, unknown>> = [];

  function addVote(
    memberId: number,
    memberParty: string,
    vote: 'aye' | 'no' | 'teller_aye' | 'teller_no',
  ) {
    const politicianId = polMap.get(memberId);
    if (!politicianId) return;

    const baseVote = vote.startsWith('teller_') ? (vote === 'teller_aye' ? 'aye' : 'no') : vote;
    const whipDirection = partyWhips.get(memberParty) ?? null;
    const brokeWhip = whipDirection !== null ? baseVote !== whipDirection : null;

    rows.push({
      politician_id: politicianId,
      evidence_type: 'division_vote',
      source: 'parliament-api',
      source_id: `lords-division-${divisionId}-member-${memberId}`,
      source_url: divisionUrl,
      occurred_at: new Date(divisionDate).toISOString(),
      raw_content: `${divisionTitle}: voted ${vote}`,
      parsed: {
        division_id: divisionId,
        division_title: divisionTitle,
        vote,
        whipped: whipDirection !== null,
        whip_direction: whipDirection,
        broke_whip: brokeWhip,
        bill_ref: null,
        amendment_ref: null,
      },
      topic_tags: [],
      entity_ids: entityIds,
      fingerprint: makeFingerprint(politicianId, 'division_vote', `lords-${divisionId}-${memberId}`),
    });
  }

  for (const v of (detail.Contents || [])) addVote(v.MemberId, v.Party, 'aye');
  for (const v of (detail.NotContents || [])) addVote(v.MemberId, v.Party, 'no');
  for (const v of (detail.ContentTellers || [])) addVote(v.MemberId, v.Party, 'teller_aye');
  for (const v of (detail.NotContentTellers || [])) addVote(v.MemberId, v.Party, 'teller_no');

  return rows;
}

// -- Main collectors ---------------------------------------------------------

export interface DivisionsCollectorOptions {
  backfillYears?: number;
  since?: Date;
}

/**
 * Collect person-level division votes from Commons.
 */
export async function collectCommonsDivisionVotes(
  options: DivisionsCollectorOptions = {},
): Promise<{ inserted: number; skipped: number }> {
  console.log('\n--- Commons Division Votes (person-level) ---');

  const polMap = await loadPoliticianMap();
  if (polMap.size === 0) {
    console.log('  No politicians in database — run migrateEntities() first');
    return { inserted: 0, skipped: 0 };
  }

  const sinceDate = options.since
    ? options.since.toISOString().split('T')[0]
    : options.backfillYears
      ? monthsAgo(options.backfillYears * 12)
      : monthsAgo(12);

  // First, get the list of divisions
  const searchUrl = `${COMMONS_DIVISIONS_API}/search?queryParameters.startDate=${sinceDate}`;
  const divisionList = await fetchJson<CommonsDivisionListItem[]>(searchUrl, 'Commons divisions list');

  if (!divisionList || divisionList.length === 0) {
    console.log('  No divisions found');
    return { inserted: 0, skipped: 0 };
  }

  console.log(`  Found ${divisionList.length} divisions since ${sinceDate}`);

  let totalInserted = 0;
  let totalSkipped = 0;

  // Process in batches of 10 divisions
  for (let i = 0; i < divisionList.length; i += 10) {
    const batch = divisionList.slice(i, i + 10);

    const allRows: Array<Record<string, unknown>> = [];

    for (const div of batch) {
      const rows = await processCommonsDivision(div.DivisionId, polMap);
      allRows.push(...rows);
      await delay(200);
    }

    if (allRows.length > 0) {
      const result = await upsertEvidence(allRows);
      totalInserted += result.inserted;
      totalSkipped += result.skipped;
    }

    if ((i + 10) % 100 === 0) {
      console.log(`  Progress: ${Math.min(i + 10, divisionList.length)}/${divisionList.length} divisions, ${totalInserted} votes inserted`);
    }
  }

  console.log(`  Commons votes: ${totalInserted} inserted, ${totalSkipped} skipped`);
  return { inserted: totalInserted, skipped: totalSkipped };
}

/**
 * Collect person-level division votes from Lords.
 */
export async function collectLordsDivisionVotes(
  options: DivisionsCollectorOptions = {},
): Promise<{ inserted: number; skipped: number }> {
  console.log('\n--- Lords Division Votes (person-level) ---');

  const polMap = await loadPoliticianMap();
  if (polMap.size === 0) {
    console.log('  No politicians in database — run migrateEntities() first');
    return { inserted: 0, skipped: 0 };
  }

  const sinceDate = options.since
    ? options.since.toISOString().split('T')[0]
    : options.backfillYears
      ? monthsAgo(options.backfillYears * 12)
      : monthsAgo(12);

  const searchUrl = `${LORDS_DIVISIONS_API}/search?StartDate=${sinceDate}`;
  const divisionList = await fetchJson<LordsDivisionListItem[]>(searchUrl, 'Lords divisions list');

  if (!divisionList || divisionList.length === 0) {
    console.log('  No Lords divisions found');
    return { inserted: 0, skipped: 0 };
  }

  console.log(`  Found ${divisionList.length} Lords divisions since ${sinceDate}`);

  let totalInserted = 0;
  let totalSkipped = 0;

  for (let i = 0; i < divisionList.length; i += 10) {
    const batch = divisionList.slice(i, i + 10);

    const allRows: Array<Record<string, unknown>> = [];

    for (const div of batch) {
      const rows = await processLordsDivision(div.DivisionId, polMap);
      allRows.push(...rows);
      await delay(200);
    }

    if (allRows.length > 0) {
      const result = await upsertEvidence(allRows);
      totalInserted += result.inserted;
      totalSkipped += result.skipped;
    }

    if ((i + 10) % 100 === 0) {
      console.log(`  Progress: ${Math.min(i + 10, divisionList.length)}/${divisionList.length} divisions, ${totalInserted} votes inserted`);
    }
  }

  console.log(`  Lords votes: ${totalInserted} inserted, ${totalSkipped} skipped`);
  return { inserted: totalInserted, skipped: totalSkipped };
}

/**
 * Combined — collect votes from both houses.
 */
export async function collectDivisionVotes(
  options: DivisionsCollectorOptions = {},
): Promise<{ inserted: number; skipped: number }> {
  console.log('\n=== Division Votes Collector (person-level) ===');

  const commons = await collectCommonsDivisionVotes(options);
  const lords = await collectLordsDivisionVotes(options);

  const total = {
    inserted: commons.inserted + lords.inserted,
    skipped: commons.skipped + lords.skipped,
  };

  console.log(`\n=== Division Votes Complete ===`);
  console.log(`Total: ${total.inserted} inserted, ${total.skipped} skipped\n`);

  return total;
}
