'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/db';
import type { FeedItem } from '@/types/feed';
import FeedItemCard from './FeedItem';

interface FeedPanelProps {
  title?: string;
  entityId?: string;
  entityName?: string;
  clientId?: string;
  items?: FeedItem[];
}

export default function FeedPanel({
  title = 'Activity Feed',
  entityId,
  clientId,
  items: propItems,
}: FeedPanelProps) {
  const [items, setItems] = useState<FeedItem[]>(propItems ?? []);
  const [loading, setLoading] = useState(!propItems);
  const [error, setError] = useState<string | null>(null);

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
          .limit(50);

        if (entityId) {
          query = query.contains('entity_ids', [entityId]);
        }

        if (clientId) {
          // Get items that have client_feed_scores for this client
          const { data: scores } = await supabase
            .from('client_feed_scores')
            .select('feed_item_id')
            .eq('client_id', clientId)
            .gt('relevance_score', 0)
            .order('relevance_score', { ascending: false })
            .limit(50);

          if (scores && scores.length > 0) {
            const feedIds = scores.map((s) => s.feed_item_id);
            query = supabase
              .from('feed_items')
              .select('*')
              .in('id', feedIds)
              .order('published_at', { ascending: false });
          }
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
  }, [entityId, clientId, propItems]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-wh-border px-4 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-wh-text-secondary">
          {title}
        </h2>
        <p className="mt-0.5 text-[10px] text-wh-text-secondary/50">
          {loading ? 'Loading...' : `${items.length} items`}
        </p>
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
          <div className="p-4 text-xs text-red-400">
            {error}
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <div className="p-4 text-xs text-wh-text-secondary/50">
            No feed items yet. Run a scan or wait for background collection.
          </div>
        )}

        {items.map((item) => (
          <FeedItemCard key={item.id} item={item} />
        ))}
      </div>

      {/* Chat input stub */}
      <div className="shrink-0 border-t border-wh-border p-3">
        <div className="flex items-center gap-2 rounded-lg border border-wh-border bg-wh-bg px-3 py-2">
          <svg
            className="h-3.5 w-3.5 shrink-0 text-wh-text-secondary/40"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z"
            />
          </svg>
          <span className="text-[11px] text-wh-text-secondary/40">
            Ask about this entity...
          </span>
        </div>
      </div>
    </div>
  );
}
