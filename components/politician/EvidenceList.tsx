'use client';

import { useState } from 'react';

interface EvidenceRow {
  id: number;
  evidence_type: string;
  occurred_at: string;
  raw_content: string | null;
  parsed: Record<string, unknown>;
  topic_tags: string[];
  source_url: string | null;
}

interface ClassificationRow {
  evidence_id: number;
  indicator_id: string;
  anchor: number;
  effective_weight: number;
  classifier_reasoning: string | null;
}

interface EvidenceListProps {
  evidence: EvidenceRow[];
  classifications: Map<number, ClassificationRow[]>;
  definitions: Map<string, { label_low: string; label_high: string }>;
}

const TYPE_LABELS: Record<string, string> = {
  division_vote: 'Vote',
  chamber_speech: 'Speech',
  committee_speech: 'Committee',
  committee_question: 'Committee Q',
  written_question_asked: 'Written Q',
  written_question_answered: 'Written A',
  oral_question_asked: 'Oral Q',
  oral_question_answered: 'Oral A',
  edm_signature: 'EDM',
  edm_proposed: 'EDM (proposed)',
  amendment_tabled: 'Amendment',
  register_of_interests: 'Register',
  appg_membership: 'APPG',
  committee_membership: 'Committee',
  social_post: 'Social',
};

const TYPE_COLOURS: Record<string, string> = {
  division_vote: 'bg-blue-500/20 text-blue-400',
  chamber_speech: 'bg-emerald-500/20 text-emerald-400',
  committee_speech: 'bg-cyan-500/20 text-cyan-400',
  written_question_asked: 'bg-violet-500/20 text-violet-400',
  edm_signature: 'bg-amber-500/20 text-amber-400',
  register_of_interests: 'bg-rose-500/20 text-rose-400',
  appg_membership: 'bg-orange-500/20 text-orange-400',
};

type FilterType = 'all' | 'classified' | string;

export default function EvidenceList({ evidence, classifications, definitions }: EvidenceListProps) {
  const [filter, setFilter] = useState<FilterType>('all');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const types = Array.from(new Set(evidence.map((e) => e.evidence_type)));

  const filtered = evidence.filter((e) => {
    if (filter === 'all') return true;
    if (filter === 'classified') return classifications.has(e.id);
    return e.evidence_type === filter;
  });

  const toggle = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Filter */}
      <div className="mb-2 flex flex-wrap gap-1.5">
        <FilterButton active={filter === 'all'} onClick={() => setFilter('all')}>All</FilterButton>
        <FilterButton active={filter === 'classified'} onClick={() => setFilter('classified')}>
          Classified ({Array.from(classifications.keys()).length})
        </FilterButton>
        {types.slice(0, 6).map((t) => (
          <FilterButton key={t} active={filter === t} onClick={() => setFilter(t)}>
            {TYPE_LABELS[t] ?? t}
          </FilterButton>
        ))}
      </div>

      {/* Evidence items */}
      {filtered.length === 0 ? (
        <p className="text-sm text-wh-text-tertiary">No evidence matching filter.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {filtered.map((e) => (
            <EvidenceItem
              key={e.id}
              evidence={e}
              classifications={classifications.get(e.id)}
              definitions={definitions}
              isExpanded={expanded.has(e.id)}
              onToggle={() => toggle(e.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EvidenceItem({
  evidence,
  classifications,
  definitions,
  isExpanded,
  onToggle,
}: {
  evidence: EvidenceRow;
  classifications?: ClassificationRow[];
  definitions: Map<string, { label_low: string; label_high: string }>;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const title = getEvidenceTitle(evidence);
  const date = new Date(evidence.occurred_at).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
  const typeColour = TYPE_COLOURS[evidence.evidence_type] ?? 'bg-gray-500/20 text-gray-400';

  return (
    <div className="rounded border border-wh-border/50 bg-wh-bg/30 hover:border-wh-border transition-colors">
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-3 py-2 text-left"
      >
        <div className="flex items-start gap-2">
          <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${typeColour}`}>
            {TYPE_LABELS[evidence.evidence_type] ?? evidence.evidence_type}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-wh-text-primary truncate">{title}</p>
            <p className="text-[10px] text-wh-text-tertiary mt-0.5">{date}</p>
          </div>
          {classifications && classifications.length > 0 && (
            <span className="shrink-0 rounded-full bg-wh-accent-teal/10 px-1.5 py-0.5 text-[10px] text-wh-accent-teal">
              {classifications.length} ind
            </span>
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-wh-border/30 px-3 py-2">
          {/* Content preview */}
          {evidence.raw_content && (
            <p className="mb-2 text-[11px] text-wh-text-secondary line-clamp-4 whitespace-pre-wrap">
              {evidence.raw_content.slice(0, 500)}
            </p>
          )}

          {/* Topic tags */}
          {evidence.topic_tags.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1">
              {evidence.topic_tags.map((tag) => (
                <span key={tag} className="rounded bg-wh-border/30 px-1.5 py-0.5 text-[10px] text-wh-text-tertiary">
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Classifications */}
          {classifications && classifications.length > 0 && (
            <div className="mt-2 border-t border-wh-border/20 pt-2">
              <p className="mb-1 text-[10px] text-wh-text-tertiary uppercase tracking-wider">Classifications</p>
              {classifications.map((c, i) => {
                const def = definitions.get(c.indicator_id);
                return (
                  <div key={i} className="flex items-center gap-2 py-0.5 text-[11px]">
                    <span className="font-mono text-wh-accent-teal">{c.anchor.toFixed(2)}</span>
                    <span className="text-wh-text-secondary">{formatIndicator(c.indicator_id)}</span>
                    {c.classifier_reasoning && (
                      <span className="text-wh-text-tertiary truncate text-[10px]">
                        — {c.classifier_reasoning}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Source link */}
          {evidence.source_url && (
            <a
              href={evidence.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block text-[10px] text-wh-accent-teal hover:underline"
            >
              View source
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-2 py-1 text-[10px] transition-colors ${
        active
          ? 'bg-wh-accent-teal/20 text-wh-accent-teal border border-wh-accent-teal/30'
          : 'bg-wh-bg/50 text-wh-text-tertiary border border-wh-border/50 hover:text-wh-text-secondary'
      }`}
    >
      {children}
    </button>
  );
}

function getEvidenceTitle(e: EvidenceRow): string {
  const p = e.parsed;
  switch (e.evidence_type) {
    case 'division_vote':
      return `${(p as any).vote?.toUpperCase()} — ${(p as any).division_title ?? 'Division'}`;
    case 'chamber_speech':
    case 'committee_speech':
      return (p as any).debate_title ?? e.raw_content?.slice(0, 80) ?? 'Speech';
    case 'written_question_asked':
      return (p as any).question_text?.slice(0, 80) ?? e.raw_content?.slice(0, 80) ?? 'Written Question';
    case 'edm_signature':
    case 'edm_proposed':
      return (p as any).edm_title ?? 'EDM';
    case 'appg_membership':
      return `${(p as any).appg_name ?? 'APPG'} (${(p as any).role ?? 'member'})`;
    case 'register_of_interests':
      return `${(p as any).category ?? 'Register'}: ${(p as any).description?.slice(0, 60) ?? ''}`;
    default:
      return e.raw_content?.slice(0, 80) ?? e.evidence_type;
  }
}

function formatIndicator(id: string): string {
  const parts = id.split('.');
  const name = parts[1] ?? parts[0];
  return name.replace(/_/g, ' ');
}
