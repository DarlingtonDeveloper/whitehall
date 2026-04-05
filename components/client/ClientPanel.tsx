'use client';

import { useMemo, useState, useCallback, useRef, type KeyboardEvent } from 'react';
import type { ClientConfig, MonitoringTheme } from '@/types/client';
import { getEntity } from '@/data/entities';
import { selectEntity, selectClient, usePanelStore, toggleSource } from '@/lib/panelStore';
import { useClientOverrides } from '@/lib/clientOverrides';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ClientPanelProps {
  client: ClientConfig;
}

type KeywordField =
  | 'policyKeywords'
  | 'industryKeywords'
  | 'competitors'
  | 'projects';

const KEYWORD_SECTIONS: { field: KeywordField; label: string }[] = [
  { field: 'policyKeywords', label: 'Policy Keywords' },
  { field: 'industryKeywords', label: 'Industry Keywords' },
  { field: 'competitors', label: 'Competitors' },
  { field: 'projects', label: 'Projects' },
];

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function ClientPanel({ client }: ClientPanelProps) {
  const { disabledSourceIds } = usePanelStore();
  const { keywords, themes, updateKeywords, updateThemes } =
    useClientOverrides(client.id, {
      policyKeywords: client.policyKeywords,
      industryKeywords: client.industryKeywords,
      competitors: client.competitors,
      projects: client.projects,
      monitoringThemes: client.monitoringThemes,
    });

  const grouped = useMemo(() => {
    const primary = client.stakeholders.filter((s) => s.priority === 'primary');
    const secondary = client.stakeholders.filter((s) => s.priority === 'secondary');
    const tertiary = client.stakeholders.filter((s) => s.priority === 'tertiary');
    return { primary, secondary, tertiary };
  }, [client]);

  /* -- Keyword helpers -- */
  const addKeyword = useCallback(
    (field: KeywordField, value: string) => {
      const trimmed = value.trim();
      if (!trimmed || keywords[field].includes(trimmed)) return;
      updateKeywords(field, [...keywords[field], trimmed]);
    },
    [keywords, updateKeywords],
  );

  const removeKeyword = useCallback(
    (field: KeywordField, value: string) => {
      updateKeywords(
        field,
        keywords[field].filter((k) => k !== value),
      );
    },
    [keywords, updateKeywords],
  );

  /* -- Theme helpers -- */
  const addTheme = useCallback(() => {
    const id = `theme-${Date.now()}`;
    updateThemes([...themes, { id, name: '', entityIds: [], keywords: [] }]);
  }, [themes, updateThemes]);

  const removeTheme = useCallback(
    (id: string) => {
      updateThemes(themes.filter((t) => t.id !== id));
    },
    [themes, updateThemes],
  );

  const renameTheme = useCallback(
    (id: string, name: string) => {
      updateThemes(themes.map((t) => (t.id === id ? { ...t, name } : t)));
    },
    [themes, updateThemes],
  );

  const addThemeKeyword = useCallback(
    (themeId: string, value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return;
      updateThemes(
        themes.map((t) => {
          if (t.id !== themeId) return t;
          if (t.keywords.includes(trimmed)) return t;
          return { ...t, keywords: [...t.keywords, trimmed] };
        }),
      );
    },
    [themes, updateThemes],
  );

  const removeThemeKeyword = useCallback(
    (themeId: string, value: string) => {
      updateThemes(
        themes.map((t) =>
          t.id === themeId
            ? { ...t, keywords: t.keywords.filter((k) => k !== value) }
            : t,
        ),
      );
    },
    [themes, updateThemes],
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-wh-border px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="h-3 w-3 shrink-0 rounded-full bg-wh-accent-teal" />
          <h1 className="text-lg font-semibold text-wh-text-primary">
            {client.name}
          </h1>
          <span className="rounded-full bg-wh-accent-teal/10 px-2.5 py-0.5 text-[10px] font-medium capitalize text-wh-accent-teal">
            {client.sector}
          </span>
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-wh-text-secondary">
          {client.description}
        </p>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">
        {/* Stakeholder groups */}
        <StakeholderGroup
          label="Primary"
          items={grouped.primary}
          disabledSourceIds={disabledSourceIds}
        />
        <StakeholderGroup
          label="Secondary"
          items={grouped.secondary}
          disabledSourceIds={disabledSourceIds}
        />
        <StakeholderGroup
          label="Tertiary"
          items={grouped.tertiary}
          disabledSourceIds={disabledSourceIds}
        />

        {/* Keyword sections */}
        <div className="border-t border-wh-border/50">
          {KEYWORD_SECTIONS.map(({ field, label }) => (
            <KeywordSection
              key={field}
              label={label}
              items={keywords[field]}
              onAdd={(v) => addKeyword(field, v)}
              onRemove={(v) => removeKeyword(field, v)}
            />
          ))}
        </div>

        {/* Monitoring Themes */}
        <div className="border-t border-wh-border/50">
          <div className="flex items-center gap-2 px-4 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-wh-text-secondary/70">
              Monitoring Themes
            </span>
            <span className="text-[10px] text-wh-text-secondary/40">
              {themes.length}
            </span>
          </div>

          {themes.map((theme) => (
            <ThemeBlock
              key={theme.id}
              theme={theme}
              onRemoveTheme={() => removeTheme(theme.id)}
              onRename={(name) => renameTheme(theme.id, name)}
              onAddKeyword={(v) => addThemeKeyword(theme.id, v)}
              onRemoveKeyword={(v) => removeThemeKeyword(theme.id, v)}
            />
          ))}

          <div className="px-4 py-2">
            <button
              type="button"
              onClick={addTheme}
              className="text-[10px] font-medium text-wh-accent-teal hover:text-wh-accent-teal/80 transition-colors"
            >
              + Add Theme
            </button>
          </div>
        </div>
      </div>

      {/* Footer: deselect */}
      <div className="shrink-0 border-t border-wh-border px-4 py-2.5">
        <button
          type="button"
          onClick={() => selectClient(null)}
          className="w-full rounded-md border border-wh-border px-3 py-1.5 text-xs text-wh-text-secondary transition-colors hover:bg-wh-border/50 hover:text-wh-text-primary"
        >
          Clear Client
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Stakeholder group with source toggles                              */
/* ------------------------------------------------------------------ */

function StakeholderGroup({
  label,
  items,
  disabledSourceIds,
}: {
  label: string;
  items: { entityId: string; priority: string; role: string }[];
  disabledSourceIds: string[];
}) {
  if (items.length === 0) return null;

  const dotColour: Record<string, string> = {
    Primary: 'bg-wh-accent-teal',
    Secondary: 'bg-wh-accent-amber',
    Tertiary: 'bg-wh-text-secondary/50',
  };

  return (
    <div className="border-b border-wh-border/50">
      <div className="flex items-center gap-2 px-4 py-2">
        <span
          className={`h-1.5 w-1.5 rounded-full ${dotColour[label] ?? 'bg-wh-text-secondary/50'}`}
        />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-wh-text-secondary/70">
          {label}
        </span>
        <span className="text-[10px] text-wh-text-secondary/40">
          {items.length}
        </span>
      </div>
      <ul className="pb-2">
        {items.map((s) => {
          const entity = getEntity(s.entityId);
          const isEnabled = !disabledSourceIds.includes(s.entityId);

          return (
            <li key={s.entityId} className="flex items-center pr-3">
              <button
                type="button"
                onClick={() => selectEntity(s.entityId)}
                className="flex flex-1 min-w-0 flex-col gap-0.5 px-4 py-1.5 text-left transition-colors hover:bg-wh-border/30"
              >
                <span className="text-xs font-medium text-wh-text-primary truncate">
                  {entity?.name ?? s.entityId}
                </span>
                <span className="text-[10px] text-wh-text-secondary/60 truncate">
                  {s.role}
                </span>
              </button>

              {/* Source toggle */}
              <button
                type="button"
                aria-label={`${isEnabled ? 'Disable' : 'Enable'} ${entity?.name ?? s.entityId} as feed source`}
                onClick={() => toggleSource(s.entityId)}
                className="shrink-0 ml-1"
              >
                <span
                  className={`block h-4 w-4 rounded-full border-2 transition-colors ${
                    isEnabled
                      ? 'border-wh-accent-teal bg-wh-accent-teal'
                      : 'border-wh-border bg-transparent'
                  }`}
                />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Keyword section with CRUD                                          */
/* ------------------------------------------------------------------ */

function KeywordSection({
  label,
  items,
  onAdd,
  onRemove,
}: {
  label: string;
  items: string[];
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = () => {
    if (draft.trim()) {
      onAdd(draft);
      setDraft('');
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    }
  };

  return (
    <div className="border-b border-wh-border/30 px-4 py-2">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-wh-text-secondary/70">
          {label}
        </span>
        <span className="text-[10px] text-wh-text-secondary/40">
          {items.length}
        </span>
      </div>

      {items.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {items.map((kw) => (
            <span
              key={kw}
              className="group flex items-center gap-1 rounded bg-wh-border/60 px-2 py-0.5 text-[10px] text-wh-text-secondary/70"
            >
              {kw}
              <button
                type="button"
                aria-label={`Remove ${kw}`}
                onClick={() => onRemove(kw)}
                className="text-wh-text-secondary/30 hover:text-red-400 transition-colors leading-none"
              >
                x
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Inline add input */}
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={commit}
        placeholder={`Add ${label.toLowerCase()}...`}
        className="w-full bg-transparent text-[10px] text-wh-text-secondary placeholder:text-wh-text-secondary/30 outline-none border-b border-transparent focus:border-wh-border transition-colors py-0.5"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Monitoring theme block (collapsible, CRUD)                         */
/* ------------------------------------------------------------------ */

function ThemeBlock({
  theme,
  onRemoveTheme,
  onRename,
  onAddKeyword,
  onRemoveKeyword,
}: {
  theme: MonitoringTheme;
  onRemoveTheme: () => void;
  onRename: (name: string) => void;
  onAddKeyword: (value: string) => void;
  onRemoveKeyword: (value: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(!theme.name);

  const commitKeyword = () => {
    if (draft.trim()) {
      onAddKeyword(draft);
      setDraft('');
    }
  };

  const handleKeywordKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitKeyword();
    }
  };

  const handleNameKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      setEditing(false);
    }
  };

  return (
    <div className="border-b border-wh-border/30 px-4 py-2">
      {/* Theme header */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="text-[10px] text-wh-text-secondary/50 hover:text-wh-text-secondary transition-colors leading-none"
          aria-label={open ? 'Collapse theme' : 'Expand theme'}
        >
          {open ? '\u25BC' : '\u25B6'}
        </button>

        {editing ? (
          <input
            type="text"
            autoFocus
            value={theme.name}
            onChange={(e) => onRename(e.target.value)}
            onKeyDown={handleNameKeyDown}
            onBlur={() => setEditing(false)}
            placeholder="Theme name..."
            className="flex-1 min-w-0 bg-transparent text-xs font-medium text-wh-text-primary placeholder:text-wh-text-secondary/30 outline-none border-b border-wh-border focus:border-wh-accent-teal transition-colors"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="flex-1 min-w-0 text-left text-xs font-medium text-wh-text-primary truncate hover:text-wh-accent-teal transition-colors"
          >
            {theme.name || 'Untitled theme'}
          </button>
        )}

        <button
          type="button"
          aria-label={`Delete theme ${theme.name}`}
          onClick={onRemoveTheme}
          className="shrink-0 text-wh-text-secondary/30 hover:text-red-400 transition-colors text-xs leading-none"
        >
          x
        </button>
      </div>

      {/* Collapsible body */}
      {open && (
        <div className="mt-1.5 pl-4">
          {theme.keywords.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-1.5">
              {theme.keywords.map((kw) => (
                <span
                  key={kw}
                  className="group flex items-center gap-1 rounded bg-wh-border/40 px-1.5 py-0.5 text-[9px] text-wh-text-secondary/60"
                >
                  {kw}
                  <button
                    type="button"
                    aria-label={`Remove ${kw} from ${theme.name}`}
                    onClick={() => onRemoveKeyword(kw)}
                    className="text-wh-text-secondary/30 hover:text-red-400 transition-colors leading-none"
                  >
                    x
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Inline add keyword */}
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeywordKeyDown}
            onBlur={commitKeyword}
            placeholder="Add keyword..."
            className="w-full bg-transparent text-[9px] text-wh-text-secondary placeholder:text-wh-text-secondary/30 outline-none border-b border-transparent focus:border-wh-border transition-colors py-0.5"
          />
        </div>
      )}
    </div>
  );
}
