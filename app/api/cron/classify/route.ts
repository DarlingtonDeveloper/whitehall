import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/db';
import { classifyEvidenceBatch } from '@/lib/classifier/pipeline';
import { DETERMINISTIC_TYPES } from '@/lib/classifier/constants';
import type { PoliticianEvidence } from '@/types/politician';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BATCH_SIZE = 200;
const MAX_PER_RUN = 2000;

/**
 * Classify new deterministic evidence (division votes, register entries,
 * APPG/committee memberships) that arrived since the last run.
 *
 * Uses classifier_failures as a dead-letter queue — evidence that errors
 * is recorded there and excluded from future runs until resolved.
 *
 * Schedule: 30 3 * * * (3:30 AM UTC, after politician_sync, before math-refresh)
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const start = Date.now();
  const db = getServiceClient();
  const types = Array.from(DETERMINISTIC_TYPES);

  // Build exclusion set: already classified + unresolved failures
  const [{ data: classifiedRows }, { data: failedRows }] = await Promise.all([
    db.from('politician_indicator_evidence')
      .select('evidence_id'),
    db.from('classifier_failures')
      .select('evidence_id')
      .eq('resolved', false),
  ]);

  const excludeIds = new Set<number>();
  for (const r of classifiedRows ?? []) excludeIds.add(r.evidence_id);
  for (const r of failedRows ?? []) excludeIds.add(r.evidence_id);

  // Fetch unclassified deterministic evidence
  const { data: candidates, error: fetchErr } = await db
    .from('politician_evidence')
    .select('*')
    .in('evidence_type', types)
    .order('occurred_at', { ascending: false })
    .limit(MAX_PER_RUN);

  if (fetchErr) {
    console.error('[classify-cron] Fetch error:', fetchErr.message);
    return NextResponse.json({ ok: false, error: fetchErr.message }, { status: 500 });
  }

  const unclassified = (candidates ?? [] as PoliticianEvidence[])
    .filter((e: PoliticianEvidence) => !excludeIds.has(e.id));

  if (unclassified.length === 0) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[classify-cron] No new deterministic evidence (${elapsed}s)`);
    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      elapsed_seconds: parseFloat(elapsed),
      processed: 0,
      classified: 0,
      errors: 0,
    });
  }

  console.log(`[classify-cron] Found ${unclassified.length} unclassified deterministic rows`);

  // Process in batches
  let totalClassified = 0;
  let totalErrors = 0;
  let totalProcessed = 0;

  for (let i = 0; i < unclassified.length; i += BATCH_SIZE) {
    const batch = unclassified.slice(i, i + BATCH_SIZE);
    const results = await classifyEvidenceBatch(batch, { concurrency: 10 });

    for (const r of results) {
      totalProcessed++;
      if (r.classifications.length > 0) totalClassified++;
      if (r.no_classification_reason?.startsWith('error:')) totalErrors++;
    }

    console.log(`[classify-cron] Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} processed, ${results.filter((r) => r.classifications.length > 0).length} classified`);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[classify-cron] Done: ${totalProcessed} processed, ${totalClassified} classified, ${totalErrors} errors (${elapsed}s)`);

  return NextResponse.json({
    ok: true,
    timestamp: new Date().toISOString(),
    elapsed_seconds: parseFloat(elapsed),
    processed: totalProcessed,
    classified: totalClassified,
    errors: totalErrors,
  });
}
