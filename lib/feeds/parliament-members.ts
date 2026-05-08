/**
 * Parliament Members API Collector
 *
 * Populates the `politicians` and `politician_roles` tables by:
 *  1. Migrating from entities.json currentHolder → Members API lookup
 *  2. Nightly sync of member details (party, constituency, roles, portrait)
 *  3. Collecting register of interests + committee memberships as evidence
 *
 * Members API docs: https://members-api.parliament.uk/index.html
 */

import { createClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import * as path from 'path';

import {
  enrichEntityIds as enrichEntityIdsCentral,
  extractTopicTags,
} from './entity-enrichment';

import type {
  MemberCandidate,
} from '@/types/politician';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
// Use service role key to bypass RLS (politician tables are write-protected for anon)
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local',
  );
}

const supabase = createClient(supabaseUrl, supabaseKey);

// -- API endpoints -----------------------------------------------------------

const MEMBERS_API = 'https://members-api.parliament.uk/api/Members';

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

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function fetchJson<T>(url: string, label: string): Promise<T | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);

    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Whitehall-Monitor/1.0 (members-collector)',
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

// -- Members API types -------------------------------------------------------

interface MembersSearchResponse {
  items: MemberSearchItem[];
  totalResults: number;
}

interface MemberSearchItem {
  value: MemberValue;
}

interface MemberValue {
  id: number;
  nameDisplayAs: string;
  nameFullTitle: string;
  gender: string;
  latestParty: { id: number; name: string; abbreviation: string };
  latestHouseMembership?: {
    membershipFrom: string;
    membershipFromId: number;
    house: number; // 1 = Commons, 2 = Lords
    membershipStartDate: string;
    membershipEndDate: string | null;
    membershipEndReason: string | null;
    membershipStatus?: {
      statusIsActive: boolean;
      statusDescription: string;
    };
  };
  thumbnailUrl: string;
}

interface MemberDetailResponse {
  value: MemberValue;
}

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
    representations: Array<{
      constituencyStart: string;
      constituencyEnd: string | null;
      house: number;
      name: string;
      id: number;
      startDate: string;
      endDate: string | null;
    }>;
    houseMemberships: BiographyEntry[];
    governmentPosts: BiographyEntry[];
    oppositionPosts: BiographyEntry[];
    committeeMemberships?: BiographyEntry[];
  };
}

interface SynopsisResponse {
  value: string;
}

interface RegisterCategory {
  id: number;
  name: string;
  interests: Array<{
    id: number;
    interest: string;
    createdWhen: string;
    lastAmendedWhen: string | null;
    registeredLate: boolean;
    childInterests?: Array<{ interest: string }>;
  }>;
}

interface RegisterResponse {
  value: RegisterCategory[];
}

// -- Entity → politician migration -------------------------------------------

/**
 * Load entities.json and return entries with currentHolder.
 */
function getMinisterEntities(): Array<{ id: string; name: string; currentHolder: string; subtype: string }> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const entities = require('../../data/_extracted/entities.json') as Record<string, Record<string, unknown>>;
  return Object.entries(entities)
    .filter(([_, e]) => typeof e.currentHolder === 'string' && (e.currentHolder as string).length > 0)
    .map(([id, e]) => ({
      id,
      name: e.name as string,
      currentHolder: e.currentHolder as string,
      subtype: (e.subtype as string) || '',
    }));
}

/**
 * Search Members API for a name, return candidate matches.
 */
async function searchMember(name: string): Promise<MemberSearchItem[]> {
  // Try full name with current member filter first
  const params = new URLSearchParams({
    Name: name,
    IsCurrentMember: 'true',
  });
  const url = `${MEMBERS_API}/Search?${params}`;
  const data = await fetchJson<MembersSearchResponse>(url, `Search: ${name}`);
  const items = data?.items ?? [];
  if (items.length > 0) return items;

  // Fallback: try surname only (handles "Richard Hermer" → "Lord Hermer")
  const surname = name.split(/\s+/).pop() || name;
  if (surname !== name) {
    await delay(200);
    const fallbackParams = new URLSearchParams({
      Name: surname,
      IsCurrentMember: 'true',
    });
    const fallbackUrl = `${MEMBERS_API}/Search?${fallbackParams}`;
    const fallbackData = await fetchJson<MembersSearchResponse>(fallbackUrl, `Search fallback: ${surname}`);
    return fallbackData?.items ?? [];
  }

  return [];
}

