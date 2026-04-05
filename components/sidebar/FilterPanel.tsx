'use client';

import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { ENTITY_LIST } from '@/data/entities';
import { ENTITY_COLOURS, getEntityColour } from '@/data/colours';
import { TAGS } from '@/data/tags';
import { JURISDICTIONS } from '@/data/jurisdictions';
import { selectEntity } from '@/lib/panelStore';
import { getNodeShape } from '@/lib/graph/shapes';
import type { CytoscapeShape } from '@/lib/graph/shapes';
import type { FilterState } from './types';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface FilterPanelProps {
  filter: FilterState;
  onSearch: (q: string) => void;
  onToggleTag: (tagId: string) => void;
  onSetJurisdiction: (j: string | null) => void;
  onToggleType: (key: string) => void;
  onToggleFocusMode: () => void;
  onResetFilters: () => void;
  visibleCount: number;
  hasActiveFilters: boolean;
}

/* ------------------------------------------------------------------ */
/*  Legend entry type                                                   */
/* ------------------------------------------------------------------ */

interface LegendEntry {
  key: string;
  category: string;
  subtype: string;
  label: string;
  hex: string;
  shape: CytoscapeShape;
  count: number;
}

const CATEGORY_LABELS: Record<string, string> = {
  official: 'Officials',
  department: 'Departments',
  body: 'Bodies',
  group: 'Groups',
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function FilterPanel({
  filter,
  onSearch,
  onToggleTag,
  onSetJurisdiction,
  onToggleType,
  onToggleFocusMode,
  onResetFilters,
  visibleCount,
  hasActiveFilters,
}: FilterPanelProps) {
  // --- Sections ---
  const [openSections, setOpenSections] = useState<Set<string>>(() => new Set(['entities']));
  const toggle = useCallback((section: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }, []);

  // --- Collapsed (entire panel) ---
  const [collapsed, setCollapsed] = useState(false);

  // --- Tag data ---
  const typeTags = useMemo(() => Object.values(TAGS).filter((t) => t.tagCategory === 'type'), []);
  const sectorTags = useMemo(() => Object.values(TAGS).filter((t) => t.tagCategory === 'sector'), []);
  const tagCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const entity of ENTITY_LIST) {
      for (const tagId of entity.tags ?? []) {
        counts[tagId] = (counts[tagId] ?? 0) + 1;
      }
    }
    return counts;
  }, []);

  // --- Legend entries ---
  const legendGrouped = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const entity of ENTITY_LIST) {
      const key = `${entity.category}:${entity.subtype}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }

    const groups: Record<string, LegendEntry[]> = {};
    for (const [category, subtypes] of Object.entries(ENTITY_COLOURS)) {
      for (const [subtype, { hex, label }] of Object.entries(subtypes)) {
        const key = `${category}:${subtype}`;
        if (!groups[category]) groups[category] = [];
        groups[category].push({
          key, category, subtype, label, hex,
          shape: getNodeShape(category, subtype),
          count: counts[key] ?? 0,
        });
      }
    }
    return groups;
  }, []);

  // --- Filtered entity list ---
  const filteredEntities = useMemo(() => {
    const q = filter.search.toLowerCase();
    let list = ENTITY_LIST;
    if (q) {
      list = list.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.id.toLowerCase().includes(q) ||
          e.currentHolder?.toLowerCase().includes(q),
      );
    }
    if (filter.activeTags.size > 0) {
      list = list.filter((e) => (e.tags ?? []).some((t) => filter.activeTags.has(t)));
    }
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [filter.search, filter.activeTags]);

  // --- Dragging ---
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 16, y: 0 }); // default: bottom-left
  const [dragging, setDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const [hasDragged, setHasDragged] = useState(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (!(e.target as HTMLElement).closest('[data-drag-handle]')) return;
    e.preventDefault();
    const el = panelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging) return;
    const parent = panelRef.current?.parentElement;
    if (!parent) return;
    const parentRect = parent.getBoundingClientRect();
    const el = panelRef.current!;
    let newX = e.clientX - parentRect.left - dragOffset.current.x;
    let newY = e.clientY - parentRect.top - dragOffset.current.y;
    newX = Math.max(0, Math.min(newX, parentRect.width - el.offsetWidth));
    newY = Math.max(0, Math.min(newY, parentRect.height - el.offsetHeight));
    setPos({ x: newX, y: newY });
  }, [dragging]);

  const onPointerUp = useCallback(() => {
    setDragging(false);
  }, []);

  // Convert from bottom-left anchor to absolute on first drag
  useEffect(() => {
    if (dragging && !hasDragged) {
      const el = panelRef.current;
      const parent = el?.parentElement;
      if (el && parent) {
        const parentRect = parent.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        setPos({ x: elRect.left - parentRect.left, y: elRect.top - parentRect.top });
        setHasDragged(true);
      }
    }
  }, [dragging, hasDragged]);

  // --- Resizing ---
  const [size, setSize] = useState({ w: 280, h: 420 });
  const resizing = useRef(false);
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 });

  const onResizePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = true;
    resizeStart.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [size]);

  const onResizePointerMove = useCallback((e: React.PointerEvent) => {
    if (!resizing.current) return;
    const dx = e.clientX - resizeStart.current.x;
    const dy = e.clientY - resizeStart.current.y;
    setSize({
      w: Math.max(240, Math.min(480, resizeStart.current.w + dx)),
      h: Math.max(200, Math.min(700, resizeStart.current.h + dy)),
    });
  }, []);

  const onResizePointerUp = useCallback(() => {
    resizing.current = false;
  }, []);

  const style = hasDragged
    ? { left: pos.x, top: pos.y, width: size.w, height: collapsed ? undefined : size.h }
    : { left: 16, bottom: 16, width: size.w, height: collapsed ? undefined : size.h };

  return (
    <div
      ref={panelRef}
      className="absolute z-10 flex flex-col rounded-lg border border-wh-border bg-wh-panel/95 backdrop-blur-sm shadow-lg shadow-black/20 select-none overflow-hidden"
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* ---- Draggable header ---- */}
      <div
        data-drag-handle=""
        className={`flex shrink-0 items-center justify-between px-3 py-2 border-b border-wh-border/50 ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
      >
        <div className="flex items-center gap-2">
          <svg className="h-3 w-3 text-wh-text-secondary/30" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="4" cy="3" r="1.5" /><circle cx="12" cy="3" r="1.5" />
            <circle cx="4" cy="8" r="1.5" /><circle cx="12" cy="8" r="1.5" />
            <circle cx="4" cy="13" r="1.5" /><circle cx="12" cy="13" r="1.5" />
          </svg>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-wh-text-secondary/70">
            Filters
          </span>
          <span className="text-[10px] text-wh-text-secondary/40">
            {visibleCount}/{ENTITY_LIST.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {hasActiveFilters && (
            <button onClick={onResetFilters} className="text-[10px] text-wh-accent-teal hover:underline">
              Reset
            </button>
          )}
          <button
            onClick={onToggleFocusMode}
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
              filter.focusMode
                ? 'bg-wh-accent-teal/15 text-wh-accent-teal'
                : 'bg-wh-border/40 text-wh-text-secondary/60 hover:text-wh-text-secondary'
            }`}
            title={filter.focusMode ? 'Focus: hide non-matching' : 'Full: dim non-matching'}
          >
            {filter.focusMode ? 'Focus' : 'Full'}
          </button>
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="text-wh-text-secondary/40 hover:text-wh-text-secondary"
          >
            <svg
              className={`h-3 w-3 transition-transform ${collapsed ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
          </button>
        </div>
      </div>

      {/* ---- Collapsible body ---- */}
      {!collapsed && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* Search */}
          <div className="shrink-0 border-b border-wh-border/50 px-3 py-2">
            <div className="flex items-center gap-2 rounded-md border border-wh-border bg-wh-bg px-2.5 py-1.5">
              <svg className="h-3.5 w-3.5 shrink-0 text-wh-text-secondary/40" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
              <input
                type="text"
                value={filter.search}
                onChange={(e) => onSearch(e.target.value)}
                placeholder="Search entities..."
                className="w-full bg-transparent text-xs text-wh-text-primary placeholder:text-wh-text-secondary/40 outline-none"
              />
              {filter.search && (
                <button onClick={() => onSearch('')} className="text-wh-text-secondary/40 hover:text-wh-text-primary">
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Scrollable sections */}
          <div className="flex-1 overflow-y-auto">
            {/* Types (legend) */}
            <div className="border-b border-wh-border/50">
              <SectionHeader
                label="Types"
                badge={filter.hiddenTypes.size > 0 ? `${filter.hiddenTypes.size} hidden` : null}
                open={openSections.has('types')}
                onToggle={() => toggle('types')}
              />
              {openSections.has('types') && (
                <div className="px-3 pb-2">
                  {Object.entries(legendGrouped).map(([category, items]) => (
                    <div key={category}>
                      <p className="mt-1 mb-0.5 text-[9px] font-semibold uppercase tracking-wider text-wh-text-secondary/50">
                        {CATEGORY_LABELS[category] ?? category}
                      </p>
                      {items.map((entry) => {
                        const hidden = filter.hiddenTypes.has(entry.key);
                        return (
                          <button
                            key={entry.key}
                            onClick={() => onToggleType(entry.key)}
                            className={`flex w-full items-center gap-2 rounded px-1.5 py-0.5 text-left transition-opacity ${
                              hidden ? 'opacity-30' : 'opacity-100 hover:bg-wh-border/30'
                            }`}
                          >
                            <ShapeIcon shape={entry.shape} colour={entry.hex} size={12} />
                            <span className="flex-1 text-[11px] text-wh-text-primary">{entry.label}</span>
                            <span className="text-[9px] text-wh-text-secondary/40">{entry.count}</span>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Jurisdiction */}
            <div className="border-b border-wh-border/50">
              <SectionHeader
                label="Jurisdiction"
                badge={filter.jurisdiction ? JURISDICTIONS[filter.jurisdiction]?.shortLabel : null}
                open={openSections.has('jurisdiction')}
                onToggle={() => toggle('jurisdiction')}
              />
              {openSections.has('jurisdiction') && (
                <div className="flex flex-wrap gap-1 px-3 pb-2">
                  <Pill label="All" active={filter.jurisdiction === null} onClick={() => onSetJurisdiction(null)} />
                  {Object.entries(JURISDICTIONS).map(([key, j]) => (
                    <Pill
                      key={key}
                      label={j.shortLabel}
                      active={filter.jurisdiction === key}
                      onClick={() => onSetJurisdiction(filter.jurisdiction === key ? null : key)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Tags */}
            <div className="border-b border-wh-border/50">
              <SectionHeader
                label="Tags"
                badge={filter.activeTags.size > 0 ? String(filter.activeTags.size) : null}
                open={openSections.has('tags')}
                onToggle={() => toggle('tags')}
              />
              {openSections.has('tags') && (
                <div className="max-h-48 overflow-y-auto px-3 pb-2">
                  <p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-wh-text-secondary/50">Type</p>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {typeTags.map((tag) => (
                      <TagPill key={tag.id} tag={tag} count={tagCounts[tag.id] ?? 0} active={filter.activeTags.has(tag.id)} onClick={() => onToggleTag(tag.id)} />
                    ))}
                  </div>
                  <p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-wh-text-secondary/50">Sector</p>
                  <div className="flex flex-wrap gap-1">
                    {sectorTags.map((tag) => (
                      <TagPill key={tag.id} tag={tag} count={tagCounts[tag.id] ?? 0} active={filter.activeTags.has(tag.id)} onClick={() => onToggleTag(tag.id)} />
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Entity list */}
            <div>
              <SectionHeader
                label={`Entities (${filteredEntities.length})`}
                open={openSections.has('entities')}
                onToggle={() => toggle('entities')}
              />
              {openSections.has('entities') && (
                <div>
                  {filteredEntities.map((entity) => (
                    <button
                      key={entity.id}
                      type="button"
                      onClick={() => selectEntity(entity.id)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-wh-border/30"
                    >
                      <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: getEntityColour(entity.tags) }} />
                      <span className="truncate text-[11px] text-wh-text-primary">{entity.name}</span>
                      <span className="ml-auto shrink-0 text-[9px] capitalize text-wh-text-secondary/40">{entity.category}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Resize handle */}
          <div
            className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize"
            onPointerDown={onResizePointerDown}
            onPointerMove={onResizePointerMove}
            onPointerUp={onResizePointerUp}
          >
            <svg className="h-4 w-4 text-wh-text-secondary/20" viewBox="0 0 16 16" fill="currentColor">
              <path d="M14 14H10L14 10V14ZM14 14H12L14 12V14Z" />
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared sub-components                                              */
/* ------------------------------------------------------------------ */

function SectionHeader({
  label,
  badge,
  open,
  onToggle,
}: {
  label: string;
  badge?: string | null;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button onClick={onToggle} className="flex w-full items-center justify-between px-3 py-2 text-left">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-wh-text-secondary/70">
        {label}
        {badge && <span className="ml-1 text-wh-accent-teal">({badge})</span>}
      </span>
      <svg
        className={`h-3 w-3 text-wh-text-secondary/40 transition-transform ${open ? 'rotate-180' : ''}`}
        fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
      </svg>
    </button>
  );
}

function Pill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
        active
          ? 'bg-wh-accent-teal/15 text-wh-accent-teal'
          : 'bg-wh-border/40 text-wh-text-secondary/60 hover:bg-wh-border/70 hover:text-wh-text-secondary'
      }`}
    >
      {label}
    </button>
  );
}

function TagPill({
  tag,
  count,
  active,
  onClick,
}: {
  tag: { id: string; label: string; colour: string };
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] transition-colors ${
        active ? 'ring-1 ring-wh-accent-teal/50' : 'opacity-70 hover:opacity-100'
      }`}
      style={{
        backgroundColor: active ? `${tag.colour}25` : `${tag.colour}12`,
        color: tag.colour,
      }}
    >
      <span className="max-w-[100px] truncate">{tag.label}</span>
      <span className="opacity-50">{count}</span>
    </button>
  );
}

function ShapeIcon({ shape, colour, size = 12 }: { shape: CytoscapeShape; colour: string; size?: number }) {
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
        return <polygon points={`${half},1 ${size - 1},${half} ${half},${size - 1} 1,${half}`} fill={colour} />;
      case 'rhomboid': {
        const o = size * 0.2;
        return <polygon points={`${o + 1},1 ${size - 1},1 ${size - o - 1},${size - 1} 1,${size - 1}`} fill={colour} />;
      }
      case 'hexagon': {
        const pts = Array.from({ length: 6 }, (_, i) => {
          const a = (Math.PI / 3) * i - Math.PI / 2;
          return `${half + (half - 1) * Math.cos(a)},${half + (half - 1) * Math.sin(a)}`;
        }).join(' ');
        return <polygon points={pts} fill={colour} />;
      }
      case 'heptagon': {
        const pts = Array.from({ length: 7 }, (_, i) => {
          const a = ((2 * Math.PI) / 7) * i - Math.PI / 2;
          return `${half + (half - 1) * Math.cos(a)},${half + (half - 1) * Math.sin(a)}`;
        }).join(' ');
        return <polygon points={pts} fill={colour} />;
      }
      case 'octagon': {
        const pts = Array.from({ length: 8 }, (_, i) => {
          const a = ((2 * Math.PI) / 8) * i - Math.PI / 2;
          return `${half + (half - 1) * Math.cos(a)},${half + (half - 1) * Math.sin(a)}`;
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
