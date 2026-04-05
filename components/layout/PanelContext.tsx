'use client';

import { createContext, useContext } from 'react';

export interface PanelState {
  sidebar: boolean;
  feed: boolean;
  toggleSidebar: () => void;
  toggleFeed: () => void;
}

const PanelContext = createContext<PanelState>({
  sidebar: true,
  feed: true,
  toggleSidebar: () => {},
  toggleFeed: () => {},
});

export const PanelProvider = PanelContext.Provider;

export function usePanels() {
  return useContext(PanelContext);
}
