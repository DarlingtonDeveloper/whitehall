'use client';

import { useState } from 'react';
import Link from 'next/link';

interface PoliticianRow {
  id: string;
  display_name: string;
  party: string | null;
  constituency: string | null;
  house: string;
  status: string;
  portrait_url: string | null;
}

export default function PoliticianSearch({ politicians }: { politicians: PoliticianRow[] }) {
  const [query, setQuery] = useState('');
  const [partyFilter, setPartyFilter] = useState<string>('all');

  const parties = Array.from(new Set(politicians.map((p) => p.party).filter(Boolean))).sort() as string[];

  const filtered = politicians.filter((p) => {
    if (partyFilter !== 'all' && p.party !== partyFilter) return false;
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      p.display_name.toLowerCase().includes(q) ||
      p.constituency?.toLowerCase().includes(q) ||
      p.id.includes(q)
    );
  });

  return (
    <div>
      {/* Search + Filter */}
      <div className="mb-4 flex items-center gap-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or constituency..."
          className="flex-1 rounded border border-wh-border bg-wh-bg px-3 py-2 text-sm text-wh-text-primary placeholder:text-wh-text-tertiary focus:border-wh-accent-teal/50 focus:outline-none"
        />
        <select
          value={partyFilter}
          onChange={(e) => setPartyFilter(e.target.value)}
          className="rounded border border-wh-border bg-wh-bg px-3 py-2 text-sm text-wh-text-secondary"
        >
          <option value="all">All parties</option>
          {parties.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>

      {/* Results count */}
      <p className="mb-3 text-xs text-wh-text-tertiary">
        {filtered.length} politician{filtered.length !== 1 ? 's' : ''}
      </p>

      {/* List */}
      <div className="grid gap-1">
        {filtered.slice(0, 100).map((p) => (
          <Link
            key={p.id}
            href={`/politician/${p.id}`}
            className="flex items-center gap-3 rounded border border-transparent px-3 py-2 hover:border-wh-border hover:bg-wh-panel transition-colors"
          >
            {p.portrait_url ? (
              <img src={p.portrait_url} alt="" className="h-8 w-8 rounded-full object-cover" />
            ) : (
              <div className="h-8 w-8 rounded-full bg-wh-border/40" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm text-wh-text-primary truncate">{p.display_name}</p>
              <p className="text-[11px] text-wh-text-tertiary truncate">
                {p.party}{p.constituency ? ` — ${p.constituency}` : ''}
              </p>
            </div>
            <span className="text-[10px] text-wh-text-tertiary uppercase">
              {p.house === 'commons' ? 'MP' : p.house === 'lords' ? 'Lord' : p.house}
            </span>
          </Link>
        ))}
        {filtered.length > 100 && (
          <p className="px-3 py-2 text-xs text-wh-text-tertiary">
            Showing first 100 of {filtered.length} results. Refine your search.
          </p>
        )}
      </div>
    </div>
  );
}
