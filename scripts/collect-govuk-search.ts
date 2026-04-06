#!/usr/bin/env npx tsx
/**
 * GOV.UK Search API Collection Script
 *
 * Fetches 12 months of historical publications from the GOV.UK Search API
 * across all document types and departments, then upserts into Supabase.
 *
 * Usage:
 *   npx tsx scripts/collect-govuk-search.ts
 */

import { collectAllGovUKSearch, TRACKED_ORGANISATIONS, DOCUMENT_TYPES } from '../lib/feeds/govuk-search';

async function main() {
  const start = Date.now();

  console.log('╔══════════════════════════════════════════╗');
  console.log('║    GOV.UK Search API Collection          ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log(`Tracked organisations: ${TRACKED_ORGANISATIONS.length}`);
  console.log(`Document types: ${DOCUMENT_TYPES.length}`);

  try {
    const result = await collectAllGovUKSearch();

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log('╔══════════════════════════════════════════╗');
    console.log('║       Collection Summary                 ║');
    console.log('╠══════════════════════════════════════════╣');
    console.log(`║  Inserted:  ${String(result.inserted).padEnd(28)}║`);
    console.log(`║  Skipped:   ${String(result.skipped).padEnd(28)}║`);
    console.log(`║  Duration:  ${String(elapsed + 's').padEnd(28)}║`);
    console.log('╚══════════════════════════════════════════╝');
  } catch (err) {
    console.error('\nFatal error during GOV.UK Search collection:', err);
    process.exit(1);
  }
}

main();
