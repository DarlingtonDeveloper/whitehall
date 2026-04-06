'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { AnalysedItem } from '@/lib/export/types';

interface ReportItemCardProps {
  item: AnalysedItem;
  isActive: boolean;
  onClick: () => void;
  onUpdate: (item: AnalysedItem) => void;
  onRemove: () => void;
}

const RAG_CYCLE: Array<'RED' | 'AMBER' | 'GREEN'> = ['GREEN', 'AMBER', 'RED'];
const ESCALATION_CYCLE: Array<'STANDARD' | 'HIGH' | 'IMMEDIATE'> = ['STANDARD', 'HIGH', 'IMMEDIATE'];

const RAG_STYLES: Record<string, string> = {
  RED: 'bg-red-500',
  AMBER: 'bg-amber-500',
  GREEN: 'bg-green-500',
};

const ESCALATION_STYLES: Record<string, string> = {
  IMMEDIATE: 'bg-red-500/15 text-red-400',
  HIGH: 'bg-amber-500/15 text-amber-400',
  STANDARD: 'bg-wh-border/60 text-wh-text-secondary/70',
};

export default function ReportItemCard({
  item,
  isActive,
  onClick,
  onUpdate,
  onRemove,
}: ReportItemCardProps) {
  const [editingField, setEditingField] = useState<string | null>(null);

  const cycleRag = useCallback(() => {
    const idx = RAG_CYCLE.indexOf(item.rag);
    const next = RAG_CYCLE[(idx + 1) % RAG_CYCLE.length];
    onUpdate({ ...item, rag: next });
  }, [item, onUpdate]);

  const cycleEscalation = useCallback(() => {
    const idx = ESCALATION_CYCLE.indexOf(item.escalation);
    const next = ESCALATION_CYCLE[(idx + 1) % ESCALATION_CYCLE.length];
    onUpdate({ ...item, escalation: next });
  }, [item, onUpdate]);

  const handleFieldSave = useCallback(
    (field: keyof AnalysedItem, value: string) => {
      onUpdate({ ...item, [field]: value });
      setEditingField(null);
    },
    [item, onUpdate],
  );

  return (
    <div
      onClick={onClick}
      className={`rounded-lg border bg-wh-panel p-4 transition-all cursor-pointer ${
        isActive
          ? 'border-wh-accent-teal/50 shadow-[0_0_0_1px_rgba(45,212,191,0.15)]'
          : 'border-wh-border hover:border-wh-border/80'
      }`}
    >
      {/* Header row: ref, RAG, headline, escalation, remove */}
      <div className="flex items-start gap-2">
        <span className="shrink-0 rounded bg-wh-border/60 px-1.5 py-0.5 text-[10px] font-medium text-wh-text-secondary">
          {item.ref}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); cycleRag(); }}
          className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${RAG_STYLES[item.rag]} transition-colors hover:opacity-80`}
          title={`RAG: ${item.rag} (click to cycle)`}
        />
        <div className="flex-1 min-w-0">
          <EditableText
            value={item.headline}
            isEditing={editingField === 'headline'}
            onStartEdit={() => setEditingField('headline')}
            onSave={(v) => handleFieldSave('headline', v)}
            className="text-xs font-medium text-wh-text-primary"
          />
          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-wh-text-secondary/60">
            <span>{item.date}</span>
            <span>·</span>
            <span>{item.source}</span>
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); cycleEscalation(); }}
          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${ESCALATION_STYLES[item.escalation]}`}
          title={`Escalation: ${item.escalation} (click to cycle)`}
        >
          {item.escalation}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="shrink-0 rounded p-0.5 text-wh-text-secondary/30 transition-colors hover:bg-red-500/10 hover:text-red-400"
          title="Remove item"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Summary */}
      <div className="mt-3">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-wh-text-secondary/50">Summary</span>
        <EditableText
          value={item.summary}
          isEditing={editingField === 'summary'}
          onStartEdit={() => setEditingField('summary')}
          onSave={(v) => handleFieldSave('summary', v)}
          className="mt-1 text-xs leading-relaxed text-wh-text-secondary"
          multiline
        />
      </div>

      {/* Client Relevance */}
      <div className="mt-3">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-wh-accent-teal/50">Client Relevance</span>
        <EditableText
          value={item.client_relevance}
          isEditing={editingField === 'client_relevance'}
          onStartEdit={() => setEditingField('client_relevance')}
          onSave={(v) => handleFieldSave('client_relevance', v)}
          className="mt-1 text-xs leading-relaxed text-wh-accent-teal/70"
          multiline
        />
      </div>

      {/* Recommended Action */}
      <div className="mt-3">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-wh-text-secondary/50">Action</span>
        <EditableText
          value={item.recommended_action}
          isEditing={editingField === 'recommended_action'}
          onStartEdit={() => setEditingField('recommended_action')}
          onSave={(v) => handleFieldSave('recommended_action', v)}
          className="mt-1 text-xs font-medium text-wh-text-primary"
        />
      </div>

      {/* Confidence indicator */}
      {item.confidence < 0.7 && (
        <div className="mt-2 flex items-center gap-1">
          <span className="text-[9px] text-amber-400/60">
            {item.confidence < 0.5 ? '[UNVERIFIED]' : '[Low confidence]'}
          </span>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Inline editable text                                               */
/* ------------------------------------------------------------------ */

function EditableText({
  value,
  isEditing,
  onStartEdit,
  onSave,
  className,
  multiline,
}: {
  value: string;
  isEditing: boolean;
  onStartEdit: () => void;
  onSave: (value: string) => void;
  className?: string;
  multiline?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      setDraft(value);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isEditing, value]);

  const commit = () => {
    if (draft.trim() !== value) {
      onSave(draft.trim());
    } else {
      onSave(value); // cancel without change
    }
  };

  if (!isEditing) {
    return (
      <p
        onClick={(e) => { e.stopPropagation(); onStartEdit(); }}
        className={`${className} cursor-text hover:bg-wh-border/20 rounded px-1 -mx-1 transition-colors`}
      >
        {value}
      </p>
    );
  }

  if (multiline) {
    return (
      <textarea
        ref={inputRef as React.RefObject<HTMLTextAreaElement>}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { onSave(value); }
        }}
        onClick={(e) => e.stopPropagation()}
        rows={3}
        className={`${className} w-full resize-none rounded border border-wh-accent-teal/30 bg-wh-bg px-2 py-1.5 outline-none focus:border-wh-accent-teal/50`}
      />
    );
  }

  return (
    <input
      ref={inputRef as React.RefObject<HTMLInputElement>}
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') onSave(value);
      }}
      onClick={(e) => e.stopPropagation()}
      className={`${className} w-full rounded border border-wh-accent-teal/30 bg-wh-bg px-2 py-1 outline-none focus:border-wh-accent-teal/50`}
    />
  );
}
