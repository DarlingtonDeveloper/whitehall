'use client';

import { useRef, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react';
import cytoscape, { Core, ElementDefinition } from 'cytoscape';
import { graphStyles } from './graphStyles';

export interface EntityGraphHandle {
  getCy: () => Core | null;
}

interface EntityGraphProps {
  elements: ElementDefinition[];
  layout?: 'preset' | 'concentric' | 'cose';
  onNodeClick?: (entityId: string) => void;
  onNodeHover?: (entityId: string | null) => void;
  focusNodeId?: string | null;
  className?: string;
  minZoom?: number;
  maxZoom?: number;
}

/** Zoom level past which labels are shown on all visible nodes. */
const LABEL_ZOOM_THRESHOLD = 1.8;

const EntityGraph = forwardRef<EntityGraphHandle, EntityGraphProps>(function EntityGraph({
  elements,
  layout = 'preset',
  onNodeClick,
  onNodeHover,
  focusNodeId,
  className = '',
  minZoom = 0.15,
  maxZoom = 4,
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);

  useImperativeHandle(ref, () => ({
    getCy: () => cyRef.current,
  }));

  // Keep callbacks in refs so effect doesn't re-run when they change.
  const onNodeClickRef = useRef(onNodeClick);
  onNodeClickRef.current = onNodeClick;
  const onNodeHoverRef = useRef(onNodeHover);
  onNodeHoverRef.current = onNodeHover;

  // -----------------------------------------------------------------------
  // Initialise Cytoscape instance
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current) return;

    // Build layout config based on type
    const layoutConfig: Record<string, unknown> = { name: layout, fit: true, padding: 40 };
    if (layout === 'cose') {
      Object.assign(layoutConfig, {
        animate: false,
        nodeRepulsion: () => 8000,
        idealEdgeLength: () => 120,
        gravity: 0.25,
        numIter: 300,
      });
    }
    if (layout === 'concentric') {
      if (focusNodeId) {
        // Entity focus: selected node at centre
        Object.assign(layoutConfig, {
          concentric: (node: { id: () => string }) => (node.id() === focusNodeId ? 10 : 1),
          levelWidth: () => 1,
          minNodeSpacing: 60,
        });
      } else {
        // Client focus: arrange by stakeholder priority rings
        const PRIORITY_WEIGHT: Record<string, number> = { primary: 10, secondary: 5, tertiary: 1 };
        Object.assign(layoutConfig, {
          concentric: (node: { data: (key: string) => string }) => {
            const p = node.data('priority') || 'tertiary';
            return PRIORITY_WEIGHT[p] ?? 1;
          },
          levelWidth: () => 2,
          minNodeSpacing: 80,
        });
      }
    }

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: graphStyles,
      layout: layoutConfig as unknown as cytoscape.LayoutOptions,
      minZoom,
      maxZoom,
      wheelSensitivity: 0.3,
      pixelRatio: 'auto',
      styleEnabled: true,
    });

    cyRef.current = cy;

    // Transparent background — the parent div CSS controls the canvas bg.
    cy.container()!.style.backgroundColor = 'transparent';

    // Fit everything with padding on mount.
    cy.fit(undefined, 40);

    // In focused mode (non-preset), show labels on key nodes only.
    // Nodes with 'focus-root' (primary stakeholders / selected entity)
    // get labels immediately; the rest are revealed on hover or zoom.
    if (layout !== 'preset') {
      cy.nodes('.focus-root').addClass('show-label');
    }

    // ----- Node click -----
    cy.on('tap', 'node', (evt) => {
      const nodeId = evt.target.id();
      onNodeClickRef.current?.(nodeId);
    });

    // ----- Node hover: add/remove hover + show-label classes -----
    cy.on('mouseover', 'node', (evt) => {
      const node = evt.target;
      // Skip interaction on filtered-out nodes
      if (node.hasClass('filtered-out')) return;

      node.addClass('hover show-label');

      // Highlight connected edges and dim the rest.
      const neighbourhood = node.closedNeighborhood();
      cy.elements().not(neighbourhood).addClass('dimmed');
      neighbourhood.edges().addClass('highlighted');

      onNodeHoverRef.current?.(node.id());
    });

    cy.on('mouseout', 'node', (evt) => {
      const node = evt.target;
      node.removeClass('hover');
      // Keep show-label on focus-root nodes (primary stakeholders) and when zoomed in.
      if (cy.zoom() < LABEL_ZOOM_THRESHOLD && !node.hasClass('focus-root')) {
        node.removeClass('show-label');
      }

      // Remove dimming and edge highlighting.
      cy.elements().removeClass('dimmed highlighted');

      onNodeHoverRef.current?.(null);
    });

    // ----- Zoom: toggle labels -----
    cy.on('zoom', () => {
      const z = cy.zoom();
      if (z >= LABEL_ZOOM_THRESHOLD) {
        cy.nodes().addClass('show-label');
      } else {
        // Remove labels from nodes that are NOT hovered and NOT focus-root.
        cy.nodes().filter((n) => !n.hasClass('hover') && !n.hasClass('focus-root')).removeClass('show-label');
      }
    });

    // Resize observer — refit when the container changes size
    // (e.g. sidebar or intelligence panel toggled).
    let prevW = containerRef.current.clientWidth;
    let prevH = containerRef.current.clientHeight;
    const ro = new ResizeObserver(() => {
      const w = containerRef.current?.clientWidth ?? 0;
      const h = containerRef.current?.clientHeight ?? 0;
      // Only refit when the size actually changes, not on every observer fire.
      if (w !== prevW || h !== prevH) {
        prevW = w;
        prevH = h;
        cy.resize();
        cy.fit(undefined, 40);
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      cy.destroy();
      cyRef.current = null;
    };
    // We only re-initialise when elements or layout change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elements, layout, focusNodeId, minZoom, maxZoom]);

  return (
    <div
      ref={containerRef}
      className={`h-full w-full ${className}`}
      style={{ backgroundColor: 'transparent' }}
    />
  );
});

export default EntityGraph;
