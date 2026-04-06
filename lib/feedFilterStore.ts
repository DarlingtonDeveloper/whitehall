/**
 * Reactive store for feed filters dispatched from health metric cards.
 * The client panel sets a filter; the feed panel subscribes and applies it.
 */

import { useSyncExternalStore } from 'react';

export interface FeedFilter {
  label: string;
  sourceType?: string;
  titleContains?: string;
  /** Exact date window in days used by the dashboard count query.
   *  When set, the feed re-queries Supabase with this cutoff
   *  instead of relying on client-side filtering. */
  queryDateDays?: number;
}

let activeFeedFilter: FeedFilter | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

export function setFeedFilter(filter: FeedFilter | null) {
  activeFeedFilter = filter;
  emit();
}

export function getFeedFilter(): FeedFilter | null {
  return activeFeedFilter;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function getSnapshot() {
  return activeFeedFilter;
}

function getServerSnapshot(): FeedFilter | null {
  return null;
}

export function useFeedFilter(): FeedFilter | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
