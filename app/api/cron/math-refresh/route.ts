import { NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const DETERMINISTIC_TYPES = ['division_vote', 'register_of_interests', 'appg_membership', 'committee_membership'] as const;

const BASE_WEIGHTS: Record<string, number> = {
  division_vote: 3.0,
  register_of_interests: 1.0,
  appg_membership: 0.5,
  committee_membership: 0.6,
};

function db(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

function dbLong(timeoutMs = 120_000): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { global: { fetch: (input: any, init: any) => fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) }) } },
  );
}

// ── Step 1: Classify deterministic evidence ─────────────────────────────

async function classifyDeterministic(): Promise<{ classified: number; skipped: number; errors: number }> {
  const s = db();
  let totalClassified = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const evidenceType of DETERMINISTIC_TYPES) {
    const { data: allEvidence } = await s
      .from('politician_evidence')
      .select('id')
      .eq('evidence_type', evidenceType)
      .limit(10000);

    if (!allEvidence?.length) continue;

    const ids = allEvidence.map((r: any) => r.id);
    const { data: existing } = await s
      .from('politician_indicator_evidence')
      .select('evidence_id')
      .in('evidence_id', ids);

    const existingIds = new Set((existing ?? []).map((r: any) => r.evidence_id));
    const unprocessedIds = ids.filter((id: number) => !existingIds.has(id));
    if (unprocessedIds.length === 0) continue;

    const { data: fullRows } = await s
      .from('politician_evidence')
      .select('id, politician_id, evidence_type, parsed, occurred_at')
      .in('id', unprocessedIds);

    for (const evidence of fullRows ?? []) {
      try {
        const classifications = await classifyEvidence(s, evidence);
        if (classifications.length === 0) { totalSkipped++; continue; }

        const indicatorIds = Array.from(new Set(classifications.map((c: any) => c.indicator_id)));
        for (const indicatorId of indicatorIds) {
          await s.from('politician_indicators').upsert(
            { politician_id: evidence.politician_id, indicator_id: indicatorId, alpha: 1.0, beta: 1.0, evidence_count: 0, last_updated: new Date().toISOString() },
            { onConflict: 'politician_id,indicator_id', ignoreDuplicates: true },
          );
        }

        const auditRows = classifications.map((c: any) => ({
          politician_id: evidence.politician_id,
          indicator_id: c.indicator_id,
          evidence_id: evidence.id,
          anchor: c.anchor,
          raw_weight: c.raw_weight,
          effective_weight: c.raw_weight,
          classifier_version: 'deterministic-v1',
          classifier_reasoning: c.reasoning,
        }));

        const { error: insertErr } = await s.from('politician_indicator_evidence').insert(auditRows);
        if (insertErr) {
          if (insertErr.message.includes('duplicate') || insertErr.message.includes('unique')) {
            totalSkipped++;
          } else {
            totalErrors++;
          }
          continue;
        }
        totalClassified++;
      } catch {
        totalErrors++;
      }
    }
  }

  return { classified: totalClassified, skipped: totalSkipped, errors: totalErrors };
}

async function classifyEvidence(
  s: SupabaseClient,
  evidence: { id: number; politician_id: string; evidence_type: string; parsed: any },
): Promise<Array<{ indicator_id: string; anchor: number; raw_weight: number; reasoning: string }>> {
  switch (evidence.evidence_type) {
    case 'division_vote': return classifyDivisionVote(s, evidence);
    case 'register_of_interests': return classifyRegisterEntry(s, evidence);
    case 'appg_membership': return classifyAppg(s, evidence);
    case 'committee_membership': return classifyCommittee(s, evidence);
    default: return [];
  }
}

async function classifyDivisionVote(s: SupabaseClient, evidence: { parsed: any }) {
  const { vote, bill_ref, division_id, amendment_ref } = evidence.parsed ?? {};
  if (vote === 'absent' || vote === 'abstain' || vote === 'teller_aye' || vote === 'teller_no') return [];

  const lookupId = bill_ref ?? (division_id ? String(division_id) : null);
  if (!lookupId) return [];

  let query = s.from('bill_policy_mappings').select('*').eq('bill_id', lookupId);
  query = amendment_ref ? query.eq('amendment_id', amendment_ref) : query.is('amendment_id', null);

  const { data: mappings } = await query;
  if (!mappings?.length) return [];

  return mappings.map((m: any) => ({
    indicator_id: m.indicator_id,
    anchor: vote === 'aye' ? m.aye_anchor : m.no_anchor,
    raw_weight: BASE_WEIGHTS.division_vote * m.diagnostic_strength * (m.reviewed ? 1.0 : 0.5),
    reasoning: `Voted ${vote} on ${m.bill_id}/${m.amendment_id ?? 'main'}`.slice(0, 200),
  }));
}

async function classifyRegisterEntry(s: SupabaseClient, evidence: { parsed: any }) {
  const { related_org, category } = evidence.parsed ?? {};
  if (!related_org) return [];
  const normalised = related_org.trim().toLowerCase();
  const { data: exact } = await s.from('org_indicator_map').select('*').eq('org_name', normalised);
  let mappings = exact ?? [];
  if (!mappings.length) {
    const { data: aliased } = await s.from('org_indicator_map').select('*').contains('org_aliases', [normalised]);
    mappings = aliased ?? [];
  }
  if (!mappings.length) return [];
  return mappings.map((m: any) => ({
    indicator_id: m.indicator_id, anchor: m.anchor,
    raw_weight: BASE_WEIGHTS.register_of_interests * (m.weight_multiplier ?? 1.0),
    reasoning: `Register ${category ?? 'entry'}: ${related_org}`.slice(0, 200),
  }));
}

