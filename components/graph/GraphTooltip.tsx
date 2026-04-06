'use client';

import { getEntity } from '@/data/entities';
import { ENTITY_COLOURS, getEntityColour } from '@/data/colours';
import { getPulseColour } from '@/lib/graph/pulse';
import type { FeedItem } from '@/types/feed';

interface GraphTooltipProps {
  entityId: string | null;
  position: { x: number; y: number };
  pulseLevel?: 'none' | 'low' | 'medium' | 'high';
  latestFeedItem?: FeedItem | null;
}

function formatSubtype(subtype: string): string {
  return subtype
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function GraphTooltip({
  entityId,
  position,
  pulseLevel = 'none',
  latestFeedItem = null,
}: GraphTooltipProps) {
  if (!entityId) return null;

  const entity = getEntity(entityId);
  if (!entity) return null;

  const colourEntry = ENTITY_COLOURS[entity.category]?.[entity.subtype];
  const badgeLabel = colourEntry?.label ?? formatSubtype(entity.subtype);

  return (
    <div
      className="pointer-events-none fixed z-50 w-72 rounded-lg border border-wh-border bg-wh-panel p-3 shadow-xl shadow-black/40"
      style={{
        left: position.x + 12,
        top: position.y - 8,
      }}
    >
      {/* Entity name + pulse dot */}
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="min-w-0">
          <p className="text-sm font-medium text-wh-text-primary truncate">
            {entity.name}
          </p>
          {entity.currentHolder && (
            <p className="text-xs text-wh-text-secondary truncate">
              {entity.currentHolder}
            </p>
          )}
        </div>
        <div
          className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1"
          style={{ backgroundColor: getPulseColour(pulseLevel) }}
        />
      </div>

      {/* Subtype badge */}
      <div className="mb-1.5">
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-wh-bg text-wh-text-secondary border border-wh-border">
          {badgeLabel}
        </span>
      </div>

      {/* Latest feed item */}
      {latestFeedItem ? (
        <div className="text-xs text-wh-text-secondary leading-relaxed border-t border-wh-border pt-1.5 truncate">
          <span className="text-wh-text-secondary/50">Latest: </span>
          {latestFeedItem.title}
        </div>
      ) : (
        <div className="text-xs text-wh-text-secondary/50 border-t border-wh-border pt-1.5">
          No recent activity
        </div>
      )}
    </div>
  );
}
