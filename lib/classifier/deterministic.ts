// ---------------------------------------------------------------------------
// Deterministic classifiers — pure functions over metadata lookups.
//
// Four evidence types use deterministic classification:
//   1. Division votes  → bill_policy_mappings table
//   2. Register of interests → org_indicator_map table
//   3. APPG membership → appg_indicator_map table
//   4. Committee membership → committee_indicator_map table
//
// All return Classification[] — same shape as LLM classifiers.
// ---------------------------------------------------------------------------

import { getServiceClient } from '@/lib/db';
import type { PoliticianEvidence, DivisionVoteParsed, RegisterEntryParsed, AppgMembershipParsed } from '@/types/politician';
import type { Classification, BillPolicyMapping, OrgIndicatorMapping, AppgIndicatorMapping, CommitteeIndicatorMapping } from './types';
import { BASE_WEIGHTS } from './constants';

// ---------------------------------------------------------------------------
// 1. Division votes
// ---------------------------------------------------------------------------

export async function getBillPolicyMappings(
  billId: string,
  amendmentId: string | null,
): Promise<BillPolicyMapping[]> {
  const db = getServiceClient();

  let query = db
    .from('bill_policy_mappings')
    .select('*')
    .eq('bill_id', billId);

  if (amendmentId) {
    query = query.eq('amendment_id', amendmentId);
  } else {
    query = query.is('amendment_id', null);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[classifier:division] Failed to fetch bill mappings:', error);
    return [];
  }
  return (data ?? []) as BillPolicyMapping[];
}

export async function classifyDivisionVote(
  evidence: PoliticianEvidence,
): Promise<Classification[]> {
  const parsed = evidence.parsed as DivisionVoteParsed;
  const { vote, bill_ref, amendment_ref } = parsed;

  // Non-diagnostic votes produce no classification
  if (vote === 'absent' || vote === 'abstain' || vote === 'teller_aye' || vote === 'teller_no') {
    return [];
  }
  if (!bill_ref) return [];

  const mappings = await getBillPolicyMappings(bill_ref, amendment_ref ?? null);
  if (!mappings.length) return [];

  return mappings.map((m) => ({
    indicator_id: m.indicator_id,
    anchor: vote === 'aye' ? m.aye_anchor : m.no_anchor,
    raw_weight: BASE_WEIGHTS.division_vote * m.diagnostic_strength * (m.reviewed ? 1.0 : 0.5),
    confidence: m.reviewed ? 0.95 : 0.7,
    reasoning: `Voted ${vote} on ${m.bill_id}/${m.amendment_id ?? 'main'}, mapped to ${m.indicator_id}`.slice(0, 200),
  }));
}

// ---------------------------------------------------------------------------
// 2. Register of interests
// ---------------------------------------------------------------------------

async function getOrgMappings(orgName: string): Promise<OrgIndicatorMapping[]> {
  const db = getServiceClient();
  const normalised = orgName.trim().toLowerCase();

  // Check exact match first, then aliases
  const { data: exact } = await db
    .from('org_indicator_map')
    .select('*')
    .ilike('org_name', normalised);

  if (exact && exact.length > 0) return exact as OrgIndicatorMapping[];

  // Check aliases array — Supabase array contains
  const { data: aliased } = await db
    .from('org_indicator_map')
    .select('*')
    .contains('org_aliases', [normalised]);

  return (aliased ?? []) as OrgIndicatorMapping[];
}

export async function classifyRegisterEntry(
  evidence: PoliticianEvidence,
): Promise<Classification[]> {
  const parsed = evidence.parsed as RegisterEntryParsed;
  const { related_org, category } = parsed;

  if (!related_org) return [];

  const mappings = await getOrgMappings(related_org);
  if (!mappings.length) return [];

  return mappings.map((m) => ({
    indicator_id: m.indicator_id,
    anchor: m.anchor,
    raw_weight: BASE_WEIGHTS.register_of_interests * m.weight_multiplier,
    confidence: 0.85,
    reasoning: `Register ${category}: ${related_org} mapped to ${m.indicator_id}`.slice(0, 200),
  }));
}

// ---------------------------------------------------------------------------
// 3. APPG membership
// ---------------------------------------------------------------------------

async function getAppgMapping(appgId: string): Promise<AppgIndicatorMapping | null> {
  const db = getServiceClient();
  const { data, error } = await db
    .from('appg_indicator_map')
    .select('*')
    .eq('appg_id', appgId)
    .maybeSingle();

  if (error || !data) return null;
  return data as AppgIndicatorMapping;
}

export async function classifyAppgMembership(
  evidence: PoliticianEvidence,
): Promise<Classification[]> {
  const parsed = evidence.parsed as AppgMembershipParsed;
  const mapping = await getAppgMapping(parsed.appg_id);
  if (!mapping) return [];

  return [{
    indicator_id: mapping.indicator_id,
    anchor: mapping.anchor,
    raw_weight: BASE_WEIGHTS.appg_membership * mapping.weight_multiplier,
    confidence: 0.75,
    reasoning: `APPG membership: ${parsed.appg_name} (${parsed.role})`.slice(0, 200),
  }];
}

// ---------------------------------------------------------------------------
// 4. Committee membership
// ---------------------------------------------------------------------------

async function getCommitteeMappings(committeeId: string): Promise<CommitteeIndicatorMapping[]> {
  const db = getServiceClient();
  const { data, error } = await db
    .from('committee_indicator_map')
    .select('*')
    .eq('committee_id', committeeId);

  if (error) return [];
  return (data ?? []) as CommitteeIndicatorMapping[];
}

export async function classifyCommitteeMembership(
  evidence: PoliticianEvidence,
): Promise<Classification[]> {
  // Committee membership evidence doesn't have a dedicated parsed type in the
  // existing type system — it uses the generic Record<string, unknown>.
  const parsed = evidence.parsed as Record<string, unknown>;
  const committeeId = parsed.committee_id as string | undefined;
  const role = parsed.role as string | undefined;

  if (!committeeId) return [];

  const mappings = await getCommitteeMappings(committeeId);
  if (!mappings.length) return [];

  const isChair = role === 'chair';

  return mappings.map((m) => ({
    indicator_id: m.indicator_id,
    anchor: (isChair && m.chair_anchor != null) ? m.chair_anchor : m.membership_anchor,
    raw_weight: BASE_WEIGHTS.committee_membership * m.weight_multiplier,
    confidence: 0.7,
    reasoning: `Committee ${isChair ? 'chair' : 'member'}: ${committeeId}`.slice(0, 200),
  }));
}
