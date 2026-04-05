/**
 * Node shape mapping for Cytoscape graph.
 * Mirrors the original MOG bundle (lines 8894-9004).
 *
 * Shape is determined by category + subtype:
 *   official  → ellipse  (prime-minister → heptagon, cabinet-minister → octagon)
 *   department → rectangle (agency → roundrectangle, division-directorate → roundrectangle)
 *   body → diamond (public-corporation → rhomboid, royal-charter-body → rhomboid, other → rhomboid)
 *   group → hexagon
 */

export type CytoscapeShape =
  | 'ellipse'
  | 'rectangle'
  | 'roundrectangle'
  | 'diamond'
  | 'rhomboid'
  | 'hexagon'
  | 'heptagon'
  | 'octagon';

const SHAPE_MAP: Record<string, Record<string, CytoscapeShape>> = {
  official: {
    'prime-minister': 'heptagon',
    'cabinet-minister': 'octagon',
    'junior-minister': 'ellipse',
    'civil-servant': 'ellipse',
    independent: 'ellipse',
  },
  department: {
    ministerial: 'rectangle',
    'non-ministerial': 'rectangle',
    agency: 'roundrectangle',
    'division-directorate': 'roundrectangle',
  },
  body: {
    'executive-ndpb': 'diamond',
    'advisory-ndpb': 'diamond',
    'public-corporation': 'rhomboid',
    'royal-charter-body': 'rhomboid',
    tribunal: 'diamond',
    other: 'rhomboid',
  },
  group: {
    cabinet: 'hexagon',
    'other-group': 'hexagon',
  },
};

const CATEGORY_DEFAULTS: Record<string, CytoscapeShape> = {
  official: 'ellipse',
  department: 'rectangle',
  body: 'diamond',
  group: 'hexagon',
};

/**
 * Get the Cytoscape node shape for an entity based on its category and subtype.
 */
export function getNodeShape(category: string, subtype: string): CytoscapeShape {
  const subtypes = SHAPE_MAP[category];
  if (subtypes) {
    const shape = subtypes[subtype];
    if (shape) return shape;
  }
  return CATEGORY_DEFAULTS[category] ?? 'ellipse';
}

/**
 * Returns all unique category + subtype + shape + colour combinations
 * for use in the legend component.
 */
export function getAllShapeEntries(): {
  category: string;
  subtype: string;
  shape: CytoscapeShape;
  label: string;
}[] {
  const entries: { category: string; subtype: string; shape: CytoscapeShape; label: string }[] = [];

  for (const [category, subtypes] of Object.entries(SHAPE_MAP)) {
    for (const [subtype, shape] of Object.entries(subtypes)) {
      entries.push({ category, subtype, shape, label: '' }); // label filled by consumer from ENTITY_COLOURS
    }
  }

  return entries;
}
