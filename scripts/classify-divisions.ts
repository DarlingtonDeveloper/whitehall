/**
 * Classify all division_vote evidence using deterministic classifier only.
 * No LLM calls — purely database lookups against bill_policy_mappings.
 *
 * Usage:
 *   npx tsx scripts/classify-divisions.ts [--limit N] [--batch-size N]
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

async function main() {
  const { createClient } = await import('@supabase/supabase-js');
  const { classifyEvidence, classifyEvidenceBatch } = await import('../lib/classifier/pipeline');

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const args = process.argv.slice(2);
  const limitIdx = args.indexOf('--limit');
  const batchIdx = args.indexOf('--batch-size');
  const maxRows = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : Infinity;
  const batchSize = batchIdx >= 0 ? parseInt(args[batchIdx + 1], 10) : 500;

  // Get already-classified evidence IDs
  const { data: classifiedRows } = await sb
    .from('politician_indicator_evidence')
    .select('evidence_id');
  const classifiedIds = new Set((classifiedRows ?? []).map((r: { evidence_id: number }) => r.evidence_id));
  console.log(`Already classified: ${classifiedIds.size} evidence rows`);

  // Count total division votes
  const { count: totalDivVotes } = await sb
    .from('politician_evidence')
    .select('*', { count: 'exact', head: true })
    .eq('evidence_type', 'division_vote');
  console.log(`Total division votes: ${totalDivVotes}`);

  let offset = 0;
  let totalProcessed = 0;
  let totalClassified = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  while (totalProcessed < maxRows) {
    // Fetch a batch of division_vote evidence
    const fetchSize = Math.min(batchSize * 2, 1000); // Over-fetch to account for exclusions
    const { data: batch, error } = await sb
      .from('politician_evidence')
      .select('*')
      .eq('evidence_type', 'division_vote')
      .order('id', { ascending: true })
      .range(offset, offset + fetchSize - 1);

    if (error || !batch?.length) {
      if (error) console.error('Fetch error:', error.message);
      break;
    }

    offset += batch.length;

    // Filter out already-classified
    const unclassified = batch.filter((e: { id: number }) => !classifiedIds.has(e.id));
    const toProcess = unclassified.slice(0, Math.min(batchSize, maxRows - totalProcessed));

    if (toProcess.length === 0) {
      if (batch.length < fetchSize) break; // No more data
      continue;
    }

    // Classify batch
    const results = await classifyEvidenceBatch(toProcess);

    const classified = results.filter((r) => r.classifications.length > 0).length;
    const skipped = results.filter((r) => r.no_classification_reason === 'no_mapping').length;
    const errors = results.filter((r) => r.no_classification_reason?.startsWith('error:')).length;

    totalProcessed += results.length;
    totalClassified += classified;
    totalSkipped += skipped;
    totalErrors += errors;

    // Track newly classified IDs
    for (const r of results) {
      if (r.classifications.length > 0) classifiedIds.add(r.evidence_id);
    }

    const pct = totalDivVotes ? ((offset / totalDivVotes!) * 100).toFixed(1) : '?';
    console.log(
      `  Batch: ${results.length} processed, ${classified} classified, ${skipped} no mapping, ${errors} errors ` +
      `| Total: ${totalProcessed} processed, ${totalClassified} classified (${pct}% scanned)`,
    );

    if (batch.length < fetchSize) break; // End of data
  }

  console.log(`\n=== Division Vote Classification Complete ===`);
  console.log(`  Processed:  ${totalProcessed}`);
  console.log(`  Classified: ${totalClassified}`);
  console.log(`  No mapping: ${totalSkipped}`);
  console.log(`  Errors:     ${totalErrors}`);

  // Summary of indicators populated
  const { data: indSummary } = await sb
    .from('politician_indicators')
    .select('indicator_id')
    .limit(1000);
  const uniqueIndicators = new Set((indSummary ?? []).map((r: { indicator_id: string }) => r.indicator_id));
  console.log(`\n  Unique indicators populated: ${uniqueIndicators.size}`);

  const { count: piCount } = await sb
    .from('politician_indicators')
    .select('*', { count: 'exact', head: true });
  console.log(`  Politician × indicator rows: ${piCount}`);
}

main().catch(console.error);
