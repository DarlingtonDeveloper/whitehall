import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import Shell from '@/components/layout/Shell';
import EntityPanel from '@/components/entity/EntityPanel';
import FeedDataLoader from '@/components/feed/FeedDataLoader';
import { getEntity, ENTITY_LIST } from '@/data/entities';
import { getRelationships } from '@/data/relationships';
import { getPowers } from '@/data/powers';
import { getBudget } from '@/data/budgets';
import { getStaff } from '@/data/staff';
import { getEntityColour } from '@/data/colours';

// Pre-render all entity pages at build time
export async function generateStaticParams() {
  return ENTITY_LIST.map((e) => ({ id: e.id }));
}

export default async function EntityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const entity = getEntity(id);

  if (!entity) {
    notFound();
  }

  const colour = getEntityColour(entity.tags);
  const relationships = getRelationships(id);
  const powers = getPowers(id);
  const budget = getBudget(id);
  const staff = getStaff(id);

  return (
    <Shell>
      <div className="flex h-full overflow-hidden">
        {/* Left panel (60%): Entity detail with tabs — static data */}
        <div className="flex min-w-0 flex-[6] flex-col">
          <EntityPanel
            entity={entity}
            colour={colour}
            relationships={relationships}
            powers={powers}
            budget={budget}
            staff={staff}
          />
        </div>

        {/* Right panel (40%): Feed — server-rendered, streams in */}
        <div className="flex w-[400px] shrink-0 flex-col border-l border-wh-border bg-wh-panel">
          <Suspense fallback={<FeedSkeleton />}>
            <FeedDataLoader entityId={entity.id} />
          </Suspense>
        </div>
      </div>
    </Shell>
  );
}

function FeedSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="animate-pulse">
          <div className="h-2 w-16 rounded bg-wh-border/60" />
          <div className="mt-2 h-3 w-full rounded bg-wh-border/40" />
          <div className="mt-1 h-3 w-3/4 rounded bg-wh-border/30" />
        </div>
      ))}
    </div>
  );
}
