'use client';

import { useMemo } from 'react';
import { ENTITY_LIST, getEntity } from '@/data/entities';
import { getEntityColour } from '@/data/colours';
import { getRelationships } from '@/data/relationships';
import { getClientBySlug } from '@/data/clients';
import PulseView from '@/components/graph/PulseView';
import PulseSidebar from '@/components/sidebar/PulseSidebar';
import GraphLegend from '@/components/sidebar/GraphLegend';
import IntelligencePanel from '@/components/intelligence/IntelligencePanel';
import EntityPanel from '@/components/entity/EntityPanel';
import { useGraphFilter } from '@/components/sidebar/useGraphFilter';
import { usePanelStore, toggleSidebar, clearEntity } from '@/lib/panelStore';

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

  // When a client is selected, enhance the graph filter to highlight their stakeholders
  const clientConfig = useMemo(() => {
    if (!panels.selectedClientId) return null;
    return getClientBySlug(panels.selectedClientId) ?? null;
  }, [panels.selectedClientId]);

  const effectiveGraphFilter = useMemo(() => {
    if (!clientConfig) return graphFilter;

    const stakeholderIds = new Set(clientConfig.stakeholders.map((s) => s.entityId));

    return {
      ...graphFilter,
      isVisible: (entity: Parameters<typeof graphFilter.isVisible>[0]) => {
        // If the base filter already hides it, keep it hidden
        if (!graphFilter.isVisible(entity)) return false;
        // In client mode, only show stakeholder entities
        return stakeholderIds.has(entity.id);
      },
    };
  }, [graphFilter, clientConfig]);

  const visibleCount = useMemo(() => {
    return ENTITY_LIST.filter((e) => effectiveGraphFilter.isVisible(e)).length;
  }, [effectiveGraphFilter]);

  const hasActiveFilters =
    filter.search !== '' ||
    filter.activeTags.size > 0 ||
    filter.jurisdiction !== null ||
    filter.hiddenTypes.size > 0;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      {/* Left panel: Entity detail or Sidebar */}
      {entityData ? (
        <div className="flex w-96 shrink-0 flex-col border-r border-wh-border bg-wh-panel">
          {/* Close button */}
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
      ) : (
        panels.sidebar && (
          <PulseSidebar
            filter={filter}
            onSearch={setSearch}
            onToggleTag={toggleTag}
            onSetJurisdiction={setJurisdiction}
            visibleCount={visibleCount}
            onCollapse={toggleSidebar}
          />
        )
      )}

      {/* Graph area with legend overlay */}
      <div className="relative min-w-0 flex-1">
        <PulseView filter={effectiveGraphFilter} />
        <GraphLegend
          hiddenTypes={filter.hiddenTypes}
          onToggleType={toggleType}
          focusMode={filter.focusMode}
          onToggleFocusMode={toggleFocusMode}
          onResetFilters={resetFilters}
          hasActiveFilters={hasActiveFilters}
        />
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
