/**
 * Math Layer CLI — inspect, debug, and validate the indicator math layer.
 *
 * Usage:
 *   npx tsx scripts/run-math-layer.ts status                       — Row counts for all math layer tables
 *   npx tsx scripts/run-math-layer.ts refresh                      — Refresh materialized view
 *   npx tsx scripts/run-math-layer.ts decay <politician_id> <indicator_id>  — Show decayed state
 *   npx tsx scripts/run-math-layer.ts audit <politician_id> <indicator_id>  — Show full audit chain
 *   npx tsx scripts/run-math-layer.ts smoke                        — Run pure math smoke tests
 *
 * Requires .env.local with Supabase credentials.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// -- Status ------------------------------------------------------------------

async function runStatus() {
  console.log('--- Math Layer Status ---\n');

  const tables = [
    'politician_indicators',
    'politician_indicator_evidence',
    'indicator_definitions',
    'indicator_correlations',
    'epoch_transitions',
    'politician_voting_alignment',
  ] as const;

  for (const table of tables) {
    const { count, error } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true });

    if (error) {
      console.log(`  ${table}: ERROR — ${error.message}`);
    } else {
      console.log(`  ${table}: ${count ?? 0} rows`);
    }
  }

  // Top indicators by evidence count
  const { data: topIndicators } = await supabase
    .from('politician_indicators')
    .select('politician_id, indicator_id, alpha, beta, evidence_count')
    .order('evidence_count', { ascending: false })
    .limit(10);

  if (topIndicators && topIndicators.length > 0) {
    console.log('\n--- Top Indicators by Evidence Count ---');
    for (const row of topIndicators) {
      const a = Number(row.alpha);
      const b = Number(row.beta);
      const mean = a / (a + b);
      console.log(
        `  ${row.politician_id} → ${row.indicator_id}: ` +
        `α=${a.toFixed(2)} β=${b.toFixed(2)} mean=${mean.toFixed(3)} (${row.evidence_count} evidence)`,
      );
    }
  } else {
    console.log('\n  No indicator data yet.');
  }
}

// -- Refresh -----------------------------------------------------------------

async function runRefresh() {
  console.log('Refreshing materialized view...');
  const start = Date.now();

  // Use a dedicated client with extended fetch timeout — the view aggregates
  // 100K+ evidence rows with decay calculations and can exceed default timeouts.
  const { createClient: cc } = await import('@supabase/supabase-js');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!;
  const db = cc(url, key, {
    global: { fetch: (input: any, init: any) => fetch(input, { ...init, signal: AbortSignal.timeout(120_000) }) },
  });
  const { error } = await db.rpc('refresh_indicators_decayed');
  if (error) {
    console.warn(`  [ERR] Refresh materialized view: ${error.message}`);
  }

  console.log(`Done in ${Date.now() - start}ms`);
}

// -- Decay -------------------------------------------------------------------

async function runDecay(politicianId: string, indicatorId: string) {
  const { decayedState } = await import('../lib/math/indicators');
  const { posterior } = await import('../lib/math/beta');

  console.log(`\nDecayed state for ${politicianId} × ${indicatorId}:\n`);

  const state = await decayedState(politicianId, indicatorId);
  const p = posterior(state.alpha, state.beta);

  console.log(`  α = ${state.alpha.toFixed(4)}`);
  console.log(`  β = ${state.beta.toFixed(4)}`);
  console.log(`  Evidence count: ${state.evidence_count}`);
  console.log(`  Mean: ${p.mean.toFixed(4)}`);
  console.log(`  Variance: ${p.variance.toFixed(6)}`);
  console.log(`  ESS: ${p.effective_sample_size.toFixed(2)}`);
  console.log(`  Confidence: ${p.confidence.toFixed(4)}`);
  console.log(`  95% CI: [${p.ci_95[0].toFixed(4)}, ${p.ci_95[1].toFixed(4)}]`);
}

// -- Audit -------------------------------------------------------------------

async function runAudit(politicianId: string, indicatorId: string) {
  const { auditedPosterior } = await import('../lib/math/indicators');

  console.log(`\nAudit chain for ${politicianId} × ${indicatorId}:\n`);

  const audit = await auditedPosterior(politicianId, indicatorId);
  const p = audit.posterior;

  console.log(`  Posterior: mean=${p.mean.toFixed(4)} var=${p.variance.toFixed(6)} conf=${p.confidence.toFixed(4)}`);
  console.log(`  α=${audit.alpha.toFixed(4)} β=${audit.beta.toFixed(4)}`);
  console.log(`  95% CI: [${p.ci_95[0].toFixed(4)}, ${p.ci_95[1].toFixed(4)}]`);

  if (audit.contributing_evidence.length > 0) {
    console.log(`\n  --- Direct Evidence (${audit.contributing_evidence.length}) ---`);
    for (const e of audit.contributing_evidence) {
      console.log(
        `  #${e.evidence_id} [${e.evidence_type}] ${e.occurred_at.slice(0, 10)} ` +
        `anchor=${e.anchor.toFixed(2)} w=${e.effective_weight.toFixed(4)} ` +
        `decay=${e.decay_factor.toFixed(3)} epoch=${e.epoch_dampening.toFixed(3)} ` +
        `→ α+${e.contribution_to_alpha.toFixed(4)} β+${e.contribution_to_beta.toFixed(4)}`,
      );
    }
  }

  if (audit.propagated_from.length > 0) {
    console.log(`\n  --- Propagated Evidence (${audit.propagated_from.length}) ---`);
    for (const e of audit.propagated_from) {
      console.log(
        `  #${e.evidence_id} [from ${e.propagation_source}] ${e.occurred_at.slice(0, 10)} ` +
        `anchor=${e.anchor.toFixed(2)} w=${e.effective_weight.toFixed(4)} ` +
        `→ α+${e.contribution_to_alpha.toFixed(4)} β+${e.contribution_to_beta.toFixed(4)}`,
      );
    }
  }

  if (audit.applied_epochs.length > 0) {
    console.log(`\n  --- Applied Epochs (${audit.applied_epochs.length}) ---`);
    for (const ep of audit.applied_epochs) {
      console.log(`  ${ep.event_type} on ${ep.event_date} (dampening: ${ep.dampening})`);
    }
  }
}

// -- Smoke tests -------------------------------------------------------------

function runSmoke() {
  const { posterior, betaCI, applyUpdate, decayFactor } = require('../lib/math/beta');

  let passed = 0;
  let failed = 0;

  function assert(name: string, actual: number, expected: number, tolerance = 1e-4) {
    if (Math.abs(actual - expected) <= tolerance) {
      console.log(`  PASS: ${name}`);
      passed++;
    } else {
      console.log(`  FAIL: ${name} — expected ${expected}, got ${actual}`);
      failed++;
    }
  }

  console.log('--- Smoke Tests ---\n');

  // Uniform prior Beta(1,1)
  const p1 = posterior(1, 1);
  assert('Beta(1,1) mean', p1.mean, 0.5);
  assert('Beta(1,1) variance', p1.variance, 1 / 12);
  assert('Beta(1,1) ESS', p1.effective_sample_size, 0);
  assert('Beta(1,1) confidence', p1.confidence, 0);

  // Beta(10,2) — strong evidence toward high
  const p2 = posterior(10, 2);
  assert('Beta(10,2) mean', p2.mean, 10 / 12);
  assert('Beta(10,2) variance', p2.variance, (10 * 2) / (144 * 13));

  // ESS and confidence for Beta(10,2)
  assert('Beta(10,2) ESS', p2.effective_sample_size, 10);
  assert('Beta(10,2) confidence', p2.confidence, 10 / 15); // k=5

  // Confidence crosses 0.5 at ~5 effective evidence units → Beta(4.5, 3.5) has ESS=6
  const p3 = posterior(4.5, 3.5);
  assert('Beta(4.5,3.5) confidence > 0.5', p3.confidence > 0.5 ? 1 : 0, 1);

  // Apply update
  const u1 = applyUpdate(1, 1, 0.8, 2.0);
  assert('applyUpdate α', u1.alpha, 2.6);
  assert('applyUpdate β', u1.beta, 1.4);

  // Decay factor: at t=0, decay=1
  const now = new Date();
  assert('decayFactor t=0', decayFactor(now, now, 3), 1.0);

  // Decay factor: at t=halfLife, decay=exp(-1)
  const threeYearsAgo = new Date(now.getTime() - 3 * 365.25 * 24 * 60 * 60 * 1000);
  assert('decayFactor t=halfLife', decayFactor(threeYearsAgo, now, 3), Math.exp(-1), 0.01);

  // CI sanity: uniform prior should span most of [0,1]
  const ci = betaCI(1, 1, 0.95);
  assert('Beta(1,1) CI lower < 0.1', ci[0] < 0.1 ? 1 : 0, 1);
  assert('Beta(1,1) CI upper > 0.9', ci[1] > 0.9 ? 1 : 0, 1);

  // Tight CI for strong evidence
  const ci2 = betaCI(100, 10, 0.95);
  assert('Beta(100,10) CI width < 0.15', (ci2[1] - ci2[0]) < 0.15 ? 1 : 0, 1);

  console.log(`\n  ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

// -- Main --------------------------------------------------------------------

async function main() {
  const cmd = process.argv[2];

  switch (cmd) {
    case 'status':
      await runStatus();
      break;
    case 'refresh':
      await runRefresh();
      break;
    case 'decay': {
      const polId = process.argv[3];
      const indId = process.argv[4];
      if (!polId || !indId) {
        console.error('Usage: decay <politician_id> <indicator_id>');
        process.exit(1);
      }
      await runDecay(polId, indId);
      break;
    }
    case 'audit': {
      const polId = process.argv[3];
      const indId = process.argv[4];
      if (!polId || !indId) {
        console.error('Usage: audit <politician_id> <indicator_id>');
        process.exit(1);
      }
      await runAudit(polId, indId);
      break;
    }
    case 'smoke':
      runSmoke();
      break;
    default:
      console.log('Usage: npx tsx scripts/run-math-layer.ts <status|refresh|decay|audit|smoke>');
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
