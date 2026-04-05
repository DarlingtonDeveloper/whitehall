'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import type { MonitoringTheme } from '@/types/client';

/* ------------------------------------------------------------------ */
/*  Storage shape — never deletes base keywords, only toggles them     */
/* ------------------------------------------------------------------ */

interface ClientOverrides {
  /** Keywords the user has disabled (across all fields) */
  disabledKeywords: string[];
  /** Keywords the user has added, keyed by field */
  addedKeywords: Record<string, string[]>;
  /** Theme keywords the user has disabled, keyed by theme ID */
  disabledThemeKeywords: Record<string, string[]>;
  /** Theme keywords the user has added, keyed by theme ID */
  addedThemeKeywords: Record<string, string[]>;
  /** Theme IDs the user has disabled entirely */
  disabledThemeIds: string[];
  /** Themes the user has created */
  addedThemes: MonitoringTheme[];
}

const EMPTY_OVERRIDES: ClientOverrides = {
  disabledKeywords: [],
  addedKeywords: {},
  disabledThemeKeywords: {},
  addedThemeKeywords: {},
  disabledThemeIds: [],
  addedThemes: [],
};

/* ------------------------------------------------------------------ */
/*  Public types                                                       */
/* ------------------------------------------------------------------ */

export type KeywordField =
  | 'policyKeywords'
  | 'industryKeywords'
  | 'competitors'
  | 'projects';

export interface KeywordEntry {
  value: string;
  enabled: boolean;
  isUserAdded: boolean;
}

export interface ThemeEntry {
  theme: MonitoringTheme;
  enabled: boolean;
  isUserAdded: boolean;
  keywords: KeywordEntry[];
}

export interface UseClientOverridesResult {
  /** All keywords per field, each with enabled/disabled state */
  keywordSections: Record<KeywordField, KeywordEntry[]>;
  /** All active (enabled) keyword strings for feed filtering */
  activeKeywords: string[];
  /** All themes with their keyword entries */
  themeEntries: ThemeEntry[];
  /** Toggle a keyword on/off */
  toggleKeyword: (value: string) => void;
  /** Add a new keyword to a field */
  addKeyword: (field: KeywordField, value: string) => void;
  /** Remove a user-added keyword (base keywords can only be toggled) */
  removeKeyword: (field: KeywordField, value: string) => void;
  /** Toggle a theme on/off */
  toggleTheme: (themeId: string) => void;
  /** Add a new theme */
  addTheme: () => void;
  /** Remove a user-added theme */
  removeTheme: (themeId: string) => void;
  /** Rename a theme */
  renameTheme: (themeId: string, name: string) => void;
  /** Toggle a theme keyword on/off */
  toggleThemeKeyword: (themeId: string, value: string) => void;
  /** Add a keyword to a theme */
  addThemeKeyword: (themeId: string, value: string) => void;
  /** Remove a user-added theme keyword */
  removeThemeKeyword: (themeId: string, value: string) => void;
}

/* ------------------------------------------------------------------ */
/*  localStorage helpers                                               */
/* ------------------------------------------------------------------ */

function storageKey(clientId: string) {
  return `wh-client-${clientId}`;
}

function readOverrides(clientId: string): ClientOverrides {
  if (typeof window === 'undefined') return { ...EMPTY_OVERRIDES };
  try {
    const raw = localStorage.getItem(storageKey(clientId));
    if (!raw) return { ...EMPTY_OVERRIDES };
    return { ...EMPTY_OVERRIDES, ...(JSON.parse(raw) as Partial<ClientOverrides>) };
  } catch {
    return { ...EMPTY_OVERRIDES };
  }
}

