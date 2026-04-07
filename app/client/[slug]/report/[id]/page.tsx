import { notFound } from 'next/navigation';
import Shell from '@/components/layout/Shell';
import { getClientBySlug } from '@/data/clients';
import { supabase } from '@/lib/db';
import ReportBuilder from '@/components/report/ReportBuilder';
import type { ReportDraft } from '@/types/report';

export const dynamic = 'force-dynamic';

export default async function ReportPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const client = getClientBySlug(slug);
  if (!client) notFound();

  const { data, error } = await supabase
    .from('report_drafts')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) notFound();

  const draft = data as ReportDraft;

  return (
    <Shell>
      <ReportBuilder
        draft={draft}
        clientName={client.name}
      />
    </Shell>
  );
}
