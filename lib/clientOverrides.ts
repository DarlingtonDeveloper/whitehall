'use client';

import { useState, useCallback, useEffect } from 'react';
import type { MonitoringTheme } from '@/types/client';

interface ClientOverrides {
  policyKeywords?: string[];
  industryKeywords?: string[];
  competitors?: string[];
  projects?: string[];
  monitoringThemes?: MonitoringTheme[];
}

interface KeywordSets {
  policyKeywords: string[];
  industryKeywords: string[];
  competitors: string[];
  projects: string[];
}

interface UseClientOverridesResult {
  keywords: KeywordSets;
  themes: MonitoringTheme[];
  updateKeywords: (field: keyof KeywordSets, next: string[]) => void;
  updateThemes: (next: MonitoringTheme[]) => void;
}

function storageKey(clientId: string) {
  return `wh-client-${clientId}`;
}

function readOverrides(clientId: string): ClientOverrides {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(storageKey(clientId));
    return raw ? (JSON.parse(raw) as ClientOverrides) : {};
  } catch {
    return {};
  }
}

function writeOverrides(clientId: string, overrides: ClientOverrides) {
  try {
    localStorage.setItem(storageKey(clientId), JSON.stringify(overrides));
  } catch {
    /* storage full or unavailable */
  }
}

/**
 * Manages per-client keyword and monitoring-theme overrides,
 * persisted to localStorage. Base values come from the ClientConfig;
 * any localStorage overrides replace (not merge) the base arrays.
 */
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
  const [overrides, setOverrides] = useState<ClientOverrides>(() =>
    readOverrides(clientId),
  );

  // Re-read when clientId changes
  useEffect(() => {
    setOverrides(readOverrides(clientId));
  }, [clientId]);

  const persist = useCallback(
    (next: ClientOverrides) => {
      setOverrides(next);
      writeOverrides(clientId, next);
    },
    [clientId],
  );

  const keywords: KeywordSets = {
    policyKeywords: overrides.policyKeywords ?? base.policyKeywords,
    industryKeywords: overrides.industryKeywords ?? base.industryKeywords,
    competitors: overrides.competitors ?? base.competitors,
    projects: overrides.projects ?? base.projects,
  };

  const themes: MonitoringTheme[] =
    overrides.monitoringThemes ?? base.monitoringThemes;

  const updateKeywords = useCallback(
    (field: keyof KeywordSets, next: string[]) => {
      const updated = { ...overrides, [field]: next };
      persist(updated);
    },
    [overrides, persist],
  );

  const updateThemes = useCallback(
    (next: MonitoringTheme[]) => {
      const updated = { ...overrides, monitoringThemes: next };
      persist(updated);
    },
    [overrides, persist],
  );

  return { keywords, themes, updateKeywords, updateThemes };
}
