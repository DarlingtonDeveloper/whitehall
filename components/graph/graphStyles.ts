import type { StylesheetStyle } from 'cytoscape';

export const graphStyles: StylesheetStyle[] = [
  // Base node style
  {
    selector: 'node',
    style: {
      'width': 8,
      'height': 8,
      'background-color': '#95a5a6',
      'border-width': 0,
      'label': '',
      'shape': 'ellipse',
    },
  },
  // Node shapes from data attribute
  {
    selector: 'node[shape]',
    style: {
      'shape': 'data(shape)' as any,
    },
  },
  // Labelled nodes (when zoomed or hovered)
  {
    selector: 'node.show-label',
    style: {
      'label': 'data(label)',
      'font-size': 10,
      'color': '#e2e8f0',
      'text-outline-width': 2,
      'text-outline-color': '#0a0a0f',
      'text-valign': 'bottom',
      'text-margin-y': 6,
    },
  },
  // Node categories -- use data(colour) field set from entity colours
  {
    selector: 'node[colour]',
    style: {
      'background-color': 'data(colour)',
    },
  },
  // Pulse levels
  {
    selector: 'node.pulse-low',
    style: {
      'width': 12,
      'height': 12,
      'border-width': 3,
      'border-color': '#2dd4bf',
      'border-opacity': 0.5,
    },
  },
  {
    selector: 'node.pulse-medium',
    style: {
      'width': 16,
      'height': 16,
      'border-width': 4,
      'border-color': '#f59e0b',
      'border-opacity': 0.6,
    },
  },
  {
    selector: 'node.pulse-high',
    style: {
      'width': 22,
      'height': 22,
      'border-width': 5,
      'border-color': '#ef4444',
      'border-opacity': 0.7,
    },
  },
  // Selected node
  {
    selector: 'node:selected',
    style: {
      'border-width': 3,
      'border-color': '#2dd4bf',
      'width': 20,
      'height': 20,
    },
  },
  // Hovered node
  {
    selector: 'node.hover',
    style: {
      'border-width': 2,
      'border-color': '#e2e8f0',
      'width': 14,
      'height': 14,
    },
  },
  // Secondary stakeholder nodes (smaller, dimmer)
  {
    selector: 'node.stakeholder-secondary',
    style: {
      'width': 6,
      'height': 6,
      'opacity': 0.7,
    },
  },
  // Tertiary stakeholder nodes (smallest, dimmest)
  {
    selector: 'node.stakeholder-tertiary',
    style: {
      'width': 5,
      'height': 5,
      'opacity': 0.45,
    },
  },
  // Filtered-out nodes (hidden by sidebar/legend filters)
  {
    selector: 'node.filtered-out',
    style: {
      'opacity': 0.06,
      'width': 4,
      'height': 4,
      'border-width': 0,
      'label': '',
    },
  },
  // Edges
  {
    selector: 'edge',
    style: {
      'width': 0.5,
      'line-color': '#1e1e2e',
      'curve-style': 'bezier',
      'target-arrow-shape': 'none',
      'opacity': 0.3,
    },
  },
  // Secondary edges (dashed)
  {
    selector: 'edge.secondary',
    style: {
      'line-style': 'dashed',
      'line-dash-pattern': [4, 4],
      'opacity': 0.15,
    },
  },
  // Highlighted edges (when node is selected)
  {
    selector: 'edge.highlighted',
    style: {
      'width': 1.5,
      'line-color': '#2dd4bf',
      'opacity': 0.6,
    },
  },
  // Dimmed (everything not connected to selected)
  {
    selector: '.dimmed',
    style: {
      'opacity': 0.08,
    },
  },
  // Edges connected to filtered-out nodes
  {
    selector: 'edge.edge-filtered',
    style: {
      'opacity': 0.03,
    },
  },
  // Feed hover: dimmed elements
  {
    selector: '.feed-dimmed',
    style: {
      'opacity': 0.15,
      'transition-property': 'opacity',
      'transition-duration': '200ms',
    } as any,
  },
  // Feed hover: highlighted entities
  {
    selector: '.feed-highlighted',
    style: {
      'opacity': 1,
      'border-width': 3,
      'border-color': '#2dd4bf',
      'border-opacity': 1,
      'transition-property': 'opacity, border-width, border-color',
      'transition-duration': '200ms',
    } as any,
  },
];
