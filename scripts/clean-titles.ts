/**
 * Backfill script — clean existing feed item titles.
 *
 * Usage: npx tsx scripts/clean-titles.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { cleanTitle, improveStakeholderTitle } from '../lib/feeds/clean-title';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY');
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function cleanAllTitles() {
  const BATCH_SIZE = 500;
  let offset = 0;
  let cleaned = 0;
  let improved = 0;
  let total = 0;

  console.log('=== Title Backfill ===\n');

  while (true) {
    const { data: items } = await supabase
      .from('feed_items')
      .select('id, title, source_type, source_name, body')
      .range(offset, offset + BATCH_SIZE - 1);

    if (!items || items.length === 0) break;
    total += items.length;

    for (const item of items) {
      let newTitle = cleanTitle(item.title);

      // For stakeholder items, also improve bare titles
      if (item.source_type === 'stakeholder') {
        newTitle = improveStakeholderTitle(newTitle, item.source_name, item.body);
      }

      if (newTitle !== item.title) {
        const { error } = await supabase
          .from('feed_items')
          .update({ title: newTitle })
          .eq('id', item.id);

        if (error) {
          console.warn(`  [ERR] ${item.id}: ${error.message}`);
        } else {
          if (item.source_type === 'stakeholder' && newTitle !== cleanTitle(item.title)) {
            improved++;
          } else {
            cleaned++;
          }
        }
      }
    }

    console.log(`  Processed ${total} items (${cleaned} cleaned, ${improved} improved)...`);
    offset += BATCH_SIZE;
  }

  console.log(`\n=== Done ===`);
  console.log(`Total scanned: ${total}`);
  console.log(`Titles cleaned: ${cleaned}`);
  console.log(`Stakeholder titles improved: ${improved}`);
}

cleanAllTitles().catch(console.error);
