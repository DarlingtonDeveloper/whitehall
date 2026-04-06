/**
 * Parliament UK Feed Collector
 *
 * Collects data from multiple Parliament UK APIs:
 *  - Bills API
 *  - Written Questions API
 *  - Commons Divisions API
 *  - Lords Divisions API
 *  - Written Statements API
 *
 * Covers the last 12 months of parliamentary activity.
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

const BILLS_API = 'https://bills-api.parliament.uk/api/v1/Bills';
const WRITTEN_QUESTIONS_API =
  'https://questions-statements-api.parliament.uk/api/writtenquestions/questions';
const COMMONS_DIVISIONS_API =
  'https://commonsvotes-api.parliament.uk/data/divisions.json/search';
const LORDS_DIVISIONS_API =
  'https://lordsvotes-api.parliament.uk/data/Divisions/search';
const WRITTEN_STATEMENTS_API =
  'https://questions-statements-api.parliament.uk/api/writtenstatements/statements';
const EDMS_API =
  'https://oralquestionsandmotions-api.parliament.uk/EarlyDayMotions/list';
const ORAL_QUESTIONS_API =
  'https://questions-statements-api.parliament.uk/api/oralquestions/list';

// -- Keyword-to-entity mapping (same as hansard.ts) --------------------------

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

// -- Answering body to entity ID mapping -------------------------------------

const ANSWERING_BODY_MAP: Record<string, string[]> = {
  'Department for Energy Security and Net Zero': ['desnz'],
  'Department of Health and Social Care': ['dhsc'],
  'Department for Education': ['dfe'],
  'Department for Transport': ['dft'],
  'Department for Levelling Up, Housing and Communities': ['dluhc'],
  'Ministry of Housing, Communities and Local Government': ['dluhc'],
  'Department for Environment, Food and Rural Affairs': ['defra'],
  'HM Treasury': ['treasury'],
  'Home Office': ['home-office'],
  'Ministry of Defence': ['mod'],
  'Ministry of Justice': ['moj'],
  'Foreign, Commonwealth and Development Office': ['fcdo'],
  'Cabinet Office': ['co'],
  'Department for Business and Trade': ['dbt'],
  'Department for Culture, Media and Sport': ['dcms'],
  'Department for Science, Innovation and Technology': ['dsit'],
  'Department for Work and Pensions': ['dwp'],
  'HM Revenue and Customs': ['treasury'],
  'Attorney General': ['moj'],
  'Northern Ireland Office': ['co'],
  'Scotland Office': ['co'],
  'Wales Office': ['co'],
  'Leader of the House': ['co'],
};

// -- Helpers -----------------------------------------------------------------

function makeFingerprint(url: string, title: string): string {
  return crypto
    .createHash('sha256')
    .update(`${url}||${title}`)
    .digest('hex');
}

function stripHtml(str: string): string {
  return str.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function monthsAgo(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
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

function enrichFromAnsweringBody(
  answeringBody: string | undefined,
  existingIds: string[],
): string[] {
  const ids = new Set<string>(existingIds);
  if (answeringBody && ANSWERING_BODY_MAP[answeringBody]) {
    for (const id of ANSWERING_BODY_MAP[answeringBody]) {
      ids.add(id);
    }
  }
  // Remove the generic 'parliament' tag if we now have specific entities
  if (ids.size > 1) {
    ids.delete('parliament');
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
    /\bproposed\b/.test(text) ||
    /\breport stage\b/.test(text) ||
    /\bthird reading\b/.test(text) ||
    /\broyal assent\b/.test(text)
  ) {
    return 'AMBER';
  }

  return 'GREEN';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson<T>(url: string, label: string): Promise<T | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);

    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Whitehall-Monitor/1.0 (parliament-collector)',
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

async function upsertBatch(
  rows: Array<Record<string, unknown>>,
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;
  const batchSize = 25;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);

    const { data, error } = await supabase
      .from('feed_items')
      .upsert(batch, { onConflict: 'fingerprint', ignoreDuplicates: true })
      .select('id');

    if (error) {
      console.warn(`    [ERR] Upsert failed: ${error.message}`);
      skipped += batch.length;
      continue;
    }

    const insertedCount = data?.length ?? 0;
    inserted += insertedCount;
    skipped += batch.length - insertedCount;
  }

  return { inserted, skipped };
}

// -- Bills API types ---------------------------------------------------------

interface BillSummary {
  billId: number;
  shortTitle?: string;
  longTitle?: string;
  currentHouse?: string;
  lastUpdate?: string;
}

interface BillsResponse {
  items?: Array<{ value: BillSummary }>;
  totalResults?: number;
}

// -- Written Questions API types ---------------------------------------------

interface WrittenQuestion {
  value?: {
    id?: number;
    questionText?: string;
    answeringBodyName?: string;
    dateTabled?: string;
    dateAnswered?: string;
    answerText?: string;
    uin?: string;
  };
}

interface WrittenQuestionsResponse {
  results?: WrittenQuestion[];
  totalResults?: number;
}

// -- Commons Divisions API types ---------------------------------------------

interface CommonsDivision {
  DivisionId: number;
  Title?: string;
  Date?: string;
  AyeCount?: number;
  NoCount?: number;
}

// -- Lords Divisions API types -----------------------------------------------

interface LordsDivision {
  DivisionId: number;
  Title?: string;
  Date?: string;
  AuthorityCount?: number;
  NotAuthorityCount?: number;
}

// -- Written Statements API types --------------------------------------------

interface WrittenStatement {
  value?: {
    id?: number;
    title?: string;
    dateMade?: string;
    memberRole?: string;
    answeringBodyName?: string;
    text?: string;
    uin?: string;
  };
}

interface WrittenStatementsResponse {
  results?: WrittenStatement[];
  totalResults?: number;
}

// == Collectors ==============================================================

// -- 1. Bills ----------------------------------------------------------------

export async function collectBills(): Promise<{ inserted: number; skipped: number }> {
  console.log('\n--- Bills ---');

  const sinceDate = monthsAgo(12);
  const seenFingerprints = new Set<string>();
  const allRows: Array<Record<string, unknown>> = [];
  let skip = 0;
  const take = 50;
  let hasMore = true;

  while (hasMore) {
    const url =
      `${BILLS_API}?SortOrder=DateUpdatedDesc&Skip=${skip}&Take=${take}`;

    const data = await fetchJson<BillsResponse>(url, `Bills skip=${skip}`);
    if (!data || !data.items || data.items.length === 0) {
      hasMore = false;
      break;
    }

    let staleCount = 0;

    for (const item of data.items) {
      const bill = item.value;
      if (!bill) continue;

      // Stop paginating once bills are older than 12 months
      if (bill.lastUpdate && bill.lastUpdate < sinceDate) {
        staleCount++;
        continue;
      }

      const title = bill.shortTitle || bill.longTitle || 'Untitled Bill';
      const billUrl = `https://bills.parliament.uk/bills/${bill.billId}`;
      const fingerprint = makeFingerprint(billUrl, title);

      if (seenFingerprints.has(fingerprint)) continue;
      seenFingerprints.add(fingerprint);

      const bodyParts: string[] = [];
      if (bill.longTitle) bodyParts.push(bill.longTitle);
      if (bill.currentHouse) bodyParts.push(`Current house: ${bill.currentHouse}`);
      const body = bodyParts.join(' — ').slice(0, 2000);

      const entityIds = enrichEntityIds(title, body);
      const ragStatus = determineRagStatus(title, body);
      const publishedAt = bill.lastUpdate
        ? new Date(bill.lastUpdate).toISOString()
        : new Date().toISOString();

      allRows.push({
        source_type: 'committee',
        source_name: 'Parliament - Bills',
        title,
        url: billUrl,
        published_at: publishedAt,
        body: body || null,
        entity_ids: entityIds,
        rag_status: ragStatus.toLowerCase(),
        relevance_score: 0.4,
        fingerprint,
        is_forward_scan: false,
      });
    }

    // If the majority of items on this page are stale, stop
    if (staleCount > take / 2) {
      hasMore = false;
    } else {
      skip += take;
      // Some APIs have high total counts; cap pagination
      if (skip >= 500) hasMore = false;
    }

    await delay(300);
  }

  console.log(`  Fetched ${allRows.length} bills`);
  const result = await upsertBatch(allRows);
  console.log(`  Inserted: ${result.inserted}, Skipped: ${result.skipped}`);
  return result;
}

// -- 2. Written Questions ----------------------------------------------------

export async function collectWrittenQuestions(): Promise<{ inserted: number; skipped: number }> {
  console.log('\n--- Written Questions ---');

  const sinceDate = monthsAgo(12);
  const seenFingerprints = new Set<string>();
  const allRows: Array<Record<string, unknown>> = [];
  let skip = 0;
  const take = 50;
  let hasMore = true;

  while (hasMore) {
    const params = new URLSearchParams({
      answeredWhenFrom: sinceDate,
      take: String(take),
      skip: String(skip),
    });

    const url = `${WRITTEN_QUESTIONS_API}?${params.toString()}`;
    const data = await fetchJson<WrittenQuestionsResponse>(url, `WrittenQuestions skip=${skip}`);

    if (!data || !data.results || data.results.length === 0) {
      hasMore = false;
      break;
    }

    for (const item of data.results) {
      const q = item.value;
      if (!q) continue;

      const title = q.questionText
        ? stripHtml(q.questionText).slice(0, 300)
        : 'Written Question';
      const dateSlug = q.dateTabled ? q.dateTabled.split('T')[0] : '';
      const questionUrl = dateSlug && q.uin
        ? `https://questions-statements.parliament.uk/written-questions/detail/${dateSlug}/${q.uin}`
        : dateSlug
          ? `https://questions-statements.parliament.uk/written-questions/detail/${dateSlug}/${q.uin || q.id}`
          : `https://questions-statements.parliament.uk/written-questions/detail/${q.uin || q.id}`;
      const fingerprint = makeFingerprint(questionUrl, title);

      if (seenFingerprints.has(fingerprint)) continue;
      seenFingerprints.add(fingerprint);

      const bodyParts: string[] = [];
      if (q.answeringBodyName) bodyParts.push(`Answering body: ${q.answeringBodyName}`);
      if (q.answerText) bodyParts.push(stripHtml(q.answerText));
      const body = bodyParts.join(' — ').slice(0, 2000);

      let entityIds = enrichEntityIds(title, body);
      entityIds = enrichFromAnsweringBody(q.answeringBodyName, entityIds);

      const ragStatus = determineRagStatus(title, body);
      const publishedAt = q.dateAnswered || q.dateTabled
        ? new Date(q.dateAnswered || q.dateTabled!).toISOString()
        : new Date().toISOString();

      allRows.push({
        source_type: 'hansard',
        source_name: 'Parliament - Written Questions',
        title,
        url: questionUrl,
        published_at: publishedAt,
        body: body || null,
        entity_ids: entityIds,
        rag_status: ragStatus.toLowerCase(),
        relevance_score: 0.3,
        fingerprint,
        is_forward_scan: false,
      });
    }

    skip += take;
    if (skip >= 500) hasMore = false;

    await delay(300);
  }

  console.log(`  Fetched ${allRows.length} written questions`);
  const result = await upsertBatch(allRows);
  console.log(`  Inserted: ${result.inserted}, Skipped: ${result.skipped}`);
  return result;
}

// -- 3. Commons Divisions ----------------------------------------------------

export async function collectDivisions(): Promise<{ inserted: number; skipped: number }> {
  console.log('\n--- Commons Divisions ---');

  const sinceDate = monthsAgo(12);
  const seenFingerprints = new Set<string>();
  const allRows: Array<Record<string, unknown>> = [];

  const url =
    `${COMMONS_DIVISIONS_API}?queryParameters.startDate=${sinceDate}`;
  const data = await fetchJson<CommonsDivision[]>(url, 'CommonsDivisions');

  if (data && Array.isArray(data)) {
    for (const div of data) {
      if (!div.Title || !div.DivisionId) continue;
      const title = div.Title;
      const divUrl = `https://votes.parliament.uk/votes/commons/division/${div.DivisionId}`;
      const fingerprint = makeFingerprint(divUrl, title);

      if (seenFingerprints.has(fingerprint)) continue;
      seenFingerprints.add(fingerprint);

      const bodyParts: string[] = [];
      if (div.AyeCount !== undefined && div.NoCount !== undefined) {
        bodyParts.push(`Ayes: ${div.AyeCount}, Noes: ${div.NoCount}`);
      }
      const body = bodyParts.join(' — ').slice(0, 2000);

      const entityIds = enrichEntityIds(title, body);
      const ragStatus = determineRagStatus(title, body);
      const publishedAt = div.Date
        ? new Date(div.Date).toISOString()
        : new Date().toISOString();

      allRows.push({
        source_type: 'hansard',
        source_name: 'Parliament - Commons Divisions',
        title,
        url: divUrl,
        published_at: publishedAt,
        body: body || null,
        entity_ids: entityIds,
        rag_status: ragStatus.toLowerCase(),
        relevance_score: 0.4,
        fingerprint,
        is_forward_scan: false,
      });
    }
  }

  console.log(`  Fetched ${allRows.length} commons divisions`);
  const result = await upsertBatch(allRows);
  console.log(`  Inserted: ${result.inserted}, Skipped: ${result.skipped}`);
  return result;
}

// -- 4. Lords Divisions ------------------------------------------------------

export async function collectLordsDivisions(): Promise<{ inserted: number; skipped: number }> {
  console.log('\n--- Lords Divisions ---');

  const sinceDate = monthsAgo(12);
  const seenFingerprints = new Set<string>();
  const allRows: Array<Record<string, unknown>> = [];

  const url = `${LORDS_DIVISIONS_API}?StartDate=${sinceDate}`;
  const data = await fetchJson<LordsDivision[]>(url, 'LordsDivisions');

  if (data && Array.isArray(data)) {
    for (const div of data) {
      if (!div.Title || !div.DivisionId) continue;
      const title = div.Title;
      const divUrl = `https://votes.parliament.uk/votes/lords/division/${div.DivisionId}`;
      const fingerprint = makeFingerprint(divUrl, title);

      if (seenFingerprints.has(fingerprint)) continue;
      seenFingerprints.add(fingerprint);

      const bodyParts: string[] = [];
      if (div.AuthorityCount !== undefined && div.NotAuthorityCount !== undefined) {
        bodyParts.push(
          `Content: ${div.AuthorityCount}, Not-Content: ${div.NotAuthorityCount}`,
        );
      }
      const body = bodyParts.join(' — ').slice(0, 2000);

      const entityIds = enrichEntityIds(title, body);
      const ragStatus = determineRagStatus(title, body);
      const publishedAt = div.Date
        ? new Date(div.Date).toISOString()
        : new Date().toISOString();

      allRows.push({
        source_type: 'hansard',
        source_name: 'Parliament - Lords Divisions',
        title,
        url: divUrl,
        published_at: publishedAt,
        body: body || null,
        entity_ids: entityIds,
        rag_status: ragStatus.toLowerCase(),
        relevance_score: 0.4,
        fingerprint,
        is_forward_scan: false,
      });
    }
  }

  console.log(`  Fetched ${allRows.length} lords divisions`);
  const result = await upsertBatch(allRows);
  console.log(`  Inserted: ${result.inserted}, Skipped: ${result.skipped}`);
  return result;
}

// -- 5. Written Statements ---------------------------------------------------

export async function collectWrittenStatements(): Promise<{ inserted: number; skipped: number }> {
  console.log('\n--- Written Statements ---');

  const sinceDate = monthsAgo(12);
  const seenFingerprints = new Set<string>();
  const allRows: Array<Record<string, unknown>> = [];
  let skip = 0;
  const take = 50;
  let hasMore = true;

  while (hasMore) {
    const params = new URLSearchParams({
      madeWhenFrom: sinceDate,
      take: String(take),
      skip: String(skip),
    });

    const url = `${WRITTEN_STATEMENTS_API}?${params.toString()}`;
    const data = await fetchJson<WrittenStatementsResponse>(url, `WrittenStatements skip=${skip}`);

    if (!data || !data.results || data.results.length === 0) {
      hasMore = false;
      break;
    }

    for (const item of data.results) {
      const s = item.value;
      if (!s) continue;

      const title = s.title || 'Written Statement';
      const dateSlug = s.dateMade ? s.dateMade.split('T')[0] : '';
      const statementUrl = dateSlug && s.uin
        ? `https://questions-statements.parliament.uk/written-statements/detail/${dateSlug}/${s.uin}`
        : dateSlug
          ? `https://questions-statements.parliament.uk/written-statements/detail/${dateSlug}/${s.uin || s.id}`
          : `https://questions-statements.parliament.uk/written-statements/detail/${s.uin || s.id}`;
      const fingerprint = makeFingerprint(statementUrl, title);

      if (seenFingerprints.has(fingerprint)) continue;
      seenFingerprints.add(fingerprint);

      const bodyParts: string[] = [];
      if (s.memberRole) bodyParts.push(`By: ${s.memberRole}`);
      if (s.answeringBodyName) bodyParts.push(`Department: ${s.answeringBodyName}`);
      if (s.text) bodyParts.push(stripHtml(s.text));
      const body = bodyParts.join(' — ').slice(0, 2000);

      let entityIds = enrichEntityIds(title, body);
      entityIds = enrichFromAnsweringBody(s.answeringBodyName, entityIds);

      const ragStatus = determineRagStatus(title, body);
      const publishedAt = s.dateMade
        ? new Date(s.dateMade).toISOString()
        : new Date().toISOString();

      allRows.push({
        source_type: 'hansard',
        source_name: 'Parliament - Written Statements',
        title,
        url: statementUrl,
        published_at: publishedAt,
        body: body || null,
        entity_ids: entityIds,
        rag_status: ragStatus.toLowerCase(),
        relevance_score: 0.35,
        fingerprint,
        is_forward_scan: false,
      });
    }

    skip += take;
    if (skip >= 500) hasMore = false;

    await delay(300);
  }

  console.log(`  Fetched ${allRows.length} written statements`);
  const result = await upsertBatch(allRows);
  console.log(`  Inserted: ${result.inserted}, Skipped: ${result.skipped}`);
  return result;
}

// -- 6. Early Day Motions (EDMs) ---------------------------------------------

interface EdmResult {
  id: number;
  title?: string;
  dateTabled?: string;
  primarySponsor?: { name?: string };
  numberOfSignatures?: number;
  status?: string;
  motionText?: string;
}

interface EdmsResponse {
  Response?: EdmResult[];
  PagingInfo?: { Total?: number };
}

export async function collectEdms(): Promise<{ inserted: number; skipped: number }> {
  console.log('\n--- Early Day Motions ---');

  const sinceDate = monthsAgo(12);
  const seenFingerprints = new Set<string>();
  const allRows: Array<Record<string, unknown>> = [];
  let skip = 0;
  const take = 25;
  let hasMore = true;

  while (hasMore) {
    const params = new URLSearchParams({
      'Parameters.TabledSinceDate': sinceDate,
      'Parameters.Take': String(take),
      'Parameters.Skip': String(skip),
      'Parameters.OrderBy': 'DateTabledDesc',
    });

    const url = `${EDMS_API}?${params.toString()}`;
    const data = await fetchJson<EdmsResponse>(url, `EDMs skip=${skip}`);

    if (!data || !data.Response || data.Response.length === 0) {
      hasMore = false;
      break;
    }

    for (const edm of data.Response) {
      if (!edm.title) continue;

      const title = `Early Day Motion: ${edm.title}`;
      const edmUrl = `https://edm.parliament.uk/early-day-motion/${edm.id}`;
      const fingerprint = makeFingerprint(edmUrl, edm.title);

      if (seenFingerprints.has(fingerprint)) continue;
      seenFingerprints.add(fingerprint);

      const bodyParts: string[] = [];
      if (edm.primarySponsor?.name) bodyParts.push(`Sponsor: ${edm.primarySponsor.name}`);
      if (edm.numberOfSignatures) bodyParts.push(`Signatures: ${edm.numberOfSignatures}`);
      if (edm.motionText) bodyParts.push(stripHtml(edm.motionText));
      const body = bodyParts.join(' — ').slice(0, 2000);

      const entityIds = enrichEntityIds(title, body);
      const ragStatus = determineRagStatus(title, body);
      const publishedAt = edm.dateTabled
        ? new Date(edm.dateTabled).toISOString()
        : new Date().toISOString();

      allRows.push({
        source_type: 'hansard',
        source_name: 'Parliament - Early Day Motions',
        title,
        url: edmUrl,
        published_at: publishedAt,
        body: body || null,
        entity_ids: entityIds,
        rag_status: ragStatus.toLowerCase(),
        relevance_score: 0.25,
        fingerprint,
        is_forward_scan: false,
        raw_data: {
          signatures: edm.numberOfSignatures,
          status: edm.status,
        },
      });
    }

    skip += take;
    if (skip >= 300) hasMore = false;

    await delay(300);
  }

  console.log(`  Fetched ${allRows.length} EDMs`);
  const result = await upsertBatch(allRows);
  console.log(`  Inserted: ${result.inserted}, Skipped: ${result.skipped}`);
  return result;
}

// -- 7. Oral Questions -------------------------------------------------------

interface OralQuestion {
  value?: {
    id?: number;
    questionText?: string;
    answeringBodyName?: string;
    questionDate?: string;
    askingMember?: { name?: string };
    answerText?: string;
    uin?: string;
  };
}

interface OralQuestionsResponse {
  results?: OralQuestion[];
  totalResults?: number;
}

export async function collectOralQuestions(): Promise<{ inserted: number; skipped: number }> {
  console.log('\n--- Oral Questions ---');

  const sinceDate = monthsAgo(12);
  const seenFingerprints = new Set<string>();
  const allRows: Array<Record<string, unknown>> = [];
  let skip = 0;
  const take = 50;
  let hasMore = true;

  while (hasMore) {
    const params = new URLSearchParams({
      answeringDateStart: sinceDate,
      take: String(take),
      skip: String(skip),
    });

    const url = `${ORAL_QUESTIONS_API}?${params.toString()}`;
    const data = await fetchJson<OralQuestionsResponse>(url, `OralQuestions skip=${skip}`);

    if (!data || !data.results || data.results.length === 0) {
      hasMore = false;
      break;
    }

    for (const item of data.results) {
      const q = item.value;
      if (!q) continue;

      const questionText = q.questionText ? stripHtml(q.questionText) : 'Oral Question';
      const title = questionText.slice(0, 300);
      const dateSlug = q.questionDate ? q.questionDate.split('T')[0] : '';
      const questionUrl = q.uin
        ? `https://questions-statements.parliament.uk/oral-questions/detail/${q.uin}`
        : `https://questions-statements.parliament.uk/oral-questions`;
      const fingerprint = makeFingerprint(questionUrl, title);

      if (seenFingerprints.has(fingerprint)) continue;
      seenFingerprints.add(fingerprint);

      const bodyParts: string[] = [];
      if (q.askingMember?.name) bodyParts.push(`Asked by: ${q.askingMember.name}`);
      if (q.answeringBodyName) bodyParts.push(`Answering body: ${q.answeringBodyName}`);
      if (q.answerText) bodyParts.push(stripHtml(q.answerText));
      const body = bodyParts.join(' — ').slice(0, 2000);

      let entityIds = enrichEntityIds(title, body);
      entityIds = enrichFromAnsweringBody(q.answeringBodyName, entityIds);

      const ragStatus = determineRagStatus(title, body);
      const publishedAt = q.questionDate
        ? new Date(q.questionDate).toISOString()
        : new Date().toISOString();

      allRows.push({
        source_type: 'hansard',
        source_name: 'Parliament - Oral Questions',
        title,
        url: questionUrl,
        published_at: publishedAt,
        body: body || null,
        entity_ids: entityIds,
        rag_status: ragStatus.toLowerCase(),
        relevance_score: 0.3,
        fingerprint,
        is_forward_scan: false,
      });
    }

    skip += take;
    if (skip >= 500) hasMore = false;

    await delay(300);
  }

  console.log(`  Fetched ${allRows.length} oral questions`);
  const result = await upsertBatch(allRows);
  console.log(`  Inserted: ${result.inserted}, Skipped: ${result.skipped}`);
  return result;
}

// == Combined collector ======================================================

export async function collectParliament(): Promise<{ inserted: number; skipped: number }> {
  console.log('\n=== Parliament Feed Collector ===');
  console.log(`Date range: last 12 months (since ${monthsAgo(12)})`);

  let totalInserted = 0;
  let totalSkipped = 0;

  const collectors: Array<{
    name: string;
    fn: () => Promise<{ inserted: number; skipped: number }>;
  }> = [
    { name: 'Bills', fn: collectBills },
    { name: 'Written Questions', fn: collectWrittenQuestions },
    { name: 'Commons Divisions', fn: collectDivisions },
    { name: 'Lords Divisions', fn: collectLordsDivisions },
    { name: 'Written Statements', fn: collectWrittenStatements },
    { name: 'Early Day Motions', fn: collectEdms },
    { name: 'Oral Questions', fn: collectOralQuestions },
  ];

  for (const collector of collectors) {
    try {
      const result = await collector.fn();
      totalInserted += result.inserted;
      totalSkipped += result.skipped;
    } catch (err) {
      console.error(`  [ERR] ${collector.name} collection failed:`, err);
      console.log('  Continuing with next collector...\n');
    }
  }

  console.log(`\n=== Parliament Collection Complete ===`);
  console.log(`Total inserted: ${totalInserted}`);
  console.log(`Total skipped:  ${totalSkipped}\n`);

  return { inserted: totalInserted, skipped: totalSkipped };
}
