import { getServiceClient } from '@/lib/db';
import type { PredictionLogEntry, PredictionType } from './types';

/**
 * Log a prediction to the predictions_log table.
 */
export async function logPrediction(
  id: string,
  predictionType: PredictionType,
  input: Record<string, unknown>,
  output: Record<string, unknown>,
): Promise<void> {
  const db = getServiceClient();
  const { error } = await db
    .from('predictions_log')
    .insert({
      id,
      prediction_type: predictionType,
      input,
      output,
    });

  if (error) {
    console.warn(`[PREDICTIONS] Failed to log prediction ${id}: ${error.message}`);
  }
}

/**
 * Retrieve a logged prediction by ID.
 */
export async function getPrediction(id: string): Promise<PredictionLogEntry | null> {
  const db = getServiceClient();
  const { data, error } = await db
    .from('predictions_log')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error || !data) return null;
  return data as PredictionLogEntry;
}
