'use client';

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type KeyboardEvent,
  type FormEvent,
} from 'react';
import { usePanelStore } from '@/lib/panelStore';
import { getEntity } from '@/data/entities';
import { getClientBySlug } from '@/data/clients';
import { dispatchGraphCommand, type GraphCommand } from '@/lib/graphCommands';
import { useGate } from '@/lib/useGate';
import { supabase } from '@/lib/db';
import { computePulseScore } from '@/lib/graph/pulse';
import { ENTITY_LIST } from '@/data/entities';
import type { FeedItem } from '@/types/feed';
import FeedPanel from '@/components/feed/FeedPanel';
import ChatMessage from '@/components/chat/ChatMessage';
import SuggestedQuestions from '@/components/chat/SuggestedQuestions';

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

type Tab = 'feed' | 'chat';

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

let _msgIdCounter = 0;
function nextId() {
  _msgIdCounter += 1;
  return `msg-${Date.now()}-${_msgIdCounter}`;
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                 */
/* -------------------------------------------------------------------------- */

export default function IntelligencePanel() {
  const [unlocked, tryUnlock] = useGate();
  const [gatePw, setGatePw] = useState('');
  const [gateError, setGateError] = useState(false);

  const { selectedEntityId, selectedClientId } = usePanelStore();
  const [activeTab, setActiveTab] = useState<Tab>('chat');

  // Feed data for dynamic suggestions and new-item indicator
  const [recentFeedItems, setRecentFeedItems] = useState<FeedItem[]>([]);
  const [newItemCount, setNewItemCount] = useState(0);
  const lastFeedCheckRef = useRef<string>(new Date().toISOString());

  useEffect(() => {
    async function fetchRecent() {
      const { data } = await supabase
        .from('feed_items')
        .select('id, entity_ids, published_at, title, source_type, source_name')
        .gte('published_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .order('published_at', { ascending: false })
        .limit(200);
      if (data) setRecentFeedItems(data as FeedItem[]);
    }
    fetchRecent();
  }, [selectedClientId, selectedEntityId]);

  // Compute pulse scores for suggestions
  const pulseScoreMap = useRef(new Map<string, number>());
  useEffect(() => {
    const map = new Map<string, number>();
    for (const entity of ENTITY_LIST) {
      const score = computePulseScore(entity.id, recentFeedItems);
      if (score > 0) map.set(entity.id, score);
    }
    pulseScoreMap.current = map;
  }, [recentFeedItems]);

  // Poll for new items every 60s
  useEffect(() => {
    const client = selectedClientId ? getClientBySlug(selectedClientId) : null;
    if (!client) {
      setNewItemCount(0);
      return;
    }

    const entityIds = client.stakeholders.map((s) => s.entityId);
    lastFeedCheckRef.current = new Date().toISOString();
    setNewItemCount(0);

    const checkNew = async () => {
      try {
        const { count } = await supabase
          .from('feed_items')
          .select('id', { count: 'exact', head: true })
          .overlaps('entity_ids', entityIds)
          .gte('created_at', lastFeedCheckRef.current);
        if (count && count > 0) {
          setNewItemCount((prev) => prev + count);
        }
        lastFeedCheckRef.current = new Date().toISOString();
      } catch {
        // Silent fail for polling
      }
    };

    const interval = setInterval(checkNew, 60000);
    return () => clearInterval(interval);
  }, [selectedClientId]);

  // Chat state
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Derive context label
  const entity = selectedEntityId ? getEntity(selectedEntityId) : null;
  const client = selectedClientId ? getClientBySlug(selectedClientId) : null;
  const contextLabel = entity?.name ?? client?.name ?? null;

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Clear messages when context changes
  useEffect(() => {
    setMessages([]);
    setError(null);
  }, [selectedEntityId, selectedClientId]);

  // Focus textarea when switching to chat tab
  useEffect(() => {
    if (activeTab === 'chat') {
      const t = setTimeout(() => textareaRef.current?.focus(), 100);
      return () => clearTimeout(t);
    }
  }, [activeTab]);

  const handleTextareaInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isLoading) return;

      setError(null);
      setInput('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';

      const userMsg: Message = { id: nextId(), role: 'user', content: trimmed };
      const assistantId = nextId();
      const assistantMsg: Message = { id: assistantId, role: 'assistant', content: '' };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setStreamingId(assistantId);
      setIsLoading(true);

      try {
        const history = messages.map((m) => ({ role: m.role, content: m.content }));

        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: trimmed,
            clientId: selectedClientId ?? undefined,
            entityId: selectedEntityId ?? undefined,
            history,
          }),
        });

        if (!res.ok) {
          let errMsg = `Request failed (${res.status})`;
          try {
            const errJson = await res.json();
            if (errJson.error) errMsg = errJson.error;
          } catch { /* not JSON */ }
          setMessages((prev) => prev.filter((m) => m.id !== assistantId));
          setError(errMsg);
          setIsLoading(false);
          setStreamingId(null);
          return;
        }

        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        let accumulated = '';
        const dispatchedCmds = new Set<string>();

        while (reader) {
          const { done, value } = await reader.read();
          if (done) break;
          accumulated += decoder.decode(value, { stream: true });

          // DELIBERATE: Graph commands are embedded as HTML comment markers
          // (<!--GRAPH_CMD:{json}-->) in the text stream rather than a separate
          // sideband. Three reasons: (1) streamText returns a single text
          // stream with no built-in metadata channel, (2) HTML comments are
          // invisible if accidentally rendered as markdown, and (3) they can be
          // emitted mid-stream so the graph reacts before the full response
          // completes. The client strips these markers before display.
          const cmdRegex = /<!--GRAPH_CMD:(.*?)-->/g;
          let cmdMatch;
          while ((cmdMatch = cmdRegex.exec(accumulated)) !== null) {
            const raw = cmdMatch[1];
            if (!dispatchedCmds.has(raw)) {
              dispatchedCmds.add(raw);
              try {
                const parsed = JSON.parse(raw) as GraphCommand;
                dispatchGraphCommand(parsed);
              } catch { /* ignore parse errors */ }
            }
          }

          // Strip command markers from displayed text
          const displayText = accumulated.replace(/\n?<!--GRAPH_CMD:.*?-->\n?/g, '');
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: displayText } : m)),
          );
        }

        // Final strip
        const finalText = accumulated.replace(/\n?<!--GRAPH_CMD:.*?-->\n?/g, '');
        if (!finalText.trim()) {
          setMessages((prev) => prev.filter((m) => m.id !== assistantId));
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'An unexpected error occurred.';
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
        setError(errMsg);
      } finally {
        setIsLoading(false);
        setStreamingId(null);
      }
    },
    [isLoading, messages, selectedClientId, selectedEntityId],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage(input);
      }
    },
    [input, sendMessage],
  );

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      sendMessage(input);
    },
    [input, sendMessage],
  );

  const hasMessages = messages.length > 0;

  if (!unlocked) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-wh-border/50">
          <svg className="h-5 w-5 text-wh-text-secondary/60" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
          </svg>
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-wh-text-primary">Intelligence Locked</p>
          <p className="mt-1 text-xs text-wh-text-secondary">Enter password to access</p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!tryUnlock(gatePw)) {
              setGateError(true);
              setTimeout(() => setGateError(false), 1500);
            }
          }}
          className="flex w-full max-w-[200px] flex-col gap-2"
        >
          <input
            type="password"
            value={gatePw}
            onChange={(e) => setGatePw(e.target.value)}
            placeholder="Password"
            autoFocus
            className={`w-full rounded-lg border bg-wh-panel px-3 py-2 text-center text-sm text-wh-text-primary placeholder:text-wh-text-secondary/40 outline-none transition-colors ${
              gateError
                ? 'border-red-500/60 shake'
                : 'border-wh-border focus:border-wh-accent-teal/50'
            }`}
          />
          <button
            type="submit"
            className="rounded-lg bg-wh-accent-teal/15 px-3 py-1.5 text-xs font-medium text-wh-accent-teal transition-colors hover:bg-wh-accent-teal/25"
          >
            Unlock
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-wh-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <svg className="h-4 w-4 text-wh-accent-teal" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
          </svg>
          <h2 className="text-xs font-semibold text-wh-text-primary">Intelligence</h2>
          {contextLabel && (
            <span className="rounded-full bg-wh-accent-teal/10 px-2 py-0.5 text-[10px] font-medium text-wh-accent-teal">
              {contextLabel}
            </span>
          )}
        </div>

        {/* Tab bar */}
        <div className="mt-2 flex gap-0.5">
          <TabButton
            active={activeTab === 'feed'}
            onClick={() => {
              setActiveTab('feed');
              setNewItemCount(0);
              lastFeedCheckRef.current = new Date().toISOString();
            }}
          >
            Feed
            {newItemCount > 0 && activeTab !== 'feed' && (
              <span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 text-[10px] font-medium rounded-full bg-wh-accent-teal text-white">
                {newItemCount > 99 ? '99+' : newItemCount}
              </span>
            )}
          </TabButton>
          <TabButton active={activeTab === 'chat'} onClick={() => setActiveTab('chat')}>
            Chat
          </TabButton>
        </div>
      </div>

      {/* Feed tab */}
      {activeTab === 'feed' && (
        <div className="flex-1 overflow-hidden">
          <FeedPanel
            entityId={selectedEntityId ?? undefined}
            clientId={selectedClientId ?? undefined}
          />
        </div>
      )}

      {/* Chat tab */}
      {activeTab === 'chat' && (
        <>
          {/* Messages area */}
          <div className="chat-scroll flex-1 overflow-y-auto overscroll-contain px-4 py-4">
            {!hasMessages && !isLoading && (
              <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-wh-accent-teal/10">
                  <svg className="h-5 w-5 text-wh-accent-teal" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-wh-text-primary">Whitehall Intelligence</p>
                  <p className="mt-1 text-xs text-wh-text-secondary">
                    Ask about departments, ministers, powers, or stakeholders.
                  </p>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-3">
              {messages.map((msg) => (
                <ChatMessage
                  key={msg.id}
                  role={msg.role}
                  content={msg.content}
                  isStreaming={msg.id === streamingId}
                />
              ))}
            </div>

            {isLoading && streamingId && messages.find((m) => m.id === streamingId)?.content === '' && (
              <div className="mt-3 flex justify-start animate-[fadeSlideIn_0.2s_ease-out]">
                <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md border border-wh-border bg-wh-panel px-4 py-3">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-wh-accent-teal" style={{ animation: 'chatPulse 1.4s ease-in-out infinite' }} />
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-wh-accent-teal" style={{ animation: 'chatPulse 1.4s ease-in-out 0.2s infinite' }} />
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-wh-accent-teal" style={{ animation: 'chatPulse 1.4s ease-in-out 0.4s infinite' }} />
                </div>
              </div>
            )}

            {error && (
              <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-xs text-red-400 animate-[fadeSlideIn_0.2s_ease-out]">
                <div className="flex items-start gap-2">
                  <svg className="mt-0.5 h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                  </svg>
                  <span>{error}</span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Suggested questions */}
          {!hasMessages && !isLoading && (
            <div className="shrink-0 border-t border-wh-border/50 px-3 py-3">
              <SuggestedQuestions
                clientId={selectedClientId ?? undefined}
                entityId={selectedEntityId ?? undefined}
                onSelect={(q) => sendMessage(q)}
                disabled={isLoading}
                feedItems={recentFeedItems}
                pulseScores={pulseScoreMap.current}
              />
            </div>
          )}

          {/* Chat input */}
          <div className="shrink-0 border-t border-wh-border px-4 py-3">
            <form onSubmit={handleSubmit} className="flex items-end gap-2">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  handleTextareaInput();
                }}
                onKeyDown={handleKeyDown}
                placeholder="Ask about UK government..."
                disabled={isLoading}
                rows={1}
                className="flex-1 resize-none rounded-xl border border-wh-border bg-wh-panel px-3.5 py-2.5 text-sm text-wh-text-primary placeholder:text-wh-text-secondary/50 transition-all focus:border-wh-accent-teal/50 focus:shadow-[0_0_0_1px_rgba(45,212,191,0.15)] focus:outline-none disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl bg-wh-accent-teal/15 text-wh-accent-teal transition-all hover:bg-wh-accent-teal/25 disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Send message"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                </svg>
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-3 py-1 text-[11px] font-medium transition-colors ${
        active
          ? 'bg-wh-accent-teal/10 text-wh-accent-teal'
          : 'text-wh-text-secondary hover:text-wh-text-primary hover:bg-wh-border/50'
      }`}
    >
      {children}
    </button>
  );
}
