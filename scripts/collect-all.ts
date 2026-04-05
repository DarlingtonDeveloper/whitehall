#!/usr/bin/env npx tsx
/**
 * Full Feed Collection Script
 *
 * Runs ALL collectors in sequence and reports totals.
 * Sources: GOV.UK Atom feeds, GOV.UK Search API, Hansard,
 *          Parliament APIs, legislation.gov.uk
 *
 * Usage:
 *   npx tsx scripts/collect-all.ts
 */

import { collectGovUK, GOVUK_FEEDS } from '../lib/feeds/govuk';
import { collectGovUKSearch } from '../lib/feeds/govuk-search';
import { collectHansard } from '../lib/feeds/hansard';
import { collectParliament } from '../lib/feeds/parliament';
import { collectLegislation } from '../lib/feeds/legislation';

interface Result {
  inserted: number;
  skipped: number;
}

async function runCollector(
  name: string,
  fn: () => Promise<Result>,
): Promise<Result> {
  try {
    return await fn();
  } catch (err) {
    console.error(`${name} collection failed:`, err);
    console.log('Continuing with next collector...\n');
    return { inserted: 0, skipped: 0 };
  }
}

async function main() {
  const start = Date.now();

  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║       Whitehall — Full Feed Collection (12 months)   ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log(`GOV.UK orgs configured: ${GOVUK_FEEDS.length}\n`);

  const results: Record<string, Result> = {};

  // ── Step 1: GOV.UK Atom feeds (recent items) ─────────────────────────
  results.govukAtom = await runCollector('GOV.UK Atom', collectGovUK);

  // ── Step 2: GOV.UK Search API (12 months historical) ─────────────────
  results.govukSearch = await runCollector('GOV.UK Search', collectGovUKSearch);

  // ── Step 3: Hansard (12 months) ──────────────────────────────────────
  results.hansard = await runCollector('Hansard', collectHansard);

  // ── Step 4: Parliament APIs (bills, questions, divisions, statements) ─
  results.parliament = await runCollector('Parliament', collectParliament);

  // ── Step 5: Legislation.gov.uk ───────────────────────────────────────
  results.legislation = await runCollector('Legislation', collectLegislation);

  // ── Summary ──────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  let totalInserted = 0;
  let totalSkipped = 0;

  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║       Full Collection Summary                        ║');
  console.log('╠══════════════════════════════════════════════════════╣');

  for (const [key, r] of Object.entries(results)) {
    const label = key.padEnd(20);
    console.log(`║  ${label} inserted: ${String(r.inserted).padEnd(19)}║`);
    console.log(`║  ${label} skipped:  ${String(r.skipped).padEnd(19)}║`);
    totalInserted += r.inserted;
    totalSkipped += r.skipped;
  }

  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  TOTAL inserted:    ${String(totalInserted).padEnd(31)}║`);
  console.log(`║  TOTAL skipped:     ${String(totalSkipped).padEnd(31)}║`);
  console.log(`║  Duration:          ${String(elapsed + 's').padEnd(31)}║`);
  console.log('╚══════════════════════════════════════════════════════╝');

  if (totalInserted === 0 && totalSkipped === 0) {
    console.log('\nNo items collected. Check network connectivity and .env.local configuration.');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
