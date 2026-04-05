import type { Entity } from '@/types/entity';

/**
 * Encapsulates all filter state for the pulse graph.
 * Both the sidebar and legend manipulate this, and the graph reads it.
 */
export interface FilterState {
  /** Text search query */
  search: string;
  /** Active tag IDs (empty = all pass) */
  activeTags: Set<string>;
  /** Active jurisdiction filter (null = all pass) */
  jurisdiction: string | null;
  /** Hidden category+subtype combos, keyed as "category:subtype" */
  hiddenTypes: Set<string>;
  /** Focus mode: true = hide filtered-out nodes, false = dim them */
  focusMode: boolean;
}

/**
 * Interface passed to PulseView so it can determine visibility.
 */
export interface GraphFilter {
  isVisible: (entity: Entity) => boolean;
  focusMode: boolean;
}

export const DEFAULT_FILTER: FilterState = {
  search: '',
  activeTags: new Set(),
  jurisdiction: null,
  hiddenTypes: new Set(),
  focusMode: false,
};
