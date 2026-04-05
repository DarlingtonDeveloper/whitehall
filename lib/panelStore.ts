/**
 * Simple reactive store for panel open/close state + selections.
 * Both NavBar and PulseContent subscribe to this directly,
 * so there's no context/prop-drilling to go wrong.
 */

import { useSyncExternalStore } from 'react';

interface PanelState {
  sidebar: boolean;
  intelligence: boolean;
  selectedEntityId: string | null;
  selectedClientId: string | null;
}

const DEFAULT: PanelState = {
  sidebar: true,
  intelligence: true,
  selectedEntityId: null,
  selectedClientId: null,
};

let state: PanelState = { ...DEFAULT };
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

export function toggleSidebar() {
  state = { ...state, sidebar: !state.sidebar };
  emit();
}

export function toggleIntelligence() {
  state = { ...state, intelligence: !state.intelligence };
  emit();
}

export function selectEntity(entityId: string) {
  state = { ...state, selectedEntityId: entityId };
  emit();
}

export function clearEntity() {
  state = { ...state, selectedEntityId: null };
  emit();
}

export function selectClient(clientId: string | null) {
  state = { ...state, selectedClientId: clientId };
  emit();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function getSnapshot() {
  return state;
}

function getServerSnapshot(): PanelState {
  return { ...DEFAULT };
}

export function usePanelStore(): PanelState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
