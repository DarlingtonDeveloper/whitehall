import type { AnalysisJSON } from '@/lib/export/types';

export type ReportStatus = 'generating' | 'draft' | 'in_review' | 'approved' | 'exported';

export interface ReportDraft {
  id: string;
  client_id: string;
  status: ReportStatus;
  date_range_from: string;
  date_range_to: string;
  sections: AnalysisJSON;
  original_sections: AnalysisJSON;
  feed_item_ids: string[];
  created_by?: string;
  reviewed_by?: string;
  review_requested_at?: string;
  reviewed_at?: string;
  approved_at?: string;
  exported_at?: string;
  review_token?: string;
  created_at: string;
  updated_at: string;
}

export interface ReportMutation {
  type: 'add_item' | 'remove_item' | 'edit_field' | 'move_item'
      | 'change_rag' | 'change_escalation' | 'reorder';
  section_id: string;
  item_ref?: string;
  field?: string;
  old_value?: string;
  new_value?: string;
  reasoning?: string;
}

export interface ReportDiff {
  items_removed: Array<{
    section_id: string;
    item_ref: string;
    reason?: string;
  }>;
  items_added: Array<{
    section_id: string;
    item_ref: string;
    feed_item_id?: string;
    reason?: string;
  }>;
  rag_changes: Array<{
    item_ref: string;
    old_rag: string;
    new_rag: string;
    reason?: string;
  }>;
  field_edits: Array<{
    item_ref: string;
    field: string;
    old_value: string;
    new_value: string;
    reason?: string;
  }>;
}

export interface LearnedSignals {
  client_id: string;
  source_boosts: Record<string, number>;
  keyword_boosts: Record<string, number>;
  rag_adjustments: Record<string, { red_threshold: number; amber_threshold: number }>;
}

export interface ReportChatMessage {
  id: string;
  report_draft_id: string;
  role: 'user' | 'assistant';
  content: string;
  user_role?: string;
  user_name?: string;
  active_section?: string;
  active_item_ref?: string;
  mutations?: ReportMutation[];
  tool_calls?: unknown;
  created_at: string;
}
