import { streamText, stepCountIs } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { buildSystemPrompt, type ChatViewState } from '@/lib/chat/systemPrompt';
import { chatTools } from '@/lib/chat/tools';

export const dynamic = 'force-dynamic';

interface ChatRequestBody {
  message: string;
  conversationId?: string;
  clientId?: string;
  entityId?: string;
  history?: Array<{ role: string; content: string }>;
  viewState?: ChatViewState;
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

  const { message, clientId, entityId, history, viewState } = body;
  if (!message || typeof message !== 'string') {
    return new Response(
      JSON.stringify({ error: 'A "message" field is required.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const systemPrompt = buildSystemPrompt({ clientId, entityId, viewState });

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

  /**
   * DELIBERATE: Graph command side-channel via HTML comment markers.
   *
   * When the graph_action tool is invoked, we embed <!--GRAPH_CMD:{json}-->
   * markers in the text stream. The client parses these out before display
   * and dispatches them to the graph via a pub/sub bus.
   *
   * Why HTML comments instead of a structured sideband?
   * 1. streamText returns a single text stream — there's no built-in
   *    sideband for out-of-band metadata.
   * 2. HTML comments are invisible if accidentally rendered as markdown,
   *    and trivially parseable with a regex.
   * 3. They can be emitted mid-stream (as soon as the tool resolves),
   *    letting the graph react before the full response finishes.
   */
  const graphCommands: string[] = [];

  const result = streamText({
    model: anthropic('claude-sonnet-4-20250514'),
    system: systemPrompt,
    messages,
    tools: chatTools,
    stopWhen: stepCountIs(5),
    onStepFinish: ({ toolCalls, toolResults }) => {
      if (!toolCalls || !toolResults) return;
      for (const call of toolCalls) {
        if (call.toolName !== 'graph_action') continue;

        // AI SDK toolResults are objects with { toolCallId, output, ... }
        // Match by toolCallId rather than assuming index alignment.
        const matched = toolResults.find(
          (r) => r.toolCallId === call.toolCallId,
        );
        if (!matched) continue;
        const res = matched.output as Record<string, unknown> | undefined;
        if (!res?.success) continue;

        const input = call.input as Record<string, unknown>;
        const cmd: Record<string, unknown> = { type: input.action };
        if (input.action === 'select_entity') {
          cmd.entityId = res.entityId ?? input.entityId;
        } else if (input.action === 'search') {
          cmd.query = input.query;
        } else if (input.action === 'focus_mode') {
          cmd.enabled = input.enabled;
        }
        graphCommands.push(`<!--GRAPH_CMD:${JSON.stringify(cmd)}-->`);
      }
    },
  });

  // Convert the AI SDK stream to a plain text stream with embedded graph commands
  const encoder = new TextEncoder();
  let commandsEmitted = false;

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of result.textStream) {
          // Emit pending graph commands before the first text chunk
          if (!commandsEmitted && graphCommands.length > 0) {
            for (const cmd of graphCommands) {
              controller.enqueue(encoder.encode(cmd));
            }
            graphCommands.length = 0;
            commandsEmitted = true;
          }
          controller.enqueue(encoder.encode(chunk));
        }

        // Emit any graph commands that arrived during later steps
        for (const cmd of graphCommands) {
          controller.enqueue(encoder.encode(cmd));
        }

        controller.close();
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'An unexpected error occurred.';
        controller.enqueue(encoder.encode(`\n\n[Error: ${errorMessage}]`));
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
