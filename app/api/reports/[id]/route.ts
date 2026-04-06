import { NextResponse } from 'next/server';
import { supabase } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const { data, error } = await supabase
    .from('report_drafts')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: 'Report not found' },
      { status: 404 },
    );
  }

  // Optionally include chat messages
  const url = new URL(request.url);
  if (url.searchParams.get('include') === 'messages') {
    const { data: messages } = await supabase
      .from('report_chat_messages')
      .select('*')
      .eq('report_draft_id', id)
      .order('created_at', { ascending: true });

    return NextResponse.json({ ...data, messages: messages ?? [] });
  }

  return NextResponse.json(data);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: { sections?: unknown; status?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON' },
      { status: 400 },
    );
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (body.sections !== undefined) {
    updates.sections = body.sections;
  }

  if (body.status) {
    updates.status = body.status;

    if (body.status === 'in_review') {
      updates.review_requested_at = new Date().toISOString();
      updates.review_token = crypto.randomUUID().replace(/-/g, '').substring(0, 16);
    }
    if (body.status === 'approved') {
      updates.approved_at = new Date().toISOString();
    }
    if (body.status === 'exported') {
      updates.exported_at = new Date().toISOString();
    }
  }

  const { data, error } = await supabase
    .from('report_drafts')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json(data);
}
