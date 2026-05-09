/**
 * Quick backtest sampling both aye and no voters on a division.
 * Usage: npx tsx scripts/quick-backtest-mixed.ts <division_id>
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

async function main() {
  const { createClient } = await import('@supabase/supabase-js');
  const { predictVote } = await import('../lib/predictions/vote');

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const divisionId = process.argv[2] ?? '1924';

  // Get ALL votes
  let allVotes: any[] = [];
  let offset = 0;
  while (true) {
    const { data } = await sb.from('politician_evidence')
      .select('politician_id, parsed')
      .eq('evidence_type', 'division_vote')
      .filter('parsed->>division_id', 'eq', divisionId)
      .range(offset, offset + 499);
    if (!data?.length) break;
    allVotes.push(...data);
    offset += data.length;
    if (data.length < 500) break;
  }

  // Split into aye and no
  const ayeVotes = allVotes.filter(v => (v.parsed as any).vote === 'aye');
  const noVotes = allVotes.filter(v => (v.parsed as any).vote === 'no');

  console.log(`Division ${divisionId}: ${ayeVotes.length} aye, ${noVotes.length} no\n`);

  // Sample up to 15 from each side
  const sampleAye = ayeVotes.sort(() => Math.random() - 0.5).slice(0, 15);
  const sampleNo = noVotes.sort(() => Math.random() - 0.5).slice(0, 15);
  const sample = [...sampleAye, ...sampleNo];

  let correct = 0;
  let total = 0;
  let correctAye = 0, totalAye = 0;
  let correctNo = 0, totalNo = 0;

  for (const v of sample) {
    const p = v.parsed as Record<string, unknown>;
    const actual = p.vote as string;

    try {
      const result = await predictVote({
        politician_id: v.politician_id,
        bill_id: divisionId,
      });

      const predictedAye = result.p_aye > 0.5;
      const actualAye = actual === 'aye';
      const match = predictedAye === actualAye;
      if (match) correct++;
      total++;
      if (actualAye) { totalAye++; if (match) correctAye++; }
      else { totalNo++; if (match) correctNo++; }

      const marker = match ? '✓' : '✗';
      console.log(
        `${marker} ${v.politician_id.padEnd(32)} pred=${predictedAye ? 'aye' : 'no '}  actual=${actual.padEnd(4)} P(aye)=${result.p_aye.toFixed(3)} whip=${result.whip_adjustment.whip_direction ?? 'none'}`,
      );
    } catch {
      // Skip
    }
  }

  console.log(`\nOverall accuracy: ${correct}/${total} = ${((correct / total) * 100).toFixed(1)}%`);
  console.log(`Aye accuracy: ${correctAye}/${totalAye} = ${totalAye > 0 ? ((correctAye / totalAye) * 100).toFixed(1) : 'N/A'}%`);
  console.log(`No accuracy: ${correctNo}/${totalNo} = ${totalNo > 0 ? ((correctNo / totalNo) * 100).toFixed(1) : 'N/A'}%`);
}

main().catch(console.error);