async function classifyAppg(s: SupabaseClient, evidence: { parsed: any }) {
  const { appg_id, appg_name, role } = evidence.parsed ?? {};
  if (!appg_id) return [];
  const { data } = await s.from('appg_indicator_map').select('*').eq('appg_id', appg_id).maybeSingle();
  if (!data) return [];
  return [{
    indicator_id: data.indicator_id, anchor: data.anchor,
    raw_weight: BASE_WEIGHTS.appg_membership * (data.weight_multiplier ?? 1.0),
    reasoning: `APPG: ${appg_name ?? appg_id} (${role ?? 'member'})`.slice(0, 200),
  }];
}

async function classifyCommittee(s: SupabaseClient, evidence: { parsed: any }) {
  const { committee_id, role } = evidence.parsed ?? {};
  if (!committee_id) return [];
  const { data: mappings } = await s.from('committee_indicator_map').select('*').eq('committee_id', committee_id);
  if (!mappings?.length) return [];
  const isChair = role === 'chair';
  return mappings.map((m: any) => ({
    indicator_id: m.indicator_id,
    anchor: isChair && m.chair_anchor != null ? m.chair_anchor : m.membership_anchor,
    raw_weight: BASE_WEIGHTS.committee_membership * (m.weight_multiplier ?? 1.0),
    reasoning: `Committee ${isChair ? 'chair' : 'member'}: ${committee_id}`.slice(0, 200),
  }));
}

// ── Step 2: Rebuild politician_indicators (α, β) ───────────────────────

async function rebuild(): Promise<{ pairs: number }> {
  const s = db();
  const { data: aggregated, error } = await dbLong().rpc('aggregate_indicator_evidence');

  let rows: Array<{ politician_id: string; indicator_id: string; sum_alpha: number; sum_beta: number; evidence_count: number }>;

  if (error || !aggregated) {
    // Fallback: client-side aggregation
    const allEvidence: any[] = [];
    let from = 0;
    const PAGE = 1000;
    while (true) {
      const { data: page, error: fetchErr } = await dbLong()
        .from('politician_indicator_evidence')
        .select('politician_id, indicator_id, anchor, effective_weight')
        .range(from, from + PAGE - 1);
      if (fetchErr || !page?.length) break;
      allEvidence.push(...page);
      from += page.length;
      if (page.length < PAGE) break;
    }

    const agg = new Map<string, { politician_id: string; indicator_id: string; sum_alpha: number; sum_beta: number; evidence_count: number }>();
    for (const row of allEvidence) {
      const key = `${row.politician_id}|${row.indicator_id}`;
      let entry = agg.get(key);
      if (!entry) {
        entry = { politician_id: row.politician_id, indicator_id: row.indicator_id, sum_alpha: 0, sum_beta: 0, evidence_count: 0 };
        agg.set(key, entry);
      }
      entry.sum_alpha += Number(row.anchor) * Number(row.effective_weight);
      entry.sum_beta += (1 - Number(row.anchor)) * Number(row.effective_weight);
      entry.evidence_count++;
    }
    rows = Array.from(agg.values());
  } else {
    rows = aggregated;
  }

  const BATCH = 500;
  let updated = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH).map((r) => ({
      politician_id: r.politician_id,
      indicator_id: r.indicator_id,
      alpha: 1.0 + r.sum_alpha,
      beta: 1.0 + r.sum_beta,
      evidence_count: r.evidence_count,
      last_updated: new Date().toISOString(),
    }));
    const { error: upsertErr } = await s
      .from('politician_indicators')
      .upsert(batch, { onConflict: 'politician_id,indicator_id' });
    if (!upsertErr) updated += batch.length;
  }

  return { pairs: updated };
}

// ── Step 3: Refresh materialized view ───────────────────────────────────

async function refresh(): Promise<{ ok: boolean; error?: string }> {
  const { error } = await dbLong(300_000).rpc('refresh_indicators_decayed');
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ── Route handler ───────────────────────────────────────────────────────

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const start = Date.now();
  const results: Record<string, any> = {};

  try {
    // Step 1: classify new deterministic evidence
    const classifyStart = Date.now();
    results.classify = await classifyDeterministic();
    results.classify.elapsed_ms = Date.now() - classifyStart;
    console.log(`[math-refresh] classify: ${results.classify.classified} new, ${results.classify.skipped} skipped, ${results.classify.errors} errors (${results.classify.elapsed_ms}ms)`);
  } catch (err: any) {
    console.error('[math-refresh] classify failed:', err);
    results.classify = { error: err.message };
  }

  try {
    // Step 2: rebuild α/β from evidence log
    const rebuildStart = Date.now();
    results.rebuild = await rebuild();
    results.rebuild.elapsed_ms = Date.now() - rebuildStart;
    console.log(`[math-refresh] rebuild: ${results.rebuild.pairs} pairs (${results.rebuild.elapsed_ms}ms)`);
  } catch (err: any) {
    console.error('[math-refresh] rebuild failed:', err);
    results.rebuild = { error: err.message };
  }

  try {
    // Step 3: refresh materialized view
    const refreshStart = Date.now();
    results.refresh = await refresh();
    results.refresh.elapsed_ms = Date.now() - refreshStart;
    console.log(`[math-refresh] refresh: ${results.refresh.ok ? 'ok' : results.refresh.error} (${results.refresh.elapsed_ms}ms)`);
  } catch (err: any) {
    console.error('[math-refresh] refresh failed:', err);
    results.refresh = { error: err.message };
  }

  const elapsed = (Date.now() - start) / 1000;
  console.log(`[math-refresh] complete in ${elapsed.toFixed(1)}s`);

  return NextResponse.json({
    ok: true,
    timestamp: new Date().toISOString(),
    elapsed_seconds: parseFloat(elapsed.toFixed(1)),
    results,
  });
}
