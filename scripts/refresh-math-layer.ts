/**
 * Math Layer Refresh — end-to-end pipeline that brings indicator scores up to date.
 *
 * Steps:
 *   1. classify-deterministic  — Run deterministic classifiers on unprocessed evidence
 *   2. rebuild                 — Recompute politician_indicators (α, β) from evidence log
 *   3. refresh                 — Refresh the materialized view (applies decay + epoch dampening)
 *
 * Usage:
 *   npx tsx scripts/refresh-math-layer.ts                         — Full pipeline (all 3 steps)
 *   npx tsx scripts/refresh-math-layer.ts classify-deterministic  — Step 1 only
 *   npx tsx scripts/refresh-math-layer.ts rebuild                 — Step 2 only
 *   npx tsx scripts/refresh-math-layer.ts refresh                 — Step 3 only
 *   npx tsx scripts/refresh-math-layer.ts status                  — Show current state
 *   npx tsx scripts/refresh-math-layer.ts --dry-run               — Full pipeline, no DB writes
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

function db(): SupabaseClient {
  return createClient(url, serviceKey);
}

/** Extended-timeout client for heavy operations. */
function dbLong(timeoutMs = 120_000): SupabaseClient {
  return createClient(url, serviceKey, {
    global: { fetch: (input: any, init: any) => fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) }) },
  });
}

// -- Evidence type constants (must match lib/classifier/constants.ts) ----------

const DETERMINISTIC_TYPES = ['division_vote', 'register_of_interests', 'appg_membership', 'committee_membership'] as const;

const BASE_WEIGHTS: Record<string, number> = {
  division_vote: 3.0,
  register_of_interests: 1.0,
  appg_membership: 0.5,
  committee_membership: 0.6,
};

// =============================================================================
// Step 1: Classify deterministic evidence
// =============================================================================

async function classifyDeterministic(dryRun: boolean): Promise<number> {
  console.log('\n=== Step 1: Classify Deterministic Evidence ===\n');
  const s = db();

  // Find evidence rows that have no corresponding audit trail entry
  let totalClassified = 0;

  for (const evidenceType of DETERMINISTIC_TYPES) {
    // Count unprocessed rows for this type
    // (evidence rows with no matching politician_indicator_evidence entry)
    const { data: allEvidence } = await s
      .from('politician_evidence')
      .select('id')
      .eq('evidence_type', evidenceType)
      .limit(10000);

    if (!allEvidence?.length) {
      console.log(`  ${evidenceType}: 0 evidence rows — skipping`);
      continue;
    }

    // Check which already have audit trail entries
    const ids = allEvidence.map((r: any) => r.id);
    const { data: existing } = await s
      .from('politician_indicator_evidence')
      .select('evidence_id')
      .in('evidence_id', ids);

    const existingIds = new Set((existing ?? []).map((r: any) => r.evidence_id));
    const unprocessedIds = ids.filter((id: number) => !existingIds.has(id));

    if (unprocessedIds.length === 0) {
      console.log(`  ${evidenceType}: all ${ids.length} rows already classified`);
      continue;
    }

    // Fetch full rows for unprocessed
    const { data: fullRows } = await s
      .from('politician_evidence')
      .select('id, politician_id, evidence_type, parsed, occurred_at')
      .in('id', unprocessedIds);

    const rows = fullRows ?? [];

    if (rows.length === 0) {
      console.log(`  ${evidenceType}: nothing to classify`);
      continue;
    }

    console.log(`  ${evidenceType}: ${rows.length} unclassified rows`);

    let classified = 0;
    let skipped = 0;
    let errors = 0;

    for (const evidence of rows) {
      try {
        const classifications = await classifyEvidence(s, evidence);
        if (classifications.length === 0) {
          skipped++;
          continue;
        }

        if (!dryRun) {
          // Ensure indicator state rows exist
          const indicatorIds = [...new Set(classifications.map((c: any) => c.indicator_id))];
          for (const indicatorId of indicatorIds) {
            await s.from('politician_indicators').upsert(
              { politician_id: evidence.politician_id, indicator_id: indicatorId, alpha: 1.0, beta: 1.0, evidence_count: 0, last_updated: new Date().toISOString() },
              { onConflict: 'politician_id,indicator_id', ignoreDuplicates: true },
            );
          }

          // Insert audit trail
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
            // Likely duplicate — skip
            if (insertErr.message.includes('duplicate') || insertErr.message.includes('unique')) {
              skipped++;
            } else {
              console.warn(`    Error inserting evidence ${evidence.id}: ${insertErr.message}`);
              errors++;
            }
            continue;
          }
        }

        classified++;
      } catch (err: any) {
        errors++;
        if (errors <= 3) console.warn(`    Error classifying ${evidence.id}: ${err.message}`);
      }
    }

    const count = classified;
    totalClassified += count;
    console.log(`    → ${count} classified, ${skipped} skipped, ${errors} errors`);
  }

  console.log(`\n  Total new classifications: ${totalClassified}`);
  return totalClassified;
}

