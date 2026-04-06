/**
 * Re-tag all feed items with the updated content-aware entity enrichment.
 *
 * For committee items from cross-cutting committees, entity tags are derived
 * purely from content (not blanket committee defaults).
 *
 * For all other items, content-based tags are merged with existing tags.
 *
 * Usage: npx tsx scripts/retag-all.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

import { enrichEntityIds, tagFromContent } from '../lib/feeds/entity-enrichment';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY in .env.local',
  );
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Cross-cutting committees: entity tags come from content only, no defaults.
const CROSS_CUTTING_COMMITTEES = new Set([
  'Lords Industry and Regulators Committee',
  'Lords Science and Technology Committee',
  'Public Accounts Committee',
  'Welsh Affairs Committee',
  'Scottish Affairs Committee',
]);

// Narrowed committee → parent department mapping
const COMMITTEE_PARENT: Record<string, string[]> = {
  'Energy Security and Net Zero Committee': ['desnz'],
  'Environmental Audit Committee': ['defra'],
  'Business and Trade Committee': ['dbt'],
  'Science, Innovation and Technology Committee': ['dsit'],
  'Health and Social Care Committee': ['dhsc'],
  'Treasury Committee': ['treasury'],
  'Public Administration and Constitutional Affairs Committee': ['co'],
};

async function retagAll() {
  const BATCH_SIZE = 500;
  let offset = 0;
  let totalProcessed = 0;
  let totalUpdated = 0;

  console.log('\n=== Re-tagging all feed items ===\n');

  while (true) {
    const { data: items, error } = await supabase
      .from('feed_items')
      .select('id, title, body, source_name, source_type, entity_ids')
      .range(offset, offset + BATCH_SIZE - 1)
      .order('id');

    if (error) {
      console.error(`Fetch error at offset ${offset}: ${error.message}`);
      break;
    }

    if (!items || items.length === 0) break;

    for (const item of items) {
      let newTags: string[];

      if (item.source_type === 'committee') {
        // Committee items: narrow defaults + content tagging
        const isCrossCutting = CROSS_CUTTING_COMMITTEES.has(item.source_name);
        const parentTags = isCrossCutting
          ? []
          : (COMMITTEE_PARENT[item.source_name] || []);
        newTags = enrichEntityIds(parentTags, item.title || '', item.body || '');
      } else {
        // All other sources: merge current tags with content-based tags
        const contentTags = tagFromContent(`${item.title || ''} ${item.body || ''}`);
        newTags = [...new Set([...(item.entity_ids || []), ...contentTags])];
      }

      // Only update if tags changed
      const oldSet = new Set(item.entity_ids || []);
      const newSet = new Set(newTags);
      const changed =
        newTags.length !== (item.entity_ids || []).length ||
        newTags.some((t) => !oldSet.has(t)) ||
        (item.entity_ids || []).some((t: string) => !newSet.has(t));

      if (changed) {
        const { error: updateError } = await supabase
          .from('feed_items')
          .update({ entity_ids: newTags })
          .eq('id', item.id);

        if (updateError) {
          console.warn(`  [ERR] Update failed for ${item.id}: ${updateError.message}`);
        } else {
          totalUpdated++;
        }
      }
    }

    totalProcessed += items.length;
    console.log(`  Processed ${totalProcessed} items, ${totalUpdated} updated so far`);

    if (items.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }

  console.log(`\n=== Re-tagging Complete ===`);
  console.log(`Total processed: ${totalProcessed}`);
  console.log(`Total updated:   ${totalUpdated}\n`);
}

retagAll().catch(console.error);
