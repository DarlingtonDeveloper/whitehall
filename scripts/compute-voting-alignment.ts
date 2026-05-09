/**
 * Compute pairwise voting alignment between politicians.
 *
 * Pages through division_vote evidence, builds a per-politician vote map
 * (division_id → aye/no), then for each pair sharing ≥20 divisions computes:
 *   alignment = agreements / shared_divisions
 *
 * Upserts results to politician_voting_alignment.
 *
 * Usage:
 *   npx tsx scripts/compute-voting-alignment.ts
 *   npx tsx scripts/compute-voting-alignment.ts --min-shared 30
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

const MIN_SHARED_DEFAULT = 20;

async function main() {
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const minShared = (() => {
    const idx = process.argv.indexOf('--min-shared');
    return idx !== -1 ? parseInt(process.argv[idx + 1], 10) : MIN_SHARED_DEFAULT;
  })();

  console.log(`\n=== Computing Voting Alignment ===`);
  console.log(`Minimum shared divisions: ${minShared}\n`);

  // ── Step 1: Load all division votes ──────────────────────────────────
  // Build a map: politician_id → Map<division_id, vote>
  // Uses cursor-based pagination (id > lastId) to avoid offset timeouts.
  const politicianVotes = new Map<string, Map<number, string>>();
  let lastId = 0;
  const pageSize = 1000;
  let totalVotes = 0;
  let rowsFetched = 0;

  console.log('Loading division votes...');
  while (true) {
    const { data, error } = await sb.from('politician_evidence')
      .select('id, politician_id, parsed')
      .eq('evidence_type', 'division_vote')
      .gt('id', lastId)
      .order('id', { ascending: true })
      .limit(pageSize);

    if (error) {
      console.error('Query error:', error.message);
      return;
    }
    if (!data?.length) break;

    for (const row of data) {
      const divId = row.parsed?.division_id;
      const vote = row.parsed?.vote;
      if (!divId || !vote) continue;

      let votes = politicianVotes.get(row.politician_id);
      if (!votes) {
        votes = new Map();
        politicianVotes.set(row.politician_id, votes);
      }
      votes.set(divId, vote);
      totalVotes++;
    }

    lastId = data[data.length - 1].id;
    rowsFetched += data.length;

    if (rowsFetched % 50000 < pageSize) {
      console.log(`  ...loaded ${rowsFetched} rows (${politicianVotes.size} politicians)`);
    }
    if (data.length < pageSize) break;
  }

  console.log(`Loaded ${totalVotes} votes from ${politicianVotes.size} politicians\n`);

  // ── Step 2: Compute pairwise alignment ───────────────────────────────
  const politicianIds = Array.from(politicianVotes.keys()).sort();
  const alignments: Array<{
    politician_a: string;
    politician_b: string;
    alignment: number;
    shared_divisions: number;
  }> = [];

  console.log('Computing pairwise alignment...');
  let pairsChecked = 0;
  const totalPairs = (politicianIds.length * (politicianIds.length - 1)) / 2;

  for (let i = 0; i < politicianIds.length; i++) {
    const idA = politicianIds[i];
    const votesA = politicianVotes.get(idA)!;

    for (let j = i + 1; j < politicianIds.length; j++) {
      const idB = politicianIds[j];
      const votesB = politicianVotes.get(idB)!;

      // Quick check: skip if either has fewer votes than minShared
      if (votesA.size < minShared || votesB.size < minShared) continue;

      // Count shared divisions and agreements
      let shared = 0;
      let agreements = 0;

      // Iterate over the smaller set for efficiency
      const [smaller, larger] = votesA.size <= votesB.size
        ? [votesA, votesB]
        : [votesB, votesA];

      for (const [divId, voteSmall] of smaller) {
        const voteLarge = larger.get(divId);
        if (voteLarge) {
          shared++;
          if (voteSmall === voteLarge) agreements++;
        }
      }

      if (shared >= minShared) {
        // politician_a < politician_b guaranteed since politicianIds is sorted
        alignments.push({
          politician_a: idA,
          politician_b: idB,
          alignment: Math.round((agreements / shared) * 10000) / 10000,
          shared_divisions: shared,
        });
      }

      pairsChecked++;
    }

    if (i > 0 && i % 100 === 0) {
      console.log(`  ...processed politician ${i}/${politicianIds.length} (${alignments.length} pairs found)`);
    }
  }

  console.log(`\nChecked pairs, found ${alignments.length} with ≥${minShared} shared divisions\n`);

  // ── Step 3: Upsert to database ───────────────────────────────────────
  console.log('Upserting alignment pairs...');
  const batchSize = 500;
  let upserted = 0;

  for (let i = 0; i < alignments.length; i += batchSize) {
    const batch = alignments.slice(i, i + batchSize);
    const { error } = await sb.from('politician_voting_alignment').upsert(
      batch.map(a => ({
        ...a,
        computed_at: new Date().toISOString(),
      })),
      { onConflict: 'politician_a,politician_b' },
    );

    if (error) {
      console.error(`Upsert error at batch ${i}:`, error.message);
      return;
    }
    upserted += batch.length;
    if (upserted % 2000 === 0 || upserted === alignments.length) {
      console.log(`  ...upserted ${upserted}/${alignments.length}`);
    }
  }

  // ── Step 4: Summary ──────────────────────────────────────────────────
  const { count } = await sb.from('politician_voting_alignment')
    .select('*', { count: 'exact', head: true });

  console.log(`\n=== Results ===`);
  console.log(`Total alignment pairs in DB: ${count}`);
  console.log(`New/updated this run: ${alignments.length}`);

  if (alignments.length > 0) {
    const sorted = [...alignments].sort((a, b) => b.alignment - a.alignment);
    console.log(`\nHighest alignment (top 5):`);
    for (const a of sorted.slice(0, 5)) {
      console.log(`  ${a.politician_a} ↔ ${a.politician_b}: ${(a.alignment * 100).toFixed(1)}% (${a.shared_divisions} divs)`);
    }
    console.log(`\nLowest alignment (bottom 5):`);
    for (const a of sorted.slice(-5)) {
      console.log(`  ${a.politician_a} ↔ ${a.politician_b}: ${(a.alignment * 100).toFixed(1)}% (${a.shared_divisions} divs)`);
    }

    const avg = alignments.reduce((s, a) => s + a.alignment, 0) / alignments.length;
    console.log(`\nAverage alignment: ${(avg * 100).toFixed(1)}%`);
  }
}

main().catch(console.error);
