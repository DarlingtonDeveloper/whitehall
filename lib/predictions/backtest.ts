import { getServiceClient } from '@/lib/db';
import { predictVote } from './vote';
import type { BacktestInput, BacktestResult, CalibrationBucket, DivisionBacktest } from './types';

const LOG_LOSS_CLAMP = 1e-7; // avoid log(0)

/**
 * Run a backtest: predict historical division votes using only evidence available
 * before each vote, then compare against actual outcomes.
 */
export async function runBacktest(input: BacktestInput): Promise<BacktestResult> {
  const predictionId = crypto.randomUUID();
  const db = getServiceClient();

  const predictions: Array<{
    division_id: number;
    division_title: string;
    politician_id: string;
    p_aye: number;
    ci_95: [number, number];
    actual_aye: boolean;
  }> = [];

  for (const divisionId of input.division_ids) {
    // Fetch all division votes for this division
    const { data: votes } = await db
      .from('politician_evidence')
      .select('politician_id, parsed, occurred_at, raw_content')
      .eq('evidence_type', 'division_vote')
      .filter('parsed->>division_id', 'eq', String(divisionId));

    if (!votes || votes.length === 0) continue;

    // Determine bill_id from the first vote's parsed data
    const firstParsed = votes[0].parsed as Record<string, unknown>;
    const billRef = firstParsed.bill_ref as string | null;
    if (!billRef) continue;

    const divisionTitle = (votes[0].raw_content as string)?.slice(0, 100) ?? `Division ${divisionId}`;
    const occurredAt = new Date(votes[0].occurred_at);

    // Predict 1 day before the vote
    const asOf = new Date(occurredAt.getTime() - 24 * 60 * 60 * 1000);

    for (const vote of votes) {
      const parsed = vote.parsed as Record<string, unknown>;
      const actual = parsed.vote as string;

      // Skip non-diagnostic votes
      if (actual === 'absent' || actual === 'abstain' || actual === 'teller_aye' || actual === 'teller_no') {
        continue;
      }

      // Filter by politician_ids if specified
      if (input.politician_ids && !input.politician_ids.includes(vote.politician_id)) {
        continue;
      }

      try {
        const result = await predictVote({
          politician_id: vote.politician_id,
          bill_id: billRef,
          amendment_id: (parsed.amendment_ref as string) ?? undefined,
          as_of: asOf,
        });

        predictions.push({
          division_id: divisionId,
          division_title: divisionTitle,
          politician_id: vote.politician_id,
          p_aye: result.p_aye,
          ci_95: result.ci_95,
          actual_aye: actual === 'aye',
        });
      } catch (err) {
        console.warn(`[BACKTEST] Failed to predict ${vote.politician_id} on division ${divisionId}:`, err);
      }
    }
  }

  if (predictions.length === 0) {
    return {
      prediction_id: predictionId,
      n_predictions: 0,
      accuracy: 0,
      log_loss: 0,
      ci_coverage: 0,
      calibration: [],
      per_division: [],
    };
  }

  // Compute metrics
  const accuracy = computeAccuracy(predictions);
  const logLoss = computeLogLoss(predictions);
  const ciCoverage = computeCiCoverage(predictions);
  const calibration = computeCalibration(predictions);
  const perDivision = computePerDivision(predictions);

  return {
    prediction_id: predictionId,
    n_predictions: predictions.length,
    accuracy: round(accuracy),
    log_loss: round(logLoss),
    ci_coverage: round(ciCoverage),
    calibration,
    per_division: perDivision,
  };
}

// -- Metrics ------------------------------------------------------------------

type Prediction = {
  division_id: number;
  division_title: string;
  politician_id: string;
  p_aye: number;
  ci_95: [number, number];
  actual_aye: boolean;
};

function computeAccuracy(preds: Prediction[]): number {
  let correct = 0;
  for (const p of preds) {
    const predictedAye = p.p_aye > 0.5;
    if (predictedAye === p.actual_aye) correct++;
  }
  return correct / preds.length;
}

function computeLogLoss(preds: Prediction[]): number {
  let totalLoss = 0;
  for (const p of preds) {
    const prob = p.actual_aye
      ? Math.max(p.p_aye, LOG_LOSS_CLAMP)
      : Math.max(1 - p.p_aye, LOG_LOSS_CLAMP);
    totalLoss -= Math.log(prob);
  }
  return totalLoss / preds.length;
}

function computeCiCoverage(preds: Prediction[]): number {
  let covered = 0;
  for (const p of preds) {
    // For an aye vote, check if 1.0 is "compatible" with the CI
    // For a no vote, check if 0.0 is "compatible"
    // More practically: is the actual outcome (0 or 1) within the CI bounds?
    const actual = p.actual_aye ? 1.0 : 0.0;
    if (actual >= p.ci_95[0] && actual <= p.ci_95[1]) covered++;
  }
  return covered / preds.length;
}

function computeCalibration(preds: Prediction[]): CalibrationBucket[] {
  const buckets: CalibrationBucket[] = [];
  const bucketSize = 0.1;

  for (let lo = 0; lo < 1.0; lo += bucketSize) {
    const hi = lo + bucketSize;
    const inBucket = preds.filter((p) => p.p_aye >= lo && p.p_aye < hi);
    if (inBucket.length === 0) continue;

    const predictedMean = inBucket.reduce((sum, p) => sum + p.p_aye, 0) / inBucket.length;
    const actualRate = inBucket.filter((p) => p.actual_aye).length / inBucket.length;

    buckets.push({
      bucket_low: round(lo),
      bucket_high: round(hi),
      predicted_mean: round(predictedMean),
      actual_rate: round(actualRate),
      count: inBucket.length,
    });
  }

  return buckets;
}

function computePerDivision(preds: Prediction[]): DivisionBacktest[] {
  const byDivision = new Map<number, Prediction[]>();
  for (const p of preds) {
    if (!byDivision.has(p.division_id)) byDivision.set(p.division_id, []);
    byDivision.get(p.division_id)!.push(p);
  }

  const results: DivisionBacktest[] = [];
  for (const [divId, divPreds] of byDivision) {
    results.push({
      division_id: divId,
      division_title: divPreds[0].division_title,
      predictions_made: divPreds.length,
      accuracy: round(computeAccuracy(divPreds)),
      mean_log_loss: round(computeLogLoss(divPreds)),
    });
  }

  return results.sort((a, b) => b.accuracy - a.accuracy);
}

function round(v: number, decimals = 4): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}
