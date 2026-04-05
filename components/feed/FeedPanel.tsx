'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { supabase } from '@/lib/db';
import { getClientBySlug } from '@/data/clients';
import { usePanelStore } from '@/lib/panelStore';
import type { FeedItem } from '@/types/feed';
import FeedItemCard from './FeedItem';

interface FeedPanelProps {
  entityId?: string;
  clientId?: string;
  items?: FeedItem[];
}

type DateRange = '24h' | '7d' | '30d' | 'all';

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

export default function FeedPanel({
  entityId,
  clientId,
  items: propItems,
}: FeedPanelProps) {
  const { disabledSourceIds } = usePanelStore();
  const [items, setItems] = useState<FeedItem[]>(propItems ?? []);
  const [loading, setLoading] = useState(!propItems);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [dateRange, setDateRange] = useState<DateRange>('7d');

  // Compute active source IDs for client filtering (stakeholders minus disabled)
  const activeSourceIds = useMemo(() => {
    if (!clientId) return null;
    const clientConfig = getClientBySlug(clientId);
    if (!clientConfig) return null;
    const all = clientConfig.stakeholders.map((s) => s.entityId);
    if (disabledSourceIds.length === 0) return all;
    return all.filter((id) => !disabledSourceIds.includes(id));
  }, [clientId, disabledSourceIds]);

  useEffect(() => {
    if (propItems && propItems.length > 0) return;

    async function fetchItems() {
      setLoading(true);
      setError(null);

      try {
        let query = supabase
          .from('feed_items')
          .select('*')
          .order('published_at', { ascending: false })
          .limit(100);

        if (entityId) {
          query = query.contains('entity_ids', [entityId]);
        }

        if (clientId && activeSourceIds && activeSourceIds.length > 0) {
          query = supabase
            .from('feed_items')
            .select('*')
            .overlaps('entity_ids', activeSourceIds)
            .order('published_at', { ascending: false })
            .limit(200);
        } else if (clientId && activeSourceIds && activeSourceIds.length === 0) {
          // All sources disabled — show nothing
          setItems([]);
          setLoading(false);
          return;
        }

        const { data, error: dbError } = await query;

        if (dbError) {
          setError(dbError.message);
        } else if (data && data.length > 0) {
          setItems(data as FeedItem[]);
        } else {
          setItems([]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load feed');
      } finally {
        setLoading(false);
      }
    }

    fetchItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId, clientId, propItems, activeSourceIds]);

  // Client-side filtering by search + date
  const filtered = useMemo(() => {
    let list = items;

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

    return list;
  }, [items, search, dateRange]);

  const clearSearch = useCallback(() => setSearch(''), []);

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

        {/* Date range + count */}
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
          </div>
          <span className="text-[10px] text-wh-text-secondary/40">
            {loading ? '...' : `${filtered.length} items`}
          </span>
        </div>
      </div>

      {/* Scrollable feed list */}
      <div className="flex-1 overflow-y-auto">
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

        {filtered.map((item) => (
          <FeedItemCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}