/**
 * Score how well a Members API result matches an entity.
 * Higher = better match. Returns 0-100.
 */
function scoreMatch(
  candidate: MemberValue,
  holderName: string,
): number {
  let score = 0;

  // Name match — exact display name
  const candidateName = candidate.nameDisplayAs.toLowerCase().trim();
  const targetName = holderName.toLowerCase().trim();

  if (candidateName === targetName) {
    score += 60;
  } else if (candidateName.includes(targetName) || targetName.includes(candidateName)) {
    score += 40;
  } else {
    // Check surname match
    const candidateSurname = candidateName.split(/\s+/).pop() || '';
    const targetSurname = targetName.split(/\s+/).pop() || '';
    if (candidateSurname === targetSurname) {
      score += 25;
    }
  }

  // Current member bonus
  if (candidate.latestHouseMembership && !candidate.latestHouseMembership.membershipEndDate) {
    score += 20;
  }

  // Commons member bonus (most ministers are MPs)
  if (candidate.latestHouseMembership?.house === 1) {
    score += 10;
  }

  return score;
}

/**
 * Fetch detailed member info.
 */
async function fetchMemberDetail(memberId: number): Promise<MemberValue | null> {
  const data = await fetchJson<MemberDetailResponse>(
    `${MEMBERS_API}/${memberId}`,
    `MemberDetail ${memberId}`,
  );
  return data?.value ?? null;
}

/**
 * Fetch biography — contains representations (constituency history),
 * governmentPosts, oppositionPosts, houseMemberships, committeeMemberships.
 */
async function fetchBiography(memberId: number): Promise<BiographyResponse['value'] | null> {
  const data = await fetchJson<BiographyResponse>(
    `${MEMBERS_API}/${memberId}/Biography`,
    `Biography ${memberId}`,
  );
  return data?.value ?? null;
}

/**
 * Fetch synopsis — short bio text.
 */