function writeOverrides(clientId: string, overrides: ClientOverrides) {
  try {
    localStorage.setItem(storageKey(clientId), JSON.stringify(overrides));
  } catch {
    /* storage full or unavailable */
  }
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useClientOverrides(
  clientId: string,
  base: {
    policyKeywords: string[];
    industryKeywords: string[];
    competitors: string[];
    projects: string[];
    monitoringThemes: MonitoringTheme[];
  },
): UseClientOverridesResult {
  const [ov, setOv] = useState<ClientOverrides>(() => readOverrides(clientId));

  useEffect(() => {
    setOv(readOverrides(clientId));
  }, [clientId]);

  const persist = useCallback(
    (next: ClientOverrides) => {
      setOv(next);
      writeOverrides(clientId, next);
    },
    [clientId],
  );

  /* -- Keyword sections -- */

  const keywordSections = useMemo(() => {
    const fields: KeywordField[] = ['policyKeywords', 'industryKeywords', 'competitors', 'projects'];
    const result = {} as Record<KeywordField, KeywordEntry[]>;

    for (const field of fields) {
      const baseKws = base[field];
      const addedKws = ov.addedKeywords[field] ?? [];
      const entries: KeywordEntry[] = [
        ...baseKws.map((value) => ({
          value,
          enabled: !ov.disabledKeywords.includes(value),
          isUserAdded: false,
        })),
        ...addedKws.map((value) => ({
          value,
          enabled: !ov.disabledKeywords.includes(value),
          isUserAdded: true,
        })),
      ];
      result[field] = entries;
    }

    return result;
  }, [base, ov]);

  const activeKeywords = useMemo(() => {
    const all: string[] = [];
    for (const entries of Object.values(keywordSections)) {
      for (const e of entries) {
        if (e.enabled) all.push(e.value);
      }
    }
    return all;
  }, [keywordSections]);

  /* -- Theme entries -- */

  const themeEntries = useMemo(() => {
    const allThemes = [...base.monitoringThemes, ...ov.addedThemes];
    return allThemes.map((theme) => {
      const isUserAdded = ov.addedThemes.some((t) => t.id === theme.id);
      const addedKws = ov.addedThemeKeywords[theme.id] ?? [];
      const disabledKws = ov.disabledThemeKeywords[theme.id] ?? [];

      const keywords: KeywordEntry[] = [
        ...theme.keywords.map((value) => ({
          value,
          enabled: !disabledKws.includes(value),
          isUserAdded: false,
        })),
        ...addedKws.map((value) => ({
          value,
          enabled: !disabledKws.includes(value),
          isUserAdded: true,
        })),
      ];

      return {
        theme,
        enabled: !ov.disabledThemeIds.includes(theme.id),
        isUserAdded,
        keywords,
      };
    });
  }, [base.monitoringThemes, ov]);

  /* -- Keyword actions -- */

  const toggleKeyword = useCallback(
    (value: string) => {
      const disabled = ov.disabledKeywords.includes(value)
        ? ov.disabledKeywords.filter((k) => k !== value)
        : [...ov.disabledKeywords, value];
      persist({ ...ov, disabledKeywords: disabled });
    },
    [ov, persist],
  );

  const addKeyword = useCallback(
    (field: KeywordField, value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return;
      const existing = [...(base[field] ?? []), ...(ov.addedKeywords[field] ?? [])];
      if (existing.includes(trimmed)) return;
      const added = { ...ov.addedKeywords, [field]: [...(ov.addedKeywords[field] ?? []), trimmed] };
      persist({ ...ov, addedKeywords: added });
    },
    [base, ov, persist],
  );

  const removeKeyword = useCallback(
    (field: KeywordField, value: string) => {
      const fieldAdded = ov.addedKeywords[field] ?? [];
      if (!fieldAdded.includes(value)) return; // can only remove user-added
      const added = { ...ov.addedKeywords, [field]: fieldAdded.filter((k) => k !== value) };
      persist({ ...ov, addedKeywords: added });
    },
    [ov, persist],
  );

  /* -- Theme actions -- */

  const toggleTheme = useCallback(
    (themeId: string) => {
      const disabled = ov.disabledThemeIds.includes(themeId)
        ? ov.disabledThemeIds.filter((id) => id !== themeId)
        : [...ov.disabledThemeIds, themeId];
      persist({ ...ov, disabledThemeIds: disabled });
    },
    [ov, persist],
  );

  const addTheme = useCallback(() => {
    const id = `theme-${Date.now()}`;
    const theme: MonitoringTheme = { id, name: '', entityIds: [], keywords: [] };
    persist({ ...ov, addedThemes: [...ov.addedThemes, theme] });
  }, [ov, persist]);

  const removeTheme = useCallback(
    (themeId: string) => {
      if (!ov.addedThemes.some((t) => t.id === themeId)) return; // can only remove user-added
      persist({ ...ov, addedThemes: ov.addedThemes.filter((t) => t.id !== themeId) });
    },
    [ov, persist],
  );

  const renameTheme = useCallback(
    (themeId: string, name: string) => {
      // Check if it's a user-added theme (update directly) or base theme (store override)
      if (ov.addedThemes.some((t) => t.id === themeId)) {
        persist({ ...ov, addedThemes: ov.addedThemes.map((t) => (t.id === themeId ? { ...t, name } : t)) });
      }
      // For base themes, renaming isn't supported (they come from config)
    },
    [ov, persist],
  );

  const toggleThemeKeyword = useCallback(
    (themeId: string, value: string) => {
      const disabled = ov.disabledThemeKeywords[themeId] ?? [];
      const next = disabled.includes(value)
        ? disabled.filter((k) => k !== value)
        : [...disabled, value];
      persist({ ...ov, disabledThemeKeywords: { ...ov.disabledThemeKeywords, [themeId]: next } });
    },
    [ov, persist],
  );

  const addThemeKeyword = useCallback(
    (themeId: string, value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return;
      const allThemes = [...base.monitoringThemes, ...ov.addedThemes];
      const theme = allThemes.find((t) => t.id === themeId);
      if (!theme) return;
      const existing = [...theme.keywords, ...(ov.addedThemeKeywords[themeId] ?? [])];
      if (existing.includes(trimmed)) return;
      const added = { ...ov.addedThemeKeywords, [themeId]: [...(ov.addedThemeKeywords[themeId] ?? []), trimmed] };
      persist({ ...ov, addedThemeKeywords: added });
    },
    [base.monitoringThemes, ov, persist],
  );

  const removeThemeKeyword = useCallback(
    (themeId: string, value: string) => {
      const fieldAdded = ov.addedThemeKeywords[themeId] ?? [];
      if (!fieldAdded.includes(value)) return;
      const added = { ...ov.addedThemeKeywords, [themeId]: fieldAdded.filter((k) => k !== value) };
      persist({ ...ov, addedThemeKeywords: added });
    },
    [ov, persist],
  );

  return {
    keywordSections,
    activeKeywords,
    themeEntries,
    toggleKeyword,
    addKeyword,
    removeKeyword,
    toggleTheme,
    addTheme,
    removeTheme,
    renameTheme,
    toggleThemeKeyword,
    addThemeKeyword,
    removeThemeKeyword,
  };
}
