/**
 * Re-enrich entity_ids on feed_items using latest enrichment patterns.
 *
 * Scans all feed_items and re-applies entity enrichment to catch items
 * that were tagged before patterns were expanded.
 *
 * Usage:
 *   npx tsx scripts/re-enrich-entities.ts              — Only re-enrich items with empty entity_ids
 *   npx tsx scripts/re-enrich-entities.ts --all        — Re-enrich all items
 *   npx tsx scripts/re-enrich-entities.ts --parliament  — Only items with entity_ids = {parliament}
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

import { enrichEntityIds } from '../lib/feeds/entity-enrichment';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const BATCH_SIZE = 500;
const reEnrichAll = process.argv.includes('--all');
const onlyParliament = process.argv.includes('--parliament');

async function run() {
  console.log(`\n=== Entity Re-Enrichment ===`);
  console.log(`Mode: ${reEnrichAll ? 'ALL items' : onlyParliament ? 'Only parliament-tagged' : 'Only empty entity_ids'}\n`);

  let lastId = process.env.START_ID || '';
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalRows = 0;
  let hasMore = true;

  while (hasMore) {
    let query = supabase
      .from('feed_items')
      .select('id, title, body, entity_ids')
      .order('id')
      .limit(BATCH_SIZE);

    if (lastId) {
      query = query.gt('id', lastId);
    }

    if (!reEnrichAll) {
      if (onlyParliament) {
        query = query.contains('entity_ids', ['parliament']);
      } else {
        query = query.eq('entity_ids', '{}');
      }
    }

    const { data: rows, error } = await query;

    if (error) {
      console.error(`  [ERR] Fetch failed after id ${lastId}: ${error.message}`);
      break;
    }

    if (!rows || rows.length === 0) {
      hasMore = false;
      break;
    }

    totalRows += rows.length;
    lastId = rows[rows.length - 1].id;

    for (const row of rows) {
      const title = row.title || '';
      const body = row.body || '';
      if (!title && !body) {
        totalSkipped++;
        continue;
      }

      const newIds = enrichEntityIds([], title, body);
      if (newIds.length === 0) {
        totalSkipped++;
        continue;
      }

      // Check if the new entity_ids are different
      const oldIds = (row.entity_ids || []).sort().join(',');
      const newSorted = newIds.sort().join(',');
      if (oldIds === newSorted) {
        totalSkipped++;
        continue;
      }

      const { error: updateErr } = await supabase
        .from('feed_items')
        .update({ entity_ids: newIds })
        .eq('id', row.id);

      if (updateErr) {
        console.warn(`    [ERR] Update ${row.id}: ${updateErr.message}`);
      } else {
        totalUpdated++;
      }
    }

    if (totalRows % 2000 === 0 || rows.length < BATCH_SIZE) {
      console.log(`  Progress: ${totalRows} scanned, ${totalUpdated} enriched, ${totalSkipped} unchanged`);
    }
  }

  console.log(`\n=== Entity Re-Enrichment Complete ===`);
  console.log(`  Rows scanned:  ${totalRows}`);
  console.log(`  Rows updated:  ${totalUpdated}`);
  console.log(`  Unchanged:     ${totalSkipped}`);
}

run().catch(console.error);
