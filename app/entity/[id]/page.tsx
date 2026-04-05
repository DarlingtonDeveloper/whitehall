import { notFound } from 'next/navigation';
import Shell from '@/components/layout/Shell';
import EntityPanel from '@/components/entity/EntityPanel';
import FeedPanel from '@/components/feed/FeedPanel';
import { getEntity } from '@/data/entities';
import { getRelationships } from '@/data/relationships';
import { getPowers } from '@/data/powers';
import { getBudget } from '@/data/budgets';
import { getStaff } from '@/data/staff';
import { getEntityColour } from '@/data/colours';

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
        {/* Left panel (60%): Entity detail with tabs */}
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

        {/* Right panel (40%): Feed + chat */}
        <div className="flex w-[400px] shrink-0 flex-col border-l border-wh-border bg-wh-panel">
          <FeedPanel
            title="Entity Feed"
            entityId={entity.id}
            entityName={entity.name}
          />
        </div>
      </div>
    </Shell>
  );
}
