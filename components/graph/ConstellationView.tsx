'use client';

import { useMemo, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { ElementDefinition } from 'cytoscape';

import { ENTITIES } from '@/data/entities';
import { getEntityColour } from '@/data/colours';
import { getNodeShape } from '@/lib/graph/shapes';
import { getClientBySlug } from '@/data/clients';
import { getPulseLevel } from '@/lib/graph/pulse';
import type { Stakeholder } from '@/types/client';
import type { Entity } from '@/types/entity';
import EntityGraph from './EntityGraph';
import GraphTooltip from './GraphTooltip';

// ---------------------------------------------------------------------------
// Layout computation for a client constellation.
//
// Groups stakeholders by priority, then arranges them in a purpose-built
// radial layout:
//   - Primary dept at centre
//   - Ministers in a small arc above
//   - Regulators / key bodies arranged to the right and below
//   - Secondary entities on a middle ring
//   - Tertiary entities on the outermost ring with dashed connections
// ---------------------------------------------------------------------------

interface PositionedStakeholder {
  entity: Entity;
  stakeholder: Stakeholder;
  x: number;
  y: number;
}

function computeConstellationLayout(
  stakeholders: Stakeholder[],
): PositionedStakeholder[] {
  const positioned: PositionedStakeholder[] = [];

  const primary = stakeholders.filter((s) => s.priority === 'primary');
  const secondary = stakeholders.filter((s) => s.priority === 'secondary');
  const tertiary = stakeholders.filter((s) => s.priority === 'tertiary');

  // Classify primary stakeholders into sub-groups by entity type.
  const departments: Stakeholder[] = [];
  const ministers: Stakeholder[] = [];
  const bodies: Stakeholder[] = [];

  for (const s of primary) {
    const entity = ENTITIES[s.entityId];
    if (!entity) continue;
    if (entity.category === 'department') departments.push(s);
    else if (entity.category === 'official') ministers.push(s);
    else bodies.push(s);
  }

  // ----- Place primary department(s) at / near centre -----
  const deptSpacing = 60;
  const deptStartX = -((departments.length - 1) * deptSpacing) / 2;
  departments.forEach((s, i) => {
    const entity = ENTITIES[s.entityId];
    if (entity) {
      positioned.push({
        entity,
        stakeholder: s,
        x: deptStartX + i * deptSpacing,
        y: 0,
      });
    }
  });

  // ----- Ministers in an arc above (radius 150) -----
  const ministerRadius = 150;
  const ministerArcStart = -Math.PI * 0.75; // sweep from upper-left to upper-right
  const ministerArcEnd = -Math.PI * 0.25;
  ministers.forEach((s, i) => {
    const entity = ENTITIES[s.entityId];
    if (!entity) return;
    const count = Math.max(ministers.length, 1);
    const angle =
      count === 1
        ? -Math.PI / 2
        : ministerArcStart + (i / (count - 1)) * (ministerArcEnd - ministerArcStart);
    positioned.push({
      entity,
      stakeholder: s,
      x: Math.cos(angle) * ministerRadius,
      y: Math.sin(angle) * ministerRadius,
    });
  });

  // ----- Key bodies (primary non-department/non-minister) arranged below-right -----
  const bodyRadius = 170;
  const bodyArcStart = Math.PI * 0.05;
  const bodyArcEnd = Math.PI * 0.7;
  bodies.forEach((s, i) => {
    const entity = ENTITIES[s.entityId];
    if (!entity) return;
    const count = Math.max(bodies.length, 1);
    const angle =
      count === 1
        ? Math.PI * 0.35
        : bodyArcStart + (i / (count - 1)) * (bodyArcEnd - bodyArcStart);
    positioned.push({
      entity,
      stakeholder: s,
      x: Math.cos(angle) * bodyRadius,
      y: Math.sin(angle) * bodyRadius,
    });
  });

  // ----- Secondary entities on a middle ring (radius 300) -----
  const secondaryRadius = 300;
  secondary.forEach((s, i) => {
    const entity = ENTITIES[s.entityId];
    if (!entity) return;
    const count = Math.max(secondary.length, 1);
    const angle = (2 * Math.PI * i) / count - Math.PI / 2;
    positioned.push({
      entity,
      stakeholder: s,
      x: Math.cos(angle) * secondaryRadius,
      y: Math.sin(angle) * secondaryRadius,
    });
  });

  // ----- Tertiary entities on the outer ring (radius 440) -----
  const tertiaryRadius = 440;
  tertiary.forEach((s, i) => {
    const entity = ENTITIES[s.entityId];
    if (!entity) return;
    const count = Math.max(tertiary.length, 1);
    const angle = (2 * Math.PI * i) / count - Math.PI / 2;
    positioned.push({
      entity,
      stakeholder: s,
      x: Math.cos(angle) * tertiaryRadius,
      y: Math.sin(angle) * tertiaryRadius,
    });
  });

  return positioned;
}

// ---------------------------------------------------------------------------
// Mock pulse data for constellation entities.
// ---------------------------------------------------------------------------

function buildMockPulseForStakeholders(
  stakeholders: Stakeholder[],
): Map<string, number> {
  const scores = new Map<string, number>();
  stakeholders.forEach((s, i) => {
    // Give about half of them some activity.
    if (i % 3 === 0) {
      scores.set(s.entityId, ((i * 5) % 9) + 0.5);
    }
  });
  return scores;
}

// ---------------------------------------------------------------------------
// Build Cytoscape elements from the constellation layout.
// ---------------------------------------------------------------------------

function buildConstellationElements(
  positioned: PositionedStakeholder[],
  allStakeholders: Stakeholder[],
  pulseScores: Map<string, number>,
): ElementDefinition[] {
  const nodes: ElementDefinition[] = [];
  const edges: ElementDefinition[] = [];
  const entityIdSet = new Set(allStakeholders.map((s) => s.entityId));
  const stakeholderMap = new Map<string, Stakeholder>();
  for (const s of allStakeholders) {
    stakeholderMap.set(s.entityId, s);
  }

  for (const p of positioned) {
    const score = pulseScores.get(p.entity.id) ?? 0;
    const level = getPulseLevel(score);
    const pulseClass = level === 'none' ? '' : `pulse-${level}`;

    nodes.push({
      data: {
        id: p.entity.id,
        label: p.entity.name,
        colour: getEntityColour(p.entity.category, p.entity.subtype),
        shape: getNodeShape(p.entity.category, p.entity.subtype),
        category: p.entity.category,
        subtype: p.entity.subtype,
      },
      position: { x: p.x, y: p.y },
      classes: pulseClass,
    });

    // Create edges only between entities that both appear in the stakeholder
    // map AND have a real parent-child relationship.
    for (const parentId of p.entity.parentIds) {
      if (entityIdSet.has(parentId)) {
        edges.push({
          data: {
            id: `${p.entity.id}->${parentId}`,
            source: p.entity.id,
            target: parentId,
          },
          classes: '',
        });
      }
    }

    // Secondary parent edges (dashed).
    for (const parentId of p.entity.secondaryParentIds ?? []) {
      if (entityIdSet.has(parentId)) {
        edges.push({
          data: {
            id: `${p.entity.id}->>${parentId}`,
            source: p.entity.id,
            target: parentId,
          },
          classes: 'secondary',
        });
      }
    }

    // Also connect secondary/tertiary stakeholders to primary entities they
    // relate to, using dashed lines, if no direct parent edge was created.
    const sh = stakeholderMap.get(p.entity.id);
    if (sh && sh.priority !== 'primary') {
      // Try connecting to the first primary department that is a parent.
      const primaryDeptIds = allStakeholders
        .filter((s) => s.priority === 'primary')
        .map((s) => s.entityId)
        .filter((id) => ENTITIES[id]?.category === 'department');

      for (const deptId of primaryDeptIds) {
        const edgeId = `${p.entity.id}->>${deptId}`;
        const reverseId = `${deptId}->>${p.entity.id}`;
        const alreadyHasEdge = edges.some(
          (e) => e.data.id === edgeId || e.data.id === reverseId,
        );
        // Also check primary edges.
        const primaryEdgeId = `${p.entity.id}->${deptId}`;
        const reversePrimaryId = `${deptId}->${p.entity.id}`;
        const alreadyHasPrimary = edges.some(
          (e) => e.data.id === primaryEdgeId || e.data.id === reversePrimaryId,
        );
        if (!alreadyHasEdge && !alreadyHasPrimary) {
          edges.push({
            data: {
              id: edgeId,
              source: p.entity.id,
              target: deptId,
            },
            classes: 'secondary',
          });
          break; // one connection to a primary dept is enough
        }
      }
    }
  }

  return [...nodes, ...edges];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ConstellationViewProps {
  clientId: string;
}

export default function ConstellationView({ clientId }: ConstellationViewProps) {
  const router = useRouter();
  const [hoveredEntity, setHoveredEntity] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const client = useMemo(() => getClientBySlug(clientId), [clientId]);

  const positioned = useMemo(() => {
    if (!client) return [];
    return computeConstellationLayout(client.stakeholders);
  }, [client]);

  const pulseScores = useMemo(() => {
    if (!client) return new Map<string, number>();
    return buildMockPulseForStakeholders(client.stakeholders);
  }, [client]);

  const elements = useMemo(() => {
    if (!client) return [];
    return buildConstellationElements(positioned, client.stakeholders, pulseScores);
  }, [client, positioned, pulseScores]);

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

  if (!client) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-wh-text-secondary">
        Client not found.
      </div>
    );
  }

  return (
    <div className="relative h-full w-full" onMouseMove={handleMouseMove}>
      <EntityGraph
        elements={elements}
        layout="preset"
        onNodeClick={handleNodeClick}
        onNodeHover={handleNodeHover}
        minZoom={0.4}
        maxZoom={3}
      />
      <GraphTooltip entityId={hoveredEntity} position={tooltipPos} />
    </div>
  );
}
