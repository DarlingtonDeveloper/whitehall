'use client';

import { useMemo, useState, useCallback, useRef, useEffect, type KeyboardEvent } from 'react';
import type { ClientConfig } from '@/types/client';
import { getEntity } from '@/data/entities';
import { selectEntity, selectClient, usePanelStore, toggleSource, openIntelligence } from '@/lib/panelStore';
import { dispatchChatAction } from '@/lib/chatActions';
import {
  useClientOverrides,
  type KeywordField,
  type KeywordEntry,
  type ThemeEntry,
} from '@/lib/clientOverrides';
import { supabase } from '@/lib/db';
import { computePulseScore, getPulseLevel } from '@/lib/graph/pulse';
import type { FeedItem } from '@/types/feed';
import ExportButton from '@/components/export/ExportButton';
import ClientHealthDashboard from './ClientHealthDashboard';
import type { ReportStatus } from '@/types/report';
import type { AnalysisJSON } from '@/lib/export/types';

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

  // Fetch feed items for pulse scoring
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  useEffect(() => {
    const stakeholderIds = client.stakeholders.map((s) => s.entityId);
    if (stakeholderIds.length === 0) return;
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    supabase
      .from('feed_items')
      .select('*')
      .overlaps('entity_ids', stakeholderIds)
      .gte('published_at', oneWeekAgo)
      .order('published_at', { ascending: false })
      .limit(500)
      .then(({ data }) => setFeedItems((data as FeedItem[]) ?? []));
  }, [client.id]);

  // Compute per-entity item counts and pulse levels
  const entityStats = useMemo(() => {
    const stats = new Map<string, { count: number; pulseLevel: 'none' | 'low' | 'medium' | 'high' }>();
    for (const s of client.stakeholders) {
      const count = feedItems.filter((item) => item.entity_ids.includes(s.entityId)).length;
      const score = computePulseScore(s.entityId, feedItems);
      stats.set(s.entityId, { count, pulseLevel: getPulseLevel(score) });
    }
    return stats;
  }, [client.stakeholders, feedItems]);

  return (
    <div className="flex h-full flex-col">
      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-3 space-y-3">
        {/* Header: name + sector + X button */}
        <div className="px-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-wh-accent-teal" />
              <h1 className="text-lg font-semibold text-wh-text-primary truncate">
                {client.name}
              </h1>
              <span className="shrink-0 rounded-full bg-wh-accent-teal/10 px-2.5 py-0.5 text-[10px] font-medium capitalize text-wh-accent-teal">
                {client.sector}
              </span>
            </div>
            <button
              type="button"
              onClick={() => selectClient(null)}
              className="w-6 h-6 flex items-center justify-center rounded
                         text-wh-text-secondary/50 hover:text-wh-text-primary
                         hover:bg-wh-bg transition-colors shrink-0"
              title="Close client view"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Report status line */}
          <ReportStatusLine clientId={client.id} />
        </div>

        {/* Health dashboard */}
        <ClientHealthDashboard client={client} />

        {/* Stakeholder groups — collapsible */}
        <div className="space-y-0.5">
          <CollapsibleSection
            title="Primary stakeholders"
            count={grouped.primary.length}
            defaultOpen
          >
            <StakeholderList
              items={grouped.primary}
              disabledSourceIds={disabledSourceIds}
              entityStats={entityStats}
            />
          </CollapsibleSection>
          <CollapsibleSection
            title="Secondary stakeholders"
            count={grouped.secondary.length}
          >
            <StakeholderList
              items={grouped.secondary}
              disabledSourceIds={disabledSourceIds}
              entityStats={entityStats}
            />
          </CollapsibleSection>
          <CollapsibleSection
            title="Tertiary stakeholders"
            count={grouped.tertiary.length}
          >
            <StakeholderList
              items={grouped.tertiary}
              disabledSourceIds={disabledSourceIds}
              entityStats={entityStats}
            />
          </CollapsibleSection>
        </div>

        {/* Keyword sections — collapsible */}
        <div className="space-y-0.5 border-t border-wh-border/50 pt-2">
          {KEYWORD_SECTIONS.map(({ field, label }) => {
            const entries = overrides.keywordSections[field];
            return (
              <CollapsibleSection
                key={field}
                title={label}
                count={entries.filter((e) => e.enabled).length}
              >
                <KeywordSection
                  entries={entries}
                  onToggle={overrides.toggleKeyword}
                  onAdd={(v) => overrides.addKeyword(field, v)}
                  onRemove={(v) => overrides.removeKeyword(field, v)}
                  fieldLabel={label}
                />
              </CollapsibleSection>
            );
          })}
        </div>

        {/* Monitoring Themes — collapsible */}
        <div className="border-t border-wh-border/50 pt-2 space-y-0.5">
          <CollapsibleSection
            title="Monitoring Themes"
            count={overrides.themeEntries.length}
          >
            <div>
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
              <div className="px-1 py-1.5">
                <button
                  type="button"
                  onClick={overrides.addTheme}
                  className="text-[10px] font-medium text-wh-accent-teal hover:text-wh-accent-teal/80 transition-colors"
                >
                  + Add Theme
                </button>
              </div>
            </div>
          </CollapsibleSection>
        </div>
      </div>

      {/* Fixed bottom bar — actions */}
      <div className="shrink-0 border-t border-wh-border px-3 py-2.5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              openIntelligence();
              dispatchChatAction({
                message:
                  'Give me a brief intelligence summary for this week. What are the most important developments, any deadlines approaching, and what should we be paying attention to? Be concise — bullet the key items with dates and action needed.',
                isBriefing: true,
              });
            }}
            className="flex items-center gap-1.5 rounded-lg border border-wh-border px-3 py-1.5 text-xs font-medium
                       text-wh-text-primary hover:border-wh-accent-teal transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            Morning briefing
          </button>
          <ExportButton clientId={client.id} />
          <ReportListButton clientId={client.id} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Collapsible section wrapper                                        */
