import { getServiceClient } from '@/lib/db';
import Shell from '@/components/layout/Shell';
import PoliticianSearch from '@/components/politician/PoliticianSearch';

export const dynamic = 'force-dynamic';

export default async function PoliticiansPage() {
  const db = getServiceClient();

  // Fetch all active politicians with indicator counts
  const { data: politicians } = await db
    .from('politicians')
    .select('id, display_name, party, constituency, house, status, portrait_url')
    .eq('status', 'active')
    .order('display_name', { ascending: true });

  return (
    <Shell>
      <div className="flex h-full flex-col overflow-hidden pt-12">
        <div className="shrink-0 border-b border-wh-border bg-wh-panel px-6 py-4">
          <h1 className="text-lg font-semibold text-wh-text-primary">Politicians</h1>
          <p className="mt-1 text-xs text-wh-text-tertiary">
            {politicians?.length ?? 0} active members
          </p>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <PoliticianSearch politicians={politicians ?? []} />
        </div>
      </div>
    </Shell>
  );
}
