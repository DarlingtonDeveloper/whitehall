'use client';

import { useMemo } from 'react';
import { ENTITY_COLOURS } from '@/data/colours';
import { ENTITY_LIST } from '@/data/entities';
import type { CytoscapeShape } from '@/lib/graph/shapes';
import { getNodeShape } from '@/lib/graph/shapes';

interface GraphLegendProps {
  hiddenTypes: Set<string>;
  onToggleType: (key: string) => void;
  focusMode: boolean;
  onToggleFocusMode: () => void;
  onResetFilters: () => void;
  hasActiveFilters: boolean;
}

interface LegendEntry {
  key: string; // "category:subtype"
  category: string;
  subtype: string;
  label: string;
  hex: string;
  shape: CytoscapeShape;
  count: number;
}

export default function GraphLegend({
  hiddenTypes,
  onToggleType,
  focusMode,
  onToggleFocusMode,
  onResetFilters,
  hasActiveFilters,
}: GraphLegendProps) {
  const entries = useMemo(() => {
    // Count entities per category:subtype
    const counts: Record<string, number> = {};
    for (const entity of ENTITY_LIST) {
      const key = `${entity.category}:${entity.subtype}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }

    const result: LegendEntry[] = [];
    for (const [category, subtypes] of Object.entries(ENTITY_COLOURS)) {
      for (const [subtype, { hex, label }] of Object.entries(subtypes)) {
        const key = `${category}:${subtype}`;
        result.push({
          key,
          category,
          subtype,
          label,
          hex,
          shape: getNodeShape(category, subtype),
          count: counts[key] ?? 0,
        });
      }
    }
    return result;
  }, []);

  // Group by category
  const grouped = useMemo(() => {
    const groups: Record<string, LegendEntry[]> = {};
    for (const entry of entries) {
      if (!groups[entry.category]) groups[entry.category] = [];
      groups[entry.category].push(entry);
    }
    return groups;
  }, [entries]);

  const categoryLabels: Record<string, string> = {
    official: 'Officials',
    department: 'Departments',
    body: 'Bodies',
    group: 'Groups',
  };

  return (
    <div className="absolute bottom-4 left-4 z-10 flex flex-col gap-1 rounded-lg border border-wh-border bg-wh-panel/95 p-3 backdrop-blur-sm" style={{ maxWidth: 260 }}>
      {/* Header with controls */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-wh-text-secondary/70">
          Legend
        </span>
        <div className="flex items-center gap-2">
          {hasActiveFilters && (
            <button
              onClick={onResetFilters}
              className="text-[10px] text-wh-accent-teal hover:underline"
            >
              Reset
            </button>
          )}
          <button
            onClick={onToggleFocusMode}
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
              focusMode
                ? 'bg-wh-accent-teal/15 text-wh-accent-teal'
                : 'bg-wh-border/40 text-wh-text-secondary/60 hover:text-wh-text-secondary'
            }`}
            title={focusMode ? 'Focus: hide non-matching' : 'Full: dim non-matching'}
          >
            {focusMode ? 'Focus' : 'Full'}
          </button>
        </div>
      </div>

      {/* Legend entries grouped by category */}
      {Object.entries(grouped).map(([category, items]) => (
        <div key={category}>
          <p className="mt-1 mb-0.5 text-[9px] font-semibold uppercase tracking-wider text-wh-text-secondary/50">
            {categoryLabels[category] ?? category}
          </p>
          {items.map((entry) => {
            const hidden = hiddenTypes.has(entry.key);
            return (
              <button
                key={entry.key}
                onClick={() => onToggleType(entry.key)}
                className={`flex w-full items-center gap-2 rounded px-1.5 py-0.5 text-left transition-opacity ${
                  hidden ? 'opacity-30' : 'opacity-100 hover:bg-wh-border/30'
                }`}
              >
                <ShapeIcon shape={entry.shape} colour={entry.hex} size={12} />
                <span className="flex-1 text-[11px] text-wh-text-primary">
                  {entry.label}
                </span>
                <span className="text-[9px] text-wh-text-secondary/40">
                  {entry.count}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/**
 * Renders an SVG icon mimicking a Cytoscape node shape.
 */
function ShapeIcon({
  shape,
  colour,
  size = 12,
}: {
  shape: CytoscapeShape;
  colour: string;
  size?: number;
}) {
  const half = size / 2;

  const shapePath = (() => {
    switch (shape) {
      case 'ellipse':
        return <circle cx={half} cy={half} r={half - 1} fill={colour} />;
      case 'rectangle':
        return <rect x={1} y={1} width={size - 2} height={size - 2} fill={colour} />;
      case 'roundrectangle':
        return <rect x={1} y={1} width={size - 2} height={size - 2} rx={2} fill={colour} />;
      case 'diamond':
        return (
          <polygon
            points={`${half},1 ${size - 1},${half} ${half},${size - 1} 1,${half}`}
            fill={colour}
          />
        );
      case 'rhomboid': {
        const offset = size * 0.2;
        return (
          <polygon
            points={`${offset + 1},1 ${size - 1},1 ${size - offset - 1},${size - 1} 1,${size - 1}`}
            fill={colour}
          />
        );
      }
      case 'hexagon': {
        const pts = Array.from({ length: 6 }, (_, i) => {
          const angle = (Math.PI / 3) * i - Math.PI / 2;
          return `${half + (half - 1) * Math.cos(angle)},${half + (half - 1) * Math.sin(angle)}`;
        }).join(' ');
        return <polygon points={pts} fill={colour} />;
      }
      case 'heptagon': {
        const pts = Array.from({ length: 7 }, (_, i) => {
          const angle = ((2 * Math.PI) / 7) * i - Math.PI / 2;
          return `${half + (half - 1) * Math.cos(angle)},${half + (half - 1) * Math.sin(angle)}`;
        }).join(' ');
        return <polygon points={pts} fill={colour} />;
      }
      case 'octagon': {
        const pts = Array.from({ length: 8 }, (_, i) => {
          const angle = ((2 * Math.PI) / 8) * i - Math.PI / 2;
          return `${half + (half - 1) * Math.cos(angle)},${half + (half - 1) * Math.sin(angle)}`;
        }).join(' ');
        return <polygon points={pts} fill={colour} />;
      }
      default:
        return <circle cx={half} cy={half} r={half - 1} fill={colour} />;
    }
  })();

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      {shapePath}
    </svg>
  );
}
