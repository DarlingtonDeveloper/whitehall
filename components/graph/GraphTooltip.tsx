'use client';

import { getEntity } from '@/data/entities';
import { ENTITY_COLOURS, getEntityColour } from '@/data/colours';

interface GraphTooltipProps {
  entityId: string | null;
  position: { x: number; y: number };
}

export default function GraphTooltip({ entityId, position }: GraphTooltipProps) {
  if (!entityId) return null;

  const entity = getEntity(entityId);
  if (!entity) return null;

  const colourEntry = ENTITY_COLOURS[entity.category]?.[entity.subtype];
  const badgeLabel = colourEntry?.label ?? entity.subtype;
  const badgeColour = getEntityColour(entity.tags);

  const description =
    entity.description.length > 120
      ? entity.description.slice(0, 120) + '...'
      : entity.description;

  return (
    <div
      className="pointer-events-none fixed z-50 max-w-xs rounded-lg border border-wh-border bg-wh-panel px-3 py-2.5 shadow-xl shadow-black/40"
      style={{
        left: position.x + 12,
        top: position.y - 8,
      }}
    >
      <p className="text-xs font-semibold text-wh-text-primary">
        {entity.name}
      </p>

      <div className="mt-1 flex items-center gap-1.5">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: badgeColour }}
        />
        <span className="text-[10px] font-medium text-wh-text-secondary">
          {badgeLabel}
        </span>
      </div>

      {entity.currentHolder && (
        <p className="mt-1.5 text-[10px] text-wh-text-secondary">
          <span className="text-wh-text-secondary/60">Holder: </span>
          {entity.currentHolder}
        </p>
      )}

      <p className="mt-1 text-[10px] leading-relaxed text-wh-text-secondary/70">
        {description}
      </p>
    </div>
  );
}
