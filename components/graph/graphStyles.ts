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
];
