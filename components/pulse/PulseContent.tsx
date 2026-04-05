'use client';

import { useMemo, useState, useCallback } from 'react';
import { ENTITY_LIST } from '@/data/entities';
import PulseView from '@/components/graph/PulseView';
import PulseSidebar from '@/components/sidebar/PulseSidebar';
import GraphLegend from '@/components/sidebar/GraphLegend';
import FeedPanel from '@/components/feed/FeedPanel';
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

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [feedOpen, setFeedOpen] = useState(true);

  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), []);
  const toggleFeed = useCallback(() => setFeedOpen((v) => !v), []);

  const visibleCount = useMemo(() => {
    return ENTITY_LIST.filter((e) => graphFilter.isVisible(e)).length;
  }, [graphFilter]);

  const hasActiveFilters =
    filter.search !== '' ||
    filter.activeTags.size > 0 ||
    filter.jurisdiction !== null ||
    filter.hiddenTypes.size > 0;

  return (
    <div className="relative flex flex-1 overflow-hidden">
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

      {/* Graph area with legend overlay + panel toggle buttons */}
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

        {/* Panel toggle buttons — top-left for sidebar, top-right for feed */}
        {!sidebarOpen && (
          <button
            onClick={toggleSidebar}
            className="absolute left-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-md border border-wh-border bg-wh-panel/90 text-wh-text-secondary backdrop-blur-sm transition-colors hover:border-wh-accent-teal/50 hover:text-wh-accent-teal"
            aria-label="Open sidebar"
            title="Open sidebar"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
        )}
      </div>

      {/* Feed reopen button — outside graph div so it's always at the right edge */}
      {!feedOpen && (
        <button
          onClick={toggleFeed}
          className="absolute right-3 top-[calc(theme(spacing.16)+0.75rem)] z-20 flex h-8 w-8 items-center justify-center rounded-md border border-wh-border bg-wh-panel/90 text-wh-text-secondary backdrop-blur-sm transition-colors hover:border-wh-accent-teal/50 hover:text-wh-accent-teal"
          aria-label="Open feed"
          title="Open activity feed"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 0 1-2.25 2.25M16.5 7.5V18a2.25 2.25 0 0 0 2.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 0 0 2.25 2.25h13.5M6 7.5h3v3H6v-3Z" />
          </svg>
        </button>
      )}

      {/* Feed panel */}
      {feedOpen && (
        <div className="flex w-80 shrink-0 flex-col border-l border-wh-border bg-wh-panel">
          <div className="flex items-center justify-between border-b border-wh-border px-4 py-3">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-wh-text-secondary">
                Activity Feed
              </h2>
            </div>
            <button
              onClick={toggleFeed}
              className="text-wh-text-secondary/40 hover:text-wh-text-secondary"
              aria-label="Close feed"
              title="Close feed"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <FeedPanel title="" />
        </div>
      )}
    </div>
  );
}
