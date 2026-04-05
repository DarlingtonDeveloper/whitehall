'use client';

import { useRef, useEffect, useCallback } from 'react';
import cytoscape, { Core, ElementDefinition } from 'cytoscape';
import { graphStyles } from './graphStyles';

interface EntityGraphProps {
  elements: ElementDefinition[];
  layout?: 'preset' | 'concentric';
  onNodeClick?: (entityId: string) => void;
  onNodeHover?: (entityId: string | null) => void;
  className?: string;
  minZoom?: number;
  maxZoom?: number;
}

/** Zoom level past which labels are shown on all visible nodes. */
const LABEL_ZOOM_THRESHOLD = 1.8;

export default function EntityGraph({
  elements,
  layout = 'preset',
  onNodeClick,
  onNodeHover,
  className = '',
  minZoom = 0.15,
  maxZoom = 4,
}: EntityGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);

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

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: graphStyles,
      layout: { name: layout, fit: true, padding: 40 },
      minZoom,
      maxZoom,
      wheelSensitivity: 0.3,
      pixelRatio: 'auto',
      // Let CSS handle the background
      styleEnabled: true,
    });

    cyRef.current = cy;

    // Transparent background — the parent div CSS controls the canvas bg.
    cy.container()!.style.backgroundColor = 'transparent';

    // Fit everything with padding on mount.
    cy.fit(undefined, 40);

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
      // Keep show-label only if zoomed past threshold.
      if (cy.zoom() < LABEL_ZOOM_THRESHOLD) {
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
        // Only remove labels from nodes that are NOT currently hovered.
        cy.nodes().filter((n) => !n.hasClass('hover')).removeClass('show-label');
      }
    });

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
    // We only re-initialise when elements or layout change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elements, layout, minZoom, maxZoom]);

  return (
    <div
      ref={containerRef}
      className={`h-full w-full ${className}`}
      style={{ backgroundColor: 'transparent' }}
    />
  );
}
