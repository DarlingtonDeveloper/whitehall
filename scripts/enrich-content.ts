#!/usr/bin/env npx tsx
/**
 * Content Enrichment Script
 *
 * Fetches full page content for feed items with thin (<500 char) bodies.
 * Rate limited at 300ms per request. Runs in batches of 50 until no
 * more thin items remain.
 *
 * Usage:
 *   npx tsx scripts/enrich-content.ts
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

import { createClient } from '@supabase/supabase-js';
import { enrichThinItems } from '../lib/feeds/enrich-content';

const THIN_THRESHOLD = 500;

async function main() {
  const start = Date.now();
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!,
  );

  // Count total thin items across the whole table
  const { data: allItems } = await supabase
    .from('feed_items')
    .select('id, body')
    .not('url', 'is', null)
    .order('published_at', { ascending: false })
    .limit(50000);

  const totalThin = allItems?.filter(i => !i.body || i.body.length < THIN_THRESHOLD).length ?? 0;

  let total = 0;
  let totalFailed = 0;
  let round = 0;
  let offset = 0;
  const PAGE_SIZE = 1000;

  console.log('╔══════════════════════════════════════════╗');
  console.log('║    Content Enrichment (Full)             ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log(`Thin items to enrich: ~${totalThin}\n`);

  // Page through the entire table
  while (offset < 50000) {
    round++;
    const batch = await enrichThinItems(supabase, offset);
    total += batch.enriched;
    totalFailed += batch.failed;
    const pct = totalThin > 0 ? ((total / totalThin) * 100).toFixed(0) : '?';
    console.log(`  Round ${round} (offset ${offset}): enriched ${batch.enriched}, failed ${batch.failed} (total: ${total}/${totalThin} ~${pct}%)`);

    // If nothing enriched and nothing failed, this page had no thin items — move on
    if (batch.enriched === 0 && batch.failed === 0) {
      offset += PAGE_SIZE;
      continue;
    }
    // If we enriched some, stay on same offset (items shifted)
    // If only failures, advance to avoid infinite loop
    if (batch.enriched === 0) {
      offset += PAGE_SIZE;
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\nDone. Total enriched: ${total}, failed: ${totalFailed}, duration: ${elapsed}s`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
