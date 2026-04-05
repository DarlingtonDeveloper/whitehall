import { useState, useMemo, useCallback } from 'react';
import type { Entity } from '@/types/entity';
import { matchesJurisdiction } from '@/data/jurisdictions';
import type { FilterState, GraphFilter } from './types';
import { DEFAULT_FILTER } from './types';

export function useGraphFilter() {
  const [filter, setFilter] = useState<FilterState>(DEFAULT_FILTER);

  const setSearch = useCallback((search: string) => {
    setFilter((prev) => ({ ...prev, search }));
  }, []);

  const toggleTag = useCallback((tagId: string) => {
    setFilter((prev) => {
      const next = new Set(prev.activeTags);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return { ...prev, activeTags: next };
    });
  }, []);

  const setJurisdiction = useCallback((jurisdiction: string | null) => {
    setFilter((prev) => ({ ...prev, jurisdiction }));
  }, []);

  const toggleType = useCallback((key: string) => {
    setFilter((prev) => {
      const next = new Set(prev.hiddenTypes);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...prev, hiddenTypes: next };
    });
  }, []);

  const toggleFocusMode = useCallback(() => {
    setFilter((prev) => ({ ...prev, focusMode: !prev.focusMode }));
  }, []);

  const resetFilters = useCallback(() => {
    setFilter(DEFAULT_FILTER);
  }, []);

  const graphFilter: GraphFilter = useMemo(() => {
    const q = filter.search.toLowerCase();

    return {
      focusMode: filter.focusMode,
      isVisible: (entity: Entity) => {
        // Search filter
        if (q) {
          const nameMatch = entity.name.toLowerCase().includes(q);
          const idMatch = entity.id.toLowerCase().includes(q);
          const holderMatch = entity.currentHolder?.toLowerCase().includes(q);
          if (!nameMatch && !idMatch && !holderMatch) return false;
        }

        // Tag filter
        if (filter.activeTags.size > 0) {
          const entityTags = entity.tags ?? [];
          const hasMatchingTag = entityTags.some((t) => filter.activeTags.has(t));
          if (!hasMatchingTag) return false;
        }

        // Jurisdiction filter
        if (filter.jurisdiction) {
          if (!matchesJurisdiction(entity.jurisdictions, filter.jurisdiction)) return false;
        }

        // Category/subtype visibility (legend toggle)
        const typeKey = `${entity.category}:${entity.subtype}`;
        if (filter.hiddenTypes.has(typeKey)) return false;

        return true;
      },
    };
  }, [filter]);

  return {
    filter,
    graphFilter,
    setSearch,
    toggleTag,
    setJurisdiction,
    toggleType,
    toggleFocusMode,
    resetFilters,
  };
}
