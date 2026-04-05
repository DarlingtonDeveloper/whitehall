'use client';

import { useMemo } from 'react';
import { ENTITY_LIST } from '@/data/entities';
import PulseView from '@/components/graph/PulseView';
import PulseSidebar from '@/components/sidebar/PulseSidebar';
import GraphLegend from '@/components/sidebar/GraphLegend';
import { useGraphFilter } from '@/components/sidebar/useGraphFilter';

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

  // Count visible entities
  const visibleCount = useMemo(() => {
    return ENTITY_LIST.filter((e) => graphFilter.isVisible(e)).length;
  }, [graphFilter]);

  const hasActiveFilters =
    filter.search !== '' ||
    filter.activeTags.size > 0 ||
    filter.jurisdiction !== null ||
    filter.hiddenTypes.size > 0;

  return (
    <>
      {/* Sidebar */}
      <PulseSidebar
        filter={filter}
        onSearch={setSearch}
        onToggleTag={toggleTag}
        onSetJurisdiction={setJurisdiction}
        visibleCount={visibleCount}
      />

      {/* Graph area with legend overlay */}
      <div className="relative flex-1">
        <PulseView filter={graphFilter} />
        <GraphLegend
          hiddenTypes={filter.hiddenTypes}
          onToggleType={toggleType}
          focusMode={filter.focusMode}
          onToggleFocusMode={toggleFocusMode}
          onResetFilters={resetFilters}
          hasActiveFilters={hasActiveFilters}
        />
      </div>
    </>
  );
}
