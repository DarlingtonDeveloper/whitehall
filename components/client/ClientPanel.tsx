'use client';

import { useMemo, useState, useCallback, useRef, useEffect, type KeyboardEvent } from 'react';
import type { ClientConfig } from '@/types/client';
import { getEntity } from '@/data/entities';
import { selectEntity, selectClient, usePanelStore, toggleSource } from '@/lib/panelStore';
import {
  useClientOverrides,
  type KeywordField,
  type KeywordEntry,
  type ThemeEntry,
} from '@/lib/clientOverrides';
import ExportButton from '@/components/export/ExportButton';
import ClientHealthDashboard from './ClientHealthDashboard';
import type { ReportStatus } from '@/types/report';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const KEYWORD_SECTIONS: { field: KeywordField; label: string }[] = [
  { field: 'policyKeywords', label: 'Policy Keywords' },
  { field: 'industryKeywords', label: 'Industry Keywords' },
  { field: 'competitors', label: 'Competitors' },
  { field: 'projects', label: 'Projects' },
];

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function ClientPanel({ client }: { client: ClientConfig }) {
  const { disabledSourceIds } = usePanelStore();
  const overrides = useClientOverrides(client.id, {
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
        <div className="mt-3 flex items-center gap-2">
          <ExportButton clientId={client.id} />
          <ReportListButton clientId={client.id} />
        </div>
      </div>

      {/* Health dashboard */}
      <ClientHealthDashboard client={client} />

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        {/* Stakeholder groups */}
        <StakeholderGroup label="Primary" items={grouped.primary} disabledSourceIds={disabledSourceIds} />
        <StakeholderGroup label="Secondary" items={grouped.secondary} disabledSourceIds={disabledSourceIds} />
        <StakeholderGroup label="Tertiary" items={grouped.tertiary} disabledSourceIds={disabledSourceIds} />

        {/* Keyword sections */}
        <div className="border-t border-wh-border/50">
          {KEYWORD_SECTIONS.map(({ field, label }) => (
            <KeywordSection
              key={field}
              label={label}
              entries={overrides.keywordSections[field]}
              onToggle={overrides.toggleKeyword}
              onAdd={(v) => overrides.addKeyword(field, v)}
              onRemove={(v) => overrides.removeKeyword(field, v)}
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
              {overrides.themeEntries.length}
            </span>
          </div>

          {overrides.themeEntries.map((entry) => (
            <ThemeBlock
              key={entry.theme.id}
              entry={entry}
              onToggleTheme={() => overrides.toggleTheme(entry.theme.id)}
              onRemoveTheme={() => overrides.removeTheme(entry.theme.id)}
              onRename={(name) => overrides.renameTheme(entry.theme.id, name)}
              onToggleKeyword={(v) => overrides.toggleThemeKeyword(entry.theme.id, v)}
              onAddKeyword={(v) => overrides.addThemeKeyword(entry.theme.id, v)}
              onRemoveKeyword={(v) => overrides.removeThemeKeyword(entry.theme.id, v)}
            />
          ))}

          <div className="px-4 py-2">
            <button
              type="button"
              onClick={overrides.addTheme}
              className="text-[10px] font-medium text-wh-accent-teal hover:text-wh-accent-teal/80 transition-colors"
            >
              + Add Theme
            </button>
          </div>
        </div>
      </div>

      {/* Footer */}
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
        <span className={`h-1.5 w-1.5 rounded-full ${dotColour[label] ?? 'bg-wh-text-secondary/50'}`} />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-wh-text-secondary/70">
          {label}
        </span>
        <span className="text-[10px] text-wh-text-secondary/40">{items.length}</span>
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
/*  Keyword section — toggle on/off, add new, remove user-added        */
/* ------------------------------------------------------------------ */

function KeywordSection({
  label,
  entries,
  onToggle,
  onAdd,
  onRemove,
}: {
  label: string;
  entries: KeywordEntry[];
  onToggle: (value: string) => void;
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
}) {
  const [draft, setDraft] = useState('');

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

  const enabledCount = entries.filter((e) => e.enabled).length;

  return (
    <div className="border-b border-wh-border/30 px-4 py-2">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-wh-text-secondary/70">
          {label}
        </span>
        <span className="text-[10px] text-wh-text-secondary/40">
          {enabledCount}/{entries.length}
        </span>
      </div>

      {entries.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {entries.map((entry) => (
            <span
              key={entry.value}
              className={`group flex items-center gap-1 rounded px-2 py-0.5 text-[10px] transition-colors cursor-pointer ${
                entry.enabled
                  ? 'bg-wh-border/60 text-wh-text-secondary/70'
                  : 'bg-wh-border/20 text-wh-text-secondary/30 line-through'
              }`}
              onClick={() => onToggle(entry.value)}
            >
              {entry.value}
              {entry.isUserAdded && (
                <button
                  type="button"
                  aria-label={`Remove ${entry.value}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(entry.value);
                  }}
                  className="text-wh-text-secondary/30 hover:text-red-400 transition-colors leading-none ml-0.5"
                >
                  x
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      <input
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
/*  Monitoring theme block — collapsible, toggleable, CRUD             */
/* ------------------------------------------------------------------ */

function ThemeBlock({
  entry,
  onToggleTheme,
  onRemoveTheme,
  onRename,
  onToggleKeyword,
  onAddKeyword,
  onRemoveKeyword,
}: {
  entry: ThemeEntry;
  onToggleTheme: () => void;
  onRemoveTheme: () => void;
  onRename: (name: string) => void;
  onToggleKeyword: (value: string) => void;
  onAddKeyword: (value: string) => void;
  onRemoveKeyword: (value: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(!entry.theme.name);

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

  const enabledKwCount = entry.keywords.filter((k) => k.enabled).length;

  return (
    <div className={`border-b border-wh-border/30 px-4 py-2 transition-opacity ${entry.enabled ? '' : 'opacity-40'}`}>
      {/* Theme header */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="text-[10px] text-wh-text-secondary/50 hover:text-wh-text-secondary transition-colors leading-none"
        >
          {open ? '\u25BC' : '\u25B6'}
        </button>

        {/* Theme toggle */}
        <button
          type="button"
          onClick={onToggleTheme}
          className="shrink-0"
          aria-label={`${entry.enabled ? 'Disable' : 'Enable'} theme ${entry.theme.name}`}
        >
          <span
            className={`block h-3 w-3 rounded-full border-2 transition-colors ${
              entry.enabled
                ? 'border-wh-accent-teal bg-wh-accent-teal'
                : 'border-wh-border bg-transparent'
            }`}
          />
        </button>

        {editing && entry.isUserAdded ? (
          <input
            type="text"
            autoFocus
            value={entry.theme.name}
            onChange={(e) => onRename(e.target.value)}
            onKeyDown={handleNameKeyDown}
            onBlur={() => setEditing(false)}
            placeholder="Theme name..."
            className="flex-1 min-w-0 bg-transparent text-xs font-medium text-wh-text-primary placeholder:text-wh-text-secondary/30 outline-none border-b border-wh-border focus:border-wh-accent-teal transition-colors"
          />
        ) : (
          <span
            className="flex-1 min-w-0 text-xs font-medium text-wh-text-primary truncate"
            onClick={() => entry.isUserAdded && setEditing(true)}
          >
            {entry.theme.name || 'Untitled theme'}
          </span>
        )}

        <span className="text-[9px] text-wh-text-secondary/30">
          {enabledKwCount}/{entry.keywords.length}
        </span>

        {entry.isUserAdded && (
          <button
            type="button"
            aria-label={`Delete theme ${entry.theme.name}`}
            onClick={onRemoveTheme}
            className="shrink-0 text-wh-text-secondary/30 hover:text-red-400 transition-colors text-xs leading-none"
          >
            x
          </button>
        )}
      </div>

      {/* Collapsible body */}
      {open && (
        <div className="mt-1.5 pl-4">
          {entry.keywords.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-1.5">
              {entry.keywords.map((kw) => (
                <span
                  key={kw.value}
                  className={`group flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] transition-colors cursor-pointer ${
                    kw.enabled
                      ? 'bg-wh-border/40 text-wh-text-secondary/60'
                      : 'bg-wh-border/15 text-wh-text-secondary/25 line-through'
                  }`}
                  onClick={() => onToggleKeyword(kw.value)}
                >
                  {kw.value}
                  {kw.isUserAdded && (
                    <button
                      type="button"
                      aria-label={`Remove ${kw.value}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveKeyword(kw.value);
                      }}
                      className="text-wh-text-secondary/30 hover:text-red-400 transition-colors leading-none"
                    >
                      x
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}

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

/* ------------------------------------------------------------------ */
/*  Report list button + dropdown                                      */
/* ------------------------------------------------------------------ */

const STATUS_STYLES: Record<ReportStatus, string> = {
  generating: 'bg-amber-500/15 text-amber-400',
  draft: 'bg-blue-500/15 text-blue-400',
  in_review: 'bg-purple-500/15 text-purple-400',
  approved: 'bg-green-500/15 text-green-400',
  exported: 'bg-wh-accent-teal/15 text-wh-accent-teal',
};

const STATUS_LABELS: Record<ReportStatus, string> = {
  generating: 'Generating',
  draft: 'Draft',
  in_review: 'In Review',
  approved: 'Approved',
  exported: 'Exported',
};

interface ReportListItem {
  id: string;
  status: ReportStatus;
  date_range_from: string;
  date_range_to: string;
  created_at: string;
}

function ReportListButton({ clientId }: { clientId: string }) {
  const [open, setOpen] = useState(false);
  const [reports, setReports] = useState<ReportListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    import('@/lib/db').then(({ supabase }) => {
      supabase
        .from('report_drafts')
        .select('id, status, date_range_from, date_range_to, created_at')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .limit(10)
        .then(({ data }) => {
          setReports((data as ReportListItem[]) ?? []);
          setLoading(false);
        });
    });
  }, [open, clientId]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await fetch('/api/reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.draftId) {
          window.location.href = `/client/${clientId}/report/${data.draftId}`;
        }
      }
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="rounded-md border border-wh-border px-3 py-1.5 text-xs font-medium text-wh-text-secondary transition-colors hover:bg-wh-border/50 hover:text-wh-text-primary"
      >
        Reports
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-lg border border-wh-border bg-wh-panel shadow-lg">
          <div className="flex items-center justify-between border-b border-wh-border px-3 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-wh-text-secondary/70">
              Reports
            </span>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating}
              className="rounded bg-wh-accent-teal/15 px-2 py-0.5 text-[10px] font-medium text-wh-accent-teal transition-colors hover:bg-wh-accent-teal/25 disabled:opacity-50"
            >
              {generating ? 'Generating...' : '+ New Report'}
            </button>
          </div>

          <div className="max-h-60 overflow-y-auto">
            {loading && (
              <div className="p-3 text-[10px] text-wh-text-secondary/50">Loading...</div>
            )}
            {!loading && reports.length === 0 && (
              <div className="p-3 text-[10px] text-wh-text-secondary/50">No reports yet.</div>
            )}
            {reports.map((r) => (
              <a
                key={r.id}
                href={`/client/${clientId}/report/${r.id}`}
                className="flex items-center gap-2 border-b border-wh-border/30 px-3 py-2 transition-colors hover:bg-wh-border/20 last:border-0"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-wh-text-primary">
                    {new Date(r.date_range_from).toLocaleDateString('en-GB')} – {new Date(r.date_range_to).toLocaleDateString('en-GB')}
                  </p>
                  <p className="text-[9px] text-wh-text-secondary/50">
                    {new Date(r.created_at).toLocaleDateString('en-GB')}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${STATUS_STYLES[r.status]}`}>
                  {STATUS_LABELS[r.status]}
                </span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
