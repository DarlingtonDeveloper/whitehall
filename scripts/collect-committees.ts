#!/usr/bin/env npx tsx
/**
 * Select Committee Web Scraping Collection
 *
 * Usage:  npx tsx scripts/collect-committees.ts
 */

import { collectCommittees } from '../lib/feeds/committees';

collectCommittees()
  .then(({ inserted, skipped }) => {
    console.log(`\nDone. Inserted: ${inserted}, Skipped: ${skipped}`);
  })
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
