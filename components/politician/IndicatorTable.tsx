'use client';

import { useState } from 'react';

interface Indicator {
  indicator_id: string;
  radar: string;
  mean: number;
  confidence: number;
  evidence_count: number;
  label_low: string;
  label_high: string;
  policy_area: string;
  description: string;
}

interface IndicatorTableProps {
  indicators: Indicator[];
}

type SortKey = 'indicator' | 'mean' | 'confidence' | 'evidence';

export default function IndicatorTable({ indicators }: IndicatorTableProps) {
  const [sortBy, setSortBy] = useState<SortKey>('confidence');
  const [filterRadar, setFilterRadar] = useState<string>('all');

  const radars = Array.from(new Set(indicators.map((i) => i.radar)));

  const filtered = filterRadar === 'all'
    ? indicators
    : indicators.filter((i) => i.radar === filterRadar);

  const sorted = [...filtered].sort((a, b) => {
    switch (sortBy) {
      case 'indicator': return a.indicator_id.localeCompare(b.indicator_id);
      case 'mean': return b.mean - a.mean;
      case 'confidence': return b.confidence - a.confidence;
      case 'evidence': return b.evidence_count - a.evidence_count;
    }
  });

  if (indicators.length === 0) {
    return <p className="text-sm text-wh-text-tertiary">No indicators computed yet.</p>;
  }

  return (
    <div>
      {/* Filters */}
      <div className="mb-3 flex items-center gap-2">
        <select
          value={filterRadar}
          onChange={(e) => setFilterRadar(e.target.value)}
          className="rounded border border-wh-border bg-wh-bg px-2 py-1 text-xs text-wh-text-secondary"
        >
          <option value="all">All radars</option>
          {radars.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortKey)}
          className="rounded border border-wh-border bg-wh-bg px-2 py-1 text-xs text-wh-text-secondary"
        >
          <option value="confidence">Sort: Confidence</option>
          <option value="mean">Sort: Position</option>
          <option value="evidence">Sort: Evidence count</option>
          <option value="indicator">Sort: Name</option>
        </select>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded border border-wh-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-wh-border bg-wh-bg/50 text-wh-text-tertiary">
              <th className="px-3 py-2 text-left font-medium">Indicator</th>
              <th className="px-3 py-2 text-right font-medium w-16">Position</th>
              <th className="px-3 py-2 text-left font-medium w-32">Scale</th>
              <th className="px-3 py-2 text-right font-medium w-14">Conf</th>
              <th className="px-3 py-2 text-right font-medium w-10">N</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((ind) => (
              <tr
                key={ind.indicator_id}
                className="border-b border-wh-border/50 last:border-0 hover:bg-wh-accent-teal/5"
              >
                <td className="px-3 py-2">
                  <div className="text-wh-text-primary">{formatIndicatorName(ind.indicator_id)}</div>
                  <div className="text-[10px] text-wh-text-tertiary">{ind.radar} / {ind.policy_area || '—'}</div>
                </td>
                <td className="px-3 py-2 text-right font-mono text-wh-text-primary">
                  {ind.mean.toFixed(2)}
                </td>
                <td className="px-3 py-2">
                  <div className="relative h-1.5 rounded-full bg-wh-border/40">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bg-wh-accent-teal/60"
                      style={{ width: `${ind.mean * 100}%` }}
                    />
                  </div>
                  <div className="mt-0.5 flex justify-between text-[9px] text-wh-text-tertiary">
                    <span className="truncate max-w-[60px]">{ind.label_low.split(' ').slice(0, 2).join(' ')}</span>
                    <span className="truncate max-w-[60px] text-right">{ind.label_high.split(' ').slice(0, 2).join(' ')}</span>
                  </div>
                </td>
                <td className="px-3 py-2 text-right font-mono text-wh-text-secondary">
                  {(ind.confidence * 100).toFixed(0)}%
                </td>
                <td className="px-3 py-2 text-right font-mono text-wh-text-tertiary">
                  {ind.evidence_count}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatIndicatorName(id: string): string {
  // "energy.net_zero.revealed" → "Net Zero"
  const parts = id.split('.');
  const name = parts[1] ?? parts[0];
  const suffix = parts[2] === 'public' ? ' (pub)' : '';
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) + suffix;
}
