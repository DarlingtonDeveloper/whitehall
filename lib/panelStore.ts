/**
 * Simple reactive store for panel open/close state.
 * Both NavBar and PulseContent subscribe to this directly,
 * so there's no context/prop-drilling to go wrong.
 */

import { useSyncExternalStore } from 'react';

interface PanelState {
  sidebar: boolean;
  feed: boolean;
}

let state: PanelState = { sidebar: true, feed: true };
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

export function toggleSidebar() {
  state = { ...state, sidebar: !state.sidebar };
  emit();
}

export function toggleFeed() {
  state = { ...state, feed: !state.feed };
  emit();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function getSnapshot() {
  return state;
}

function getServerSnapshot() {
  return { sidebar: true, feed: true };
}

export function usePanelStore(): PanelState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
