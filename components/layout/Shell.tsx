'use client';

import { useState, useMemo, useCallback, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import NavBar from './NavBar';
import ChatDrawer from '@/components/chat/ChatDrawer';

interface ShellProps {
  children: ReactNode;
}

export default function Shell({ children }: ShellProps) {
  const pathname = usePathname();
  const [isChatOpen, setIsChatOpen] = useState(false);

  /* Derive clientId / entityId from the current URL path */
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

  const handleChatToggle = useCallback(() => {
    setIsChatOpen((prev) => !prev);
  }, []);

  const handleChatClose = useCallback(() => {
    setIsChatOpen(false);
  }, []);

  return (
    <div className="flex h-full flex-col">
      <NavBar onChatToggle={handleChatToggle} isChatOpen={isChatOpen} />
      <main className="flex-1 overflow-auto">{children}</main>
      <ChatDrawer
        isOpen={isChatOpen}
        onClose={handleChatClose}
        clientId={clientId}
        entityId={entityId}
      />
    </div>
  );
}
