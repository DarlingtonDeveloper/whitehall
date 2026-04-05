'use client';

import { useState, useMemo, useCallback, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import NavBar from './NavBar';
import ChatDrawer from '@/components/chat/ChatDrawer';
import { PanelProvider } from './PanelContext';

interface ShellProps {
  children: ReactNode;
}

export default function Shell({ children }: ShellProps) {
  const pathname = usePathname();
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isFeedOpen, setIsFeedOpen] = useState(true);

  const { clientId, entityId } = useMemo(() => {
    const segments = pathname.split('/').filter(Boolean);

    if (segments[0] === 'client' && segments[1]) {
      return { clientId: segments[1], entityId: undefined };
    }

    if (segments[0] === 'entity' && segments[1]) {
      return { clientId: undefined, entityId: segments[1] };
    }

    return { clientId: undefined, entityId: undefined };
  }, [pathname]);

  const handleChatToggle = useCallback(() => setIsChatOpen((v) => !v), []);
  const handleChatClose = useCallback(() => setIsChatOpen(false), []);
  const toggleSidebar = useCallback(() => setIsSidebarOpen((v) => !v), []);
  const toggleFeed = useCallback(() => setIsFeedOpen((v) => !v), []);

  const isOnPulse = pathname === '/';

  const panelState = useMemo(
    () => ({ sidebar: isSidebarOpen, feed: isFeedOpen, toggleSidebar, toggleFeed }),
    [isSidebarOpen, isFeedOpen, toggleSidebar, toggleFeed],
  );

  return (
    <PanelProvider value={panelState}>
      <div className="flex h-full flex-col">
        <NavBar
          onChatToggle={handleChatToggle}
          isChatOpen={isChatOpen}
          isSidebarOpen={isSidebarOpen}
          onSidebarToggle={toggleSidebar}
          isFeedOpen={isFeedOpen}
          onFeedToggle={toggleFeed}
          showPanelToggles={isOnPulse}
        />
        <main className="flex-1 overflow-auto">{children}</main>
        <ChatDrawer
          isOpen={isChatOpen}
          onClose={handleChatClose}
          clientId={clientId}
          entityId={entityId}
        />
      </div>
    </PanelProvider>
  );
}
