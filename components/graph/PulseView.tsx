'use client';

import { useMemo, useState, useCallback, useEffect } from 'react';
import type { ElementDefinition } from 'cytoscape';

import { ENTITIES, ENTITY_LIST } from '@/data/entities';
import { getEntityColour } from '@/data/colours';
import { getNodeShape } from '@/lib/graph/shapes';
import { LAYOUT } from '@/lib/graph/layout';
import { computePulseScore, getPulseLevel } from '@/lib/graph/pulse';
import { getRelationships } from '@/data/relationships';
import { getClientBySlug } from '@/data/clients';
import { supabase } from '@/lib/db';
import type { FeedItem } from '@/types/feed';
import type { Entity } from '@/types/entity';
import type { GraphFilter } from '@/components/sidebar/types';
import { usePanelStore, selectEntity } from '@/lib/panelStore';
import EntityGraph from './EntityGraph';
import GraphTooltip from './GraphTooltip';

// ---------------------------------------------------------------------------
// Helpers to build a node element from an Entity
// ---------------------------------------------------------------------------

function makeNode(
  entity: Entity,
  pulseScores: Map<string, number>,
  classes?: string,
  usePresetPos?: boolean,
  priority?: 'primary' | 'secondary' | 'tertiary',
): ElementDefinition {
  const score = pulseScores.get(entity.id) ?? 0;
  const level = getPulseLevel(score);
  const pulseClass = level === 'none' ? '' : `pulse-${level}`;
  const priorityClass = priority && priority !== 'primary' ? `stakeholder-${priority}` : '';
  const allClasses = [pulseClass, priorityClass, classes].filter(Boolean).join(' ');

  const node: ElementDefinition = {
    data: {
      id: entity.id,
      label: entity.name,
      colour: getEntityColour(entity.tags),
      shape: getNodeShape(entity.category, entity.subtype),
      category: entity.category,
      subtype: entity.subtype,
      priority: priority ?? 'primary',
    },
    classes: allClasses,
  };

  if (usePresetPos) {
    const pos = LAYOUT.positions.get(entity.id);
    if (pos) node.position = { x: pos.x, y: pos.y };
  }

  return node;
}

function makeEdge(sourceId: string, targetId: string, secondary = false): ElementDefinition {
  return {
    data: {
      id: secondary ? `${sourceId}->>${targetId}` : `${sourceId}->${targetId}`,
      source: sourceId,
      target: targetId,
    },
    classes: secondary ? 'secondary' : '',
  };
}

// ---------------------------------------------------------------------------
// Build full graph (no selection)
// ---------------------------------------------------------------------------

function buildFullElements(
  pulseScores: Map<string, number>,
  filter: GraphFilter,
): ElementDefinition[] {
  const nodes: ElementDefinition[] = [];
  const edges: ElementDefinition[] = [];

  for (const entity of ENTITY_LIST) {
    if (!LAYOUT.positions.has(entity.id)) continue;

    const isVisible = filter.isVisible(entity);
    nodes.push(makeNode(entity, pulseScores, !isVisible ? 'filtered-out' : '', true));

    for (const parentId of entity.parentIds) {
      if (LAYOUT.positions.has(parentId)) {
        edges.push(makeEdge(entity.id, parentId));
      }
    }
    for (const parentId of entity.secondaryParentIds ?? []) {
      if (LAYOUT.positions.has(parentId)) {
        edges.push(makeEdge(entity.id, parentId, true));
      }
    }
  }

  return [...nodes, ...edges];
}

// ---------------------------------------------------------------------------
// Build focused entity graph (entity + relationships)
// ---------------------------------------------------------------------------

