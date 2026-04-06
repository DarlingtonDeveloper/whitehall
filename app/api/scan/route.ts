import { NextResponse } from 'next/server';
import { getClientBySlug } from '@/data/clients';
import { runWebSearchCollector } from '@/lib/feeds/web-search';
import { runForwardScanCollector } from '@/lib/feeds/forward-scan';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY is not configured.' },
      { status: 503 },
    );
  }

  let body: { clientId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { clientId } = body;
  if (!clientId) {
    return NextResponse.json(
      { error: 'clientId is required' },
      { status: 400 },
    );
  }

  const client = getClientBySlug(clientId);
  if (!client) {
    return NextResponse.json(
      { error: `Unknown client: "${clientId}"` },
      { status: 400 },
    );
  }

  const [webResults, forwardResults] = await Promise.all([
    runWebSearchCollector(client),
    runForwardScanCollector(client),
  ]);

  return NextResponse.json({
    web_search: webResults,
    forward_scan: forwardResults,
  });
}
