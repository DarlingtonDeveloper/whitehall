'use client';

import { useMemo } from 'react';
import { ENTITY_LIST, getEntity } from '@/data/entities';
import { getEntityColour } from '@/data/colours';
import { getRelationships } from '@/data/relationships';
import PulseView from '@/components/graph/PulseView';
import FilterPanel from '@/components/sidebar/FilterPanel';
import IntelligencePanel from '@/components/intelligence/IntelligencePanel';
import EntityPanel from '@/components/entity/EntityPanel';
import { useGraphFilter } from '@/components/sidebar/useGraphFilter';
import { usePanelStore, clearEntity } from '@/lib/panelStore';

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

  // Resolve selected entity data for the entity panel
  const entityData = useMemo(() => {
    if (!panels.selectedEntityId) return null;
    const entity = getEntity(panels.selectedEntityId);
    if (!entity) return null;
    return {
      entity,
      colour: getEntityColour(entity.tags),
      relationships: getRelationships(entity.id),
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
        <div className="flex w-96 shrink-0 flex-col border-r border-wh-border bg-wh-panel">
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
          />
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
        <div className="flex w-80 shrink-0 flex-col border-l border-wh-border bg-wh-panel">
          <IntelligencePanel />
        </div>
      )}
    </div>
  );
}
