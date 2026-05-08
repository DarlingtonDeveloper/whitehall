/**
 * Predictions CLI — test and debug the predictions layer.
 *
 * Usage:
 *   npx tsx scripts/run-predictions.ts vote <politician_id> <bill_id> [amendment_id]
 *   npx tsx scripts/run-predictions.ts position <politician_id> "<issue text>"
 *   npx tsx scripts/run-predictions.ts coalition <policy_area> [--k <n>] [--party <party>]
 *   npx tsx scripts/run-predictions.ts swings <policy_area> [--limit <n>]
 *   npx tsx scripts/run-predictions.ts backtest <division_id> [<division_id>...]
 *   npx tsx scripts/run-predictions.ts lookup <prediction_id>
 *
 * Requires .env.local with Supabase credentials.
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

// -- Vote prediction ----------------------------------------------------------

async function runVote(politicianId: string, billId: string, amendmentId?: string) {
  const { predictVote } = await import('../lib/predictions/vote');

  console.log(`\nVote prediction: ${politicianId} on bill ${billId}${amendmentId ? ` amendment ${amendmentId}` : ''}:\n`);

  const result = await predictVote({
    politician_id: politicianId,
    bill_id: billId,
    amendment_id: amendmentId,
  });

  console.log(`  Prediction ID: ${result.prediction_id}`);
  console.log(`  P(aye): ${result.p_aye.toFixed(4)}`);
  console.log(`  P(no):  ${result.p_no.toFixed(4)}`);
  console.log(`  P(aye) base (pre-whip): ${result.p_aye_base.toFixed(4)}`);
  console.log(`  95% CI: [${result.ci_95[0].toFixed(4)}, ${result.ci_95[1].toFixed(4)}]`);

  if (result.whip_adjustment.whipped) {
    console.log(`\n  --- Whip Adjustment ---`);
    console.log(`  Direction: ${result.whip_adjustment.whip_direction}`);
    console.log(`  Rebellion rate: ${result.whip_adjustment.rebellion_rate.toFixed(4)}`);
    console.log(`  Whip weight: ${result.whip_adjustment.weight.toFixed(4)}`);
    console.log(`  Frontbench: ${result.whip_adjustment.is_frontbench}`);
  } else {
    console.log(`\n  Whip: not detected or free vote`);
  }

  if (result.drivers.length > 0) {
    console.log(`\n  --- Indicator Drivers (${result.drivers.length}) ---`);
    for (const d of result.drivers) {
      console.log(
        `  ${d.indicator_id}: mean=${d.posterior_mean.toFixed(4)} ` +
        `conf=${d.posterior_confidence.toFixed(3)} strength=${d.diagnostic_strength.toFixed(2)} ` +
        `(${d.evidence_count} evidence)`,
      );
    }
  }

  if (result.key_evidence.length > 0) {
    console.log(`\n  --- Key Evidence (${result.key_evidence.length}) ---`);
    for (const e of result.key_evidence) {
      console.log(
        `  #${e.evidence_id} [${e.evidence_type}] ${e.occurred_at.slice(0, 10)} ` +
        `anchor=${e.anchor.toFixed(2)} w=${e.effective_weight.toFixed(4)}`,
      );
    }
  }

  if (result.caveats.length > 0) {
    console.log(`\n  Caveats:`);
    for (const c of result.caveats) {
      console.log(`  - ${c}`);
    }
  }
}

// -- Position prediction ------------------------------------------------------

async function runPosition(politicianId: string, issueText: string) {
  const { predictPosition } = await import('../lib/predictions/position');

  console.log(`\nPosition prediction: ${politicianId} on "${issueText}":\n`);

  const result = await predictPosition({
    politician_id: politicianId,
    issue_text: issueText,
  });

  console.log(`  Prediction ID: ${result.prediction_id}`);
  console.log(`  Position: ${result.position_score.toFixed(4)} (0=against, 1=in favour)`);
  console.log(`  Confidence: ${result.confidence.toFixed(4)}`);
  console.log(`  95% CI: [${result.ci_95[0].toFixed(4)}, ${result.ci_95[1].toFixed(4)}]`);

  console.log(`\n  Signal weights: ideology=${result.blended_weights.ideology.toFixed(2)} ` +
    `adjacent=${result.blended_weights.adjacent.toFixed(2)} ` +
    `network=${result.blended_weights.network.toFixed(2)}`);

  console.log(`\n  Ideology signal: score=${result.signals.ideology.score.toFixed(4)} ` +
    `(${result.signals.ideology.indicators.length} indicators)`);
  console.log(`  Adjacent policy signal: score=${result.signals.adjacent_policy.score.toFixed(4)} ` +
    `(${result.signals.adjacent_policy.indicators.length} indicators)`);
  console.log(`  Network signal: score=${result.signals.network.score.toFixed(4)} ` +
    `(${result.signals.network.aligned_politicians.length} aligned politicians)`);

  if (result.caveats.length > 0) {
    console.log(`\n  Caveats:`);
    for (const c of result.caveats) {
      console.log(`  - ${c}`);
    }
  }
}

// -- Coalition mapping --------------------------------------------------------

async function runCoalition(policyArea: string, k?: number, party?: string) {
  const { mapCoalitions } = await import('../lib/predictions/coalition');

  console.log(`\nCoalition mapping: ${policyArea}${k ? ` k=${k}` : ' (auto-k)'}${party ? ` party=${party}` : ''}:\n`);

  const result = await mapCoalitions({
    policy_area: policyArea,
    k,
    politician_filter: { party },
  });

  console.log(`  Prediction ID: ${result.prediction_id}`);
  console.log(`  k=${result.k}  silhouette=${result.silhouette_score.toFixed(4)}`);

  for (const cluster of result.clusters) {
    console.log(`\n  --- Cluster ${cluster.id} (${cluster.members.length} members) ---`);

    if (cluster.defining_indicators.length > 0) {
      console.log(`  Defining indicators:`);
      for (const di of cluster.defining_indicators.slice(0, 3)) {
        const label = di.cluster_mean > di.other_clusters_mean ? di.label_high : di.label_low;
        console.log(`    ${di.indicator_id}: ${di.cluster_mean.toFixed(3)} vs ${di.other_clusters_mean.toFixed(3)} (${label})`);
      }
    }

    console.log(`  Members (closest to centroid first):`);
    for (const m of cluster.members.slice(0, 10)) {
      console.log(`    ${m.politician_name} (${m.party ?? 'unknown'}) dist=${m.distance_to_centroid.toFixed(4)}`);
    }
    if (cluster.members.length > 10) {
      console.log(`    ... and ${cluster.members.length - 10} more`);
    }
  }
}

// -- Swing identification -----------------------------------------------------

async function runSwings(policyArea: string, limit: number) {
  const { identifySwings } = await import('../lib/predictions/swing');

  console.log(`\nSwing identification: ${policyArea} (top ${limit}):\n`);

  const result = await identifySwings({ policy_area: policyArea, limit });

  console.log(`  Prediction ID: ${result.prediction_id}`);
  console.log(`  Found ${result.swings.length} swing politicians:\n`);

  for (const s of result.swings) {
    console.log(
      `  ${s.politician_name} (${s.party ?? 'unknown'}, ${s.role_type ?? 'unknown'})` +
      ` swing=${s.swing_score.toFixed(4)}` +
      ` [uncertainty=${s.uncertainty_score.toFixed(3)} influence=${s.influence_score.toFixed(3)}]` +
      ` mean=${s.posterior_mean.toFixed(3)} ci_width=${s.ci_width.toFixed(3)}` +
      ` (${s.evidence_count} evidence)`,
    );
  }
}

// -- Backtest -----------------------------------------------------------------

async function runBacktestCmd(divisionIds: number[]) {
  const { runBacktest } = await import('../lib/predictions/backtest');

  console.log(`\nBacktest: ${divisionIds.length} division(s):\n`);
  const start = Date.now();

  const result = await runBacktest({ division_ids: divisionIds });

  console.log(`  Prediction ID: ${result.prediction_id}`);
  console.log(`  Predictions: ${result.n_predictions}`);
  console.log(`  Accuracy: ${(result.accuracy * 100).toFixed(1)}%`);
  console.log(`  Log loss: ${result.log_loss.toFixed(4)}`);
  console.log(`  CI coverage: ${(result.ci_coverage * 100).toFixed(1)}%`);

  if (result.calibration.length > 0) {
    console.log(`\n  --- Calibration ---`);
    for (const b of result.calibration) {
      const bar = '='.repeat(Math.round(b.actual_rate * 20));
      console.log(
        `  [${b.bucket_low.toFixed(1)}-${b.bucket_high.toFixed(1)}) ` +
        `predicted=${b.predicted_mean.toFixed(3)} actual=${b.actual_rate.toFixed(3)} ` +
        `n=${b.count} ${bar}`,
      );
    }
  }

  if (result.per_division.length > 0) {
    console.log(`\n  --- Per Division ---`);
    for (const d of result.per_division.slice(0, 10)) {
      console.log(
        `  Division ${d.division_id}: ${d.division_title.slice(0, 60)}... ` +
        `accuracy=${(d.accuracy * 100).toFixed(1)}% n=${d.predictions_made}`,
      );
    }
  }

  console.log(`\n  Completed in ${Date.now() - start}ms`);
}

// -- Lookup -------------------------------------------------------------------

async function runLookup(predictionId: string) {
  const { getPrediction } = await import('../lib/predictions/log');

  console.log(`\nLooking up prediction: ${predictionId}\n`);

  const entry = await getPrediction(predictionId);
  if (!entry) {
    console.log('  Not found.');
    return;
  }

  console.log(`  Type: ${entry.prediction_type}`);
  console.log(`  Created: ${entry.created_at}`);
  console.log(`  Input: ${JSON.stringify(entry.input, null, 2)}`);
  console.log(`  Output: ${JSON.stringify(entry.output, null, 2).slice(0, 2000)}`);
  if (entry.outcome) {
    console.log(`  Outcome: ${JSON.stringify(entry.outcome, null, 2)}`);
  }
}

// -- Main ---------------------------------------------------------------------

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

async function main() {
  const cmd = process.argv[2];
  const args = process.argv.slice(3);

  switch (cmd) {
    case 'vote': {
      if (args.length < 2) {
        console.error('Usage: vote <politician_id> <bill_id> [amendment_id]');
        process.exit(1);
      }
      await runVote(args[0], args[1], args[2]);
      break;
    }
    case 'position': {
      if (args.length < 2) {
        console.error('Usage: position <politician_id> "<issue text>"');
        process.exit(1);
      }
      await runPosition(args[0], args.slice(1).join(' '));
      break;
    }
    case 'coalition': {
      if (args.length < 1) {
        console.error('Usage: coalition <policy_area> [--k <n>] [--party <party>]');
        process.exit(1);
      }
      const k = parseFlag(args, '--k');
      const party = parseFlag(args, '--party');
      await runCoalition(args[0], k ? parseInt(k, 10) : undefined, party);
      break;
    }
    case 'swings': {
      if (args.length < 1) {
        console.error('Usage: swings <policy_area> [--limit <n>]');
        process.exit(1);
      }
      const limit = parseFlag(args, '--limit');
      await runSwings(args[0], limit ? parseInt(limit, 10) : 20);
      break;
    }
    case 'backtest': {
      if (args.length < 1) {
        console.error('Usage: backtest <division_id> [<division_id>...]');
        process.exit(1);
      }
      const divIds = args.filter((a) => !a.startsWith('--')).map((a) => parseInt(a, 10));
      await runBacktestCmd(divIds);
      break;
    }
    case 'lookup': {
      if (args.length < 1) {
        console.error('Usage: lookup <prediction_id>');
        process.exit(1);
      }
      await runLookup(args[0]);
      break;
    }
    default:
      console.log('Usage: npx tsx scripts/run-predictions.ts <vote|position|coalition|swings|backtest|lookup>');
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
