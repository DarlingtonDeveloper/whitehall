#!/usr/bin/env npx tsx
/**
 * Direct Source Scraping Collection
 *
 * Usage:  npx tsx scripts/collect-direct-sources.ts
 */

import { collectDirectSources } from '../lib/feeds/direct-sources';

collectDirectSources()
  .then(({ inserted, skipped }) => {
    console.log(`\nDone. Inserted: ${inserted}, Skipped: ${skipped}`);
  })
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
