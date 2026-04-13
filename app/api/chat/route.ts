import { streamText, stepCountIs } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { buildSystemPrompt, type ChatViewState } from '@/lib/chat/systemPrompt';
import { chatTools } from '@/lib/chat/tools';
import { validateChatMessage, validateConversationLength } from '@/lib/security/validateInput';
import { checkRateLimit } from '@/lib/security/rateLimit';
import { logAudit } from '@/lib/audit';
import { logTrace } from '@/lib/observability/opik';

export const dynamic = 'force-dynamic';

interface ChatRequestBody {
  message: string;
  conversationId?: string;
  clientId?: string;
  entityId?: string;
  history?: Array<{ role: string; content: string }>;
  viewState?: ChatViewState;
  isBriefing?: boolean;
}

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        error:
          'ANTHROPIC_API_KEY is not configured. Add it to your .env.local file to enable the chat feature.',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }

  let body: ChatRequestBody;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON in request body.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const { message, clientId, entityId, history, viewState, isBriefing } = body;
  if (!message || typeof message !== 'string') {
    return new Response(
      JSON.stringify({ error: 'A "message" field is required.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Input validation
  const msgCheck = validateChatMessage(message);
  if (!msgCheck.valid) {
    return new Response(
      JSON.stringify({ error: msgCheck.error }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  if (history && Array.isArray(history)) {
    const convCheck = validateConversationLength(history.length);
    if (!convCheck.valid) {
      return new Response(
        JSON.stringify({ error: convCheck.error }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }

  // Rate limiting: 30 requests per minute (keyed by IP for pre-auth)
  const ip = request.headers.get('x-forwarded-for') || 'anonymous';
  if (!checkRateLimit(`chat:${ip}`, 30, 60_000)) {
    logAudit('rate_limit_hit', 'chat', undefined, { ip }, request);
    return new Response(
      JSON.stringify({ error: 'Rate limit exceeded. Try again shortly.' }),
      { status: 429, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const systemPrompt = buildSystemPrompt({ clientId, entityId, viewState, isBriefing });

  // Build message history in AI SDK format
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  if (history && Array.isArray(history)) {
    for (const msg of history) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
  }
  messages.push({ role: 'user', content: message });

  const result = streamText({
    model: anthropic('claude-opus-4-6-20250115'),
    system: systemPrompt,
    messages,
    tools: chatTools,
    stopWhen: stepCountIs(5),
    maxRetries: 5,
  });

  /**
   * Use fullStream instead of textStream to get text from ALL steps
   * (including post-tool-call responses). textStream in some SDK versions
   * only yields text from the first step.
   *
   * Graph commands are detected from tool-result events for graph_action
   * and embedded as HTML comment markers in the text stream.
   */
  const encoder = new TextEncoder();
  const startTime = performance.now();
  let fullAssistantText = '';

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of result.fullStream) {
          if (event.type === 'text-delta') {
            fullAssistantText += event.text;
            controller.enqueue(encoder.encode(event.text));
          } else if (event.type === 'tool-result') {
            // Embed graph commands for graph_action tool calls
            if (event.toolName === 'graph_action') {
              try {
                const res = event.output as Record<string, unknown> | undefined;
                if (res?.success) {
                  const args = event.input as Record<string, unknown>;
                  const cmd: Record<string, unknown> = { type: args.action };
                  if (args.action === 'select_entity') {
                    cmd.entityId = res.entityId ?? args.entityId;
                  } else if (args.action === 'search') {
                    cmd.query = args.query;
                  } else if (args.action === 'focus_mode') {
                    cmd.enabled = args.enabled;
                  }
                  controller.enqueue(
                    encoder.encode(`<!--GRAPH_CMD:${JSON.stringify(cmd)}-->`),
                  );
                }
              } catch (err) {
                console.error('[chat/route] graph command error:', err);
              }
            }
          } else if (event.type === 'tool-error') {
            console.error('[chat/route] tool-error:', (event as Record<string, unknown>).toolName, event);
          } else if (event.type === 'error') {
            console.error('[chat/route] stream error event:', event.error);
          }
        }
        // Trace before closing — Vercel may kill the function after close
        if (fullAssistantText) {
          try {
            const usage = await result.totalUsage;
            await logTrace(
              {
                client_id: clientId || entityId || 'unknown',
                step: 'chat',
                model: 'claude-opus-4-6-20250115',
              },
              message,
              fullAssistantText,
              undefined,
              {
                input_tokens: usage.inputTokens ?? 0,
                output_tokens: usage.outputTokens ?? 0,
                duration_ms: Math.round(performance.now() - startTime),
              },
            );
          } catch (traceErr) {
            console.error('[chat/route] trace failed:', traceErr);
          }
        }
        controller.close();
      } catch (err) {
        console.error('[chat/route] stream iteration error:', err);
        const errorMessage =
          err instanceof Error ? err.message : 'An unexpected error occurred.';
        // Map known API errors to user-friendly messages
        const userMessage = errorMessage.includes('Overloaded')
          ? 'The AI service is currently overloaded. Please try again in a moment.'
          : errorMessage;
        controller.enqueue(encoder.encode(`\n\n[Error: ${userMessage}]`));
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Transfer-Encoding': 'chunked',
    },
  });
}
