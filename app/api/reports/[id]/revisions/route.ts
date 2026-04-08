import { NextResponse } from 'next/server';
import { supabase } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** GET /api/reports/[id]/revisions — list revision history */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const { data, error } = await supabase
    .from('report_revisions')
    .select('id, edit_source, mutation_summary, chat_message_id, created_at')
    .eq('report_draft_id', id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}

/** POST /api/reports/[id]/revisions — rollback to a specific revision */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: { revisionId: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.revisionId) {
    return NextResponse.json({ error: 'revisionId required' }, { status: 400 });
  }

  // Fetch the target revision
  const { data: revision, error: revError } = await supabase
    .from('report_revisions')
    .select('sections_snapshot')
    .eq('id', body.revisionId)
    .eq('report_draft_id', id)
    .single();

  if (revError || !revision) {
    return NextResponse.json({ error: 'Revision not found' }, { status: 404 });
  }

  // Save current state as a revision before rolling back
  const { data: current } = await supabase
    .from('report_drafts')
    .select('sections')
    .eq('id', id)
    .single();

  if (current?.sections) {
    await supabase.from('report_revisions').insert({
      report_draft_id: id,
      sections_snapshot: current.sections,
      edit_source: 'rollback',
    });
  }

  // Apply the rollback
  const { data, error } = await supabase
    .from('report_drafts')
    .update({
      sections: revision.sections_snapshot,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
