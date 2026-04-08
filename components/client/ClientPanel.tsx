'use client';

import { useMemo, useState, useEffect, useRef, useCallback, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
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
import ClientHealthDashboard from './ClientHealthDashboard';
import type { ReportStatus, ReportDraft } from '@/types/report';
import type { AnalysisJSON } from '@/lib/export/types';
import ReportBuilder from '@/components/report/ReportBuilder';

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
  }, [client.id, client.stakeholders]);

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

  // Report generation state — lifted here so progress renders in modal
  const [genState, setGenState] = useState<GenerationState>({
    generating: false,
    completedSteps: new Set(),
    activeStep: null,
    stepDetails: {},
    error: null,
  });

  // Report modal state — holds the draft when viewing/editing
  const [reportDraft, setReportDraft] = useState<ReportDraft | null>(null);

  const handleGenerate = useCallback(async () => {
    setGenState({
      generating: true,
      completedSteps: new Set(),
      activeStep: null,
      stepDetails: {},
      error: null,
    });

    try {
      const res = await fetch('/api/reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: client.id }),
      });

      // Handle non-streaming error responses (rate limit, bad request, etc.)
      if (!res.ok) {
        let errorMsg = `Server error (${res.status})`;
        try {
          const errBody = await res.json();
          errorMsg = errBody.error || errorMsg;
        } catch { /* use default */ }
        setGenState((prev) => ({ ...prev, generating: false, error: errorMsg }));
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setGenState((prev) => ({ ...prev, generating: false, error: 'No response stream' }));
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));

            setGenState((prev) => {
              const completed = new Set(prev.completedSteps);
              const details = { ...prev.stepDetails };

              if (event.step.endsWith('_complete') || event.step === 'complete') {
                completed.add(event.step);
              }
              if (event.detail) {
                details[event.step] = event.detail;
              }

              let active: string | null = event.step;
              if (event.step === 'complete' || event.step === 'error') {
                active = null;
              }

              return {
                ...prev,
                completedSteps: completed,
                activeStep: active,
                stepDetails: details,
                error: event.step === 'error' ? event.detail : prev.error,
              };
            });

            if (event.step === 'complete' && event.detail) {
              // Fetch the draft and show in modal instead of navigating
              fetch(`/api/reports/${event.detail}`)
                .then(r => r.json())
                .then(data => {
                  if (data) setReportDraft(data as ReportDraft);
                })
                .catch(() => {});
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (err) {
      setGenState((prev) => ({
        ...prev,
        generating: false,
        error: err instanceof Error ? err.message : 'Network error',
      }));
    } finally {
      setGenState((prev) => ({ ...prev, generating: false }));
    }
  }, [client.id]);

  // Open an existing report in the modal
  const handleOpenReport = useCallback(async (reportId: string) => {
    const res = await fetch(`/api/reports/${reportId}`);
    if (res.ok) {
      const data = await res.json();
      setReportDraft(data as ReportDraft);
    }
  }, []);

  // Close the report/progress modal
  const handleCloseModal = useCallback(() => {
    setReportDraft(null);
    setGenState(prev => ({ ...prev, generating: false, error: null }));
  }, []);

  // Show modal when generating, error, or viewing a report
  const showModal = genState.generating || genState.error !== null || reportDraft !== null;

  return (
    <div className="flex h-full flex-col">
      {/* Report modal — portalled to body, shows progress or report builder */}
      {showModal && createPortal(
        reportDraft ? (
          <ReportModal draft={reportDraft} clientName={client.name} onClose={handleCloseModal} />
        ) : (
          <ReportGenerationModal state={genState} onClose={handleCloseModal} />
        ),
        document.body,
      )}

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
              aria-label="Close client view"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Report status line */}
          <ReportStatusLine clientId={client.id} onOpenReport={handleOpenReport} />
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
          <button
            type="button"
            onClick={handleGenerate}
            disabled={genState.generating}
            className="flex items-center gap-2 rounded-lg bg-wh-accent-teal/15 px-3 py-1.5 text-xs font-medium text-wh-accent-teal transition-all hover:bg-wh-accent-teal/25 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {genState.generating ? (
              <>
                <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Generating...
              </>
            ) : (
              <>
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                Generate report
              </>
            )}
          </button>
          <ReportListButton clientId={client.id} onGenerate={handleGenerate} onOpenReport={handleOpenReport} generating={genState.generating} />
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

