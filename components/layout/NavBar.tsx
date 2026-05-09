'use client';

import Link from 'next/link';
import ClientSwitcher from '@/components/client/ClientSwitcher';
import ThemeToggle from './ThemeToggle';
import { usePanelStore, toggleEntityPanel, toggleLegend, toggleIntelligence } from '@/lib/panelStore';

export default function NavBar() {
  const panels = usePanelStore();

  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex h-12 shrink-0 items-center px-4">
      {/* Left: Wordmark */}
      <Link href="/" className="pointer-events-auto flex items-center gap-2">
        <span className="text-sm font-semibold tracking-[0.2em] text-wh-text-secondary uppercase">
          Whitehall
        </span>
      </Link>

      {/* Centre: Nav links */}
      <nav className="pointer-events-auto ml-6 flex items-center gap-3">
        <Link
          href="/politician"
          className="text-xs text-wh-text-tertiary hover:text-wh-accent-teal transition-colors"
        >
          Politicians
        </Link>
      </nav>

      {/* Right: Panel toggles + Client Switcher + Theme */}
      <div className="pointer-events-auto ml-auto flex items-center gap-1.5">
        {/* Entity panel (left sidebar) */}
        <IconToggle
          isActive={panels.entityPanel}
          onClick={toggleEntityPanel}
          label="Toggle entity panel"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
          </svg>
        </IconToggle>
        {/* Filter/legend panel (floating) */}
        <IconToggle
          isActive={panels.legend}
          onClick={toggleLegend}
          label="Toggle filters"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 0 1-.659 1.591l-5.432 5.432a2.25 2.25 0 0 0-.659 1.591v2.927a2.25 2.25 0 0 1-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 0 0-.659-1.591L3.659 7.409A2.25 2.25 0 0 1 3 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0 1 12 3Z" />
          </svg>
        </IconToggle>
        {/* Intelligence panel (right sidebar) */}
        <IconToggle
          isActive={panels.intelligence}
          onClick={toggleIntelligence}
          label="Toggle intelligence panel"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
          </svg>
        </IconToggle>
        <div className="mx-1" />
        <ClientSwitcher />
        <ThemeToggle />
      </div>
    </header>
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
      className={`flex h-8 w-8 items-center justify-center rounded-md border backdrop-blur-sm transition-colors ${
        isActive
          ? 'border-wh-accent-teal/50 bg-wh-accent-teal/10 text-wh-accent-teal'
          : 'border-wh-border/50 bg-wh-bg/30 text-wh-text-secondary hover:border-wh-accent-teal/50 hover:text-wh-accent-teal'
      }`}
      aria-label={label}
      aria-pressed={isActive}
    >
      {children}
    </button>
  );
}
