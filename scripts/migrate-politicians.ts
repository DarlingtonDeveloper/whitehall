/**
 * Politician Migration + Validation Script
 *
 * Usage:
 *   npx tsx scripts/migrate-politicians.ts migrate     — Run entity→politician migration
 *   npx tsx scripts/migrate-politicians.ts backfill    — Backfill division votes (5 years)
 *   npx tsx scripts/migrate-politicians.ts status      — Report on current data state
 *   npx tsx scripts/migrate-politicians.ts cohort      — Run energy cohort discovery query
 *
 * Requires .env.local with Supabase credentials.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// -- Commands ----------------------------------------------------------------

async function runMigrate() {
  const { migrateEntities } = await import('../lib/feeds/parliament-members');
  const result = await migrateEntities();
  console.log('\n--- Migration Summary ---');
  console.log(`  Matched:   ${result.matched}`);
  console.log(`  Ambiguous: ${result.ambiguous}`);
  console.log(`  Failed:    ${result.failed}`);

  // Show review queue
  const { data: reviews } = await supabase
    .from('politician_match_review')
    .select('entity_id, entity_name, current_holder, status, notes')
    .eq('status', 'pending');

  if (reviews && reviews.length > 0) {
    console.log(`\n--- Manual Review Queue (${reviews.length}) ---`);
    for (const r of reviews) {
      console.log(`  ${r.entity_id}: "${r.current_holder}" (${r.entity_name}) — ${r.notes}`);
    }
  }
}

async function runBackfill() {
  const { collectDivisionVotes } = await import('../lib/feeds/parliament-divisions');
  const { collectEdmSignatures } = await import('../lib/feeds/parliament-edms');

  console.log('Starting 5-year backfill...\n');

  const divResult = await collectDivisionVotes({ backfillYears: 5 });
  console.log(`Division votes: ${divResult.inserted} inserted, ${divResult.skipped} skipped\n`);

  const edmResult = await collectEdmSignatures({ backfillYears: 5 });
  console.log(`EDM signatures: ${edmResult.inserted} inserted, ${edmResult.skipped} skipped\n`);
}

async function runStatus() {
  console.log('\n=== Politician Data Layer Status ===\n');

  // Politician count
  const { count: polCount } = await supabase
    .from('politicians')
    .select('*', { count: 'exact', head: true });
  console.log(`Politicians:     ${polCount ?? 0}`);

  // Active vs inactive
  const { count: activeCount } = await supabase
    .from('politicians')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'active');
  console.log(`  Active:        ${activeCount ?? 0}`);

  // Roles
  const { count: roleCount } = await supabase
    .from('politician_roles')
    .select('*', { count: 'exact', head: true });
  console.log(`Roles:           ${roleCount ?? 0}`);

  const { count: activeRoles } = await supabase
    .from('politician_roles')
    .select('*', { count: 'exact', head: true })
    .is('end_date', null);
  console.log(`  Active roles:  ${activeRoles ?? 0}`);

  // Evidence
  const { count: evidenceCount } = await supabase
    .from('politician_evidence')
    .select('*', { count: 'exact', head: true });
  console.log(`Evidence rows:   ${evidenceCount ?? 0}`);

  // Evidence by type
  const { data: byType } = await supabase
    .rpc('count_evidence_by_type');
  // Fallback if RPC doesn't exist — manual query
  if (!byType) {
    const evidenceTypes = [
      'division_vote', 'chamber_speech', 'committee_speech',
      'written_question_asked', 'written_question_answered',
      'edm_signature', 'edm_proposed', 'register_of_interests',
    ];
    console.log('\n  Evidence by type:');
    for (const t of evidenceTypes) {
      const { count } = await supabase
        .from('politician_evidence')
        .select('*', { count: 'exact', head: true })
        .eq('evidence_type', t);
      if (count && count > 0) {
        console.log(`    ${t}: ${count}`);
      }
    }
  }

  // Review queue
  const { count: reviewCount } = await supabase
    .from('politician_match_review')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending');
  console.log(`\nPending reviews: ${reviewCount ?? 0}`);

  // Top politicians by evidence count
  const { data: topPols } = await supabase
    .from('politician_evidence')
    .select('politician_id')
    .limit(1000);

  if (topPols && topPols.length > 0) {
    const counts = new Map<string, number>();
    for (const row of topPols) {
      counts.set(row.politician_id, (counts.get(row.politician_id) || 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

    console.log('\n  Top 10 politicians by evidence:');
    for (const [id, count] of sorted) {
      const { data: pol } = await supabase
        .from('politicians')
        .select('display_name, party')
        .eq('id', id)
        .single();
      console.log(`    ${pol?.display_name || id} (${pol?.party || '?'}): ${count} rows`);
    }
  }
}

async function runCohort() {
  console.log('\n=== Energy Cohort Discovery ===\n');

  // Since we can't run raw SQL via Supabase client directly,
  // we'll approximate the cohort query using multiple API calls.
  // For the full SQL query, run it directly against the database.

  // Get energy evidence by type to avoid the 5K limit drowning speeches in votes
  const energyEntities = ['desnz', 'desnz-sec', 'ofgem', 'nsta', 'crown-estate', 'neso'];
  const twoYearsAgo = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000).toISOString();

  const evidenceTypes = [
    'division_vote', 'chamber_speech', 'committee_speech',
    'written_question_asked', 'written_question_answered',
    'edm_signature', 'edm_proposed',
  ];

  const evidence: Array<{ politician_id: string; evidence_type: string; occurred_at: string }> = [];

  for (const evType of evidenceTypes) {
    const { data } = await supabase
      .from('politician_evidence')
      .select('politician_id, evidence_type, occurred_at')
      .eq('evidence_type', evType)
      .overlaps('entity_ids', energyEntities)
      .gte('occurred_at', twoYearsAgo)
      .limit(5000);

    if (data) {
      evidence.push(...data);
      if (data.length > 0) console.log(`  ${evType}: ${data.length} rows`);
    }
  }

  if (evidence.length === 0) {
    console.log('No energy evidence found. Run backfill first.');
    return;
  }
  console.log(`  Total energy evidence: ${evidence.length}\n`);

  // Aggregate by politician
  const polStats = new Map<string, {
    votes: Set<string>;
    speeches: Set<string>;
    wqs: Set<string>;
    cmtQuestions: Set<string>;
    totalDays: Set<string>;
    types: Set<string>;
  }>();

  for (const e of evidence) {
    if (!polStats.has(e.politician_id)) {
      polStats.set(e.politician_id, {
        votes: new Set(), speeches: new Set(), wqs: new Set(),
        cmtQuestions: new Set(), totalDays: new Set(), types: new Set(),
      });
    }
    const stats = polStats.get(e.politician_id)!;
    const day = e.occurred_at.split('T')[0];
    stats.totalDays.add(day);
    stats.types.add(e.evidence_type);

    if (e.evidence_type === 'division_vote') stats.votes.add(day);
    if (e.evidence_type === 'chamber_speech' || e.evidence_type === 'committee_speech') stats.speeches.add(day);
    if (e.evidence_type.startsWith('written_question')) stats.wqs.add(day);
    if (e.evidence_type === 'committee_question') stats.cmtQuestions.add(day);
  }

  // Sort by total evidence days
  const ranked = [...polStats.entries()]
    .filter(([_, s]) => s.totalDays.size >= 3)
    .sort((a, b) => b[1].totalDays.size - a[1].totalDays.size)
    .slice(0, 40);

  console.log(`${'Rank'.padStart(4)} ${'Name'.padEnd(30)} ${'Party'.padEnd(15)} ${'Days'.padStart(5)} ${'Types'.padStart(5)} ${'Votes'.padStart(6)} ${'Speech'.padStart(6)} ${'WQs'.padStart(5)} ${'CmtQ'.padStart(5)}`);
  console.log('-'.repeat(100));

  for (let i = 0; i < ranked.length; i++) {
    const [polId, stats] = ranked[i];
    const { data: pol } = await supabase
      .from('politicians')
      .select('display_name, party, house')
      .eq('id', polId)
      .single();

    const name = pol?.display_name || polId;
    const party = pol?.party || '?';

    console.log(
      `${String(i + 1).padStart(4)} ${name.padEnd(30)} ${party.padEnd(15)} ${String(stats.totalDays.size).padStart(5)} ${String(stats.types.size).padStart(5)} ${String(stats.votes.size).padStart(6)} ${String(stats.speeches.size).padStart(6)} ${String(stats.wqs.size).padStart(5)} ${String(stats.cmtQuestions.size).padStart(5)}`,
    );
  }

  console.log(`\n  Total politicians with energy evidence (>=3 days): ${ranked.length}`);
  console.log(`  Total energy evidence rows: ${evidence.length}`);
}

// -- Entry point -------------------------------------------------------------

const command = process.argv[2];

switch (command) {
  case 'migrate':
    runMigrate().catch(console.error);
    break;
  case 'backfill':
    runBackfill().catch(console.error);
    break;
  case 'status':
    runStatus().catch(console.error);
    break;
  case 'cohort':
    runCohort().catch(console.error);
    break;
  default:
    console.log('Usage: npx tsx scripts/migrate-politicians.ts <command>');
    console.log('Commands: migrate, backfill, status, cohort');
    process.exit(1);
}
