import { NextResponse } from 'next/server';
import { getClientBySlug, ALL_CLIENTS } from '@/data/clients';
import { generateDraftReport } from '@/lib/report/generate';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY is not configured.' },
      { status: 503 },
    );
  }

  let body: { clientId?: string; from?: string; to?: string } = {};
  try {
    body = await request.json();
  } catch {
    // Empty body = generate for all clients (cron mode)
  }

  const { clientId, from, to } = body;
  const dateRange = from && to
    ? { from: new Date(from), to: new Date(to) }
    : undefined;

  if (clientId) {
    // Single client mode
    const client = getClientBySlug(clientId);
    if (!client) {
      return NextResponse.json(
        { error: `Unknown client: "${clientId}"` },
        { status: 400 },
      );
    }

    try {
      const draftId = await generateDraftReport(clientId, dateRange);
      return NextResponse.json({ draftId, clientId });
    } catch (error) {
      return NextResponse.json(
        { error: 'Report generation failed', detail: error instanceof Error ? error.message : String(error) },
        { status: 500 },
      );
    }
  }

  // All clients mode (cron)
  const results: Array<{ clientId: string; draftId?: string; error?: string }> = [];
  for (const client of ALL_CLIENTS) {
    try {
      const draftId = await generateDraftReport(client.id, dateRange);
      results.push({ clientId: client.id, draftId });
    } catch (error) {
      results.push({
        clientId: client.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return NextResponse.json({ results });
}
