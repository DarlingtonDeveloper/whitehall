#!/usr/bin/env npx tsx
/**
 * RSS / Trade Press Feed Collection
 *
 * Usage:  npx tsx scripts/collect-rss.ts
 */

import { collectRss } from '../lib/feeds/rss';

collectRss()
  .then(({ inserted, skipped }) => {
    console.log(`\nDone. Inserted: ${inserted}, Skipped: ${skipped}`);
  })
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
