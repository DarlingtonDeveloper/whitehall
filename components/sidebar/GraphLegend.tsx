'use client';

import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
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
  key: string;
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
    const counts: Record<string, number> = {};
    for (const entity of ENTITY_LIST) {
      const key = `${entity.category}:${entity.subtype}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }

    const result: LegendEntry[] = [];
    for (const [category, subtypes] of Object.entries(ENTITY_COLOURS)) {
      for (const [subtype, { hex, label }] of Object.entries(subtypes)) {
        const key = `${category}:${subtype}`;
        result.push({ key, category, subtype, label, hex, shape: getNodeShape(category, subtype), count: counts[key] ?? 0 });
      }
    }
    return result;
  }, []);

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

  // --- Dragging ---
  const legendRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 16, y: -16 }); // x from left, y from bottom (negative = from bottom)
  const [dragging, setDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const [collapsed, setCollapsed] = useState(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // Only drag from the header bar
    if (!(e.target as HTMLElement).closest('[data-legend-handle]')) return;
    e.preventDefault();
    const el = legendRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging) return;
    const parent = legendRef.current?.parentElement;
    if (!parent) return;
    const parentRect = parent.getBoundingClientRect();
    const el = legendRef.current!;
    const elW = el.offsetWidth;
    const elH = el.offsetHeight;

    let newX = e.clientX - parentRect.left - dragOffset.current.x;
    let newY = e.clientY - parentRect.top - dragOffset.current.y;

    // Clamp within parent
    newX = Math.max(0, Math.min(newX, parentRect.width - elW));
    newY = Math.max(0, Math.min(newY, parentRect.height - elH));

    setPos({ x: newX, y: newY });
  }, [dragging]);

  const onPointerUp = useCallback(() => {
    setDragging(false);
  }, []);

  // Switch from bottom-anchored to absolute top/left once dragging starts
  const [hasDragged, setHasDragged] = useState(false);
  useEffect(() => {
    if (dragging && !hasDragged) {
      // Convert initial bottom-left position to top-left
      const el = legendRef.current;
      const parent = el?.parentElement;
      if (el && parent) {
        const parentRect = parent.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        setPos({
          x: elRect.left - parentRect.left,
          y: elRect.top - parentRect.top,
        });
        setHasDragged(true);
      }
    }
  }, [dragging, hasDragged]);

  const style = hasDragged
    ? { left: pos.x, top: pos.y, maxWidth: 260 }
    : { left: 16, bottom: 16, maxWidth: 260 };

  return (
    <div
      ref={legendRef}
      className="absolute z-10 flex flex-col rounded-lg border border-wh-border bg-wh-panel/95 backdrop-blur-sm select-none"
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* Draggable header */}
      <div
        data-legend-handle=""
        className={`flex items-center justify-between px-3 py-2 ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
      >
        <div className="flex items-center gap-2">
          {/* Grip icon */}
          <svg className="h-3 w-3 text-wh-text-secondary/30" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="4" cy="3" r="1.5" /><circle cx="12" cy="3" r="1.5" />
            <circle cx="4" cy="8" r="1.5" /><circle cx="12" cy="8" r="1.5" />
            <circle cx="4" cy="13" r="1.5" /><circle cx="12" cy="13" r="1.5" />
          </svg>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-wh-text-secondary/70">
            Legend
          </span>
        </div>
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
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="text-wh-text-secondary/40 hover:text-wh-text-secondary"
          >
            <svg
              className={`h-3 w-3 transition-transform ${collapsed ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
          </button>
        </div>
      </div>

      {/* Collapsible body */}
      {!collapsed && (
        <div className="px-3 pb-2">
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
      )}
    </div>
  );
}

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
