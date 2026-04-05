'use client';

import { useMemo } from 'react';
import { ENTITY_LIST } from '@/data/entities';
import PulseView from '@/components/graph/PulseView';
import PulseSidebar from '@/components/sidebar/PulseSidebar';
import GraphLegend from '@/components/sidebar/GraphLegend';
import FeedPanel from '@/components/feed/FeedPanel';
import { useGraphFilter } from '@/components/sidebar/useGraphFilter';

interface PulseContentProps {
  sidebarOpen: boolean;
  feedOpen: boolean;
  toggleSidebar: () => void;
}

export default function PulseContent({ sidebarOpen, feedOpen, toggleSidebar }: PulseContentProps) {
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

  const visibleCount = useMemo(() => {
    return ENTITY_LIST.filter((e) => graphFilter.isVisible(e)).length;
  }, [graphFilter]);

  const hasActiveFilters =
    filter.search !== '' ||
    filter.activeTags.size > 0 ||
    filter.jurisdiction !== null ||
    filter.hiddenTypes.size > 0;

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Sidebar */}
      {sidebarOpen && (
        <PulseSidebar
          filter={filter}
          onSearch={setSearch}
          onToggleTag={toggleTag}
          onSetJurisdiction={setJurisdiction}
          visibleCount={visibleCount}
          onCollapse={toggleSidebar}
        />
      )}

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

      {/* Feed panel */}
      {feedOpen && (
        <div className="flex w-80 shrink-0 flex-col border-l border-wh-border bg-wh-panel">
          <FeedPanel title="Activity Feed" />
        </div>
      )}
    </div>
  );
}
