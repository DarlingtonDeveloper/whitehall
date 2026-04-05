#!/usr/bin/env npx tsx
/**
 * Legislation.gov.uk Feed Collection Script
 *
 * Fetches legislation from all legislation.gov.uk Atom feeds
 * (UK Acts, Statutory Instruments, Draft SIs, Impact Assessments,
 * and devolved legislation) and upserts them into Supabase.
 *
 * Usage:
 *   npx tsx scripts/collect-legislation.ts
 */

import { collectLegislation, LEGISLATION_FEEDS } from '../lib/feeds/legislation';

async function main() {
  const start = Date.now();

  console.log('╔══════════════════════════════════════════╗');
  console.log('║   Legislation.gov.uk Feed Collection     ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log(`Configured: ${LEGISLATION_FEEDS.length} feeds`);

  try {
    const result = await collectLegislation();

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log('╔══════════════════════════════════════════╗');
    console.log('║       Collection Summary                 ║');
    console.log('╠══════════════════════════════════════════╣');
    console.log(`║  Inserted:  ${String(result.inserted).padEnd(28)}║`);
    console.log(`║  Skipped:   ${String(result.skipped).padEnd(28)}║`);
    console.log(`║  Duration:  ${String(elapsed + 's').padEnd(28)}║`);
    console.log('╚══════════════════════════════════════════╝');
  } catch (err) {
    console.error('\nFatal error during legislation collection:', err);
    process.exit(1);
  }
}

main();
