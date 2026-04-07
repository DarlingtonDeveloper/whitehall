import { NextResponse } from 'next/server';
import { supabase } from '@/lib/db';
import { getClientBySlug } from '@/data/clients';
import { generateReport } from '@/lib/export/docx-generator';
import { checkRateLimit } from '@/lib/security/rateLimit';
import { logAudit } from '@/lib/audit';
import type { AnalysisJSON } from '@/lib/export/types';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Rate limiting: 10 exports per hour
  const ip = request.headers.get('x-forwarded-for') || 'anonymous';
  if (!checkRateLimit(`export:${ip}`, 10, 3_600_000)) {
    logAudit('rate_limit_hit', 'report_export', id, { ip }, request);
    return NextResponse.json(
      { error: 'Rate limit exceeded. Max 10 exports per hour.' },
      { status: 429 },
    );
  }

  const { data: draft, error } = await supabase
    .from('report_drafts')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !draft) {
    return NextResponse.json(
      { error: 'Report not found' },
      { status: 404 },
    );
  }

  if (draft.status !== 'approved' && draft.status !== 'exported') {
    return NextResponse.json(
      { error: 'Report must be approved before export' },
      { status: 400 },
    );
  }

  const client = getClientBySlug(draft.client_id);
  if (!client) {
    return NextResponse.json(
      { error: `Unknown client: "${draft.client_id}"` },
      { status: 400 },
    );
  }

  try {
    const analysis = draft.sections as AnalysisJSON;
    const buffer = await generateReport(analysis, client);

    // Mark as exported
    await supabase
      .from('report_drafts')
      .update({
        status: 'exported',
        exported_at: new Date().toISOString(),
      })
      .eq('id', id);

    const weekStart = new Date(draft.date_range_from)
      .toISOString()
      .split('T')[0]
      .replace(/-/g, '_');
    const filename = `${client.name}_Weekly_Monitoring_Report_wc_${weekStart}.docx`;

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Export failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
