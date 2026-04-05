'use client';

import { useMemo, useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { ElementDefinition } from 'cytoscape';

import { ENTITY_LIST } from '@/data/entities';
import { getEntityColour } from '@/data/colours';
import { getNodeShape } from '@/lib/graph/shapes';
import { LAYOUT } from '@/lib/graph/layout';
import { computePulseScore, getPulseLevel } from '@/lib/graph/pulse';
import { supabase } from '@/lib/db';
import type { FeedItem } from '@/types/feed';
import type { GraphFilter } from '@/components/sidebar/types';
import EntityGraph from './EntityGraph';
import GraphTooltip from './GraphTooltip';

// ---------------------------------------------------------------------------
// Build Cytoscape elements from the full entity set + pre-computed layout.
// ---------------------------------------------------------------------------

function buildElements(
  pulseScores: Map<string, number>,
  filter: GraphFilter,
): ElementDefinition[] {
  const nodes: ElementDefinition[] = [];
  const edges: ElementDefinition[] = [];
  const visibleIds = new Set<string>();

  for (const entity of ENTITY_LIST) {
    const pos = LAYOUT.positions.get(entity.id);
    if (!pos) continue;

    const score = pulseScores.get(entity.id) ?? 0;
    const level = getPulseLevel(score);
    const pulseClass = level === 'none' ? '' : `pulse-${level}`;

    // Determine if entity passes filters
    const isVisible = filter.isVisible(entity);
    if (isVisible) visibleIds.add(entity.id);

    const classes = [
      pulseClass,
      !isVisible ? 'filtered-out' : '',
    ].filter(Boolean).join(' ');

    nodes.push({
      data: {
        id: entity.id,
        label: entity.name,
        colour: getEntityColour(entity.category, entity.subtype),
        shape: getNodeShape(entity.category, entity.subtype),
        category: entity.category,
        subtype: entity.subtype,
      },
      position: { x: pos.x, y: pos.y },
      classes,
    });

    // Primary parent edges
    for (const parentId of entity.parentIds) {
      if (LAYOUT.positions.has(parentId)) {
        edges.push({
          data: {
            id: `${entity.id}->${parentId}`,
            source: entity.id,
            target: parentId,
          },
          classes: '',
        });
      }
    }

    // Secondary parent edges
    for (const parentId of entity.secondaryParentIds ?? []) {
      if (LAYOUT.positions.has(parentId)) {
        edges.push({
          data: {
            id: `${entity.id}->>${parentId}`,
            source: entity.id,
            target: parentId,
          },
          classes: 'secondary',
        });
      }
    }
  }

  return [...nodes, ...edges];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface PulseViewProps {
  filter: GraphFilter;
}

export default function PulseView({ filter }: PulseViewProps) {
  const router = useRouter();
  const [hoveredEntity, setHoveredEntity] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);

  useEffect(() => {
    async function fetchFeed() {
      const { data } = await supabase
        .from('feed_items')
        .select('entity_ids, published_at')
        .gte('published_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .order('published_at', { ascending: false })
        .limit(200);
      if (data) setFeedItems(data as FeedItem[]);
    }
    fetchFeed();
  }, []);

  const pulseScores = useMemo(() => {
    const scores = new Map<string, number>();
    for (const entity of ENTITY_LIST) {
      const score = computePulseScore(entity.id, feedItems);
      if (score > 0) scores.set(entity.id, score);
    }
    return scores;
  }, [feedItems]);

  const elements = useMemo(
    () => buildElements(pulseScores, filter),
    [pulseScores, filter],
  );

  const handleNodeClick = useCallback(
    (entityId: string) => {
      router.push(`/entity/${entityId}`);
    },
    [router],
  );

  const handleNodeHover = useCallback((entityId: string | null) => {
    setHoveredEntity(entityId);
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (hoveredEntity) {
        setTooltipPos({ x: e.clientX, y: e.clientY });
      }
    },
    [hoveredEntity],
  );

  return (
    <div className="relative h-full w-full" onMouseMove={handleMouseMove}>
      <EntityGraph
        elements={elements}
        layout="preset"
        onNodeClick={handleNodeClick}
        onNodeHover={handleNodeHover}
      />
      <GraphTooltip entityId={hoveredEntity} position={tooltipPos} />
    </div>
  );
}
