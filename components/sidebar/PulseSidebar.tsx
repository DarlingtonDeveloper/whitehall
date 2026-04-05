'use client';

import { useMemo, useState, useCallback } from 'react';
import { ENTITY_LIST } from '@/data/entities';
import { selectEntity } from '@/lib/panelStore';
import { TAGS } from '@/data/tags';
import { getEntityColour } from '@/data/colours';
import { JURISDICTIONS } from '@/data/jurisdictions';
import type { FilterState } from './types';

interface PulseSidebarProps {
  filter: FilterState;
  onSearch: (q: string) => void;
  onToggleTag: (tagId: string) => void;
  onSetJurisdiction: (j: string | null) => void;
  visibleCount: number;
  onCollapse: () => void;
}

export default function PulseSidebar({
  filter,
  onSearch,
  onToggleTag,
  onSetJurisdiction,
  visibleCount,
  onCollapse,
}: PulseSidebarProps) {
  // Each section independently collapsible; only entities open by default
  const [openSections, setOpenSections] = useState<Set<string>>(
    () => new Set(['entities']),
  );

  const toggle = useCallback((section: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }, []);

  const typeTags = useMemo(
    () => Object.values(TAGS).filter((t) => t.tagCategory === 'type'),
    [],
  );
  const sectorTags = useMemo(
    () => Object.values(TAGS).filter((t) => t.tagCategory === 'sector'),
    [],
  );

  const tagCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const entity of ENTITY_LIST) {
      for (const tagId of entity.tags ?? []) {
        counts[tagId] = (counts[tagId] ?? 0) + 1;
      }
    }
    return counts;
  }, []);

  const filteredEntities = useMemo(() => {
    const q = filter.search.toLowerCase();
    let list = ENTITY_LIST;

    if (q) {
      list = list.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.id.toLowerCase().includes(q) ||
          e.currentHolder?.toLowerCase().includes(q),
      );
    }

    if (filter.activeTags.size > 0) {
      list = list.filter((e) =>
        (e.tags ?? []).some((t) => filter.activeTags.has(t)),
      );
    }

    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [filter.search, filter.activeTags]);

  return (
    <div className="flex h-full w-72 shrink-0 flex-col border-r border-wh-border bg-wh-panel">
      {/* Search + close */}
      <div className="shrink-0 border-b border-wh-border p-3">
        <div className="flex items-center gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-md border border-wh-border bg-wh-bg px-2.5 py-1.5">
            <svg
              className="h-3.5 w-3.5 shrink-0 text-wh-text-secondary/40"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
              />
            </svg>
            <input
              type="text"
              value={filter.search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Search entities..."
              className="w-full bg-transparent text-xs text-wh-text-primary placeholder:text-wh-text-secondary/40 outline-none"
            />
            {filter.search && (
              <button
                onClick={() => onSearch('')}
                className="text-wh-text-secondary/40 hover:text-wh-text-primary"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          <button
            onClick={onCollapse}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-wh-text-secondary/40 hover:bg-wh-border/40 hover:text-wh-text-secondary"
            aria-label="Close sidebar"
            title="Close sidebar"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
          </button>
        </div>
        <p className="mt-1.5 text-[10px] text-wh-text-secondary/50">
          {visibleCount} of {ENTITY_LIST.length} entities visible
        </p>
      </div>

      {/* Jurisdiction — collapsible, closed by default */}
      <div className="shrink-0 border-b border-wh-border">
        <SectionHeader
          label="Jurisdiction"
          badge={filter.jurisdiction ? JURISDICTIONS[filter.jurisdiction]?.shortLabel : null}
          open={openSections.has('jurisdiction')}
          onToggle={() => toggle('jurisdiction')}
        />
        {openSections.has('jurisdiction') && (
          <div className="flex flex-wrap gap-1 px-3 pb-2">
            <JurisdictionPill
              label="All"
              active={filter.jurisdiction === null}
              onClick={() => onSetJurisdiction(null)}
            />
            {Object.entries(JURISDICTIONS).map(([key, j]) => (
              <JurisdictionPill
                key={key}
                label={j.shortLabel}
                active={filter.jurisdiction === key}
                onClick={() =>
                  onSetJurisdiction(filter.jurisdiction === key ? null : key)
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* Tags — collapsible, closed by default */}
      <div className="shrink-0 border-b border-wh-border">
        <SectionHeader
          label="Tags"
          badge={filter.activeTags.size > 0 ? String(filter.activeTags.size) : null}
          open={openSections.has('tags')}
          onToggle={() => toggle('tags')}
        />
        {openSections.has('tags') && (
          <div className="max-h-48 overflow-y-auto px-3 pb-2">
            <p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-wh-text-secondary/50">
              Type
            </p>
            <div className="flex flex-wrap gap-1 mb-2">
              {typeTags.map((tag) => (
                <TagPill
                  key={tag.id}
                  tag={tag}
                  count={tagCounts[tag.id] ?? 0}
                  active={filter.activeTags.has(tag.id)}
                  onClick={() => onToggleTag(tag.id)}
                />
              ))}
            </div>
            <p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-wh-text-secondary/50">
              Sector
            </p>
            <div className="flex flex-wrap gap-1">
              {sectorTags.map((tag) => (
                <TagPill
                  key={tag.id}
                  tag={tag}
                  count={tagCounts[tag.id] ?? 0}
                  active={filter.activeTags.has(tag.id)}
                  onClick={() => onToggleTag(tag.id)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Entities — collapsible, open by default */}
      <div className="flex min-h-0 flex-1 flex-col">
        <SectionHeader
          label={`Entities (${filteredEntities.length})`}
          open={openSections.has('entities')}
          onToggle={() => toggle('entities')}
        />
        {openSections.has('entities') && (
          <div className="flex-1 overflow-y-auto">
            {filteredEntities.map((entity) => (
              <button
                key={entity.id}
                type="button"
                onClick={() => selectEntity(entity.id)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-wh-border/30"
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-sm"
                  style={{ backgroundColor: getEntityColour(entity.tags) }}
                />
                <span className="truncate text-[11px] text-wh-text-primary">
                  {entity.name}
                </span>
                <span className="ml-auto shrink-0 text-[9px] capitalize text-wh-text-secondary/40">
                  {entity.category}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Shared section header with chevron ---

function SectionHeader({
  label,
  badge,
  open,
  onToggle,
}: {
  label: string;
  badge?: string | null;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="flex w-full items-center justify-between px-3 py-2 text-left"
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider text-wh-text-secondary/70">
        {label}
        {badge && (
          <span className="ml-1 text-wh-accent-teal">({badge})</span>
        )}
      </span>
      <svg
        className={`h-3 w-3 text-wh-text-secondary/40 transition-transform ${
          open ? 'rotate-180' : ''
        }`}
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={2}
        stroke="currentColor"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
      </svg>
    </button>
  );
}

function JurisdictionPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
        active
          ? 'bg-wh-accent-teal/15 text-wh-accent-teal'
          : 'bg-wh-border/40 text-wh-text-secondary/60 hover:bg-wh-border/70 hover:text-wh-text-secondary'
      }`}
    >
      {label}
    </button>
  );
}

function TagPill({
  tag,
  count,
  active,
  onClick,
}: {
  tag: { id: string; label: string; colour: string };
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] transition-colors ${
        active
          ? 'ring-1 ring-wh-accent-teal/50'
          : 'opacity-70 hover:opacity-100'
      }`}
      style={{
        backgroundColor: active ? `${tag.colour}25` : `${tag.colour}12`,
        color: tag.colour,
      }}
    >
      <span className="max-w-[100px] truncate">{tag.label}</span>
      <span className="opacity-50">{count}</span>
    </button>
  );
}
