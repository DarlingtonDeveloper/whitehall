import { tool } from 'ai';
import { z } from 'zod';
import {
  predictVote,
  predictPosition,
  mapCoalitions,
  identifySwings,
  computeEvidenceGaps,
  logPrediction,
  getPrediction,
} from '@/lib/predictions';

// ---------------------------------------------------------------------------
// Politician prediction tools — extends the chat tool set with political
// intelligence predictions (vote, position, coalition, swing, EIG, audit).
// ---------------------------------------------------------------------------

export const politicianTools = {
  predict_vote: tool({
    description:
      'Predict how a politician will vote on a bill or amendment. Returns P(aye) with indicator drivers, key evidence, whip adjustment, and confidence intervals. Requires a bill_id that has bill_policy_mappings.',
    inputSchema: z.object({
      politician_id: z
        .string()
        .describe('Politician UUID'),
      bill_id: z
        .string()
        .describe('Bill reference ID'),
      amendment_id: z
        .string()
        .optional()
        .describe('Amendment ID if predicting on a specific amendment'),
    }),
    execute: async ({ politician_id, bill_id, amendment_id }): Promise<Record<string, unknown>> => {
      const result = await predictVote({ politician_id, bill_id, amendment_id });
      await logPrediction(result.prediction_id, 'vote', { politician_id, bill_id, amendment_id }, result as unknown as Record<string, unknown>);
      return result as unknown as Record<string, unknown>;
    },
  }),

  predict_position: tool({
    description:
      "Predict a politician's position on an emerging issue without direct evidence. Blends ideology priors, adjacent policy similarity, and network signals from voting alignment. Good for novel issues that haven't come to a vote yet.",
    inputSchema: z.object({
      politician_id: z
        .string()
        .describe('Politician UUID'),
      issue_text: z
        .string()
        .describe('Description of the issue to predict position on (e.g. "Should the UK ban single-use plastics?")'),
    }),
    execute: async ({ politician_id, issue_text }): Promise<Record<string, unknown>> => {
      const result = await predictPosition({ politician_id, issue_text });
      await logPrediction(result.prediction_id, 'position', { politician_id, issue_text }, result as unknown as Record<string, unknown>);
      return result as unknown as Record<string, unknown>;
    },
  }),

  map_coalitions: tool({
    description:
      'Map coalitions of politicians within a policy area using k-means clustering on their indicator posteriors. Shows which groups of politicians share similar positions and what defines each group.',
    inputSchema: z.object({
      policy_area: z
        .string()
        .describe('Policy area (e.g. "energy", "health", "education")'),
      k: z
        .number()
        .optional()
        .describe('Number of clusters. Auto-detected via silhouette score if omitted.'),
      party: z
        .string()
        .optional()
        .describe('Filter to a specific party (e.g. "Conservative", "Labour")'),
      house: z
        .enum(['commons', 'lords'])
        .optional()
        .describe('Filter to commons or lords'),
    }),
    execute: async ({ policy_area, k, party, house }): Promise<Record<string, unknown>> => {
      const result = await mapCoalitions({
        policy_area,
        k,
        politician_filter: { party, house },
      });
      await logPrediction(result.prediction_id, 'coalition', { policy_area, k, party, house }, result as unknown as Record<string, unknown>);
      return result as unknown as Record<string, unknown>;
    },
  }),

  identify_swings: tool({
    description:
      'Identify swing politicians — those with high uncertainty AND high influence in a policy area or on a specific bill. Useful for "who should you talk to to change the outcome of this vote?"',
    inputSchema: z.object({
      policy_area: z
        .string()
        .optional()
        .describe('Policy area to assess swing voters in'),
      bill_id: z
        .string()
        .optional()
        .describe('Bill ID to assess swing votes for'),
      limit: z
        .number()
        .optional()
        .describe('Max results. Default 20.'),
    }),
    execute: async ({ policy_area, bill_id, limit }): Promise<Record<string, unknown>> => {
      const result = await identifySwings({ policy_area, bill_id, limit });
      await logPrediction(result.prediction_id, 'swing', { policy_area, bill_id, limit }, result as unknown as Record<string, unknown>);
      return result as unknown as Record<string, unknown>;
    },
  }),

  audit_prediction: tool({
    description:
      'Look up a previously made prediction by its ID. Returns the full input, output, and any logged outcomes.',
    inputSchema: z.object({
      prediction_id: z
        .string()
        .describe('The prediction ID (UUID) to look up'),
    }),
    execute: async ({ prediction_id }): Promise<Record<string, unknown>> => {
      const entry = await getPrediction(prediction_id);
      if (!entry) return { error: `Prediction ${prediction_id} not found` };
      return entry as unknown as Record<string, unknown>;
    },
  }),

  evidence_gaps: tool({
    description:
      'Identify which indicators would most benefit from additional evidence for a given prediction. Ranks by expected variance reduction. Use after a vote or position prediction to understand intelligence priorities.',
    inputSchema: z.object({
      politician_id: z
        .string()
        .describe('Politician UUID'),
      prediction_id: z
        .string()
        .describe('Reference prediction ID to analyze gaps for'),
    }),
    execute: async ({ politician_id, prediction_id }): Promise<Record<string, unknown>> => {
      const result = await computeEvidenceGaps({ politician_id, prediction_id });
      return result as unknown as Record<string, unknown>;
    },
  }),
};