/** Classify a single deterministic evidence row. Returns Classification-like objects. */
async function classifyEvidence(
  s: SupabaseClient,
  evidence: { id: number; politician_id: string; evidence_type: string; parsed: any },
): Promise<Array<{ indicator_id: string; anchor: number; raw_weight: number; confidence: number; reasoning: string }>> {
  switch (evidence.evidence_type) {
    case 'division_vote':
      return classifyDivisionVote(s, evidence);
    case 'register_of_interests':
      return classifyRegisterEntry(s, evidence);
    case 'appg_membership':
      return classifyAppg(s, evidence);
    case 'committee_membership':
      return classifyCommittee(s, evidence);
    default:
      return [];
  }
}

async function classifyDivisionVote(
  s: SupabaseClient,
  evidence: { id: number; parsed: any },
): Promise<Array<{ indicator_id: string; anchor: number; raw_weight: number; confidence: number; reasoning: string }>> {
  const { vote, bill_ref, division_id, amendment_ref } = evidence.parsed ?? {};
  if (vote === 'absent' || vote === 'abstain' || vote === 'teller_aye' || vote === 'teller_no') return [];

  const lookupId = bill_ref ?? (division_id ? String(division_id) : null);
  if (!lookupId) return [];

  let query = s.from('bill_policy_mappings').select('*').eq('bill_id', lookupId);
  if (amendment_ref) {
    query = query.eq('amendment_id', amendment_ref);
  } else {
    query = query.is('amendment_id', null);
  }

  const { data: mappings } = await query;
  if (!mappings?.length) return [];

  return mappings.map((m: any) => ({
    indicator_id: m.indicator_id,
    anchor: vote === 'aye' ? m.aye_anchor : m.no_anchor,
    raw_weight: BASE_WEIGHTS.division_vote * m.diagnostic_strength * (m.reviewed ? 1.0 : 0.5),
    confidence: m.reviewed ? 0.95 : 0.7,
    reasoning: `Voted ${vote} on ${m.bill_id}/${m.amendment_id ?? 'main'}`.slice(0, 200),
  }));
}

async function classifyRegisterEntry(
  s: SupabaseClient,
  evidence: { id: number; parsed: any },
): Promise<Array<{ indicator_id: string; anchor: number; raw_weight: number; confidence: number; reasoning: string }>> {
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
    indicator_id: m.indicator_id,
    anchor: m.anchor,
    raw_weight: BASE_WEIGHTS.register_of_interests * (m.weight_multiplier ?? 1.0),
    confidence: 0.85,
    reasoning: `Register ${category ?? 'entry'}: ${related_org}`.slice(0, 200),
  }));
}

async function classifyAppg(
  s: SupabaseClient,
  evidence: { id: number; parsed: any },
): Promise<Array<{ indicator_id: string; anchor: number; raw_weight: number; confidence: number; reasoning: string }>> {
  const { appg_id, appg_name, role } = evidence.parsed ?? {};
  if (!appg_id) return [];

  const { data } = await s.from('appg_indicator_map').select('*').eq('appg_id', appg_id).maybeSingle();
  if (!data) return [];

  return [{
    indicator_id: data.indicator_id,
    anchor: data.anchor,
    raw_weight: BASE_WEIGHTS.appg_membership * (data.weight_multiplier ?? 1.0),
    confidence: 0.75,
    reasoning: `APPG: ${appg_name ?? appg_id} (${role ?? 'member'})`.slice(0, 200),
  }];
}

