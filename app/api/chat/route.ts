import Anthropic from '@anthropic-ai/sdk';
import { buildSystemPrompt } from '@/lib/chat/systemPrompt';
import { toolDefinitions, handleToolCallAsync } from '@/lib/chat/tools';

export const dynamic = 'force-dynamic';

interface ChatRequestBody {
  message: string;
  conversationId?: string;
  clientId?: string;
  entityId?: string;
  history?: Array<{ role: string; content: string }>;
}

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        error: 'ANTHROPIC_API_KEY is not configured. Add it to your .env.local file to enable the chat feature.',
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

  const { message, clientId, entityId, history } = body;
  if (!message || typeof message !== 'string') {
    return new Response(
      JSON.stringify({ error: 'A "message" field is required.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const client = new Anthropic({ apiKey });
  const systemPrompt = buildSystemPrompt({ clientId, entityId });

  // Build message history
  const messages: Anthropic.MessageParam[] = [];
  if (history && Array.isArray(history)) {
    for (const msg of history) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
  }
  messages.push({ role: 'user', content: message });

  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    async start(controller) {
      try {
        let currentMessages = [...messages];
        let continueLoop = true;

        while (continueLoop) {
          continueLoop = false;

          const stream = client.messages.stream({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 2048,
            system: systemPrompt,
            messages: currentMessages,
            tools: toolDefinitions,
          });

          for await (const event of stream) {
            if (
              event.type === 'content_block_delta' &&
              event.delta.type === 'text_delta'
            ) {
              controller.enqueue(encoder.encode(event.delta.text));
            }
          }

          const finalMessage = await stream.finalMessage();

          if (finalMessage.stop_reason === 'tool_use') {
            const toolBlocks = finalMessage.content
              .filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use');

            if (toolBlocks.length > 0) {
              // Emit graph action markers before tool results
              for (const block of toolBlocks) {
                if (block.name === 'graph_action') {
                  const input = block.input as Record<string, unknown>;
                  // For select_entity with fuzzy match, resolve first
                  const result = await handleToolCallAsync(block.name, input);
                  const parsed = JSON.parse(result);
                  if (parsed.success) {
                    const cmd: Record<string, unknown> = { type: input.action };
                    if (input.action === 'select_entity') {
                      cmd.entityId = parsed.entityId ?? input.entityId;
                    } else if (input.action === 'search') {
                      cmd.query = input.query;
                    } else if (input.action === 'focus_mode') {
                      cmd.enabled = input.enabled;
                    }
                    controller.enqueue(encoder.encode(`<!--GRAPH_CMD:${JSON.stringify(cmd)}-->`));
                  }
                }
              }

              currentMessages.push({
                role: 'assistant',
                content: finalMessage.content,
              });

              const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
                toolBlocks.map(async (block) => ({
                  type: 'tool_result' as const,
                  tool_use_id: block.id,
                  content: await handleToolCallAsync(block.name, block.input as Record<string, unknown>),
                })),
              );

              currentMessages.push({
                role: 'user',
                content: toolResults,
              });

              continueLoop = true;
            }
          }
        }

        controller.close();
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'An unexpected error occurred.';
        controller.enqueue(
          encoder.encode(`\n\n[Error: ${errorMessage}]`),
        );
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
