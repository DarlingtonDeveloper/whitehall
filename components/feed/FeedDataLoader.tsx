/* eslint-disable react-hooks/purity -- Server component: Date.now() is intentionally called per-request */
/**
 * Server component — fetches initial feed data at request time
 * so the user sees content immediately instead of a loading skeleton.
 *
 * Client-side interactivity (filtering, sorting, search, date range changes)
 * layers on top via the FeedPanel client component.
 */

import { createClient } from '@supabase/supabase-js';
import type { FeedItem } from '@/types/feed';
import FeedPanel from './FeedPanel';

interface FeedDataLoaderProps {
  clientId?: string;
  entityId?: string;
  stakeholderIds?: string[];
}

export default async function FeedDataLoader({
  clientId,
  entityId,
  stakeholderIds,
}: FeedDataLoaderProps) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!,
  );

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  let items: FeedItem[] = [];

  if (entityId) {
    const { data } = await supabase
      .from('feed_items')
      .select('*')
      .contains('entity_ids', [entityId])
      .order('published_at', { ascending: false })
      .limit(100);
    items = (data as FeedItem[]) ?? [];
  } else if (stakeholderIds && stakeholderIds.length > 0) {
    const { data } = await supabase
      .from('feed_items')
      .select('*')
      .overlaps('entity_ids', stakeholderIds)
      .gte('published_at', sevenDaysAgo)
      .order('published_at', { ascending: false })
      .limit(200);
    items = (data as FeedItem[]) ?? [];
  } else {
    const { data } = await supabase
      .from('feed_items')
      .select('*')
      .gte('published_at', sevenDaysAgo)
      .order('published_at', { ascending: false })
      .limit(100);
    items = (data as FeedItem[]) ?? [];
  }

  return (
    <FeedPanel
      items={items}
      clientId={clientId}
      entityId={entityId}
    />
  );
}
