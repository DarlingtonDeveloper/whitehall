export { predictVote } from './vote';
export { predictPosition } from './position';
export { mapCoalitions } from './coalition';
export { identifySwings } from './swing';
export { computeEvidenceGaps } from './eig';
export { runBacktest } from './backtest';
export { logPrediction, getPrediction } from './log';

export type {
  VotePredictionInput,
  VotePredictionResult,
  PositionPredictionInput,
  PositionPredictionResult,
  CoalitionInput,
  CoalitionResult,
  SwingInput,
  SwingResult,
  EigInput,
  EigResult,
  BacktestInput,
  BacktestResult,
  PredictionLogEntry,
} from './types';
