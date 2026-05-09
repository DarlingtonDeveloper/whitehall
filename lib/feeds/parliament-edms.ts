/**
 * Parliament EDMs Collector — Person-Level
 *
 * Fetches EDM signatories from the Parliament EDM API and writes
 * `politician_evidence` rows with evidence_type = 'edm_signature' or 'edm_proposed'.
 *
 * Complements the existing `collectEdms()` in parliament.ts which writes
 * EDM summaries to feed_items.
 *
 * EDM API: https://oralquestionsandmotions-api.parliament.uk
 */

import { createClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import * as path from 'path';

import {
  enrichEntityIds as enrichEntityIdsCentral,
  extractTopicTags,
} from './entity-enrichment';

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

// -- API endpoints -----------------------------------------------------------

const EDMS_LIST_API = 'https://oralquestionsandmotions-api.parliament.uk/EarlyDayMotions/list';
const EDM_DETAIL_API = 'https://oralquestionsandmotions-api.parliament.uk/EarlyDayMotion'; // singular: /{id}

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
    const timer = setTimeout(() => controller.abort(), 15_000);

    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Whitehall-Monitor/1.0 (edms-collector)',
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

interface EdmListResponse {
  Response: EdmListItem[];
  PagingInfo: { Total: number };
}

interface EdmListItem {
  Id: number;
  Title: string;
  DateTabled: string;
  MemberId: number;
  PrimarySponsor: { MnisId: number; Name: string } | null;
  SponsorsCount: number;
  MotionText: string | null;
}

interface EdmDetailResponse {
  Response: {
    Id: number;
    Title: string;
    DateTabled: string;
    MemberId: number;
    PrimarySponsor: { MnisId: number; Name: string } | null;
    MotionText: string | null;
    Sponsors: Array<{
      Id: number;
      MemberId: number;
      Member: { MnisId: number; Name: string };
      CreatedWhen: string | null;
      IsMainSponsor?: boolean;
      Order?: number;
    }>;
  };
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

// -- Main collector ----------------------------------------------------------

export interface EdmCollectorOptions {
  backfillYears?: number;
  since?: Date;
}

export async function collectEdmSignatures(
  options: EdmCollectorOptions = {},
): Promise<{ inserted: number; skipped: number }> {
  console.log('\n=== EDM Signatures Collector (person-level) ===');

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

  // Paginate through EDM list
  let skip = 0;
  const take = 25;
  let hasMore = true;
  let totalInserted = 0;
  let totalSkipped = 0;
  let edmCount = 0;

  while (hasMore) {
    const params = new URLSearchParams({
      'Parameters.TabledSinceDate': sinceDate,
      'Parameters.Take': String(take),
      'Parameters.Skip': String(skip),
      'Parameters.OrderBy': 'DateTabledDesc',
    });

    const listUrl = `${EDMS_LIST_API}?${params}`;
    const listData = await fetchJson<EdmListResponse>(listUrl, `EDM list skip=${skip}`);

    if (!listData?.Response || listData.Response.length === 0) {
      hasMore = false;
      break;
    }

    for (const edm of listData.Response) {
      // Fetch detail for sponsor list
      const detail = await fetchJson<EdmDetailResponse>(
        `${EDM_DETAIL_API}/${edm.Id}`,
        `EDM ${edm.Id}`,
      );
      await delay(200);

      if (!detail?.Response?.Sponsors) continue;

      const edmUrl = `https://edm.parliament.uk/early-day-motion/${edm.Id}`;
      const entityIds = enrichEntityIdsCentral([], edm.Title || '', edm.MotionText || '');

      const rows: Array<Record<string, unknown>> = [];
      const primaryMemberId = edm.PrimarySponsor?.MnisId ?? edm.MemberId;

      for (const sponsor of detail.Response.Sponsors) {
        const memberId = sponsor.Member?.MnisId ?? sponsor.MemberId;
        const politicianId = polMap.get(memberId);
        if (!politicianId) continue;

        const isPrimary = memberId === primaryMemberId;
        const evidenceType = isPrimary ? 'edm_proposed' : 'edm_signature';

        rows.push({
          politician_id: politicianId,
          evidence_type: evidenceType,
          source: 'parliament-api',
          source_id: `edm-${edm.Id}-member-${memberId}`,
          source_url: edmUrl,
          occurred_at: sponsor.CreatedWhen
            ? new Date(sponsor.CreatedWhen).toISOString()
            : new Date(edm.DateTabled).toISOString(),
          raw_content: `${edm.Title}${edm.MotionText ? ': ' + edm.MotionText.slice(0, 500) : ''}`,
          parsed: {
            edm_id: String(edm.Id),
            edm_title: edm.Title || '',
            primary_signatory_id: primaryMemberId,
          },
          topic_tags: extractTopicTags(edm.Title || '', edm.MotionText || ''),
          entity_ids: entityIds,
          fingerprint: makeFingerprint(politicianId, evidenceType, `edm-${edm.Id}-${memberId}`),
        });
      }

      if (rows.length > 0) {
        const result = await upsertEvidence(rows);
        totalInserted += result.inserted;
        totalSkipped += result.skipped;
      }

      edmCount++;
    }

    skip += take;
    if (skip >= 2000) hasMore = false; // Safety cap

    console.log(`  Progress: ${edmCount} EDMs processed, ${totalInserted} signatures inserted`);
    await delay(300);
  }

  console.log(`\n=== EDM Signatures Complete ===`);
  console.log(`EDMs: ${edmCount}, Signatures: ${totalInserted} inserted, ${totalSkipped} skipped\n`);

  return { inserted: totalInserted, skipped: totalSkipped };
}
