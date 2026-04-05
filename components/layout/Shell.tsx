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

  return (
    <div className="flex h-full flex-col">
      <NavBar onChatToggle={handleChatToggle} isChatOpen={isChatOpen} />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
      <ChatDrawer
        isOpen={isChatOpen}
        onClose={handleChatClose}
        clientId={clientId}
        entityId={entityId}
      />
    </div>
  );
}
