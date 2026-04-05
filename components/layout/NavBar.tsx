'use client';

import Link from 'next/link';
import ClientSwitcher from '@/components/client/ClientSwitcher';
import ThemeToggle from './ThemeToggle';
import { usePanelStore, toggleSidebar, toggleIntelligence } from '@/lib/panelStore';

export default function NavBar() {
  const panels = usePanelStore();

  return (
    <header className="flex h-12 shrink-0 items-center border-b border-wh-border bg-wh-panel px-4">
      {/* Left: Wordmark */}
      <Link href="/" className="flex items-center gap-2">
        <span className="text-sm font-semibold tracking-[0.2em] text-wh-text-secondary uppercase">
          Whitehall
        </span>
      </Link>

      {/* Right: Panel toggles + Client Switcher + Theme */}
      <div className="ml-auto flex items-center gap-1.5">
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
          isActive={panels.intelligence}
          onClick={toggleIntelligence}
          label="Toggle intelligence panel"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
          </svg>
        </IconToggle>
        <div className="mx-1 h-4 w-px bg-wh-border" />
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
