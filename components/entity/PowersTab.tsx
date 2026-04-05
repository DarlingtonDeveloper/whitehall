'use client';

import { useState, useMemo } from 'react';
import type { PowerRecord, Power, PowerSource } from '@/types/entity';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

type PowerType = Power['powerType'];

const TYPE_STYLES: Record<PowerType, { bg: string; text: string; label: string }> = {
  power: { bg: 'bg-blue-500/15', text: 'text-blue-400', label: 'Power' },
  duty: { bg: 'bg-amber-500/15', text: 'text-amber-400', label: 'Duty' },
  function: { bg: 'bg-teal-500/15', text: 'text-teal-400', label: 'Function' },
  responsibility: {
    bg: 'bg-purple-500/15',
    text: 'text-purple-400',
    label: 'Responsibility',
  },
};

const SOURCE_TYPE_ICONS: Record<PowerSource['type'], string> = {
  act: '\u00a7', // section mark
  'statutory-instrument': 'SI',
  prerogative: '\u2655', // crown symbol
  'case-law': '\u2696', // scales
  convention: '\u2709', // convention envelope
};

const FILTER_OPTIONS: { value: PowerType | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'power', label: 'Powers' },
  { value: 'duty', label: 'Duties' },
  { value: 'function', label: 'Functions' },
  { value: 'responsibility', label: 'Responsibilities' },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface PowersTabProps {
  powers: PowerRecord;
}

export default function PowersTab({ powers }: PowersTabProps) {
  const [filter, setFilter] = useState<PowerType | 'all'>('all');

  const filtered = useMemo(() => {
    if (filter === 'all') return powers.powers;
    return powers.powers.filter((p) => p.powerType === filter);
  }, [powers.powers, filter]);

  // Count per type for filter badges
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: powers.powers.length };
    for (const p of powers.powers) {
      c[p.powerType] = (c[p.powerType] ?? 0) + 1;
    }
    return c;
  }, [powers.powers]);

  return (
    <div className="flex flex-col">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-wh-border/50 px-4 py-3">
        {FILTER_OPTIONS.map((opt) => {
          const count = counts[opt.value] ?? 0;
          if (opt.value !== 'all' && count === 0) return null;
          const isActive = filter === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setFilter(opt.value)}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                isActive
                  ? 'bg-wh-accent-teal/15 text-wh-accent-teal'
                  : 'text-wh-text-secondary hover:bg-wh-border/40 hover:text-wh-text-primary'
              }`}
            >
              {opt.label}
              <span className="ml-1 text-[10px] opacity-60">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Powers list */}
      <div className="space-y-px p-4">
        {filtered.length === 0 && (
          <p className="py-8 text-center text-xs text-wh-text-secondary/50">
            No items match the current filter.
          </p>
        )}
        {filtered.map((power) => (
          <PowerCard key={power.id} power={power} />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Individual power card                                              */
/* ------------------------------------------------------------------ */

function PowerCard({ power }: { power: Power }) {
  const style = TYPE_STYLES[power.powerType];

  return (
    <div className="rounded-md border border-wh-border/50 p-3 mb-2">
      {/* Type badge + title */}
      <div className="flex items-start gap-2">
        <span
          className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${style.bg} ${style.text}`}
        >
          {style.label}
        </span>
        <h3 className="text-xs font-semibold leading-snug text-wh-text-primary">
          {power.title}
        </h3>
      </div>

      {/* Description */}
      <p className="mt-2 text-[11px] leading-relaxed text-wh-text-secondary">
        {power.description}
      </p>

      {/* In force */}
      {power.inForceFrom && (
        <p className="mt-2 text-[10px] text-wh-text-secondary/50">
          In force since {power.inForceFrom}
        </p>
      )}

      {/* Sources */}
      {power.sources.length > 0 && (
        <div className="mt-2.5 space-y-1">
          {power.sources.map((src, idx) => (
            <SourceRow key={idx} source={src} />
          ))}
        </div>
      )}

      {/* Notes */}
      {power.notes && (
        <div className="mt-2.5 rounded border border-wh-border/40 bg-wh-bg/50 px-2.5 py-2">
          <p className="text-[10px] leading-relaxed text-wh-text-secondary/70">
            {power.notes}
          </p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Source row                                                         */
/* ------------------------------------------------------------------ */

function SourceRow({ source }: { source: PowerSource }) {
  const icon = SOURCE_TYPE_ICONS[source.type] ?? '\u00b7';

  return (
    <div className="flex items-start gap-2 text-[10px]">
      <span className="mt-px shrink-0 font-mono text-wh-text-secondary/40">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <span className="text-wh-text-secondary">
          {source.title}
          {source.year != null && (
            <span className="text-wh-text-secondary/50"> ({source.year})</span>
          )}
          {source.section && (
            <span className="text-wh-text-secondary/50">
              {' '}
              &mdash; {source.section}
            </span>
          )}
        </span>
        {source.legislationUrl && (
          <a
            href={source.legislationUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-1.5 text-wh-accent-teal/70 transition-colors hover:text-wh-accent-teal"
          >
            legislation.gov.uk &rarr;
          </a>
        )}
        {source.notes && (
          <span className="block text-wh-text-secondary/50">{source.notes}</span>
        )}
      </div>
    </div>
  );
}
