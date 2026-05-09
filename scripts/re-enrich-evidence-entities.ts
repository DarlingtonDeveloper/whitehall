/**
 * Re-enrich entity_ids on politician_evidence using latest enrichment patterns.
 *
 * Uses cursor-based pagination for efficiency on large tables.
 *
 * Usage:
 *   npx tsx scripts/re-enrich-evidence-entities.ts           — Only rows with empty entity_ids
 *   npx tsx scripts/re-enrich-evidence-entities.ts --all     — Re-enrich all rows
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

async function run() {
  console.log(`\n=== Evidence Entity Re-Enrichment ===`);
  console.log(`Mode: ${reEnrichAll ? 'ALL rows' : 'Only empty entity_ids'}\n`);

  let lastId = parseInt(process.env.START_ID || '0', 10);
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalRows = 0;
  let hasMore = true;

  while (hasMore) {
    let query = supabase
      .from('politician_evidence')
      .select('id, evidence_type, raw_content, parsed, entity_ids')
      .gt('id', lastId)
      .order('id')
      .limit(BATCH_SIZE);

    if (!reEnrichAll) {
      query = query.eq('entity_ids', '{}');
    }

    const { data: rows, error } = await query;

    if (error) {
      console.error(`  [ERR] Fetch failed after id ${lastId}: ${error.message}`);
      console.log(`  Resume with: START_ID=${lastId} npx tsx scripts/re-enrich-evidence-entities.ts`);
      break;
    }

    if (!rows || rows.length === 0) {
      hasMore = false;
      break;
    }

    totalRows += rows.length;
    lastId = rows[rows.length - 1].id;

    // Build updates
    const updates: Array<{ id: number; entity_ids: string[] }> = [];

    for (const row of rows) {
      const parsed = (row.parsed || {}) as Record<string, unknown>;

      // Build text from all available content
      const textParts: string[] = [];
      if (row.raw_content) textParts.push(row.raw_content);
      if (parsed.debate_title) textParts.push(parsed.debate_title as string);
      if (parsed.division_title) textParts.push(parsed.division_title as string);
      if (parsed.question_text) textParts.push(parsed.question_text as string);
      if (parsed.answer_text) textParts.push(parsed.answer_text as string);
      if (parsed.answering_body) textParts.push(parsed.answering_body as string);
      if (parsed.edm_title) textParts.push(parsed.edm_title as string);
      if (parsed.category) textParts.push(parsed.category as string);
      if (parsed.description) textParts.push(parsed.description as string);

      const fullText = textParts.join(' ');
      if (!fullText) {
        totalSkipped++;
        continue;
      }

      const newIds = enrichEntityIds([], '', fullText);
      if (newIds.length === 0) {
        totalSkipped++;
        continue;
      }

      // Check if different from existing
      const oldSorted = (row.entity_ids || []).sort().join(',');
      const newSorted = newIds.sort().join(',');
      if (oldSorted === newSorted) {
        totalSkipped++;
        continue;
      }

      updates.push({ id: row.id, entity_ids: newIds });
    }

    // Batch update
    for (const upd of updates) {
      const { error: updateErr } = await supabase
        .from('politician_evidence')
        .update({ entity_ids: upd.entity_ids })
        .eq('id', upd.id);

      if (updateErr) {
        console.warn(`    [ERR] Update ${upd.id}: ${updateErr.message}`);
      } else {
        totalUpdated++;
      }
    }

    if (totalRows % 5000 === 0 || rows.length < BATCH_SIZE) {
      console.log(`  Progress: ${totalRows} scanned, ${totalUpdated} enriched, ${totalSkipped} unchanged (cursor: ${lastId})`);
    }
  }

  console.log(`\n=== Evidence Entity Re-Enrichment Complete ===`);
  console.log(`  Rows scanned:  ${totalRows}`);
  console.log(`  Rows updated:  ${totalUpdated}`);
  console.log(`  Unchanged:     ${totalSkipped}`);
}

run().catch(console.error);