async function classifyCommittee(
  s: SupabaseClient,
  evidence: { id: number; parsed: any },
): Promise<Array<{ indicator_id: string; anchor: number; raw_weight: number; confidence: number; reasoning: string }>> {
  const { committee_id, role } = evidence.parsed ?? {};
  if (!committee_id) return [];

  const { data: mappings } = await s.from('committee_indicator_map').select('*').eq('committee_id', committee_id);
  if (!mappings?.length) return [];

  const isChair = role === 'chair';

  return mappings.map((m: any) => ({
    indicator_id: m.indicator_id,
    anchor: isChair && m.chair_anchor != null ? m.chair_anchor : m.membership_anchor,
    raw_weight: BASE_WEIGHTS.committee_membership * (m.weight_multiplier ?? 1.0),
    confidence: 0.7,
    reasoning: `Committee ${isChair ? 'chair' : 'member'}: ${committee_id}`.slice(0, 200),
  }));
}

// =============================================================================
// Step 2: Rebuild politician_indicators from evidence log
// =============================================================================

async function rebuild(dryRun: boolean): Promise<void> {
  console.log('\n=== Step 2: Rebuild politician_indicators (α, β) ===\n');
  const s = db();

  // Aggregate directly from politician_indicator_evidence
  // α = 1 + Σ(anchor × effective_weight), β = 1 + Σ((1 - anchor) × effective_weight)
  const { data: aggregated, error } = await dbLong().rpc('aggregate_indicator_evidence');

  let rows: Array<{ politician_id: string; indicator_id: string; sum_alpha: number; sum_beta: number; evidence_count: number }>;

  if (error || !aggregated) {
    console.log('  RPC aggregate_indicator_evidence not found — using client-side aggregation');

    // Fallback: fetch all evidence with pagination (Supabase caps at 1000/page)
    const allEvidence: any[] = [];
    const PAGE_SIZE = 1000;
    let from = 0;
    while (true) {
      const { data: page, error: fetchErr } = await dbLong()
        .from('politician_indicator_evidence')
        .select('politician_id, indicator_id, anchor, effective_weight')
        .range(from, from + PAGE_SIZE - 1);

      if (fetchErr) {
        console.error(`  Failed to fetch evidence at offset ${from}: ${fetchErr.message}`);
        return;
      }
      if (!page || page.length === 0) break;
      allEvidence.push(...page);
      from += page.length;
      if (page.length < PAGE_SIZE) break;
    }

    if (allEvidence.length === 0) {
      console.log('  No evidence rows found');
      return;
    }

    console.log(`  Loaded ${allEvidence.length} evidence rows`);

    // Aggregate per (politician_id, indicator_id)
    const agg = new Map<string, { politician_id: string; indicator_id: string; sum_alpha: number; sum_beta: number; evidence_count: number }>();

    for (const row of allEvidence) {
      const key = `${row.politician_id}|${row.indicator_id}`;
      let entry = agg.get(key);
      if (!entry) {
        entry = { politician_id: row.politician_id, indicator_id: row.indicator_id, sum_alpha: 0, sum_beta: 0, evidence_count: 0 };
        agg.set(key, entry);
      }
      const anchor = Number(row.anchor);
      const weight = Number(row.effective_weight);
      entry.sum_alpha += anchor * weight;
      entry.sum_beta += (1 - anchor) * weight;
      entry.evidence_count++;
    }

    rows = Array.from(agg.values());
  } else {
    rows = aggregated;
  }

  console.log(`  ${rows.length} (politician, indicator) pairs to update`);

  if (dryRun) {
    console.log('  [DRY RUN — skipping writes]');
    return;
  }

  // Batch upsert in chunks of 500
  const BATCH_SIZE = 500;
  let updated = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE).map((r) => ({
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

    if (upsertErr) {
      console.error(`  Batch ${Math.floor(i / BATCH_SIZE)}: ${upsertErr.message}`);
    } else {
      updated += batch.length;
    }
  }

  console.log(`  Updated ${updated} indicator rows`);
}

// =============================================================================
// Step 3: Refresh materialized view
// =============================================================================

async function refresh(): Promise<void> {
  console.log('\n=== Step 3: Refresh Materialized View ===\n');
  const start = Date.now();

  const { error } = await dbLong(300_000).rpc('refresh_indicators_decayed');
  if (error) {
    console.warn(`  Error: ${error.message}`);
    console.log('  (This is OK if the materialized view has not been created yet)');
  } else {
    console.log(`  Done in ${Date.now() - start}ms`);
  }
}

// =============================================================================
// Status
// =============================================================================

async function status(): Promise<void> {
  console.log('\n=== Math Layer Status ===\n');
  const s = db();

  // Table counts
  const tables = [
    'politician_evidence',
    'politician_indicator_evidence',
    'politician_indicators',
    'indicator_definitions',
    'bill_policy_mappings',
    'org_indicator_map',
    'appg_indicator_map',
    'committee_indicator_map',
    'indicator_correlations',
    'epoch_transitions',
  ];

  console.log('Table row counts:');
  for (const table of tables) {
    const { count, error } = await s.from(table).select('*', { count: 'exact', head: true });
    console.log(`  ${table.padEnd(40)} ${error ? `ERROR: ${error.message}` : count ?? 0}`);
  }

  // Evidence type breakdown
  console.log('\nEvidence by type:');
  for (const etype of [...DETERMINISTIC_TYPES, 'chamber_speech', 'written_question_asked', 'committee_question']) {
    const { count: totalCount } = await s.from('politician_evidence').select('*', { count: 'exact', head: true }).eq('evidence_type', etype);
    const { count: classifiedCount } = await s
      .from('politician_indicator_evidence')
      .select('evidence_id', { count: 'exact', head: true })
      // Can't easily filter by evidence_type here, so approximate
    ;
    console.log(`  ${etype.padEnd(30)} ${totalCount ?? 0} rows`);
  }

  // Classification coverage
  const { count: totalEvidence } = await s.from('politician_evidence').select('*', { count: 'exact', head: true });
  const { data: classifiedIds } = await s.from('politician_indicator_evidence').select('evidence_id');
  const uniqueClassified = new Set((classifiedIds ?? []).map((r: any) => r.evidence_id)).size;
  console.log(`\nClassification coverage: ${uniqueClassified} / ${totalEvidence ?? 0} evidence rows (${totalEvidence ? ((uniqueClassified / (totalEvidence as number)) * 100).toFixed(1) : 0}%)`);

  // Top indicators by evidence count
  const { data: topIndicators } = await s
    .from('politician_indicators')
    .select('politician_id, indicator_id, alpha, beta, evidence_count')
    .order('evidence_count', { ascending: false })
    .limit(10);

  if (topIndicators?.length) {
    console.log('\nTop 10 indicators by evidence count:');
    for (const row of topIndicators) {
      const a = Number(row.alpha);
      const b = Number(row.beta);
      const mean = a / (a + b);
      const ess = Math.max(0, a + b - 2);
      const conf = ess / (ess + 5);
      console.log(
        `  ${row.politician_id.padEnd(30)} ${row.indicator_id.padEnd(45)} ` +
        `mean=${mean.toFixed(3)} conf=${conf.toFixed(2)} (${row.evidence_count} evidence)`,
      );
    }
  }

  // Stale indicator check: indicators where evidence_count doesn't match audit trail
  const { data: indicatorRows } = await s
    .from('politician_indicators')
    .select('politician_id, indicator_id, evidence_count')
    .order('evidence_count', { ascending: false })
    .limit(5);

  if (indicatorRows?.length) {
    console.log('\nStaleness check (top 5):');
    for (const row of indicatorRows) {
      const { count: auditCount } = await s
        .from('politician_indicator_evidence')
        .select('*', { count: 'exact', head: true })
        .eq('politician_id', row.politician_id)
        .eq('indicator_id', row.indicator_id);

      const match = (auditCount ?? 0) === row.evidence_count;
      console.log(
        `  ${row.politician_id.padEnd(30)} ${row.indicator_id.padEnd(45)} ` +
        `stored=${row.evidence_count} actual=${auditCount ?? 0} ${match ? '✓' : '← STALE'}`,
      );
    }
  }
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const command = args.find((a) => !a.startsWith('--'));

  const startTime = Date.now();

  switch (command) {
    case 'classify-deterministic':
      await classifyDeterministic(dryRun);
      break;

    case 'rebuild':
      await rebuild(dryRun);
      break;

    case 'refresh':
      await refresh();
      break;

    case 'status':
      await status();
      break;

    default: {
      // Full pipeline: all 3 steps
      console.log('=== Math Layer Full Refresh ===');
      if (dryRun) console.log('[DRY RUN MODE]');

      const newClassifications = await classifyDeterministic(dryRun);
      await rebuild(dryRun);
      await refresh();

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`\n=== Complete in ${elapsed}s ===`);
      break;
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
