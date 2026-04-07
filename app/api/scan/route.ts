import { NextResponse } from 'next/server';
import { getClientBySlug } from '@/data/clients';
import { runWebSearchCollector } from '@/lib/feeds/web-search';
import { runForwardScanCollector } from '@/lib/feeds/forward-scan';
import { checkRateLimit } from '@/lib/security/rateLimit';
import { logAudit } from '@/lib/audit';

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

  // Rate limiting: 3 scans per hour per client
  if (!checkRateLimit(`scan:${clientId}`, 3, 3_600_000)) {
    logAudit('rate_limit_hit', 'scan', clientId, undefined, request);
    return NextResponse.json(
      { error: 'Rate limit exceeded. Max 3 scans per hour per client.' },
      { status: 429 },
    );
  }

  const client = getClientBySlug(clientId);
  if (!client) {
    return NextResponse.json(
      { error: `Unknown client: "${clientId}"` },
      { status: 400 },
    );
  }

  try {
    const [webResults, forwardResults] = await Promise.all([
      runWebSearchCollector(client),
      runForwardScanCollector(client),
    ]);

    return NextResponse.json({
      web_search: webResults,
      forward_scan: forwardResults,
    });
  } catch (err) {
    console.error('[scan] Collection failed:', err);
    return NextResponse.json(
      { error: 'Scan failed', detail: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
