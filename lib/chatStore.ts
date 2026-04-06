/**
 * Reactive chat store — persists conversations per client across
 * graph changes, panel toggles, and tab switches.
 *
 * Each client gets its own conversation. Switching between clients
 * preserves both. Chat only resets on explicit clear or browser
 * session end.
 */

import { useSyncExternalStore } from 'react';
import { supabase } from '@/lib/db';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface ChatState {
  messages: ChatMsg[];
  conversationId: string | null;
  isLoading: boolean;
  streamingId: string | null;
  error: string | null;
  /** Whether we've attempted to load from DB for this key */
  loaded: boolean;
}

/* ------------------------------------------------------------------ */
/*  Internal state                                                     */
/* ------------------------------------------------------------------ */

const conversations = new Map<string, ChatState>();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

function getKey(clientId: string | null): string {
  return clientId || '__global__';
}

function makeDefault(): ChatState {
  return {
    messages: [],
    conversationId: null,
    isLoading: false,
    streamingId: null,
    error: null,
    loaded: false,
  };
}

/* ------------------------------------------------------------------ */
/*  State accessors                                                    */
/* ------------------------------------------------------------------ */

export function getChatState(clientId: string | null): ChatState {
  const key = getKey(clientId);
  if (!conversations.has(key)) {
    conversations.set(key, makeDefault());
  }
  return conversations.get(key)!;
}

/* ------------------------------------------------------------------ */
/*  Mutations                                                          */
/* ------------------------------------------------------------------ */

export function addMessage(clientId: string | null, msg: ChatMsg) {
  const key = getKey(clientId);
  const s = getChatState(clientId);
  conversations.set(key, { ...s, messages: [...s.messages, msg] });
  emit();
}

export function updateStreamingMessage(
  clientId: string | null,
  messageId: string,
  content: string,
) {
  const key = getKey(clientId);
  const s = getChatState(clientId);
  conversations.set(key, {
    ...s,
    messages: s.messages.map((m) =>
      m.id === messageId ? { ...m, content } : m,
    ),
  });
  emit();
}

export function removeMessage(clientId: string | null, messageId: string) {
  const key = getKey(clientId);
  const s = getChatState(clientId);
  conversations.set(key, {
    ...s,
    messages: s.messages.filter((m) => m.id !== messageId),
  });
  emit();
}

export function setChatLoading(clientId: string | null, loading: boolean) {
  const key = getKey(clientId);
  const s = getChatState(clientId);
  conversations.set(key, { ...s, isLoading: loading });
  emit();
}

export function setChatStreamingId(clientId: string | null, id: string | null) {
  const key = getKey(clientId);
  const s = getChatState(clientId);
  conversations.set(key, { ...s, streamingId: id });
  emit();
}

export function setChatError(clientId: string | null, error: string | null) {
  const key = getKey(clientId);
  const s = getChatState(clientId);
  conversations.set(key, { ...s, error });
  emit();
}

export function clearChat(clientId: string | null) {
  const key = getKey(clientId);
  conversations.set(key, makeDefault());
  emit();
}

/* ------------------------------------------------------------------ */
/*  Database persistence                                               */
/* ------------------------------------------------------------------ */

export async function loadConversation(clientId: string | null): Promise<void> {
  const key = getKey(clientId);
  const s = getChatState(clientId);
  if (s.loaded || s.messages.length > 0) return;

  if (!clientId) {
    conversations.set(key, { ...s, loaded: true });
    emit();
    return;
  }

  try {
    const { data: convo } = await supabase
      .from('chat_conversations')
      .select('id')
      .eq('client_id', clientId)
      .eq('context_type', 'intelligence')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!convo) {
      conversations.set(key, { ...s, loaded: true });
      emit();
      return;
    }

    const { data: rows } = await supabase
      .from('chat_messages')
      .select('id, role, content')
      .eq('conversation_id', convo.id)
      .order('created_at', { ascending: true })
      .limit(50);

    const msgs: ChatMsg[] = (rows || []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      role: r.role as 'user' | 'assistant',
      content: r.content as string,
    }));

    conversations.set(key, {
      ...s,
      messages: msgs,
      conversationId: convo.id,
      loaded: true,
    });
    emit();
  } catch {
    conversations.set(key, { ...s, loaded: true });
    emit();
  }
}

export async function persistMessage(
  clientId: string | null,
  role: 'user' | 'assistant',
  content: string,
): Promise<void> {
  if (!clientId) return;

  const key = getKey(clientId);
  let conversationId = getChatState(clientId).conversationId;

  try {
    if (!conversationId) {
      const { data } = await supabase
        .from('chat_conversations')
        .insert({ client_id: clientId, context_type: 'intelligence' })
        .select('id')
        .single();

      if (data) {
        conversationId = data.id;
        const s = getChatState(clientId);
        conversations.set(key, { ...s, conversationId });
        emit();
      } else {
        return;
      }
    }

    await supabase
      .from('chat_messages')
      .insert({ conversation_id: conversationId, role, content });
  } catch {
    // Silent — persistence is best-effort
  }
}

/* ------------------------------------------------------------------ */
/*  React hook                                                         */
/* ------------------------------------------------------------------ */

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const SERVER_DEFAULT = makeDefault();

export function useChatState(clientId: string | null): ChatState {
  return useSyncExternalStore(
    subscribe,
    () => getChatState(clientId),
    () => SERVER_DEFAULT,
  );
}
