import { NextResponse } from 'next/server';
import { getClientBySlug } from '@/data/clients';
import { gatherItems, groupByTheme } from '@/lib/export/gather';
import { enrichItems } from '@/lib/export/enrich';
import { generateReport } from '@/lib/export/docx-generator';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface ExportRequestBody {
  clientId: string;
  dateRange?: {
    from: string;
    to: string;
  };
}

export async function POST(request: Request) {
  let body: ExportRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON in request body.' },
      { status: 400 },
    );
  }

  const { clientId, dateRange } = body;
  if (!clientId || typeof clientId !== 'string') {
    return NextResponse.json(
      { error: 'A "clientId" field is required.' },
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

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          'ANTHROPIC_API_KEY is not configured. Add it to your .env.local file to enable report generation.',
      },
      { status: 503 },
    );
  }

  const from = dateRange?.from
    ? new Date(dateRange.from)
    : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const to = dateRange?.to ? new Date(dateRange.to) : new Date();

  try {
    // 1. Gather items from Supabase
    const items = await gatherItems(client, from, to);

    // 2. Group by monitoring theme
    const grouped = groupByTheme(items, client);

    // 3. Enrich with Claude (theme analysis + synthesis)
    const analysis = await enrichItems(grouped, client, { from, to });

    // 4. Generate DOCX
    const buffer = await generateReport(analysis, client);

    // 5. Return file
    const weekStart = from.toISOString().split('T')[0].replace(/-/g, '_');
    const filename = `${client.name}_Weekly_Monitoring_Report_wc_${weekStart}.docx`;

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Report generation failed:', error);
    return NextResponse.json(
      {
        error: 'Report generation failed',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
