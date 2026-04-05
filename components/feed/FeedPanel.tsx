'use client';

import { useMemo } from 'react';
import type { FeedItem } from '@/types/feed';
import FeedItemCard from './FeedItem';

/* ------------------------------------------------------------------ */
/*  Mock-data generator                                                */
/* ------------------------------------------------------------------ */

const MOCK_TEMPLATES: {
  title: string;
  source_type: FeedItem['source_type'];
  source_name: string;
}[] = [
  {
    title: '{entity} publishes updated policy framework',
    source_type: 'govuk',
    source_name: 'GOV.UK',
  },
  {
    title: 'Written Statement: {entity} strategic priorities for 2026-27',
    source_type: 'govuk',
    source_name: 'GOV.UK',
  },
  {
    title: 'Hansard: Oral Questions to the Secretary of State',
    source_type: 'hansard',
    source_name: 'Hansard',
  },
  {
    title: 'Select Committee evidence session on departmental spending',
    source_type: 'committee',
    source_name: 'Parliament',
  },
  {
    title: 'Consultation response: regulatory reform proposals',
    source_type: 'govuk',
    source_name: 'GOV.UK',
  },
  {
    title: '{entity} annual report and accounts 2025-26 published',
    source_type: 'govuk',
    source_name: 'GOV.UK',
  },
  {
    title: 'New legislation laid before Parliament affecting {entity}',
    source_type: 'legislation',
    source_name: 'Legislation.gov.uk',
  },
  {
    title: 'Ministerial appointment: changes to {entity} leadership',
    source_type: 'govuk',
    source_name: 'GOV.UK',
  },
  {
    title: 'Public Accounts Committee inquiry into {entity} delivery',
    source_type: 'committee',
    source_name: 'Parliament',
  },
  {
    title: 'Hansard: Debate on {entity} funding settlement',
    source_type: 'hansard',
    source_name: 'Hansard',
  },
  {
    title: 'NAO value for money study: {entity} programme review',
    source_type: 'web_search',
    source_name: 'NAO',
  },
  {
    title: '{entity} launches public consultation on service standards',
    source_type: 'govuk',
    source_name: 'GOV.UK',
  },
  {
    title: 'Written Answer: staffing levels at {entity}',
    source_type: 'hansard',
    source_name: 'Hansard',
  },
  {
    title: 'Infrastructure and Projects Authority review of {entity} projects',
    source_type: 'govuk',
    source_name: 'GOV.UK',
  },
  {
    title: 'Forward scan: upcoming statutory instrument affecting {entity}',
    source_type: 'forward_scan',
    source_name: 'Forward Scan',
  },
];

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return s / 2147483647;
  };
}

function generateMockItems(entityId: string, entityName?: string): FeedItem[] {
  const rand = seededRandom(
    entityId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0),
  );
  const label = entityName ?? entityId;
  const now = Date.now();

  return MOCK_TEMPLATES.map((tpl, i) => {
    const hoursAgo = Math.floor(rand() * 168) + 1; // 1h to 7 days
    const publishedAt = new Date(now - hoursAgo * 3600000).toISOString();
    const score = Math.round((rand() * 0.6 + 0.3) * 100) / 100;

    return {
      id: `mock-${entityId}-${i}`,
      source_type: tpl.source_type,
      source_name: tpl.source_name,
      title: tpl.title.replace(/{entity}/g, label),
      url: undefined,
      published_at: publishedAt,
      entity_ids: [entityId],
      relevance_score: score,
      fingerprint: `mock-fp-${entityId}-${i}`,
      created_at: publishedAt,
      is_forward_scan: tpl.source_type === 'forward_scan',
    };
  }).sort(
    (a, b) =>
      new Date(b.published_at).getTime() - new Date(a.published_at).getTime(),
  );
}

/* ------------------------------------------------------------------ */
/*  Feed panel component                                               */
/* ------------------------------------------------------------------ */

interface FeedPanelProps {
  title?: string;
  entityId?: string;
  entityName?: string;
  clientId?: string;
  items?: FeedItem[];
}

export default function FeedPanel({
  title = 'Activity Feed',
  entityId,
  entityName,
  items,
}: FeedPanelProps) {
  const feedItems = useMemo(() => {
    if (items && items.length > 0) return items;
    if (entityId) return generateMockItems(entityId, entityName);
    return generateMockItems('whitehall', 'Government');
  }, [items, entityId, entityName]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-wh-border px-4 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-wh-text-secondary">
          {title}
        </h2>
        <p className="mt-0.5 text-[10px] text-wh-text-secondary/50">
          {feedItems.length} items
        </p>
      </div>

      {/* Scrollable feed list */}
      <div className="flex-1 overflow-y-auto">
        {feedItems.map((item) => (
          <FeedItemCard key={item.id} item={item} />
        ))}
      </div>

      {/* Chat input stub */}
      <div className="shrink-0 border-t border-wh-border p-3">
        <div className="flex items-center gap-2 rounded-lg border border-wh-border bg-wh-bg px-3 py-2">
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
              d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z"
            />
          </svg>
          <span className="text-[11px] text-wh-text-secondary/40">
            Ask about this entity...
          </span>
        </div>
      </div>
    </div>
  );
}
