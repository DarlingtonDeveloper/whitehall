'use client';

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type KeyboardEvent,
  type FormEvent,
} from 'react';
import type { ReportMutation } from '@/types/report';

interface ReportChatProps {
  reportId: string;
  clientId: string;
  activeSection: string | null;
  activeItemRef: string | null;
  onMutation: (mutation: ReportMutation) => void;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

let _msgId = 0;
function nextId() {
  _msgId += 1;
  return `rmsg-${Date.now()}-${_msgId}`;
}

export default function ReportChat({
  reportId,
  clientId,
  activeSection,
  activeItemRef,
  onMutation,
}: ReportChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isLoading) return;

      setInput('');
      const userMsg: Message = { id: nextId(), role: 'user', content: trimmed };
      const assistantId = nextId();
      const assistantMsg: Message = { id: assistantId, role: 'assistant', content: '' };

      setMessages(prev => [...prev, userMsg, assistantMsg]);
      setIsLoading(true);

      try {
        const res = await fetch(`/api/reports/${reportId}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: trimmed,
            activeSection,
            activeItemRef,
          }),
        });

        if (!res.ok) {
          setMessages(prev => prev.filter(m => m.id !== assistantId));
          setIsLoading(false);
          return;
        }

        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        let accumulated = '';
        const dispatched = new Set<string>();

        while (reader) {
          const { done, value } = await reader.read();
          if (done) break;
          accumulated += decoder.decode(value, { stream: true });

          // Parse mutation markers
          const mutRegex = /<!--MUTATION:(.*?)-->/g;
          let match;
          while ((match = mutRegex.exec(accumulated)) !== null) {
            const raw = match[1];
            if (!dispatched.has(raw)) {
              dispatched.add(raw);
              try {
                onMutation(JSON.parse(raw) as ReportMutation);
              } catch { /* ignore */ }
            }
          }

          const displayText = accumulated.replace(/\n?<!--MUTATION:.*?-->\n?/g, '');
          setMessages(prev =>
            prev.map(m => m.id === assistantId ? { ...m, content: displayText } : m),
          );
        }

        const finalText = accumulated.replace(/\n?<!--MUTATION:.*?-->\n?/g, '');
        if (!finalText.trim()) {
          setMessages(prev => prev.filter(m => m.id !== assistantId));
        }
      } catch {
        setMessages(prev => prev.filter(m => m.id !== assistantId));
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, reportId, activeSection, activeItemRef, onMutation],
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

  // Quick actions based on context
  const quickActions = activeItemRef
    ? [
        `Rewrite client relevance for ${activeItemRef}`,
        `Change ${activeItemRef} to RED`,
        `Remove ${activeItemRef}`,
      ]
    : activeSection
    ? [
        'Add an item to this section',
        'Summarise this section',
      ]
    : [
        'What are the most important items?',
        'Any consultations closing soon?',
      ];

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-wh-border px-4 py-3">
        <div className="flex items-center gap-2">
          <svg className="h-4 w-4 text-wh-accent-teal" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
          </svg>
          <h2 className="text-sm font-semibold text-wh-text-primary">Report Chat</h2>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 && !isLoading && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <p className="text-xs text-wh-text-secondary/60">
              Ask me to edit items, change RAG ratings, add items from the feed, or rewrite sections.
            </p>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {messages.map(msg => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed ${
                  msg.role === 'user'
                    ? 'rounded-br-md bg-wh-accent-teal/15 text-wh-text-primary'
                    : 'rounded-bl-md border border-wh-border bg-wh-panel text-wh-text-secondary'
                }`}
              >
                {msg.content || (
                  <span className="inline-flex gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-wh-accent-teal animate-pulse" />
                    <span className="h-1.5 w-1.5 rounded-full bg-wh-accent-teal animate-pulse [animation-delay:0.2s]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-wh-accent-teal animate-pulse [animation-delay:0.4s]" />
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        <div ref={messagesEndRef} />
      </div>

      {/* Quick actions */}
      {messages.length === 0 && (
        <div className="shrink-0 border-t border-wh-border/50 px-3 py-2">
          <div className="flex flex-wrap gap-1.5">
            {quickActions.map(q => (
              <button
                key={q}
                onClick={() => sendMessage(q)}
                disabled={isLoading}
                className="rounded-full border border-wh-border px-2.5 py-1 text-[10px] text-wh-text-secondary transition-colors hover:bg-wh-border/30 hover:text-wh-text-primary disabled:opacity-50"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="shrink-0 border-t border-wh-border px-4 py-3">
        <form onSubmit={handleSubmit} className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Edit report items..."
            disabled={isLoading}
            rows={1}
            className="flex-1 resize-none rounded-xl border border-wh-border bg-wh-panel px-3.5 py-2.5 text-sm text-wh-text-primary placeholder:text-wh-text-secondary/50 transition-all focus:border-wh-accent-teal/50 focus:outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl bg-wh-accent-teal/15 text-wh-accent-teal transition-all hover:bg-wh-accent-teal/25 disabled:opacity-30"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}