/* ------------------------------------------------------------------ */

function CollapsibleSection({
  title,
  count,
  defaultOpen = false,
  children,
}: {
  title: string;
  count: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-1.5 px-1"
      >
        <span className="text-[10px] text-wh-text-secondary/70 uppercase tracking-wider">
          {title}
          <span className="normal-case tracking-normal ml-1 text-wh-text-secondary/40">
            · {count}
          </span>
        </span>
        <span
          className={`text-wh-text-secondary/50 text-xs transition-transform duration-150 ${
            open ? 'rotate-90' : ''
          }`}
        >
          ›
        </span>
      </button>
      {open && children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Report status line                                                  */
/* ------------------------------------------------------------------ */

const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  generating: 'Generating',
  draft: 'Draft',
  in_review: 'In review',
  approved: 'Approved',
  exported: 'Exported',
};

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function ReportStatusLine({ clientId }: { clientId: string }) {
  const [report, setReport] = useState<{
    id: string;
    status: ReportStatus;
    created_at: string;
    sections: AnalysisJSON;
  } | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    supabase
      .from('report_drafts')
      .select('id, status, created_at, sections')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
      .then(({ data }) => {
        setReport(data as typeof report);
        setLoaded(true);
      });
  }, [clientId]);

  if (!loaded) return null;

  if (!report) {
    return (
      <div className="text-xs text-wh-text-secondary/60 mt-1">
        No reports generated yet
      </div>
    );
  }

  const allItems = Object.values(report.sections?.sections || {})
    .flatMap((s: any) => s.items || []);
  const itemCount = allItems.length;
  const redCount = allItems.filter((i: any) => i.rag === 'RED').length;

  return (
    <div className="text-xs text-wh-text-secondary/60 mt-1">
      <a
        href={`/client/${clientId}/report/${report.id}`}
        className="hover:text-wh-accent-teal transition-colors"
      >
        Latest report: {REPORT_STATUS_LABELS[report.status]}
        {' · '}
        {itemCount} items
        {redCount > 0 && (
          <span className="text-red-400"> · {redCount} RED</span>
        )}
        {' · '}
        {formatRelativeTime(report.created_at)}
      </a>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Stakeholder list with pulse-aware dots                             */
/* ------------------------------------------------------------------ */

const PULSE_COLOURS: Record<string, string> = {
  none: 'var(--color-wh-text-secondary)',
  low: '#2dd4bf',   // teal
  medium: '#f59e0b', // amber
  high: '#ef4444',   // red
};

function StakeholderList({
  items,
  disabledSourceIds,
  entityStats,
}: {
  items: { entityId: string; priority: string; role: string }[];
  disabledSourceIds: string[];
  entityStats: Map<string, { count: number; pulseLevel: string }>;
}) {
  if (items.length === 0) return null;

  return (
    <ul className="pb-1">
      {items.map((s) => {
        const entity = getEntity(s.entityId);
        const isEnabled = !disabledSourceIds.includes(s.entityId);
        const stats = entityStats.get(s.entityId);
        const pulseLevel = stats?.pulseLevel ?? 'none';
        const itemCount = stats?.count ?? 0;
        const dotColour = isEnabled
          ? PULSE_COLOURS[pulseLevel] ?? PULSE_COLOURS.none
          : 'var(--color-wh-text-secondary)';

        return (
          <li key={s.entityId} className="flex items-center pr-1">
            <button
              type="button"
              onClick={() => selectEntity(s.entityId)}
              className="flex flex-1 min-w-0 flex-col gap-0.5 px-1 py-1.5 text-left transition-colors hover:bg-wh-border/30 rounded"
            >
              <span className="text-xs font-medium text-wh-text-primary truncate">
                {entity?.name ?? s.entityId}
              </span>
              <span className="text-[10px] text-wh-text-secondary/60 truncate">
                {s.role}
              </span>
            </button>
            <div className="flex items-center gap-2 shrink-0 ml-1">
              {itemCount > 0 && (
                <span className="text-[10px] text-wh-text-secondary/40">
                  {itemCount}
                </span>
              )}
              <button
                type="button"
                aria-label={`${isEnabled ? 'Disable' : 'Enable'} ${entity?.name ?? s.entityId} as feed source`}
                onClick={() => toggleSource(s.entityId)}
                title={
                  isEnabled
                    ? `Active — ${pulseLevel} activity`
                    : 'Disabled as feed source'
                }
              >
                <span
                  className={`block h-3 w-3 rounded-full transition-all ${
                    !isEnabled ? 'opacity-30' : ''
                  }`}
                  style={{ backgroundColor: dotColour }}
                />
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/*  Keyword section — toggle on/off, add new, remove user-added        */
/* ------------------------------------------------------------------ */

function KeywordSection({
  entries,
  onToggle,
  onAdd,
  onRemove,
  fieldLabel,
}: {
  entries: KeywordEntry[];
  onToggle: (value: string) => void;
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
  fieldLabel: string;
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

  return (
    <div className="px-1 py-1">
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
        placeholder={`Add ${fieldLabel.toLowerCase()}...`}
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
    <div className={`border-b border-wh-border/30 px-1 py-2 transition-opacity ${entry.enabled ? '' : 'opacity-40'}`}>
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
        className="w-full rounded-md border border-wh-border px-3 py-1.5 text-xs font-medium text-wh-text-secondary transition-colors hover:bg-wh-border/50 hover:text-wh-text-primary"
      >
        Reports
      </button>

      {open && (
        <div className="absolute left-0 bottom-full z-50 mb-1 w-72 rounded-lg border border-wh-border bg-wh-panel shadow-lg">
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
