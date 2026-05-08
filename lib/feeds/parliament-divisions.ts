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
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local',
  );
}

const supabase = createClient(supabaseUrl, supabaseKey);

// -- API endpoints -----------------------------------------------------------

const COMMONS_DIVISIONS_SEARCH = 'https://commonsvotes-api.parliament.uk/data/divisions.json/search';
const COMMONS_DIVISION_DETAIL = 'https://commonsvotes-api.parliament.uk/data/division'; // /{id}.json
const LORDS_DIVISIONS_SEARCH = 'https://lordsvotes-api.parliament.uk/data/Divisions/search';

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

// Commons uses PascalCase
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

// Lords uses camelCase and includes vote lists inline in search results
interface LordsDivisionSearchItem {
  divisionId: number;
  title: string;
  date: string;
  authoritativeContentCount: number;
  authoritativeNotContentCount: number;
  contents: Array<{ memberId: number; name: string; party: string }>;
  notContents: Array<{ memberId: number; name: string; party: string }>;
  contentTellers: Array<{ memberId: number; name: string; party: string }>;
  notContentTellers: Array<{ memberId: number; name: string; party: string }>;
}

// -- Politician lookup cache -------------------------------------------------

let politicianByMemberId: Map<number, string> | null = null;

async function loadPoliticianMap(): Promise<Map<number, string>> {
  if (politicianByMemberId) return politicianByMemberId;

  const { data, error } = await supabase
    .from('politicians')
    .select('id, parliament_member_id')
    .not('parliament_member_id', 'is', null)
    .limit(5000);

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
  ayes: Array<{ Party?: string; party?: string }>,
  noes: Array<{ Party?: string; party?: string }>,
): Map<string, 'aye' | 'no'> {
  const partyCounts = new Map<string, { aye: number; no: number }>();

  for (const v of ayes) {
    const p = v.Party || v.party || '';
    const c = partyCounts.get(p) ?? { aye: 0, no: 0 };
    c.aye++;
    partyCounts.set(p, c);
  }
  for (const v of noes) {
    const p = v.Party || v.party || '';
    const c = partyCounts.get(p) ?? { aye: 0, no: 0 };
    c.no++;
    partyCounts.set(p, c);
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
    `${COMMONS_DIVISION_DETAIL}/${divisionId}.json`,
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

/**
 * Process a Lords division directly from search results (which include vote lists).
 * No separate detail fetch needed — Lords API returns everything inline.
 */
function processLordsDivisionInline(
  div: LordsDivisionSearchItem,
  polMap: Map<number, string>,
): Array<Record<string, unknown>> {
  const divisionId = div.divisionId;
  const divisionTitle = div.title || '';
  const divisionDate = div.date?.split('T')[0] || new Date().toISOString().split('T')[0];
  const divisionUrl = `https://votes.parliament.uk/votes/lords/division/${divisionId}`;

  const entityIds = enrichEntityIdsCentral([], divisionTitle, '');

  const allAyes = [...(div.contents || []), ...(div.contentTellers || [])];
  const allNoes = [...(div.notContents || []), ...(div.notContentTellers || [])];
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

  for (const v of (div.contents || [])) addVote(v.memberId, v.party, 'aye');
  for (const v of (div.notContents || [])) addVote(v.memberId, v.party, 'no');
  for (const v of (div.contentTellers || [])) addVote(v.memberId, v.party, 'teller_aye');
  for (const v of (div.notContentTellers || [])) addVote(v.memberId, v.party, 'teller_no');

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

  // Paginate through all divisions
  let totalInserted = 0;
  let totalSkipped = 0;
  let divisionCount = 0;
  let skip = 0;
  const take = 25;
  let hasMore = true;

  while (hasMore) {
    const searchUrl = `${COMMONS_DIVISIONS_SEARCH}?queryParameters.startDate=${sinceDate}&queryParameters.skip=${skip}&queryParameters.take=${take}`;
    const page = await fetchJson<CommonsDivisionListItem[]>(searchUrl, `Commons divisions skip=${skip}`);

    if (!page || page.length === 0) {
      hasMore = false;
      break;
    }

    console.log(`  Page at skip=${skip}: ${page.length} divisions`);

    for (const div of page) {
      const rows = await processCommonsDivision(div.DivisionId, polMap);
      if (rows.length > 0) {
        await upsertEvidence(rows);
        totalInserted += rows.length;
      }
      divisionCount++;
      await delay(200);

      if (divisionCount % 50 === 0) {
        console.log(`  Progress: ${divisionCount} divisions, ~${totalInserted} votes`);
      }
    }

    skip += take;
    if (page.length < take) hasMore = false;
    await delay(300);
  }

  console.log(`  Commons: ${divisionCount} divisions, ${totalInserted} votes`);
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

  // Lords search returns vote lists inline — paginate through all
  let totalInserted = 0;
  let totalSkipped = 0;
  let divisionCount = 0;
  let skip = 0;
  const take = 25;
  let hasMore = true;

  while (hasMore) {
    const searchUrl = `${LORDS_DIVISIONS_SEARCH}?StartDate=${sinceDate}&Skip=${skip}&Take=${take}`;
    const page = await fetchJson<LordsDivisionSearchItem[]>(searchUrl, `Lords divisions skip=${skip}`);

    if (!page || page.length === 0) {
      hasMore = false;
      break;
    }

    console.log(`  Page at skip=${skip}: ${page.length} Lords divisions`);

    const allRows: Array<Record<string, unknown>> = [];
    for (const div of page) {
      const rows = processLordsDivisionInline(div, polMap);
      allRows.push(...rows);
      divisionCount++;
    }

    if (allRows.length > 0) {
      await upsertEvidence(allRows);
      totalInserted += allRows.length;
    }

    skip += take;
    if (page.length < take) hasMore = false;
    await delay(300);
  }

  console.log(`  Lords: ${divisionCount} divisions, ${totalInserted} votes`);
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
