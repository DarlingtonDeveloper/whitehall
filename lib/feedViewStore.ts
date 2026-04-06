/**
 * Exposes feed panel view state for the chat system prompt.
 *
 * FeedPanel writes state here on each render; the chat reads it
 * imperatively when composing a request. Not reactive — no need
 * to re-render when feed state changes, we just snapshot it.
 */

export interface FeedViewState {
  dateRange: string;
  sortMode: string;
  searchText: string;
  visibleItems: Array<{ id: string; title: string; source_type: string }>;
  lastClickedItem: {
    id: string;
    title: string;
    source_type: string;
    published_at: string;
  } | null;
}

let current: FeedViewState = {
  dateRange: '7d',
  sortMode: 'recent',
  searchText: '',
  visibleItems: [],
  lastClickedItem: null,
};

export function setFeedViewState(partial: Partial<FeedViewState>) {
  current = { ...current, ...partial };
}

export function getFeedViewState(): FeedViewState {
  return current;
}