async function fetchSynopsis(memberId: number): Promise<string | null> {
  const data = await fetchJson<SynopsisResponse>(
    `${MEMBERS_API}/${memberId}/Synopsis`,
    `Synopsis ${memberId}`,
  );
  if (!data?.value) return null;
  // Strip HTML tags from synopsis
  return data.value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

async function fetchRegisterInterests(memberId: number): Promise<RegisterCategory[]> {
  const data = await fetchJson<RegisterResponse>(
    `${MEMBERS_API}/${memberId}/RegisteredInterests`,
    `RegisterInterests ${memberId}`,
  );
  return data?.value ?? [];
}

// -- Upsert helpers ----------------------------------------------------------

async function upsertPolitician(row: Record<string, unknown>): Promise<boolean> {
  const { error } = await supabase
    .from('politicians')
    .upsert(row, { onConflict: 'id' });

  if (error) {
    console.warn(`  [ERR] Upsert politician ${row.id}: ${error.message}`);
    return false;
  }
  return true;
}

async function upsertRole(row: Record<string, unknown>): Promise<boolean> {
  // Check if a matching active role already exists
  const { data: existing } = await supabase
    .from('politician_roles')
    .select('id')
    .eq('politician_id', row.politician_id)
    .eq('role_entity_id', row.role_entity_id)
    .is('end_date', null)
    .limit(1);

  if (existing && existing.length > 0) {
    return true; // Role already exists
  }

  const { error } = await supabase
    .from('politician_roles')
    .insert(row);

  if (error) {
    console.warn(`  [ERR] Insert role: ${error.message}`);
    return false;
  }
  return true;
}

async function upsertEvidence(rows: Array<Record<string, unknown>>): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;
  const batchSize = 25;

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

// -- Map government post name to entity ID -----------------------------------

const GOV_POST_TO_ENTITY: Record<string, string> = {
  'prime minister': 'pm',
  'chancellor of the exchequer': 'chancellor',
  'secretary of state for energy security and net zero': 'desnz-sec',
  'secretary of state for health and social care': 'dhsc-sec',
  'secretary of state for education': 'dfe-sec',
  'secretary of state for transport': 'transport-sec',
  'secretary of state for defence': 'defence-sec',
  'secretary of state for environment, food and rural affairs': 'defra-sec',
  'secretary of state for housing, communities and local government': 'dluhc-sec',
  'secretary of state for the home department': 'home-sec',
  'secretary of state for foreign, commonwealth and development affairs': 'fcdo-sec',
  'secretary of state for justice': 'moj-sec',
  'secretary of state for business and trade': 'dbt-sec',
  'secretary of state for culture, media and sport': 'dcms-sec',
  'secretary of state for science, innovation and technology': 'science-sec',
  'secretary of state for work and pensions': 'dwp-sec',
  'secretary of state for northern ireland': 'ni-sec',
  'secretary of state for scotland': 'scotland-sec',
  'secretary of state for wales': 'wales-sec',
  'attorney general': 'attorney-gen',
  'chancellor of the duchy of lancaster': 'cabinet-office-sec',
  'leader of the house of commons': 'leader-commons',
  'leader of the house of lords': 'leader-lords',
  'chief whip': 'chief-whip-commons',
};

function govPostToEntityId(postName: string): string | null {
  const lower = postName.toLowerCase().trim();

  // Direct match
  if (GOV_POST_TO_ENTITY[lower]) return GOV_POST_TO_ENTITY[lower];

  // Partial match — try substring matching for role variants
  for (const [pattern, entityId] of Object.entries(GOV_POST_TO_ENTITY)) {
    if (lower.includes(pattern) || pattern.includes(lower)) {
      return entityId;
    }
  }

  return null;
}

function roleTypeFromSubtype(subtype: string): string {
  switch (subtype) {
    case 'prime-minister':
    case 'cabinet-minister':
    case 'minister':
      return 'minister';
    case 'shadow-cabinet':
      return 'shadow_minister';
    case 'select-committee-chair':
      return 'select_committee_chair';
    case 'select-committee-member':
      return 'select_committee_member';
    default:
      return 'minister';
  }
}

// == Main collectors =========================================================

/**
 * Migrate entities.json currentHolder entries to the politicians table.
 * Searches the Members API for each holder, creates politician + role records.
 * Ambiguous matches go to politician_match_review.
 */
export async function migrateEntities(): Promise<{
  matched: number;
  ambiguous: number;
  failed: number;
}> {
  console.log('\n=== Entity → Politician Migration ===');

  const entities = getMinisterEntities();
  console.log(`  Found ${entities.length} entities with currentHolder\n`);

  let matched = 0;
  let ambiguous = 0;
  let failed = 0;

  // Group by currentHolder to avoid duplicate searches for ministers holding multiple roles
  const holderMap = new Map<string, typeof entities>();
  for (const entity of entities) {
    const key = entity.currentHolder.toLowerCase().trim();
    const existing = holderMap.get(key) ?? [];
    existing.push(entity);
    holderMap.set(key, existing);
  }

  console.log(`  Unique holders: ${holderMap.size}\n`);

  for (const [_, holderEntities] of holderMap) {
    const holderName = holderEntities[0].currentHolder;
    const results = await searchMember(holderName);
    await delay(200); // Rate limit: ~5 req/sec

    if (results.length === 0) {
      console.log(`  [MISS] "${holderName}" — no results`);
      for (const entity of holderEntities) {
        await supabase.from('politician_match_review').upsert({
          entity_id: entity.id,
          entity_name: entity.name,
          current_holder: holderName,
          candidate_ids: [],
          status: 'pending',
          notes: 'No Members API results found',
        }, { onConflict: 'entity_id' }).select();
      }
      failed += holderEntities.length;
      continue;
    }

    // Score candidates
    const scored: Array<{ item: MemberSearchItem; score: number }> = results
      .map((item) => ({ item, score: scoreMatch(item.value, holderName) }))
      .sort((a, b) => b.score - a.score);

    const best = scored[0];

    // High-confidence match: best score >= 70 and clear gap to second
    const secondScore = scored.length > 1 ? scored[1].score : 0;
    const isConfident = best.score >= 70 && (best.score - secondScore >= 20 || scored.length === 1);

    if (!isConfident) {
      console.log(`  [AMBIG] "${holderName}" — top ${scored.length} scores: ${scored.slice(0, 3).map(s => `${s.item.value.nameDisplayAs}(${s.score})`).join(', ')}`);

      const candidates: MemberCandidate[] = scored.slice(0, 5).map((s) => ({
        member_id: s.item.value.id,
        name: s.item.value.nameDisplayAs,
        party: s.item.value.latestParty?.name ?? null,
        constituency: s.item.value.latestHouseMembership?.house === 1 ? s.item.value.latestHouseMembership.membershipFrom : null,
        house: s.item.value.latestHouseMembership?.house === 1 ? 'commons' : 'lords',
        score: s.score,
      }));

      for (const entity of holderEntities) {
        await supabase.from('politician_match_review').upsert({
          entity_id: entity.id,
          entity_name: entity.name,
          current_holder: holderName,
          candidate_ids: candidates,
          status: 'pending',
          notes: `Ambiguous: top score ${best.score}, gap to second ${best.score - secondScore}`,
        }, { onConflict: 'entity_id' }).select();
      }
      ambiguous += holderEntities.length;
      continue;
    }

    // Confident match — create politician
    const member = best.item.value;
    const politicianId = slugify(member.nameDisplayAs);
    const memberHouse = member.latestHouseMembership?.house ?? 1;
    const partyName = member.latestParty?.name ?? null;
    const constituency = memberHouse === 1
      ? member.latestHouseMembership?.membershipFrom ?? null
      : null;

    // Fetch biography (constituency history + government posts) and synopsis
    const bio = await fetchBiography(member.id);
    await delay(200);

    const synopsis = await fetchSynopsis(member.id);
    await delay(200);

    const house = memberHouse === 1 ? 'commons' : memberHouse === 2 ? 'lords' : 'commons';

    // Build constituency history from biography representations
    const representations = bio?.representations ?? [];
    const constituencyHistory = representations
      .filter((r) => r.house === 1) // Commons only
      .map((r) => ({
        constituency: r.name,
        start_date: r.startDate?.split('T')[0],
        end_date: r.endDate?.split('T')[0] ?? null,
      }));

    const houseMemberships = bio?.houseMemberships ?? [];
    const firstElected = houseMemberships.length > 0
      ? houseMemberships.reduce((earliest, h) =>
          h.startDate < earliest ? h.startDate : earliest,
          houseMemberships[0].startDate,
        ).split('T')[0]
      : (constituencyHistory.length > 0
          ? constituencyHistory.reduce((earliest, h) =>
              h.start_date < earliest ? h.start_date : earliest,
              constituencyHistory[0].start_date,
            )
          : null);

    const politicianRow = {
      id: politicianId,
      parliament_member_id: member.id,
      full_name: member.nameFullTitle || member.nameDisplayAs,
      display_name: member.nameDisplayAs,
      party: partyName,
      party_history: [],
      house,
      constituency,
      constituency_history: constituencyHistory,
      first_elected: firstElected,
      peerage_date: memberHouse === 2 ? (houseMemberships[0]?.startDate?.split('T')[0] ?? null) : null,
      portrait_url: member.thumbnailUrl || null,
      bio: synopsis,
      gender: (member.gender || '').toLowerCase() || null,
      date_of_birth: null,
      status: 'active',
    };

    const ok = await upsertPolitician(politicianRow);
    if (!ok) {
      failed += holderEntities.length;
      continue;
    }

    console.log(`  [OK] "${holderName}" → ${politicianId} (member ${member.id}, ${partyName}, ${constituency || house})`);

    // Create roles from the entity associations
    for (const entity of holderEntities) {
      await upsertRole({
        politician_id: politicianId,
        role_entity_id: entity.id,
        role_type: roleTypeFromSubtype(entity.subtype),
        start_date: '2024-07-05', // Current government formed date
        end_date: null,
        source: 'parliament-api',
      });
    }

    // Also create roles from government posts in biography
    const govPosts = bio?.governmentPosts ?? [];
    for (const post of govPosts) {
      const entityId = govPostToEntityId(post.name);
      if (!entityId) continue;

      await upsertRole({
        politician_id: politicianId,
        role_entity_id: entityId,
        role_type: 'minister',
        start_date: post.startDate?.split('T')[0] || '2024-07-05',
        end_date: post.endDate?.split('T')[0] ?? null,
        source: 'parliament-api',
      });
    }

    matched += holderEntities.length;
  }

  console.log(`\n=== Migration Complete ===`);
  console.log(`Matched: ${matched}, Ambiguous: ${ambiguous}, Failed: ${failed}\n`);

  return { matched, ambiguous, failed };
}

/**
 * Sync existing politicians — update party, constituency, portrait, status.
 * Run nightly.
 */
export async function syncPoliticians(): Promise<{ updated: number; errors: number }> {
  console.log('\n=== Politician Sync ===');

  const { data: politicians, error } = await supabase
    .from('politicians')
    .select('id, parliament_member_id')
    .not('parliament_member_id', 'is', null)
    .limit(5000);

  if (error || !politicians) {
    console.error('  [ERR] Failed to load politicians:', error?.message);
    return { updated: 0, errors: 1 };
  }

  let updated = 0;
  let errors = 0;

  for (const pol of politicians) {
    const detail = await fetchMemberDetail(pol.parliament_member_id);
    await delay(200);

    if (!detail) {
      errors++;
      continue;
    }

    const memberHouse = detail.latestHouseMembership?.house ?? 1;
    const house = memberHouse === 1 ? 'commons' : memberHouse === 2 ? 'lords' : 'commons';
    const membership = detail.latestHouseMembership;

    let status: 'active' | 'retired' | 'deceased' | 'defeated' = 'active';
    if (membership?.membershipEndDate) {
      const reason = (membership.membershipEndReason || '').toLowerCase();
      if (reason.includes('death') || reason.includes('died')) {
        status = 'deceased';
      } else if (reason.includes('defeat') || reason.includes('lost')) {
        status = 'defeated';
      } else {
        status = 'retired';
      }
    }

    const { error: updateError } = await supabase
      .from('politicians')
      .update({
        display_name: detail.nameDisplayAs,
        full_name: detail.nameFullTitle || detail.nameDisplayAs,
        party: detail.latestParty?.name ?? null,
        house,
        constituency: memberHouse === 1 ? (membership?.membershipFrom ?? null) : null,
        portrait_url: detail.thumbnailUrl || null,
        gender: (detail.gender || '').toLowerCase() || null,
        status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', pol.id);

    if (updateError) {
      console.warn(`  [ERR] Update ${pol.id}: ${updateError.message}`);
      errors++;
    } else {
      updated++;
    }
  }

  console.log(`  Updated: ${updated}, Errors: ${errors}`);
  return { updated, errors };
}

/**
 * Collect register of interests for all politicians as evidence rows.
 */
export async function collectRegisterInterests(): Promise<{ inserted: number; skipped: number }> {
  console.log('\n--- Register of Interests ---');

  const { data: politicians, error } = await supabase
    .from('politicians')
    .select('id, parliament_member_id')
    .not('parliament_member_id', 'is', null)
    .eq('status', 'active')
    .limit(5000);

  if (error || !politicians) {
    console.error('  [ERR] Failed to load politicians:', error?.message);
    return { inserted: 0, skipped: 0 };
  }

  const allRows: Array<Record<string, unknown>> = [];

  for (const pol of politicians) {
    const interests = await fetchRegisterInterests(pol.parliament_member_id);
    await delay(200);

    for (const cat of interests) {
      if (!cat.interests || cat.interests.length === 0) continue;

      for (const interest of cat.interests) {
        const description = interest.interest || '';
        const childDetails = interest.childInterests?.map((c) => c.interest).join('; ') ?? '';
        const fullContent = [description, childDetails].filter(Boolean).join(' — ');

        const entityIds = enrichEntityIdsCentral([], cat.name, fullContent);

        allRows.push({
          politician_id: pol.id,
          evidence_type: 'register_of_interests',
          source: 'members-api',
          source_id: String(interest.id),
          source_url: `https://members.parliament.uk/member/${pol.parliament_member_id}/registeredinterests`,
          occurred_at: interest.createdWhen || new Date().toISOString(),
          raw_content: fullContent.slice(0, 5000),
          parsed: {
            category: cat.name,
            description: description.slice(0, 2000),
            value: null,
            registered_on: interest.createdWhen?.split('T')[0] || null,
            related_org: null,
          },
          topic_tags: extractTopicTags(cat.name, fullContent),
          entity_ids: entityIds,
          fingerprint: makeFingerprint(pol.id, 'register_of_interests', String(interest.id)),
        });
      }
    }
  }

  console.log(`  Collected ${allRows.length} register entries`);
  return await upsertEvidence(allRows);
}

/**
 * Import ALL current Members of Parliament (Commons + Lords) into the politicians table.
 * Uses the Members API search endpoint with IsCurrentMember=true and paginates through all results.
 * Skips members that already exist (matched by parliament_member_id).
 */
export async function importAllCurrentMembers(
  options: { house?: 'commons' | 'lords' | 'both' } = {},
): Promise<{ imported: number; skipped: number; errors: number }> {
  const houses = options.house === 'commons' ? [1]
    : options.house === 'lords' ? [2]
    : [1, 2];

  let totalImported = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  // Load existing parliament_member_ids to skip duplicates
  const { data: existingPols } = await supabase
    .from('politicians')
    .select('parliament_member_id')
    .not('parliament_member_id', 'is', null);

  const existingIds = new Set(
    (existingPols || []).map((p) => p.parliament_member_id as number),
  );
  console.log(`  ${existingIds.size} politicians already in database`);

  for (const house of houses) {
    const houseName = house === 1 ? 'Commons' : 'Lords';
    console.log(`\n--- Importing ${houseName} members ---`);

    let skip = 0;
    const take = 20;
    let hasMore = true;

    while (hasMore) {
      const params = new URLSearchParams({
        House: String(house),
        IsCurrentMember: 'true',
        skip: String(skip),
        take: String(take),
      });

      const url = `${MEMBERS_API}/Search?${params}`;
      const data = await fetchJson<MembersSearchResponse>(url, `${houseName} skip=${skip}`);

      if (!data?.items || data.items.length === 0) {
        hasMore = false;
        break;
      }

      for (const item of data.items) {
        const member = item.value;
        if (!member?.id) continue;

        // Skip if already imported
        if (existingIds.has(member.id)) {
          totalSkipped++;
          continue;
        }

        const memberHouse = member.latestHouseMembership?.house ?? house;
        const houseStr = memberHouse === 1 ? 'commons' : 'lords';
        const constituency = memberHouse === 1
          ? (member.latestHouseMembership?.membershipFrom ?? null)
          : null;

        const polId = slugify(member.nameDisplayAs);

        const ok = await upsertPolitician({
          id: polId,
          parliament_member_id: member.id,
          display_name: member.nameDisplayAs,
          full_name: member.nameFullTitle || member.nameDisplayAs,
          party: member.latestParty?.name ?? null,
          house: houseStr,
          constituency,
          portrait_url: member.thumbnailUrl || null,
          gender: (member.gender || '').toLowerCase() || null,
          status: 'active',
        });

        if (ok) {
          totalImported++;
          existingIds.add(member.id);
        } else {
          totalErrors++;
        }
      }

      skip += take;
      if (skip % 100 === 0) {
        console.log(`  ${houseName}: ${skip} processed, ${totalImported} imported so far`);
      }
      await delay(200);
    }

    console.log(`  ${houseName} done: ${totalImported} imported total`);
  }

  console.log(`\n=== Import Complete: ${totalImported} imported, ${totalSkipped} skipped, ${totalErrors} errors ===`);
  return { imported: totalImported, skipped: totalSkipped, errors: totalErrors };
}

/**
 * Combined collector — run all member-related collection in sequence.
 */
export async function collectParliamentMembers(): Promise<{ inserted: number; skipped: number }> {
  console.log('\n=== Parliament Members Collector ===');

  // Sync politician details
  const syncResult = await syncPoliticians();
  console.log(`  Sync: ${syncResult.updated} updated, ${syncResult.errors} errors`);

  // Collect register of interests as evidence
  const registerResult = await collectRegisterInterests();
  console.log(`  Register: ${registerResult.inserted} inserted, ${registerResult.skipped} skipped`);

  return registerResult;
}
