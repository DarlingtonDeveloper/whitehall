'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { supabase } from '@/lib/db';
import { getClientBySlug } from '@/data/clients';
import { usePanelStore, openIntelligence } from '@/lib/panelStore';
import { useClientOverrides } from '@/lib/clientOverrides';
import { computeFeedRelevance } from '@/lib/feed/scoring';
import { useFeedFilter, setFeedFilter } from '@/lib/feedFilterStore';
import { setFeedViewState } from '@/lib/feedViewStore';
import { dispatchChatAction } from '@/lib/chatActions';
import type { FeedItem } from '@/types/feed';
import FeedItemCard from './FeedItem';

interface FeedPanelProps {
  entityId?: string;
  clientId?: string;
  items?: FeedItem[];
}

type DateRange = '24h' | '7d' | '30d' | 'all';
type SortMode = 'recent' | 'relevance';

const DATE_OPTIONS: { value: DateRange; label: string }[] = [
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: 'all', label: 'All' },
];

function getDateCutoff(range: DateRange): string | null {
  if (range === 'all') return null;
  const ms: Record<string, number> = {
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
  };
  return new Date(Date.now() - ms[range]).toISOString();
}

function formatDateShort(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
}

export default function FeedPanel({
  entityId,
  clientId,
  items: propItems,
}: FeedPanelProps) {
  const { disabledSourceIds } = usePanelStore();
  const feedFilter = useFeedFilter();
  const [items, setItems] = useState<FeedItem[]>(propItems ?? []);
  const [loading, setLoading] = useState(!propItems);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [dateRange, setDateRange] = useState<DateRange>('7d');
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const [lastClickedItem, setLastClickedItem] = useState<FeedItem | null>(null);

  // Get active keywords for client-based keyword filtering
  const clientConfig = clientId ? getClientBySlug(clientId) : null;
  const baseConfig = useMemo(
    () => ({
      policyKeywords: clientConfig?.policyKeywords ?? [],
      industryKeywords: clientConfig?.industryKeywords ?? [],
      competitors: clientConfig?.competitors ?? [],
      projects: clientConfig?.projects ?? [],
      monitoringThemes: clientConfig?.monitoringThemes ?? [],
    }),
    [clientConfig],
  );
  const { activeKeywords } = useClientOverrides(clientId ?? '__none__', baseConfig);

  // Compute active source IDs for client filtering (stakeholders minus disabled)
  const activeSourceIds = useMemo(() => {
    if (!clientConfig) return null;
    const all = clientConfig.stakeholders.map((s) => s.entityId);
    if (disabledSourceIds.length === 0) return all;
    return all.filter((id) => !disabledSourceIds.includes(id));
  }, [clientConfig, disabledSourceIds]);

  // Stable serialised keys so the effect only re-runs when values actually change
  const activeKeywordsKey = useMemo(() => activeKeywords.join('\0'), [activeKeywords]);
  const activeSourceIdsKey = useMemo(
    () => (activeSourceIds ? activeSourceIds.join('\0') : ''),
    [activeSourceIds],
  );

  useEffect(() => {
    if (propItems && propItems.length > 0) return;

    async function fetchItems() {
      setLoading(true);
      setError(null);

      try {
        // --- Entity-based query ---
        if (entityId) {
          const { data, error: dbError } = await supabase
            .from('feed_items')
            .select('*')
            .contains('entity_ids', [entityId])
            .order('published_at', { ascending: false })
            .limit(100);

          if (dbError) {
            setError(dbError.message);
          } else {
            setItems((data as FeedItem[]) ?? []);
          }
          setLoading(false);
          return;
        }

        // --- Client-based: entity IDs + keyword matching ---
        if (clientId && activeSourceIds) {
          const seen = new Map<string, FeedItem>();

          // 1. Fetch by stakeholder entity IDs
          if (activeSourceIds.length > 0) {
            const { data } = await supabase
              .from('feed_items')
              .select('*')
              .overlaps('entity_ids', activeSourceIds)
              .order('published_at', { ascending: false })
              .limit(200);
            for (const item of (data ?? []) as FeedItem[]) {
              seen.set(item.id, item);
            }
          }

          // 2. Fetch by keyword matches (search title/body)
          const kwsToSearch = activeKeywords.slice(0, 30);
          if (kwsToSearch.length > 0) {
            const orConditions = kwsToSearch
              .map((kw) => {
                const escaped = kw.replace(/[%_]/g, '\\$&');
                return `title.ilike.%${escaped}%`;
              })
              .join(',');

            const { data } = await supabase
              .from('feed_items')
              .select('*')
              .or(orConditions)
              .order('published_at', { ascending: false })
              .limit(100);
            for (const item of (data ?? []) as FeedItem[]) {
              if (!seen.has(item.id)) seen.set(item.id, item);
            }
          }

          // Merge and sort by date
          const merged = Array.from(seen.values()).sort(
            (a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime(),
          );
          setItems(merged);
          setLoading(false);
          return;
        }

        // --- Default: no filters ---
        const { data, error: dbError } = await supabase
          .from('feed_items')
          .select('*')
          .order('published_at', { ascending: false })
          .limit(100);

        if (dbError) {
          setError(dbError.message);
        } else {
          setItems((data as FeedItem[]) ?? []);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load feed');
      } finally {
        setLoading(false);
      }
    }

    fetchItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId, clientId, propItems, activeSourceIdsKey, activeKeywordsKey]);

  // Client-side filtering by search + date + metric filter, then sort
  const filtered = useMemo(() => {
    let list = items;

    // Apply metric filter from health dashboard
    if (feedFilter) {
      if (feedFilter.sourceType) {
        list = list.filter((item) => item.source_type === feedFilter.sourceType);
      }
      if (feedFilter.titleContains) {
        const term = feedFilter.titleContains.toLowerCase();
        list = list.filter((item) => item.title.toLowerCase().includes(term));
      }
      if (feedFilter.dateRange) {
        const metricCutoff = getDateCutoff(feedFilter.dateRange as DateRange);
        if (metricCutoff) {
          list = list.filter((item) => item.published_at >= metricCutoff);
        }
      }
    }

    const cutoff = getDateCutoff(dateRange);
    if (cutoff) {
      list = list.filter((item) => item.published_at >= cutoff);
    }

    const q = search.toLowerCase().trim();
    if (q) {
      list = list.filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          item.source_name.toLowerCase().includes(q) ||
          item.entity_ids.some((id) => id.toLowerCase().includes(q)),
      );
    }

    // Sort by relevance score when a client is selected and relevance mode is active
    if (sortMode === 'relevance' && clientConfig) {
      list = [...list].sort(
        (a, b) =>
          computeFeedRelevance(b, clientConfig) -
          computeFeedRelevance(a, clientConfig),
      );
    }

    return list;
  }, [items, search, dateRange, sortMode, clientConfig, feedFilter]);

  // Compute relevance scores for each filtered item (when client is selected)
  const scoredItems = useMemo(() => {
    if (!clientConfig) return filtered.map((item) => ({ item, score: undefined as number | undefined }));
    return filtered.map((item) => ({
      item,
      score: computeFeedRelevance(item, clientConfig),
    }));
  }, [filtered, clientConfig]);

  // Publish view state for the chat system prompt
  useEffect(() => {
    setFeedViewState({
      dateRange,
      sortMode,
      searchText: search || '',
      visibleItems: filtered.slice(0, 20).map((item) => ({
        id: item.id,
        title: item.title,
        source_type: item.source_type,
      })),
      lastClickedItem: lastClickedItem
        ? {
            id: lastClickedItem.id,
            title: lastClickedItem.title,
            source_type: lastClickedItem.source_type,
            published_at: lastClickedItem.published_at,
          }
        : null,
    });
  }, [dateRange, sortMode, search, filtered, lastClickedItem]);

  const clearSearch = useCallback(() => setSearch(''), []);

  // "Why relevant?" handler — opens chat with pre-formed question
  const handleAskRelevance = useCallback(
    (item: FeedItem) => {
      if (!clientConfig) return;
      setLastClickedItem(item);
      openIntelligence();
      dispatchChatAction({
        message: `Why is this relevant to ${clientConfig.name} and what should we do about it?\n\n"${item.title}" (${item.source_name}, ${formatDateShort(item.published_at)})`,
      });
    },
    [clientConfig],
  );

  return (
    <div className="flex h-full flex-col">
      {/* Search + date filter bar */}
      <div className="shrink-0 space-y-2 border-b border-wh-border px-3 py-2.5">
        {/* Search */}
        <div className="flex items-center gap-2 rounded-md border border-wh-border bg-wh-bg px-2.5 py-1.5">
          <svg className="h-3.5 w-3.5 shrink-0 text-wh-text-secondary/40" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search feed..."
            className="w-full bg-transparent text-xs text-wh-text-primary placeholder:text-wh-text-secondary/40 outline-none"
          />
          {search && (
            <button onClick={clearSearch} className="text-wh-text-secondary/40 hover:text-wh-text-primary">
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Date range + sort toggle + count */}
        <div className="flex items-center justify-between">
          <div className="flex gap-0.5">
            {DATE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setDateRange(opt.value)}
                className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
                  dateRange === opt.value
                    ? 'bg-wh-accent-teal/15 text-wh-accent-teal'
                    : 'text-wh-text-secondary/60 hover:text-wh-text-secondary hover:bg-wh-border/40'
                }`}
              >
                {opt.label}
              </button>
            ))}
            {clientConfig && (
              <>
                <span className="mx-1 text-wh-border">|</span>
                {(['recent', 'relevance'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setSortMode(mode)}
                    className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
                      sortMode === mode
                        ? 'bg-wh-accent-teal/15 text-wh-accent-teal'
                        : 'text-wh-text-secondary/60 hover:text-wh-text-secondary hover:bg-wh-border/40'
                    }`}
                  >
                    {mode === 'recent' ? 'Recent' : 'Relevant'}
                  </button>
                ))}
              </>
            )}
          </div>
          <span className="text-[10px] text-wh-text-secondary/40">
            {loading ? '...' : `${filtered.length} items`}
          </span>
        </div>
      </div>

      {/* Active metric filter chip */}
      {feedFilter && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 mx-2 mt-2 rounded-lg
                        bg-wh-accent-teal/10 text-xs text-wh-accent-teal">
          <span>Filtered: {feedFilter.label}</span>
          <button
            type="button"
            onClick={() => setFeedFilter(null)}
            className="ml-auto hover:text-wh-text-primary transition-colors"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Scrollable feed list */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        {loading && (
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="h-2 w-16 rounded bg-wh-border/60" />
                <div className="mt-2 h-3 w-full rounded bg-wh-border/40" />
                <div className="mt-1 h-3 w-3/4 rounded bg-wh-border/30" />
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="p-4 text-xs text-red-400">{error}</div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="p-4 text-xs text-wh-text-secondary/50">
            {items.length === 0
              ? 'No feed items yet.'
              : 'No items match your filters.'}
          </div>
        )}

        {scoredItems.map(({ item, score }) => (
          <FeedItemCard
            key={item.id}
            item={item}
            relevanceScore={score}
            showScore={sortMode === 'relevance'}
            clientName={clientConfig?.name}
            onAskRelevance={clientConfig ? handleAskRelevance : undefined}
          />
        ))}
      </div>
    </div>
  );
}
