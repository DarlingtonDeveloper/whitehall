'use client';

import { useCallback, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'wh-intel-unlocked';

/** Notify all hook instances when unlock state changes */
const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((fn) => fn());
}

function getSnapshot(): boolean {
  if (typeof window === 'undefined') return false;
  return sessionStorage.getItem(STORAGE_KEY) === '1';
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/**
 * Session-gated password hook. Returns [unlocked, tryUnlock].
 * All consumers share the same session state — unlocking in one
 * component immediately unlocks all others.
 */
export function useGate(): [boolean, (pw: string) => boolean] {
  const unlocked = useSyncExternalStore(subscribe, getSnapshot, () => false);

  const tryUnlock = useCallback((pw: string) => {
    if (pw === 'wa') {
      sessionStorage.setItem(STORAGE_KEY, '1');
      emit();
      return true;
    }
    return false;
  }, []);

  return [unlocked, tryUnlock];
}
