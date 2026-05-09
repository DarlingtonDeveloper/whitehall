/**
 * Quick manual backtest — compare predictions vs actual votes on specific divisions.
 * Usage: npx tsx scripts/quick-backtest.ts <division_id> [--limit N]
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

  const divisionId = process.argv[2] ?? '1052';
  const limitIdx = process.argv.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(process.argv[limitIdx + 1], 10) : 30;

  console.log(`Quick backtest: division ${divisionId} (limit ${limit})\n`);

  // Get votes
  const { data: votes } = await sb.from('politician_evidence')
    .select('politician_id, parsed')
    .eq('evidence_type', 'division_vote')
    .filter('parsed->>division_id', 'eq', divisionId)
    .limit(limit);

  if (!votes?.length) {
    console.log('No votes found for division', divisionId);
    return;
  }

  let correct = 0;
  let total = 0;
  let whipped = 0;

  for (const v of votes) {
    const p = v.parsed as Record<string, unknown>;
    const actual = p.vote as string;
    if (actual === 'absent' || actual === 'abstain' || actual === 'teller_aye' || actual === 'teller_no') continue;

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
      if (result.whip_adjustment.whipped) whipped++;

      const marker = match ? '✓' : '✗';
      console.log(
        `${marker} ${v.politician_id.padEnd(32)} pred=${predictedAye ? 'aye' : 'no '}  actual=${actual.padEnd(4)} P(aye)=${result.p_aye.toFixed(3)} whip=${result.whip_adjustment.whip_direction ?? 'none'}`,
      );
    } catch {
      // Skip errors
    }
  }

  console.log(`\nAccuracy: ${correct}/${total} = ${((correct / total) * 100).toFixed(1)}%`);
  console.log(`Whip detected: ${whipped}/${total}`);
}

main().catch(console.error);
