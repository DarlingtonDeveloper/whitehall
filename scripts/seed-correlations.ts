/**
 * Seed indicator_correlations with hand-coded pairwise correlations.
 *
 * These encode well-established relationships from UK political science:
 * - Same-indicator revealed/public pairs (high positive)
 * - Left-right economic cluster (workers' rights, welfare, spending, tax)
 * - Lib-auth cluster (immigration, justice, policing)
 * - Cross-cluster relationships (e.g. net zero ↔ water regulation)
 *
 * The math layer's propagate() uses these for single-hop dampened updates.
 *
 * Usage:
 *   npx tsx scripts/seed-correlations.ts
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

async function main() {
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // indicator_a < indicator_b (alphabetical) is enforced by CHECK constraint.
  // correlation: -1 to 1.  source: 'hand_coded'.

  const correlations: Array<{
    indicator_a: string;
    indicator_b: string;
    correlation: number;
    source: string;
    notes: string;
  }> = [
    // ── Same-indicator revealed/public pairs ──────────────────────────────
    // These measure the same underlying attitude via different evidence streams.
    // High correlation: what politicians say publicly generally aligns with
    // how they vote, though not perfectly.
    {
      indicator_a: 'employment.workers_rights.public',
      indicator_b: 'employment.workers_rights.revealed',
      correlation: 0.85,
      source: 'hand_coded',
      notes: 'Same concept — public statements vs voting record on workers\' rights',
    },
    {
      indicator_a: 'energy.net_zero.public',
      indicator_b: 'energy.net_zero.revealed',
      correlation: 0.85,
      source: 'hand_coded',
      notes: 'Same concept — public statements vs voting record on net zero',
    },
    {
      indicator_a: 'immigration.border_control.public',
      indicator_b: 'immigration.border_control.revealed',
      correlation: 0.85,
      source: 'hand_coded',
      notes: 'Same concept — public statements vs voting record on immigration',
    },
    {
      indicator_a: 'welfare.benefits_expansion.public',
      indicator_b: 'welfare.benefits_expansion.revealed',
      correlation: 0.85,
      source: 'hand_coded',
      notes: 'Same concept — public statements vs voting record on welfare',
    },

    // ── Left-right economic cluster ──────────────────────────────────────
    // Core economic left-right ideology strongly predicts positions on
    // workers' rights, welfare, public spending, and taxation.
    {
      indicator_a: 'employment.workers_rights.revealed',
      indicator_b: 'ideology.economic_left_right.revealed',
      correlation: 0.75,
      source: 'hand_coded',
      notes: 'Economic left strongly correlates with pro-workers\' rights',
    },
    {
      indicator_a: 'fiscal.public_spending.revealed',
      indicator_b: 'ideology.economic_left_right.revealed',
      correlation: 0.70,
      source: 'hand_coded',
      notes: 'Economic left favours higher public spending',
    },
    {
      indicator_a: 'fiscal.taxation.revealed',
      indicator_b: 'ideology.economic_left_right.revealed',
      correlation: 0.65,
      source: 'hand_coded',
      notes: 'Economic left accepts higher taxes for public services',
    },
    {
      indicator_a: 'ideology.economic_left_right.revealed',
      indicator_b: 'welfare.benefits_expansion.revealed',
      correlation: 0.70,
      source: 'hand_coded',
      notes: 'Economic left supports welfare expansion',
    },
    {
      indicator_a: 'energy.public_ownership.revealed',
      indicator_b: 'ideology.economic_left_right.revealed',
      correlation: 0.60,
      source: 'hand_coded',
      notes: 'Economic left favours public ownership of energy',
    },

    // ── Intra-economic correlations ──────────────────────────────────────
    // These are the pairwise correlations within the economic cluster,
    // not mediated by ideology.
    {
      indicator_a: 'employment.workers_rights.revealed',
      indicator_b: 'welfare.benefits_expansion.revealed',
      correlation: 0.55,
      source: 'hand_coded',
      notes: 'Pro-workers\' rights politicians tend to support welfare expansion',
    },
    {
      indicator_a: 'employment.workers_rights.revealed',
      indicator_b: 'fiscal.public_spending.revealed',
      correlation: 0.50,
      source: 'hand_coded',
      notes: 'Pro-workers\' rights correlates with higher public spending',
    },
    {
      indicator_a: 'fiscal.public_spending.revealed',
      indicator_b: 'fiscal.taxation.revealed',
      correlation: 0.65,
      source: 'hand_coded',
      notes: 'Higher spending requires higher taxation — fiscally consistent',
    },
    {
      indicator_a: 'fiscal.public_spending.revealed',
      indicator_b: 'welfare.benefits_expansion.revealed',
      correlation: 0.55,
      source: 'hand_coded',
      notes: 'Pro-spending politicians tend to support welfare expansion',
    },
    {
      indicator_a: 'fiscal.public_spending.revealed',
      indicator_b: 'health.nhs_funding.public',
      correlation: 0.50,
      source: 'hand_coded',
      notes: 'Pro-spending correlates with support for NHS funding',
    },
    {
      indicator_a: 'employment.workers_rights.revealed',
      indicator_b: 'health.nhs_funding.public',
      correlation: 0.45,
      source: 'hand_coded',
      notes: 'Pro-workers\' rights politicians tend to support NHS funding',
    },
    {
      indicator_a: 'health.nhs_funding.public',
      indicator_b: 'welfare.benefits_expansion.revealed',
      correlation: 0.45,
      source: 'hand_coded',
      notes: 'Pro-NHS funding correlates with pro-welfare expansion',
    },
    {
      indicator_a: 'health.nhs_funding.public',
      indicator_b: 'ideology.economic_left_right.revealed',
      correlation: 0.45,
      source: 'hand_coded',
      notes: 'Economic left supports more NHS funding',
    },

    // ── Small business / taxation (negative) ─────────────────────────────
    {
      indicator_a: 'fiscal.small_business.revealed',
      indicator_b: 'fiscal.taxation.revealed',
      correlation: -0.45,
      source: 'hand_coded',
      notes: 'Pro-small business tax relief correlates with lower tax preference',
    },

    // ── Education cluster ────────────────────────────────────────────────
    {
      indicator_a: 'education.schools.public',
      indicator_b: 'ideology.economic_left_right.revealed',
      correlation: 0.40,
      source: 'hand_coded',
      notes: 'Economic left favours state school investment over choice/competition',
    },
    {
      indicator_a: 'education.schools.public',
      indicator_b: 'fiscal.public_spending.revealed',
      correlation: 0.35,
      source: 'hand_coded',
      notes: 'Pro-state school investment correlates with higher public spending',
    },

    // ── Housing ──────────────────────────────────────────────────────────
    {
      indicator_a: 'housing.supply.public',
      indicator_b: 'ideology.economic_left_right.revealed',
      correlation: 0.30,
      source: 'hand_coded',
      notes: 'Economic left tends to support ambitious housebuilding targets (moderate)',
    },

    // ── Lib-auth cluster ─────────────────────────────────────────────────
    // The libertarian-authoritarian dimension predicts positions on
    // immigration (auth = stricter), justice (auth = punitive), policing.
    // Note: immigration.border_control high = more open, so auth = negative.
    // Note: justice.criminal_justice high = rehabilitative, so auth = negative.
    {
      indicator_a: 'ideology.lib_auth.revealed',
      indicator_b: 'immigration.border_control.revealed',
      correlation: -0.55,
      source: 'hand_coded',
      notes: 'Authoritarian stance correlates with stricter border controls (low on scale)',
    },
    {
      indicator_a: 'ideology.lib_auth.revealed',
      indicator_b: 'justice.criminal_justice.public',
      correlation: -0.50,
      source: 'hand_coded',
      notes: 'Authoritarian stance correlates with punitive justice approach (low on scale)',
    },

    // ── Environment cluster ──────────────────────────────────────────────
    {
      indicator_a: 'energy.net_zero.revealed',
      indicator_b: 'environment.water_regulation.revealed',
      correlation: 0.50,
      source: 'hand_coded',
      notes: 'Pro-net zero politicians tend to support stronger water regulation (green cluster)',
    },
    {
      indicator_a: 'energy.net_zero.revealed',
      indicator_b: 'energy.public_ownership.revealed',
      correlation: 0.40,
      source: 'hand_coded',
      notes: 'Pro-net zero correlates with support for public energy ownership (moderate)',
    },
    {
      indicator_a: 'energy.net_zero.revealed',
      indicator_b: 'ideology.economic_left_right.revealed',
      correlation: 0.30,
      source: 'hand_coded',
      notes: 'Economic left slightly more pro-net zero, but cross-party support makes this weak',
    },

    // ── Defence / sovereignty cluster ────────────────────────────────────
    {
      indicator_a: 'defence.military_spending.public',
      indicator_b: 'foreign.sovereignty.revealed',
      correlation: 0.50,
      source: 'hand_coded',
      notes: 'Pro-defence spending correlates with hawkish sovereignty stance',
    },
    {
      indicator_a: 'defence.military_spending.public',
      indicator_b: 'ideology.lib_auth.revealed',
      correlation: 0.30,
      source: 'hand_coded',
      notes: 'Pro-defence spending weakly correlates with authoritarian stance',
    },
  ];

  // Validate alphabetical ordering before insert
  for (const c of correlations) {
    if (c.indicator_a >= c.indicator_b) {
      console.error(`ORDERING ERROR: ${c.indicator_a} must be < ${c.indicator_b}`);
      process.exit(1);
    }
  }

  console.log(`\n=== Seeding Indicator Correlations ===`);
  console.log(`Correlations to insert: ${correlations.length}\n`);

  const { error } = await sb.from('indicator_correlations').upsert(correlations, {
    onConflict: 'indicator_a,indicator_b',
  });

  if (error) {
    console.error('Upsert error:', error.message);
    return;
  }

  console.log(`Seeded ${correlations.length} indicator correlations`);

  // Summary
  const { count } = await sb.from('indicator_correlations').select('*', { count: 'exact', head: true });
  console.log(`Total correlations in DB: ${count}`);

  // Print matrix summary
  const positive = correlations.filter(c => c.correlation > 0);
  const negative = correlations.filter(c => c.correlation < 0);
  const strong = correlations.filter(c => Math.abs(c.correlation) >= 0.6);
  const moderate = correlations.filter(c => Math.abs(c.correlation) >= 0.4 && Math.abs(c.correlation) < 0.6);
  const weak = correlations.filter(c => Math.abs(c.correlation) < 0.4);

  console.log(`\nPositive: ${positive.length} | Negative: ${negative.length}`);
  console.log(`Strong (|r| >= 0.6): ${strong.length}`);
  console.log(`Moderate (0.4 <= |r| < 0.6): ${moderate.length}`);
  console.log(`Weak (|r| < 0.4): ${weak.length}`);
}

main().catch(console.error);
