#!/usr/bin/env npx tsx
/**
 * Parliament Feed Collection Script
 *
 * Fetches data from multiple Parliament UK APIs (Bills, Written Questions,
 * Commons Divisions, Lords Divisions, Written Statements) and upserts
 * them into Supabase.
 *
 * Usage:
 *   npx tsx scripts/collect-parliament.ts
 */

import { collectParliament } from '../lib/feeds/parliament';

async function main() {
  const start = Date.now();

  console.log('╔══════════════════════════════════════════╗');
  console.log('║     Parliament Feed Collection           ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`Started at: ${new Date().toISOString()}`);

  try {
    const result = await collectParliament();

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log('╔══════════════════════════════════════════╗');
    console.log('║       Collection Summary                 ║');
    console.log('╠══════════════════════════════════════════╣');
    console.log(`║  Inserted:  ${String(result.inserted).padEnd(28)}║`);
    console.log(`║  Skipped:   ${String(result.skipped).padEnd(28)}║`);
    console.log(`║  Duration:  ${String(elapsed + 's').padEnd(28)}║`);
    console.log('╚══════════════════════════════════════════╝');
  } catch (err) {
    console.error('\nFatal error during Parliament collection:', err);
    process.exit(1);
  }
}

main();
