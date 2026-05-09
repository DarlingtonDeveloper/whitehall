/**
 * Classify all committee_membership evidence using deterministic classifier.
 * No LLM calls — purely database lookups against committee_indicator_map.
 *
 * Usage: npx tsx scripts/classify-committees.ts
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

async function main() {
  const { createClient } = await import('@supabase/supabase-js');
  const { classifyEvidenceBatch } = await import('../lib/classifier/pipeline');

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Get already-classified evidence IDs
  const { data: classifiedRows } = await sb
    .from('politician_indicator_evidence')
    .select('evidence_id');
  const classifiedIds = new Set((classifiedRows ?? []).map((r: { evidence_id: number }) => r.evidence_id));
  console.log('Already classified:', classifiedIds.size, 'evidence rows');

  // Fetch all committee_membership evidence
  const { data: allRows, error, count } = await sb
    .from('politician_evidence')
    .select('*', { count: 'exact' })
    .eq('evidence_type', 'committee_membership')
    .order('id', { ascending: true });

  if (error) { console.error('Fetch error:', error.message); return; }
  console.log('Total committee_membership rows:', count);

  const unclassified = (allRows ?? []).filter((e: { id: number }) => !classifiedIds.has(e.id));
  console.log('Unclassified:', unclassified.length);

  if (unclassified.length === 0) {
    console.log('Nothing to classify.');
    return;
  }

  const batchSize = 100;
  let totalClassified = 0;
  let totalNoMapping = 0;
  let totalErrors = 0;

  for (let i = 0; i < unclassified.length; i += batchSize) {
    const batch = unclassified.slice(i, i + batchSize);
    const results = await classifyEvidenceBatch(batch);

    const classified = results.filter((r) => r.classifications.length > 0).length;
    const noMapping = results.filter((r) => r.no_classification_reason === 'no_mapping').length;
    const errors = results.filter((r) => r.no_classification_reason?.startsWith('error:')).length;

    totalClassified += classified;
    totalNoMapping += noMapping;
    totalErrors += errors;

    console.log(
      `  Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(unclassified.length / batchSize)}` +
      ` — classified: ${classified}, no_mapping: ${noMapping}, errors: ${errors}`,
    );
  }

  console.log();
  console.log('=== Classification Complete ===');
  console.log(`  Total processed: ${unclassified.length}`);
  console.log(`  Classified:      ${totalClassified}`);
  console.log(`  No mapping:      ${totalNoMapping}`);
  console.log(`  Errors:          ${totalErrors}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
