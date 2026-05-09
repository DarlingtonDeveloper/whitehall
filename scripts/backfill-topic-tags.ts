/**
 * Backfill topic_tags on all politician_evidence rows.
 *
 * Reads evidence rows in batches using cursor-based pagination,
 * applies extractTopicTags() to raw_content + parsed data,
 * and updates the topic_tags column.
 *
 * Usage:
 *   npx tsx scripts/backfill-topic-tags.ts           — Backfill all rows with empty topic_tags
 *   npx tsx scripts/backfill-topic-tags.ts --all     — Re-tag all rows (overwrite existing)
 *
 * Environment:
 *   START_ID=12345  — Resume from a specific evidence ID
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

import { extractTopicTags } from '../lib/feeds/entity-enrichment';

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

async function backfill() {
  console.log(`\n=== Topic Tags Backfill ===`);
  console.log(`Mode: ${retagAll ? 'Re-tag ALL rows' : 'Only empty topic_tags'}\n`);

  let lastId = parseInt(process.env.START_ID || '0', 10);
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalRows = 0;
  let hasMore = true;

  while (hasMore) {
    // Cursor-based pagination — always efficient regardless of position
    let query = supabase
      .from('politician_evidence')
      .select('id, evidence_type, raw_content, parsed')
      .gt('id', lastId)
      .order('id')
      .limit(BATCH_SIZE);

    // Only process rows with empty topic_tags unless --all
    if (!retagAll) {
      query = query.eq('topic_tags', '{}');
    }

    const { data: rows, error } = await query;

    if (error) {
      console.error(`  [ERR] Fetch failed after id ${lastId}: ${error.message}`);
      console.log(`  Resume with: START_ID=${lastId} npx tsx scripts/backfill-topic-tags.ts --all`);
      break;
    }

    if (!rows || rows.length === 0) {
      hasMore = false;
      break;
    }

    totalRows += rows.length;
    // Advance cursor to last ID in this batch
    lastId = rows[rows.length - 1].id;

    // Build updates
    const updates: Array<{ id: string; topic_tags: string[] }> = [];

    for (const row of rows) {
      const parsed = (row.parsed || {}) as Record<string, unknown>;

      // Build text to scan from all available content
      const textParts: string[] = [];

      // raw_content is the main text
      if (row.raw_content) textParts.push(row.raw_content);

      // Parsed fields vary by evidence type
      if (parsed.debate_title) textParts.push(parsed.debate_title as string);
      if (parsed.question_text) textParts.push(parsed.question_text as string);
      if (parsed.answer_text) textParts.push(parsed.answer_text as string);
      if (parsed.answering_body) textParts.push(parsed.answering_body as string);
      if (parsed.edm_title) textParts.push(parsed.edm_title as string);
      if (parsed.division_title) textParts.push(parsed.division_title as string);
      if (parsed.category) textParts.push(parsed.category as string);
      if (parsed.description) textParts.push(parsed.description as string);

      const fullText = textParts.join(' ');
      if (!fullText) continue;

      const tags = extractTopicTags('', fullText);
      if (tags.length === 0) {
        totalSkipped++;
        continue;
      }

      updates.push({ id: row.id, topic_tags: tags });
    }

    // Group by tag set and batch update all rows with the same tags
    if (updates.length > 0) {
      const byTags = new Map<string, string[]>();
      for (const upd of updates) {
        const key = JSON.stringify(upd.topic_tags.sort());
        if (!byTags.has(key)) byTags.set(key, []);
        byTags.get(key)!.push(upd.id);
      }

      for (const [tagKey, ids] of byTags) {
        const tags = JSON.parse(tagKey) as string[];
        // Batch update in chunks of 200 IDs
        for (let i = 0; i < ids.length; i += 200) {
          const chunk = ids.slice(i, i + 200);
          const { error: updateErr } = await supabase
            .from('politician_evidence')
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

    if (totalRows % 5000 === 0 || rows.length < BATCH_SIZE) {
      console.log(`  Progress: ${totalRows} scanned, ${totalUpdated} tagged, ${totalSkipped} no topics (cursor: ${lastId})`);
    }
  }

  console.log(`\n=== Backfill Complete ===`);
  console.log(`  Rows scanned:  ${totalRows}`);
  console.log(`  Rows tagged:   ${totalUpdated}`);
  console.log(`  No topics:     ${totalSkipped}`);
}

backfill().catch(console.error);
