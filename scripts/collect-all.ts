#!/usr/bin/env npx tsx
/**
 * Full Feed Collection Script
 *
 * Runs GOV.UK and Hansard collectors in sequence and reports totals.
 *
 * Usage:
 *   npx tsx scripts/collect-all.ts
 */

import { collectGovUK, GOVUK_FEEDS } from '../lib/feeds/govuk';
import { collectHansard } from '../lib/feeds/hansard';

async function main() {
  const start = Date.now();

  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║       Whitehall — Full Feed Collection           ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log(`GOV.UK orgs configured: ${GOVUK_FEEDS.length}\n`);

  // ── Step 1: GOV.UK feeds ──────────────────────────────────────────────
  let govukResult = { inserted: 0, skipped: 0 };
  try {
    govukResult = await collectGovUK();
  } catch (err) {
    console.error('GOV.UK collection failed:', err);
    console.log('Continuing with Hansard...\n');
  }

  // ── Step 2: Hansard feeds ─────────────────────────────────────────────
  let hansardResult = { inserted: 0, skipped: 0 };
  try {
    hansardResult = await collectHansard();
  } catch (err) {
    console.error('Hansard collection failed:', err);
  }

  // ── Summary ───────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const totalInserted = govukResult.inserted + hansardResult.inserted;
  const totalSkipped = govukResult.skipped + hansardResult.skipped;

  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║       Full Collection Summary                    ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  GOV.UK inserted:   ${String(govukResult.inserted).padEnd(29)}║`);
  console.log(`║  GOV.UK skipped:    ${String(govukResult.skipped).padEnd(29)}║`);
  console.log(`║  Hansard inserted:  ${String(hansardResult.inserted).padEnd(29)}║`);
  console.log(`║  Hansard skipped:   ${String(hansardResult.skipped).padEnd(29)}║`);
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  TOTAL inserted:    ${String(totalInserted).padEnd(29)}║`);
  console.log(`║  TOTAL skipped:     ${String(totalSkipped).padEnd(29)}║`);
  console.log(`║  Duration:          ${String(elapsed + 's').padEnd(29)}║`);
  console.log('╚══════════════════════════════════════════════════╝');

  if (totalInserted === 0 && totalSkipped === 0) {
    console.log('\nNo items collected. Check network connectivity and .env.local configuration.');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
