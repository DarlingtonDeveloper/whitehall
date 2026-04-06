#!/usr/bin/env npx tsx
/**
 * UK Parliament Petitions Collection
 *
 * Usage:  npx tsx scripts/collect-petitions.ts
 */

import { collectPetitions } from '../lib/feeds/petitions';

collectPetitions()
  .then(({ inserted, skipped }) => {
    console.log(`\nDone. Inserted: ${inserted}, Skipped: ${skipped}`);
  })
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
