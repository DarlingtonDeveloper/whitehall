'use client';

import { useState, useRef, useEffect } from 'react';
import { ALL_CLIENTS } from '@/data/clients';
import { usePanelStore, selectClient } from '@/lib/panelStore';

export default function ClientSwitcher() {
  const { selectedClientId } = usePanelStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const currentClient = selectedClientId
    ? ALL_CLIENTS.find((c) => c.id === selectedClientId)
    : null;

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close on escape
  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, []);

  function handleSelect(slug: string | null) {
    setOpen(false);
    selectClient(slug);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-2 rounded-md border border-wh-border bg-wh-bg px-3 py-1.5 text-xs font-medium text-wh-text-secondary transition-colors hover:border-wh-accent-teal/40 hover:text-wh-text-primary"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="h-2 w-2 rounded-full bg-wh-accent-teal" />
        {currentClient ? currentClient.name : 'No Client'}
        <ChevronDown />
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute right-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-lg border border-wh-border bg-wh-panel shadow-lg shadow-black/40"
        >
          <DropdownItem
            label="No Client"
            selected={selectedClientId === null}
            onSelect={() => handleSelect(null)}
          />
          {ALL_CLIENTS.map((client) => (
            <DropdownItem
              key={client.id}
              label={client.name}
              sublabel={client.sector}
              selected={selectedClientId === client.id}
              onSelect={() => handleSelect(client.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function DropdownItem({
  label,
  sublabel,
  selected,
  onSelect,
}: {
  label: string;
  sublabel?: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li
      role="option"
      aria-selected={selected}
      className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-xs transition-colors ${
        selected
          ? 'bg-wh-accent-teal/10 text-wh-accent-teal'
          : 'text-wh-text-secondary hover:bg-wh-border/50 hover:text-wh-text-primary'
      }`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      tabIndex={0}
    >
      {selected && (
        <svg className="h-3 w-3 shrink-0" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M16.707 5.293a1 1 0 0 1 0 1.414l-8 8a1 1 0 0 1-1.414 0l-4-4a1 1 0 0 1 1.414-1.414L8 12.586l7.293-7.293a1 1 0 0 1 1.414 0Z"
            clipRule="evenodd"
          />
        </svg>
      )}
      <div className={`flex flex-col ${!selected ? 'pl-5' : ''}`}>
        <span className="font-medium">{label}</span>
        {sublabel && (
          <span className="text-[10px] text-wh-text-secondary/60 capitalize">
            {sublabel}
          </span>
        )}
      </div>
    </li>
  );
}

function ChevronDown() {
  return (
    <svg
      className="h-3 w-3"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
    </svg>
  );
}
