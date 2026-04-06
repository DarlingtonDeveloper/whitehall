#!/usr/bin/env npx tsx
/**
 * Parliamentary Research Briefings Collection
 *
 * Usage:  npx tsx scripts/collect-research-briefings.ts
 */

import { collectResearchBriefings } from '../lib/feeds/research-briefings';

collectResearchBriefings()
  .then(({ inserted, skipped }) => {
    console.log(`\nDone. Inserted: ${inserted}, Skipped: ${skipped}`);
  })
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
