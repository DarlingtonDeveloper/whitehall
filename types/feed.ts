export interface FeedItem {
  id: string;
  source_type: 'govuk' | 'hansard' | 'committee' | 'legislation' | 'web_search' | 'forward_scan';
  source_name: string;
  title: string;
  url?: string;
  published_at: string;
  body?: string;
  raw_data?: Record<string, unknown>;
  entity_ids: string[];
  monitoring_theme?: string;
  rag_status?: 'RED' | 'AMBER' | 'GREEN';
  relevance_score: number;
  fingerprint: string;
  created_at: string;
  event_date?: string;
  is_forward_scan: boolean;
}

export interface ClientFeedScore {
  id: string;
  feed_item_id: string;
  client_id: string;
  relevance_score: number;
  is_actionable: boolean;
  created_at: string;
}

export interface EnrichedItem {
  id: string;
  feed_item_id: string;
  client_id: string;
  summary?: string;
  client_relevance?: string;
  recommended_action?: string;
  significance?: 'Low' | 'Medium' | 'High';
  created_at: string;
}