function ReportStatusLine({ clientId, onOpenReport }: { clientId: string; onOpenReport: (id: string) => void }) {
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .flatMap((s: any) => s.items || []) as Array<{ rag?: string }>;
  const itemCount = allItems.length;
  const redCount = allItems.filter((i) => i.rag === 'RED').length;

  return (
    <div className="text-xs text-wh-text-secondary/60 mt-1">
      <button
        type="button"
        onClick={() => onOpenReport(report.id)}
        className="hover:text-wh-accent-teal transition-colors text-left"
      >
        Latest report: {REPORT_STATUS_LABELS[report.status]}
        {' · '}
        {itemCount} items
        {redCount > 0 && (
          <span className="text-red-400"> · {redCount} RED</span>
        )}
        {' · '}
        {formatRelativeTime(report.created_at)}
      </button>
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
/*  Report list button + portal dropdown + generation progress          */
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

/** Pipeline steps in order — used to render the full progress timeline */
const PIPELINE_STEPS = [
  { key: 'scan', label: 'Scanning sources', doneKey: 'scan_complete' },
  { key: 'enrich_content', label: 'Enriching content', doneKey: 'enrich_content_complete' },
  { key: 'gather', label: 'Gathering items', doneKey: 'gather_complete' },
  { key: 'score', label: 'Scoring relevance', doneKey: 'score_complete' },
  { key: 'dedup', label: 'Deduplicating', doneKey: 'dedup_complete' },
  { key: 'verify', label: 'Verifying sources', doneKey: 'verify_complete' },
  { key: 'group', label: 'Grouping themes', doneKey: 'group_complete' },
  { key: 'enrich', label: 'AI analysis', doneKey: 'enrich_complete' },
  { key: 'evaluate', label: 'Quality checks', doneKey: 'evaluate_complete' },
  { key: 'save', label: 'Saving draft', doneKey: 'complete' },
] as const;

interface GenerationState {
  generating: boolean;
  completedSteps: Set<string>;
  activeStep: string | null;
  stepDetails: Record<string, string>;
  error: string | null;
}

function ReportListButton({
  clientId,
  onGenerate,
  onOpenReport,
  generating,
}: {
  clientId: string;
  onGenerate: () => void;
  onOpenReport: (reportId: string) => void;
  generating: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reports, setReports] = useState<ReportListItem[]>([]);
  const [loading, setLoading] = useState(false);

  // Portal dropdown positioning
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null);

  const updateDropdownPos = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setDropdownPos({ top: rect.top, left: rect.left });
  }, []);

  useEffect(() => {
    if (!open) return;
    updateDropdownPos();
    window.addEventListener('scroll', updateDropdownPos, true);
    window.addEventListener('resize', updateDropdownPos);
    return () => {
      window.removeEventListener('scroll', updateDropdownPos, true);
      window.removeEventListener('resize', updateDropdownPos);
    };
  }, [open, updateDropdownPos]);

  // Close dropdown on outside click
  const dropdownRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: sync loading state with async fetch
    setLoading(true);
    let cancelled = false;
    supabase
      .from('report_drafts')
      .select('id, status, date_range_from, date_range_to, created_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(10)
      .then(({ data }) => {
        if (!cancelled) {
          setReports((data as ReportListItem[]) ?? []);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [open, clientId]);

  const handleClickGenerate = () => {
    setOpen(false);
    onGenerate();
  };

  const dropdown = open && dropdownPos && createPortal(
    <div
      ref={dropdownRef}
      className="fixed z-[9999] w-72 rounded-lg border border-wh-border bg-wh-panel shadow-lg"
      style={{
        left: dropdownPos.left,
        top: dropdownPos.top - 4,
        transform: 'translateY(-100%)',
      }}
    >
      <div className="flex items-center justify-between border-b border-wh-border px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-wh-text-secondary/70">
          Reports
        </span>
        <button
          type="button"
          onClick={handleClickGenerate}
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
          <button
            key={r.id}
            type="button"
            onClick={() => { setOpen(false); onOpenReport(r.id); }}
            className="w-full flex items-center gap-2 border-b border-wh-border/30 px-3 py-2 transition-colors hover:bg-wh-border/20 last:border-0 text-left"
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
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full rounded-md border border-wh-border px-3 py-1.5 text-xs font-medium text-wh-text-secondary transition-colors hover:bg-wh-border/50 hover:text-wh-text-primary"
      >
        Reports
      </button>
      {dropdown}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Report modal — full screen overlay with ReportBuilder               */
/* ------------------------------------------------------------------ */

function ReportModal({
  draft,
  clientName,
  onClose,
}: {
  draft: ReportDraft;
  clientName: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[9999] flex flex-col bg-wh-bg">
      {/* Top bar with close */}
      <div className="flex items-center justify-between shrink-0 border-b border-wh-border px-2 py-1.5 bg-wh-panel">
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-wh-text-secondary hover:text-wh-text-primary hover:bg-wh-border/30 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
          Back to client
        </button>
      </div>

      {/* ReportBuilder fills remaining space */}
      <div className="flex-1 overflow-hidden">
        <ReportBuilder draft={draft} clientName={clientName} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Pipeline progress modal — full overlay portal, impossible to miss   */
/* ------------------------------------------------------------------ */

function ReportGenerationModal({
  state,
  onClose,
}: {
  state: GenerationState;
  onClose: () => void;
}) {
  const completedCount = PIPELINE_STEPS.filter(s => state.completedSteps.has(s.doneKey)).length;
  const progressPct = Math.round((completedCount / PIPELINE_STEPS.length) * 100);

  // Elapsed time
  const [startTime] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!state.generating) return;
    const interval = setInterval(() => setElapsed(Date.now() - startTime), 1000);
    return () => clearInterval(interval);
  }, [state.generating, startTime]);
  const mins = Math.floor(elapsed / 60000);
  const secs = Math.floor((elapsed % 60000) / 1000);
  const elapsedStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal */}
      <div className="relative w-full max-w-md mx-4 rounded-xl border border-wh-border bg-wh-panel shadow-2xl overflow-hidden">
        {/* Progress bar */}
        <div className="h-1 bg-wh-border/30">
          <div
            className="h-full bg-wh-accent-teal transition-all duration-700 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <div className="flex items-center gap-2.5">
            {state.generating && !state.error ? (
              <div className="h-2.5 w-2.5 rounded-full bg-wh-accent-teal animate-pulse" />
            ) : state.error ? (
              <div className="h-2.5 w-2.5 rounded-full bg-red-400" />
            ) : (
              <div className="h-2.5 w-2.5 rounded-full bg-wh-accent-teal" />
            )}
            <span className="text-sm font-semibold text-wh-text-primary">
              {state.error ? 'Generation Failed' : 'Generating Report'}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {state.generating && (
              <span className="text-[10px] text-wh-text-secondary/50 tabular-nums">
                {elapsedStr}
              </span>
            )}
            {!state.generating && (
              <button
                type="button"
                onClick={onClose}
                className="text-wh-text-secondary/50 hover:text-wh-text-primary transition-colors"
                aria-label="Close"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Step progress */}
        <div className="text-[10px] text-wh-text-secondary/40 px-5 pb-3">
          Step {Math.min(completedCount + 1, PIPELINE_STEPS.length)} of {PIPELINE_STEPS.length}
          {progressPct > 0 && ` — ${progressPct}%`}
        </div>

        {/* Timeline */}
        <div className="px-5 pb-5 max-h-[50vh] overflow-y-auto">
          <div className="space-y-0">
            {PIPELINE_STEPS.map((step, i) => {
              const isCompleted = state.completedSteps.has(step.doneKey);
              const isActive =
                !isCompleted &&
                state.activeStep !== null &&
                (state.activeStep === step.key || state.activeStep === step.doneKey);
              const detail = state.stepDetails[step.doneKey] || state.stepDetails[step.key];
              const isLast = i === PIPELINE_STEPS.length - 1;

              return (
                <div key={step.key} className="flex gap-3">
                  {/* Timeline line + dot */}
                  <div className="flex flex-col items-center">
                    <div
                      className={`h-5 w-5 rounded-full flex items-center justify-center shrink-0 transition-all duration-300 ${
                        isCompleted
                          ? 'bg-wh-accent-teal/20'
                          : isActive
                          ? 'bg-wh-accent-teal/10 ring-2 ring-wh-accent-teal/40'
                          : 'bg-wh-border/30'
                      }`}
                    >
                      {isCompleted ? (
                        <svg className="h-3 w-3 text-wh-accent-teal" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                      ) : isActive ? (
                        <div className="h-2 w-2 rounded-full bg-wh-accent-teal animate-pulse" />
                      ) : (
                        <div className="h-1.5 w-1.5 rounded-full bg-wh-text-secondary/15" />
                      )}
                    </div>
                    {!isLast && (
                      <div
                        className={`w-px flex-1 min-h-[12px] transition-colors duration-300 ${
                          isCompleted ? 'bg-wh-accent-teal/30' : 'bg-wh-border/30'
                        }`}
                      />
                    )}
                  </div>

                  {/* Label + detail */}
                  <div className={`pb-2.5 ${isLast ? 'pb-0' : ''}`}>
                    <span
                      className={`text-xs font-medium transition-colors duration-300 ${
                        isCompleted
                          ? 'text-wh-text-secondary/60'
                          : isActive
                          ? 'text-wh-text-primary'
                          : 'text-wh-text-secondary/25'
                      }`}
                    >
                      {step.label}
                    </span>
                    {detail && (isCompleted || isActive) && (
                      <p className="text-[10px] text-wh-text-secondary/50 mt-0.5">
                        {detail}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Error state */}
        {state.error && (
          <div className="mx-5 mb-5 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3">
            <p className="text-xs font-medium text-red-400">Generation failed</p>
            <p className="text-[10px] text-red-400/70 mt-1 leading-relaxed">{state.error}</p>
          </div>
        )}
      </div>
    </div>
  );
}
