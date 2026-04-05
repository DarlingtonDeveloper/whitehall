'use client';

import { useMemo, useState, useCallback, useRef } from 'react';
import { ENTITY_LIST, getEntity } from '@/data/entities';
import { getEntityColour } from '@/data/colours';
import { getRelationships } from '@/data/relationships';
import { getPowers } from '@/data/powers';
import { getBudget } from '@/data/budgets';
import { getStaff } from '@/data/staff';
import PulseView from '@/components/graph/PulseView';
import FilterPanel from '@/components/sidebar/FilterPanel';
import IntelligencePanel from '@/components/intelligence/IntelligencePanel';
import EntityPanel from '@/components/entity/EntityPanel';
import { useGraphFilter } from '@/components/sidebar/useGraphFilter';
import { usePanelStore, clearEntity } from '@/lib/panelStore';

/* ------------------------------------------------------------------ */
/*  Resize handle                                                      */
/* ------------------------------------------------------------------ */

function ResizeHandle({
  side,
  onResize,
}: {
  side: 'right' | 'left';
  onResize: (delta: number) => void;
}) {
  const dragging = useRef(false);
  const lastX = useRef(0);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    lastX.current = e.clientX;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      const dx = e.clientX - lastX.current;
      lastX.current = e.clientX;
      // For the left panel's right edge, positive dx = wider
      // For the right panel's left edge, positive dx = narrower (invert)
      onResize(side === 'right' ? dx : -dx);
    },
    [onResize, side],
  );

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  return (
    <div
      className={`group absolute top-0 ${side === 'right' ? 'right-0' : 'left-0'} z-10 flex h-full w-1.5 cursor-col-resize items-center justify-center`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div className="h-8 w-1 rounded-full bg-wh-border/40 transition-colors group-hover:bg-wh-accent-teal/50 group-active:bg-wh-accent-teal" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function PulseContent() {
  const {
    filter,
    graphFilter,
    setSearch,
    toggleTag,
    setJurisdiction,
    toggleType,
    toggleFocusMode,
    resetFilters,
  } = useGraphFilter();

  const panels = usePanelStore();

  // Panel widths (px)
  const [leftWidth, setLeftWidth] = useState(384);
  const [rightWidth, setRightWidth] = useState(320);

  const handleLeftResize = useCallback((delta: number) => {
    setLeftWidth((w) => Math.max(280, Math.min(600, w + delta)));
  }, []);

  const handleRightResize = useCallback((delta: number) => {
    setRightWidth((w) => Math.max(260, Math.min(500, w + delta)));
  }, []);

  // Resolve selected entity data for the entity panel (including powers, budget, staff)
  const entityData = useMemo(() => {
    if (!panels.selectedEntityId) return null;
    const entity = getEntity(panels.selectedEntityId);
    if (!entity) return null;
    return {
      entity,
      colour: getEntityColour(entity.tags),
      relationships: getRelationships(entity.id),
      powers: getPowers(entity.id),
      budget: getBudget(entity.id),
      staff: getStaff(entity.id),
    };
  }, [panels.selectedEntityId]);

  const visibleCount = useMemo(() => {
    return ENTITY_LIST.filter((e) => graphFilter.isVisible(e)).length;
  }, [graphFilter]);

  const hasActiveFilters =
    filter.search !== '' ||
    filter.activeTags.size > 0 ||
    filter.jurisdiction !== null ||
    filter.hiddenTypes.size > 0;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      {/* Left panel: Entity detail (when selected and toggled on) */}
      {entityData && panels.entityPanel && (
        <div
          className="relative flex shrink-0 flex-col border-r border-wh-border bg-wh-panel"
          style={{ width: leftWidth }}
        >
          <div className="flex shrink-0 items-center justify-end border-b border-wh-border px-3 py-1.5">
            <button
              type="button"
              onClick={clearEntity}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-wh-text-secondary transition-colors hover:bg-wh-border/50 hover:text-wh-text-primary"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
              Close
            </button>
          </div>
          <EntityPanel
            entity={entityData.entity}
            colour={entityData.colour}
            relationships={entityData.relationships}
            powers={entityData.powers}
            budget={entityData.budget}
            staff={entityData.staff}
          />
          <ResizeHandle side="right" onResize={handleLeftResize} />
        </div>
      )}

      {/* Graph area with floating filter panel */}
      <div className="relative min-w-0 flex-1">
        <PulseView filter={graphFilter} />
        {panels.legend && (
          <FilterPanel
            filter={filter}
            onSearch={setSearch}
            onToggleTag={toggleTag}
            onSetJurisdiction={setJurisdiction}
            onToggleType={toggleType}
            onToggleFocusMode={toggleFocusMode}
            onResetFilters={resetFilters}
            visibleCount={visibleCount}
            hasActiveFilters={hasActiveFilters}
          />
        )}
      </div>

      {/* Intelligence panel (feed + chat) */}
      {panels.intelligence && (
        <div
          className="relative flex shrink-0 flex-col border-l border-wh-border bg-wh-panel"
          style={{ width: rightWidth }}
        >
          <ResizeHandle side="left" onResize={handleRightResize} />
          <IntelligencePanel />
        </div>
      )}
    </div>
  );
}
