'use client';

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type KeyboardEvent,
  type FormEvent,
} from 'react';
import ChatMessage from './ChatMessage';
import SuggestedQuestions from './SuggestedQuestions';
import { dispatchGraphCommand, type GraphCommand } from '@/lib/graphCommands';

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface ChatDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  clientId?: string;
  entityId?: string;
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

let _msgIdCounter = 0;
function nextId() {
  _msgIdCounter += 1;
  return `msg-${Date.now()}-${_msgIdCounter}`;
}

function contextLabel(clientId?: string, entityId?: string): string | null {
  if (entityId) return entityId;
  if (clientId) return clientId;
  return null;
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                 */
/* -------------------------------------------------------------------------- */

export default function ChatDrawer({
  isOpen,
  onClose,
  clientId,
  entityId,
}: ChatDrawerProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  /* --- Auto-scroll to bottom on new content --- */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  /* --- Focus textarea when drawer opens --- */
  useEffect(() => {
    if (isOpen) {
      // Small delay to let the slide animation start before focusing
      const t = setTimeout(() => textareaRef.current?.focus(), 220);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  /* --- Clear context-specific conversation when context changes --- */
  useEffect(() => {
    setMessages([]);
    setError(null);
  }, [clientId, entityId]);

  /* --- Auto-resize textarea --- */
  const handleTextareaInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, []);

  /* --- Send message --- */
  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isLoading) return;

      setError(null);
      setInput('');

      // Reset textarea height
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }

      const userMsg: Message = { id: nextId(), role: 'user', content: trimmed };
      const assistantId = nextId();
      const assistantMsg: Message = {
        id: assistantId,
        role: 'assistant',
        content: '',
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setStreamingId(assistantId);
      setIsLoading(true);

      try {
        const history = messages.map((m) => ({
          role: m.role,
          content: m.content,
        }));

        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: trimmed,
            clientId,
            entityId,
            history,
          }),
        });

        if (!res.ok) {
          // Try to parse JSON error body
          let errMsg = `Request failed (${res.status})`;
          try {
            const errJson = await res.json();
            if (errJson.error) errMsg = errJson.error;
          } catch {
            // Response wasn't JSON, use status text
          }
          // Remove the empty assistant message and show error
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

          // DELIBERATE: See IntelligencePanel.tsx for why graph commands are
          // embedded as HTML comment markers in the text stream.
          const cmdRegex = /<!--GRAPH_CMD:(.*?)-->/g;
          let cmdMatch;
          while ((cmdMatch = cmdRegex.exec(accumulated)) !== null) {
            const raw = cmdMatch[1];
            if (!dispatchedCmds.has(raw)) {
              dispatchedCmds.add(raw);
              try {
                dispatchGraphCommand(JSON.parse(raw) as GraphCommand);
              } catch { /* ignore */ }
            }
          }

          const displayText = accumulated.replace(/\n?<!--GRAPH_CMD:.*?-->\n?/g, '');
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: displayText } : m,
            ),
          );
        }

        const finalText = accumulated.replace(/\n?<!--GRAPH_CMD:.*?-->\n?/g, '');
        if (!finalText.trim()) {
          setMessages((prev) => prev.filter((m) => m.id !== assistantId));
        }
      } catch (err) {
        const errMsg =
          err instanceof Error ? err.message : 'An unexpected error occurred.';
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
        setError(errMsg);
      } finally {
        setIsLoading(false);
        setStreamingId(null);
      }
    },
    [isLoading, messages, clientId, entityId],
  );

  /* --- Handle keyboard shortcuts in textarea --- */
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage(input);
      }
    },
    [input, sendMessage],
  );

  /* --- Handle form submit --- */
  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      sendMessage(input);
    },
    [input, sendMessage],
  );

  /* --- Handle suggested question click --- */
  const handleSuggestedSelect = useCallback(
    (question: string) => {
      sendMessage(question);
    },
    [sendMessage],
  );

  const badge = contextLabel(clientId, entityId);
  const hasMessages = messages.length > 0;

  return (
    <>
      {/* Overlay */}
      <div
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-200 ${
          isOpen
            ? 'opacity-100 pointer-events-auto'
            : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <aside
        className={`fixed right-0 top-0 z-50 flex h-full w-full max-w-[420px] flex-col border-l border-wh-accent-teal/20 bg-wh-bg transition-transform duration-200 ease-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
        role="dialog"
        aria-label="Intelligence chat"
        aria-hidden={!isOpen}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center gap-3 border-b border-wh-border px-4 py-3">
          <div className="flex flex-1 items-center gap-2.5">
            {/* Chat icon */}
            <svg
              className="h-4 w-4 text-wh-accent-teal"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z"
              />
            </svg>
            <h2 className="text-sm font-semibold text-wh-text-primary">
              Intelligence
            </h2>
            {badge && (
              <span className="rounded-full bg-wh-accent-teal/10 px-2 py-0.5 text-[10px] font-medium text-wh-accent-teal">
                {badge}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-wh-text-secondary transition-colors hover:bg-wh-border/50 hover:text-wh-text-primary"
            aria-label="Close chat"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Messages area */}
        <div
          ref={scrollContainerRef}
          className="chat-scroll flex-1 overflow-y-auto px-4 py-4"
        >
          {!hasMessages && !isLoading && (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-wh-accent-teal/10">
                <svg
                  className="h-5 w-5 text-wh-accent-teal"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z"
                  />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-wh-text-primary">
                  Whitehall Intelligence
                </p>
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

          {/* Loading indicator */}
          {isLoading && streamingId && messages.find(m => m.id === streamingId)?.content === '' && (
            <div className="flex justify-start mt-3 animate-[fadeSlideIn_0.2s_ease-out]">
              <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md bg-wh-panel border border-wh-border px-4 py-3">
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full bg-wh-accent-teal"
                  style={{ animation: 'chatPulse 1.4s ease-in-out infinite' }}
                />
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full bg-wh-accent-teal"
                  style={{
                    animation: 'chatPulse 1.4s ease-in-out 0.2s infinite',
                  }}
                />
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full bg-wh-accent-teal"
                  style={{
                    animation: 'chatPulse 1.4s ease-in-out 0.4s infinite',
                  }}
                />
              </div>
            </div>
          )}

          {/* Error display */}
          {error && (
            <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-xs text-red-400 animate-[fadeSlideIn_0.2s_ease-out]">
              <div className="flex items-start gap-2">
                <svg
                  className="mt-0.5 h-3.5 w-3.5 shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                  />
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
              clientId={clientId}
              entityId={entityId}
              onSelect={handleSuggestedSelect}
              disabled={isLoading}
            />
          </div>
        )}

        {/* Input area */}
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
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"
                />
              </svg>
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