function buildEntityFocusElements(
  entityId: string,
  pulseScores: Map<string, number>,
): ElementDefinition[] {
  const entity = ENTITIES[entityId];
  if (!entity) return [];

  const rels = getRelationships(entityId);
  const neighborIds = new Set<string>();
  const allRelated = [
    ...rels.parents,
    ...rels.children,
    ...rels.secondaryParents,
    ...rels.secondaryChildren,
  ];
  for (const e of allRelated) neighborIds.add(e.id);

  const nodes: ElementDefinition[] = [makeNode(entity, pulseScores, 'focus-root')];
  const edges: ElementDefinition[] = [];

  for (const e of allRelated) {
    if (e.id === entityId) continue;
    nodes.push(makeNode(e, pulseScores, 'focus-root'));
  }

  // Edges from the focused entity
  for (const parentId of entity.parentIds) {
    if (neighborIds.has(parentId)) edges.push(makeEdge(entityId, parentId));
  }
  for (const parentId of entity.secondaryParentIds ?? []) {
    if (neighborIds.has(parentId)) edges.push(makeEdge(entityId, parentId, true));
  }

  // Edges from children back to this entity
  for (const child of rels.children) {
    edges.push(makeEdge(child.id, entityId));
  }
  for (const child of rels.secondaryChildren) {
    edges.push(makeEdge(child.id, entityId, true));
  }

  // Inter-relationships between neighbors
  for (const e of allRelated) {
    for (const pid of e.parentIds) {
      if (pid !== entityId && neighborIds.has(pid)) {
        edges.push(makeEdge(e.id, pid));
      }
    }
  }

  return [...nodes, ...edges];
}

// ---------------------------------------------------------------------------
// Build focused client graph (stakeholders + inter-relationships)
// ---------------------------------------------------------------------------

function buildClientFocusElements(
  clientId: string,
  pulseScores: Map<string, number>,
): ElementDefinition[] {
  const config = getClientBySlug(clientId);
  if (!config) return [];

  const stakeholderIds = new Set(config.stakeholders.map((s) => s.entityId));
  const priorityMap = new Map(config.stakeholders.map((s) => [s.entityId, s.priority]));
  const primaryIds = new Set(
    config.stakeholders.filter((s) => s.priority === 'primary').map((s) => s.entityId),
  );
  const nodes: ElementDefinition[] = [];
  const edges: ElementDefinition[] = [];

  for (const s of config.stakeholders) {
    const entity = ENTITIES[s.entityId];
    if (!entity) continue;
    const cls = s.priority === 'primary' ? 'focus-root' : '';
    nodes.push(makeNode(entity, pulseScores, cls, false, s.priority as 'primary' | 'secondary' | 'tertiary'));

    // Only show edges where at least one end is a primary stakeholder
    for (const pid of entity.parentIds) {
      if (stakeholderIds.has(pid) && (primaryIds.has(entity.id) || primaryIds.has(pid))) {
        edges.push(makeEdge(entity.id, pid));
      }
    }
    for (const pid of entity.secondaryParentIds ?? []) {
      if (stakeholderIds.has(pid) && (primaryIds.has(entity.id) || primaryIds.has(pid))) {
        edges.push(makeEdge(entity.id, pid, true));
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
  const { selectedEntityId, selectedClientId } = usePanelStore();
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

  // Determine graph mode
  const isFocused = !!selectedEntityId || !!selectedClientId;

  const elements = useMemo(() => {
    if (selectedEntityId) return buildEntityFocusElements(selectedEntityId, pulseScores);
    if (selectedClientId) return buildClientFocusElements(selectedClientId, pulseScores);
    return buildFullElements(pulseScores, filter);
  }, [pulseScores, filter, selectedEntityId, selectedClientId]);

  const graphLayout = isFocused ? 'concentric' : 'preset';
  const focusNodeId = selectedEntityId ?? null;

  const handleNodeClick = useCallback((entityId: string) => {
    setHoveredEntity(null);
    selectEntity(entityId);
  }, []);

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
        layout={graphLayout}
        onNodeClick={handleNodeClick}
        onNodeHover={handleNodeHover}
        focusNodeId={focusNodeId}
      />
      <GraphTooltip entityId={hoveredEntity} position={tooltipPos} />
    </div>
  );
}
