export interface ChatMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  tool_calls?: Record<string, unknown>;
  created_at: string;
}

export interface ChatConversation {
  id: string;
  client_id?: string;
  context_entity?: string;
  context_type?: 'intelligence' | 'report';
  created_at: string;
}

export interface ChatContext {
  clientId?: string;
  entityId?: string;
  recentFeedItems?: Array<{ title: string; source: string; date: string }>;
}
