'use client';

import { useMemo, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { ElementDefinition } from 'cytoscape';

import { ENTITIES, ENTITY_LIST } from '@/data/entities';
import { getEntityColour } from '@/data/colours';
import { LAYOUT } from '@/lib/graph/layout';
import { getPulseLevel } from '@/lib/graph/pulse';
import EntityGraph from './EntityGraph';
import GraphTooltip from './GraphTooltip';

// ---------------------------------------------------------------------------
// Mock pulse data: give ~20 random entities some simulated activity so the
// graph glows with life even before real feed items are piped in.
// ---------------------------------------------------------------------------

function buildMockPulseScores(): Map<string, number> {
  const scores = new Map<string, number>();

  // Deterministic "random" selection — pick entities at regular intervals
  // from the entity list so the result is stable across renders.
  const ids = ENTITY_LIST.map((e) => e.id);
  const step = Math.max(1, Math.floor(ids.length / 20));

  for (let i = 0; i < ids.length; i += step) {
    // Vary the score so we get a mix of low / medium / high.
    const score = ((i * 7) % 11) + 0.5; // deterministic spread 0.5 -- 10.5
    scores.set(ids[i], score);
  }

  return scores;
}

// ---------------------------------------------------------------------------
// Build Cytoscape elements from the full entity set + pre-computed layout.
// ---------------------------------------------------------------------------

function buildElements(pulseScores: Map<string, number>): ElementDefinition[] {
  const nodes: ElementDefinition[] = [];
  const edges: ElementDefinition[] = [];

  for (const entity of ENTITY_LIST) {
    const pos = LAYOUT.positions.get(entity.id);
    if (!pos) continue; // skip entities that weren't laid out

    const score = pulseScores.get(entity.id) ?? 0;
    const level = getPulseLevel(score);
    const pulseClass = level === 'none' ? '' : `pulse-${level}`;

    nodes.push({
      data: {
        id: entity.id,
        label: entity.name,
        colour: getEntityColour(entity.category, entity.subtype),
      },
      position: { x: pos.x, y: pos.y },
      classes: pulseClass,
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

export default function PulseView() {
  const router = useRouter();
  const [hoveredEntity, setHoveredEntity] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const pulseScores = useMemo(() => buildMockPulseScores(), []);
  const elements = useMemo(() => buildElements(pulseScores), [pulseScores]);

  const handleNodeClick = useCallback(
    (entityId: string) => {
      router.push(`/entity/${entityId}`);
    },
    [router],
  );

  const handleNodeHover = useCallback((entityId: string | null) => {
    setHoveredEntity(entityId);
  }, []);

  // Track the mouse to position the tooltip.
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
