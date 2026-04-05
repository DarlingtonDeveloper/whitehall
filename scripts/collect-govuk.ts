#!/usr/bin/env npx tsx
/**
 * GOV.UK Feed Collection Script
 *
 * Fetches publications from all major government departments and bodies
 * via GOV.UK Atom feeds and upserts them into Supabase.
 *
 * Usage:
 *   npx tsx scripts/collect-govuk.ts
 */

import { collectGovUK, GOVUK_FEEDS } from '../lib/feeds/govuk';

async function main() {
  const start = Date.now();

  console.log('╔══════════════════════════════════════════╗');
  console.log('║       GOV.UK Feed Collection             ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log(`Configured: ${GOVUK_FEEDS.length} organisations`);

  const totalFeeds = GOVUK_FEEDS.reduce((sum, f) => sum + f.feedTypes.length, 0);
  console.log(`Total feeds to fetch: ${totalFeeds}`);

  try {
    const result = await collectGovUK();

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log('╔══════════════════════════════════════════╗');
    console.log('║       Collection Summary                 ║');
    console.log('╠══════════════════════════════════════════╣');
    console.log(`║  Inserted:  ${String(result.inserted).padEnd(28)}║`);
    console.log(`║  Skipped:   ${String(result.skipped).padEnd(28)}║`);
    console.log(`║  Duration:  ${String(elapsed + 's').padEnd(28)}║`);
    console.log('╚══════════════════════════════════════════╝');
  } catch (err) {
    console.error('\nFatal error during GOV.UK collection:', err);
    process.exit(1);
  }
}

main();
