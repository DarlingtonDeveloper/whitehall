import { tool } from 'ai';
import { z } from 'zod';
import {
  applyEditField,
  applyRemoveItem,
  applyMoveItem,
  applyAddItem,
  saveReportContent,
} from './mutations';
import type { AnalysisJSON, AnalysedItem } from '@/lib/export/types';

// Import existing chat tools for entity_lookup, feed_search, stakeholder_map
import { chatTools } from '@/lib/chat/tools';

export function buildReportTools(reportId: string, initialContent: AnalysisJSON) {
  // Mutable reference to current content state
  let content = structuredClone(initialContent);

  return {
    // Include existing chat tools
    entity_lookup: chatTools.entity_lookup,
    feed_search: chatTools.feed_search,
    stakeholder_map: chatTools.stakeholder_map,

    edit_report_item: tool({
      description:
        'Edit a field on an existing report item. Use when the user asks to change a summary, reframe client relevance, adjust a RAG rating, change escalation, or update any field.',
      inputSchema: z.object({
        item_ref: z.string().describe('Item reference number, e.g. "2.1", "3.2"'),
        field: z
          .enum(['headline', 'summary', 'client_relevance', 'recommended_action', 'rag', 'escalation', 'date', 'source'])
          .describe('Which field to edit'),
        new_value: z.string().describe('The new value for the field'),
      }),
      execute: async ({ item_ref, field, new_value }): Promise<Record<string, unknown>> => {
        try {
          const result = applyEditField(content, item_ref, field, new_value);
          content = result.content;
          await saveReportContent(reportId, content, {
            editSource: 'chat_mutation',
            mutation: result.mutation,
          });
          return {
            success: true,
            mutation: result.mutation,
            message: `Updated ${field} on item ${item_ref}.`,
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : 'Edit failed' };
        }
      },
    }),

    add_report_item: tool({
      description:
        'Add a new analysed item to a theme section. Provide the full item details. Use when the user wants to add something to the report.',
      inputSchema: z.object({
        theme_id: z.string().describe('Target theme section ID'),
        headline: z.string().describe('Item headline'),
        date: z.string().describe('Date in DD/MM/YYYY format'),
        source: z.string().describe('Source attribution'),
        summary: z.string().describe('2-4 sentence summary'),
        client_relevance: z.string().describe('2-3 sentences on client relevance'),
        recommended_action: z.string().describe('Specific recommended action'),
        escalation: z.enum(['IMMEDIATE', 'HIGH', 'STANDARD']).describe('Escalation level'),
        rag: z.enum(['RED', 'AMBER', 'GREEN']).describe('RAG rating'),
        source_items: z.array(z.string()).optional().describe('Source fingerprints'),
      }),
      execute: async ({
        theme_id, headline, date, source, summary,
        client_relevance, recommended_action, escalation, rag, source_items,
      }): Promise<Record<string, unknown>> => {
        try {
          const newItem: AnalysedItem = {
            ref: '0.0', // will be renumbered
            headline,
            date,
            source,
            summary,
            client_relevance,
            recommended_action,
            escalation,
            rag,
            confidence: 0.8,
            source_items: source_items || [],
          };
          const result = applyAddItem(content, theme_id, newItem);
          content = result.content;
          await saveReportContent(reportId, content, {
            editSource: 'chat_mutation',
            mutation: result.mutation,
          });
          return {
            success: true,
            mutation: result.mutation,
            message: `Added item to ${theme_id}.`,
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : 'Add failed' };
        }
      },
    }),

    remove_report_item: tool({
      description: 'Remove an item from the report by its reference number.',
      inputSchema: z.object({
        item_ref: z.string().describe('Item reference to remove, e.g. "2.4"'),
      }),
      execute: async ({ item_ref }): Promise<Record<string, unknown>> => {
        try {
          const result = applyRemoveItem(content, item_ref);
          content = result.content;
          await saveReportContent(reportId, content, {
            editSource: 'chat_mutation',
            mutation: result.mutation,
          });
          return {
            success: true,
            mutation: result.mutation,
            message: `Removed item ${item_ref}.`,
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : 'Remove failed' };
        }
      },
    }),

    move_report_item: tool({
      description: 'Move an item from one theme section to another.',
      inputSchema: z.object({
        item_ref: z.string().describe('Item reference to move'),
        target_theme_id: z.string().describe('Target theme section ID'),
      }),
      execute: async ({ item_ref, target_theme_id }): Promise<Record<string, unknown>> => {
        try {
          const result = applyMoveItem(content, item_ref, target_theme_id);
          content = result.content;
          await saveReportContent(reportId, content, {
            editSource: 'chat_mutation',
            mutation: result.mutation,
          });
          return {
            success: true,
            mutation: result.mutation,
            message: `Moved item ${item_ref} to ${target_theme_id}.`,
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : 'Move failed' };
        }
      },
    }),
  };
}
