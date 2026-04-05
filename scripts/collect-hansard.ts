#!/usr/bin/env npx tsx
/**
 * Hansard Feed Collection Script
 *
 * Fetches parliamentary contributions (spoken and written) from the
 * Hansard API and upserts them into Supabase.
 *
 * Usage:
 *   npx tsx scripts/collect-hansard.ts
 */

import { collectHansard } from '../lib/feeds/hansard';

async function main() {
  const start = Date.now();

  console.log('╔══════════════════════════════════════════╗');
  console.log('║       Hansard Feed Collection            ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`Started at: ${new Date().toISOString()}`);

  try {
    const result = await collectHansard();

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log('╔══════════════════════════════════════════╗');
    console.log('║       Collection Summary                 ║');
    console.log('╠══════════════════════════════════════════╣');
    console.log(`║  Inserted:  ${String(result.inserted).padEnd(28)}║`);
    console.log(`║  Skipped:   ${String(result.skipped).padEnd(28)}║`);
    console.log(`║  Duration:  ${String(elapsed + 's').padEnd(28)}║`);
    console.log('╚══════════════════════════════════════════╝');
  } catch (err) {
    console.error('\nFatal error during Hansard collection:', err);
    process.exit(1);
  }
}

main();
