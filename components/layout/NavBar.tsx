'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import ClientSwitcher from '@/components/client/ClientSwitcher';
import ThemeToggle from './ThemeToggle';
import { usePanelStore, toggleSidebar, toggleFeed } from '@/lib/panelStore';

interface NavBarProps {
  onChatToggle: () => void;
  isChatOpen: boolean;
}

export default function NavBar({ onChatToggle, isChatOpen }: NavBarProps) {
  const pathname = usePathname();
  const panels = usePanelStore();

  const isOnPulse = pathname === '/';
  const isOnClient = pathname.startsWith('/client/');
  const isOnEntity = pathname.startsWith('/entity/');

  const currentClientSlug = isOnClient
    ? pathname.split('/')[2] ?? null
    : null;

  return (
    <header className="flex h-12 shrink-0 items-center border-b border-wh-border bg-wh-panel px-4">
      {/* Left: Wordmark */}
      <Link href="/" className="flex items-center gap-2">
        <span className="text-sm font-semibold tracking-[0.2em] text-wh-text-secondary uppercase">
          Whitehall
        </span>
      </Link>

      {/* Center: Navigation */}
      <nav className="ml-8 flex items-center gap-1" aria-label="Main navigation">
        <NavLink href="/" active={isOnPulse}>
          Pulse
        </NavLink>
        <NavLink
          href={currentClientSlug ? `/client/${currentClientSlug}` : '#'}
          active={isOnClient}
          disabled={!isOnClient && !currentClientSlug}
        >
          Client
        </NavLink>
        <NavLink
          href="#"
          active={isOnEntity}
          disabled={!isOnEntity}
        >
          Entity
        </NavLink>
      </nav>

      {/* Right: Panel toggles + Client Switcher + Theme + Chat */}
      <div className="ml-auto flex items-center gap-1.5">
        {isOnPulse && (
          <>
            <IconToggle
              isActive={panels.sidebar}
              onClick={toggleSidebar}
              label="Toggle sidebar"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
              </svg>
            </IconToggle>
            <IconToggle
              isActive={panels.feed}
              onClick={toggleFeed}
              label="Toggle activity feed"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 0 1-2.25 2.25M16.5 7.5V18a2.25 2.25 0 0 0 2.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 0 0 2.25 2.25h13.5M6 7.5h3v3H6v-3Z" />
              </svg>
            </IconToggle>
            <div className="mx-1 h-4 w-px bg-wh-border" />
          </>
        )}
        <ClientSwitcher />
        <ThemeToggle />
        <IconToggle
          isActive={isChatOpen}
          onClick={onChatToggle}
          label="Toggle chat"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z"
            />
          </svg>
        </IconToggle>
      </div>
    </header>
  );
}

function NavLink({
  href,
  active,
  disabled = false,
  children,
}: {
  href: string;
  active: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  if (disabled) {
    return (
      <span className="rounded-md px-3 py-1.5 text-xs font-medium text-wh-text-secondary/40 cursor-not-allowed select-none">
        {children}
      </span>
    );
  }

  return (
    <Link
      href={href}
      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? 'bg-wh-accent-teal/10 text-wh-accent-teal'
          : 'text-wh-text-secondary hover:text-wh-text-primary hover:bg-wh-border/50'
      }`}
    >
      {children}
    </Link>
  );
}

function IconToggle({
  isActive,
  onClick,
  label,
  children,
}: {
  isActive: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-md border transition-colors ${
        isActive
          ? 'border-wh-accent-teal/50 bg-wh-accent-teal/10 text-wh-accent-teal'
          : 'border-wh-border text-wh-text-secondary hover:border-wh-accent-teal/50 hover:text-wh-accent-teal'
      }`}
      aria-label={label}
      aria-pressed={isActive}
    >
      {children}
    </button>
  );
}
