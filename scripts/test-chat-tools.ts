/**
 * Test script for chat prediction tools.
 * Tests predict_position, map_coalitions, and predict_vote.
 *
 * Usage: npx tsx scripts/test-chat-tools.ts
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

async function main() {
  const { predictPosition } = await import('../lib/predictions/position');
  const { mapCoalitions } = await import('../lib/predictions/coalition');
  const { predictVote } = await import('../lib/predictions/vote');
  const { identifySwings } = await import('../lib/predictions/swing');

  // ── Test 1: predict_position for 3 politicians ────────────────────────
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║  TEST 1: predict_position (3 politicians)   ║');
  console.log('╚══════════════════════════════════════════════╝');

  const positionTests = [
    { politician_id: 'sir-keir-starmer', issue_text: 'Should the UK expand onshore wind farms to meet net zero targets?' },
    { politician_id: 'rishi-sunak', issue_text: 'Should the UK expand onshore wind farms to meet net zero targets?' },
    { politician_id: 'ed-davey', issue_text: 'Should the UK expand onshore wind farms to meet net zero targets?' },
  ];

  for (const test of positionTests) {
    console.log(`\n══ ${test.politician_id} ══`);
    console.log(`Issue: ${test.issue_text}`);
    try {
      const result = await predictPosition(test);
      console.log(`Position score: ${result.position_score.toFixed(3)} (0=oppose, 1=support)`);
      console.log(`Confidence: ${result.confidence.toFixed(3)}`);
      console.log(`CI 95%: [${result.ci_95[0].toFixed(3)}, ${result.ci_95[1].toFixed(3)}]`);
      console.log(`Blended weights: ideology=${result.blended_weights.ideology.toFixed(2)} adjacent=${result.blended_weights.adjacent.toFixed(2)} network=${result.blended_weights.network.toFixed(2)}`);
      console.log(`Ideology signal: score=${result.signals.ideology.score.toFixed(3)} (${result.signals.ideology.indicators.length} indicators)`);
      console.log(`Adjacent signal: score=${result.signals.adjacent_policy.score.toFixed(3)} (${result.signals.adjacent_policy.indicators.length} indicators)`);
      console.log(`Network signal: score=${result.signals.network.score.toFixed(3)} (${result.signals.network.aligned_politicians.length} peers)`);
      if (result.caveats.length > 0) console.log(`Caveats: ${result.caveats.join('; ')}`);
      if (result.signals.network.aligned_politicians.length > 0) {
        console.log('Top aligned peers:');
        for (const p of result.signals.network.aligned_politicians.slice(0, 3)) {
          console.log(`  ${p.politician_name} (${p.party}) align=${p.alignment?.toFixed(3)} pos=${p.their_position?.toFixed(3) ?? 'null'}`);
        }
      }
    } catch (err: any) {
      console.error('ERROR:', err.message);
      console.error(err.stack?.split('\n').slice(0, 5).join('\n'));
    }
  }

  // ── Test 2: map_coalitions for energy-policy ──────────────────────────
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║  TEST 2: map_coalitions (energy-policy)      ║');
  console.log('╚══════════════════════════════════════════════╝');

  try {
    const result = await mapCoalitions({ policy_area: 'energy-policy' });
    console.log(`Policy area: ${result.policy_area}`);
    console.log(`Clusters (k=${result.k}), silhouette=${result.silhouette_score}`);

    for (const cluster of result.clusters) {
      console.log(`\n── Cluster ${cluster.id} (${cluster.members.length} members) ──`);
      console.log('Top 3 members:');
      for (const m of cluster.members.slice(0, 3)) {
        console.log(`  ${m.politician_name} (${m.party}) dist=${m.distance_to_centroid}`);
      }
      console.log('Defining indicators:');
      for (const d of cluster.defining_indicators.slice(0, 3)) {
        console.log(`  ${d.indicator_id}: cluster=${d.cluster_mean} vs others=${d.other_clusters_mean} [${d.label_low} <-> ${d.label_high}]`);
      }
    }
  } catch (err: any) {
    console.error('ERROR:', err.message);
    console.error(err.stack?.split('\n').slice(0, 5).join('\n'));
  }

  // ── Test 3: map_coalitions for energy-policy, filtered by party ───────
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║  TEST 3: map_coalitions (Labour only)        ║');
  console.log('╚══════════════════════════════════════════════╝');

  try {
    const result = await mapCoalitions({
      policy_area: 'energy-policy',
      politician_filter: { party: 'Labour' },
    });
    console.log(`Clusters (k=${result.k}), silhouette=${result.silhouette_score}`);
    for (const cluster of result.clusters) {
      console.log(`\n── Cluster ${cluster.id} (${cluster.members.length} members) ──`);
      for (const m of cluster.members.slice(0, 5)) {
        console.log(`  ${m.politician_name} dist=${m.distance_to_centroid}`);
      }
    }
  } catch (err: any) {
    console.error('ERROR:', err.message);
    console.error(err.stack?.split('\n').slice(0, 5).join('\n'));
  }

  // ── Test 4: predict_vote ──────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║  TEST 4: predict_vote (Starmer, division)     ║');
  console.log('╚══════════════════════════════════════════════╝');

  try {
    // Division 2012 = Sentencing Guidelines Third Reading (criminal-justice)
    const result = await predictVote({ politician_id: 'sir-keir-starmer', bill_id: '2012' });
    console.log(`P(aye): ${result.p_aye.toFixed(3)} / P(no): ${result.p_no.toFixed(3)}`);
    console.log(`P(aye) base (pre-whip): ${result.p_aye_base.toFixed(3)}`);
    console.log(`CI 95%: [${result.ci_95[0].toFixed(3)}, ${result.ci_95[1].toFixed(3)}]`);
    console.log(`Whip: whipped=${result.whip_adjustment.whipped} dir=${result.whip_adjustment.whip_direction} rebellion=${result.whip_adjustment.rebellion_rate.toFixed(3)} weight=${result.whip_adjustment.weight.toFixed(3)} frontbench=${result.whip_adjustment.is_frontbench}`);
    console.log(`Drivers (${result.drivers.length}):`);
    for (const d of result.drivers.slice(0, 3)) {
      console.log(`  ${d.indicator_id}: post=${d.posterior_mean.toFixed(3)} conf=${d.posterior_confidence.toFixed(3)} contrib=${d.contribution_to_p_aye.toFixed(3)} [${d.label_low} <-> ${d.label_high}]`);
    }
    console.log(`Key evidence (${result.key_evidence.length}):`);
    for (const e of result.key_evidence.slice(0, 3)) {
      console.log(`  ${e.evidence_type} (${e.occurred_at}) anchor=${e.anchor.toFixed(2)} weight=${e.effective_weight.toFixed(4)}`);
    }
    if (result.caveats.length > 0) console.log(`Caveats: ${result.caveats.join('; ')}`);
  } catch (err: any) {
    console.error('ERROR:', err.message);
    console.error(err.stack?.split('\n').slice(0, 8).join('\n'));
  }

  // ── Test 5: identify_swings ───────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║  TEST 5: identify_swings (energy-policy)      ║');
  console.log('╚══════════════════════════════════════════════╝');

  try {
    const result = await identifySwings({ policy_area: 'energy-policy', limit: 10 });
    console.log(`Swing voters (${result.swings.length}):`);
    for (const s of result.swings.slice(0, 5)) {
      console.log(`  ${s.politician_name} (${s.party}): swing=${s.swing_score.toFixed(3)} uncert=${s.uncertainty_score.toFixed(3)} influence=${s.influence_score.toFixed(3)} post=${s.posterior_mean.toFixed(3)} evidence=${s.evidence_count} role=${s.role_type}`);
    }
  } catch (err: any) {
    console.error('ERROR:', err.message);
    console.error(err.stack?.split('\n').slice(0, 8).join('\n'));
  }
}

main().catch(console.error);
