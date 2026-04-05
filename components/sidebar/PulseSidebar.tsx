'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ENTITY_LIST } from '@/data/entities';
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
}

export default function PulseSidebar({
  filter,
  onSearch,
  onToggleTag,
  onSetJurisdiction,
  visibleCount,
}: PulseSidebarProps) {
  const [expandedSection, setExpandedSection] = useState<'tags' | 'entities' | null>('entities');

  const typeTags = useMemo(
    () => Object.values(TAGS).filter((t) => t.tagCategory === 'type'),
    [],
  );
  const sectorTags = useMemo(
    () => Object.values(TAGS).filter((t) => t.tagCategory === 'sector'),
    [],
  );

  // Count entities per tag
  const tagCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const entity of ENTITY_LIST) {
      for (const tagId of entity.tags ?? []) {
        counts[tagId] = (counts[tagId] ?? 0) + 1;
      }
    }
    return counts;
  }, []);

  // Filtered entity list for the bottom section
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

    // Sort alphabetically
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [filter.search, filter.activeTags]);

  return (
    <div className="flex h-full w-72 shrink-0 flex-col border-r border-wh-border bg-wh-panel">
      {/* Search */}
      <div className="shrink-0 border-b border-wh-border p-3">
        <div className="flex items-center gap-2 rounded-md border border-wh-border bg-wh-bg px-2.5 py-1.5">
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
        <p className="mt-1.5 text-[10px] text-wh-text-secondary/50">
          {visibleCount} of {ENTITY_LIST.length} entities visible
        </p>
      </div>

      {/* Jurisdiction filter */}
      <div className="shrink-0 border-b border-wh-border px-3 py-2">
        <label className="text-[10px] font-semibold uppercase tracking-wider text-wh-text-secondary/70">
          Jurisdiction
        </label>
        <div className="mt-1.5 flex flex-wrap gap-1">
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
      </div>

      {/* Tags section */}
      <div className="shrink-0 border-b border-wh-border">
        <button
          onClick={() =>
            setExpandedSection(expandedSection === 'tags' ? null : 'tags')
          }
          className="flex w-full items-center justify-between px-3 py-2 text-left"
        >
          <span className="text-[10px] font-semibold uppercase tracking-wider text-wh-text-secondary/70">
            Tags
            {filter.activeTags.size > 0 && (
              <span className="ml-1 text-wh-accent-teal">
                ({filter.activeTags.size})
              </span>
            )}
          </span>
          <svg
            className={`h-3 w-3 text-wh-text-secondary/40 transition-transform ${
              expandedSection === 'tags' ? 'rotate-180' : ''
            }`}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </button>

        {expandedSection === 'tags' && (
          <div className="max-h-48 overflow-y-auto px-3 pb-2">
            {/* Type tags */}
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
            {/* Sector tags */}
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

      {/* Entity list */}
      <div className="flex min-h-0 flex-1 flex-col">
        <button
          onClick={() =>
            setExpandedSection(expandedSection === 'entities' ? null : 'entities')
          }
          className="flex shrink-0 w-full items-center justify-between px-3 py-2 text-left"
        >
          <span className="text-[10px] font-semibold uppercase tracking-wider text-wh-text-secondary/70">
            Entities ({filteredEntities.length})
          </span>
          <svg
            className={`h-3 w-3 text-wh-text-secondary/40 transition-transform ${
              expandedSection === 'entities' ? 'rotate-180' : ''
            }`}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </button>

        {expandedSection === 'entities' && (
          <div className="flex-1 overflow-y-auto">
            {filteredEntities.map((entity) => (
              <Link
                key={entity.id}
                href={`/entity/${entity.id}`}
                className="flex items-center gap-2 px-3 py-1.5 transition-colors hover:bg-wh-border/30"
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-sm"
                  style={{
                    backgroundColor: getEntityColour(
                      entity.category,
                      entity.subtype,
                    ),
                  }}
                />
                <span className="truncate text-[11px] text-wh-text-primary">
                  {entity.name}
                </span>
                <span className="ml-auto shrink-0 text-[9px] capitalize text-wh-text-secondary/40">
                  {entity.category}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
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
