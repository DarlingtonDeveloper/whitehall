/**
 * Simple reactive store for panel open/close state + selections.
 * Both NavBar and PulseContent subscribe to this directly,
 * so there's no context/prop-drilling to go wrong.
 */

import { useSyncExternalStore } from 'react';

interface PanelState {
  entityPanel: boolean;
  legend: boolean;
  intelligence: boolean;
  selectedEntityId: string | null;
  selectedClientId: string | null;
  disabledSourceIds: string[];
}

const DEFAULT: PanelState = {
  entityPanel: true,
  legend: true,
  intelligence: true,
  selectedEntityId: null,
  selectedClientId: null,
  disabledSourceIds: [],
};

let state: PanelState = { ...DEFAULT };
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

export function toggleEntityPanel() {
  state = { ...state, entityPanel: !state.entityPanel };
  emit();
}

export function toggleLegend() {
  state = { ...state, legend: !state.legend };
  emit();
}

export function toggleIntelligence() {
  state = { ...state, intelligence: !state.intelligence };
  emit();
}

export function openIntelligence() {
  if (!state.intelligence) {
    state = { ...state, intelligence: true };
    emit();
  }
}

export function getPanelState(): PanelState {
  return state;
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
  state = { ...state, selectedClientId: clientId, disabledSourceIds: [] };
  emit();
}

export function toggleSource(entityId: string) {
  const ids = state.disabledSourceIds;
  const next = ids.includes(entityId)
    ? ids.filter((id) => id !== entityId)
    : [...ids, entityId];
  state = { ...state, disabledSourceIds: next };
  emit();
}

export function resetSources() {
  state = { ...state, disabledSourceIds: [] };
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
