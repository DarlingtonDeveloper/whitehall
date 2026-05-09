/**
 * Generate a whip card showing predicted votes across parties for a division.
 * Usage: npx tsx scripts/whip-card.ts <division_id>
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

  const divId = process.argv[2] ?? '1924';

  // Get division title
  const { data: sampleVote } = await sb.from('politician_evidence')
    .select('parsed')
    .eq('evidence_type', 'division_vote')
    .filter('parsed->>division_id', 'eq', divId)
    .limit(1);
  const title = (sampleVote?.[0]?.parsed as any)?.division_title ?? `Division ${divId}`;

  console.log(`\n=== WHIP CARD: ${title} ===\n`);

  const parties = ['Labour', 'Conservative', 'Liberal Democrat', 'Reform UK', 'Scottish National Party', 'Plaid Cymru', 'Green Party'];

  for (const party of parties) {
    const { data: pols } = await sb.from('politicians')
      .select('id, display_name')
      .eq('party', party)
      .eq('status', 'active')
      .limit(5);
    if (!pols?.length) continue;

    console.log(`--- ${party} ---`);
    for (const p of pols) {
      try {
        const result = await predictVote({ politician_id: p.id, bill_id: divId });
        const dir = result.whip_adjustment.whip_direction ?? 'free';
        const frontbench = result.whip_adjustment.is_frontbench ? ' [FB]' : '';
        console.log(
          `  ${p.display_name.padEnd(28)} P(aye)=${result.p_aye.toFixed(3)} ` +
          `whip=${dir.padEnd(5)} ` +
          `drivers=${result.drivers.length}${frontbench}`,
        );
      } catch {
        console.log(`  ${p.display_name.padEnd(28)} [error]`);
      }
    }
    console.log('');
  }
}

main().catch(console.error);
