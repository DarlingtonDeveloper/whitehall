/**
 * Backfill feed_items: topic_tags + entity_ids re-enrichment
 *
 * 1. Adds the topic_tags column if missing
 * 2. Extracts topic tags from title + body for all rows
 * 3. Re-enriches entity_ids using the latest enrichment patterns
 *
 * Usage:
 *   npx tsx scripts/backfill-feed-items.ts              — Tag rows with empty topic_tags
 *   npx tsx scripts/backfill-feed-items.ts --all        — Re-tag all rows
 *   npx tsx scripts/backfill-feed-items.ts --entities   — Also re-enrich entity_ids
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

import { extractTopicTags, enrichEntityIds } from '../lib/feeds/entity-enrichment';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const BATCH_SIZE = 500;
const retagAll = process.argv.includes('--all');
const reEnrichEntities = process.argv.includes('--entities');

async function ensureColumn() {
  // Add topic_tags column if it doesn't exist
  const { error } = await supabase.rpc('exec_sql', {
    sql: `ALTER TABLE feed_items ADD COLUMN IF NOT EXISTS topic_tags TEXT[] DEFAULT '{}';
          CREATE INDEX IF NOT EXISTS idx_feed_items_topics ON feed_items USING GIN (topic_tags);`,
  }).maybeSingle();

  if (error) {
    // RPC might not exist — try raw SQL via REST
    console.log('  Note: exec_sql RPC not available, assuming column exists');
  }
}

async function backfill() {
  console.log(`\n=== Feed Items Backfill ===`);
  console.log(`Mode: ${retagAll ? 'Re-tag ALL rows' : 'Only empty topic_tags'}`);
  console.log(`Entity re-enrichment: ${reEnrichEntities ? 'YES' : 'NO'}\n`);

  await ensureColumn();

  let lastId = process.env.START_ID || '';
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalRows = 0;
  let totalEntitiesUpdated = 0;
  let hasMore = true;

  while (hasMore) {
    // Cursor-based pagination — always efficient regardless of position
    let query = supabase
      .from('feed_items')
      .select('id, title, body, entity_ids, topic_tags')
      .order('id')
      .limit(BATCH_SIZE);

    if (lastId) {
      query = query.gt('id', lastId);
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

    // Group updates by tag+entity set for batch efficiency
    const tagUpdates: Array<{ id: string; topic_tags: string[]; entity_ids?: string[] }> = [];

    for (const row of rows) {
      // Skip already-tagged rows unless --all
      if (!retagAll && row.topic_tags && row.topic_tags.length > 0) {
        totalSkipped++;
        continue;
      }

      const title = row.title || '';
      const body = row.body || '';

      if (!title && !body) {
        totalSkipped++;
        continue;
      }

      const tags = extractTopicTags(title, body);

      let newEntityIds: string[] | undefined;
      if (reEnrichEntities) {
        newEntityIds = enrichEntityIds(row.entity_ids || [], title, body);
      }

      if (tags.length === 0 && !newEntityIds) {
        totalSkipped++;
        continue;
      }

      tagUpdates.push({
        id: row.id,
        topic_tags: tags,
        ...(newEntityIds ? { entity_ids: newEntityIds } : {}),
      });
    }

    // Batch update — group by tag set for efficiency
    if (tagUpdates.length > 0) {
      if (reEnrichEntities) {
        // Each row may have unique entity_ids, so update individually in chunks
        for (let i = 0; i < tagUpdates.length; i += 50) {
          const chunk = tagUpdates.slice(i, i + 50);
          for (const upd of chunk) {
            const updateData: Record<string, unknown> = { topic_tags: upd.topic_tags };
            if (upd.entity_ids) updateData.entity_ids = upd.entity_ids;

            const { error: updateErr } = await supabase
              .from('feed_items')
              .update(updateData)
              .eq('id', upd.id);

            if (updateErr) {
              console.warn(`    [ERR] Update ${upd.id}: ${updateErr.message}`);
            } else {
              totalUpdated++;
              if (upd.entity_ids) totalEntitiesUpdated++;
            }
          }
        }
      } else {
        // Group by tag set for efficient batch updates
        const byTags = new Map<string, string[]>();
        for (const upd of tagUpdates) {
          const key = JSON.stringify(upd.topic_tags.sort());
          if (!byTags.has(key)) byTags.set(key, []);
          byTags.get(key)!.push(upd.id);
        }

        for (const [tagKey, ids] of byTags) {
          const tags = JSON.parse(tagKey) as string[];
          for (let i = 0; i < ids.length; i += 200) {
            const chunk = ids.slice(i, i + 200);
            const { error: updateErr } = await supabase
              .from('feed_items')
              .update({ topic_tags: tags })
              .in('id', chunk);

            if (updateErr) {
              console.warn(`    [ERR] Batch update (${chunk.length} rows): ${updateErr.message}`);
            } else {
              totalUpdated += chunk.length;
            }
          }
        }
      }
    }

    // Advance cursor
    lastId = rows[rows.length - 1].id;

    if (totalRows % 5000 === 0 || rows.length < BATCH_SIZE) {
      console.log(`  Progress: ${totalRows} scanned, ${totalUpdated} tagged${reEnrichEntities ? `, ${totalEntitiesUpdated} entities enriched` : ''}, ${totalSkipped} no topics`);
    }
  }

  console.log(`\n=== Feed Items Backfill Complete ===`);
  console.log(`  Rows scanned:       ${totalRows}`);
  console.log(`  Rows tagged:        ${totalUpdated}`);
  if (reEnrichEntities) {
    console.log(`  Entities enriched:  ${totalEntitiesUpdated}`);
  }
  console.log(`  No topics:          ${totalSkipped}`);
}

backfill().catch(console.error);
