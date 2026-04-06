'use client';

import type { FeedItem as FeedItemType } from '@/types/feed';
import { dispatchGraphCommand } from '@/lib/graphCommands';

const SOURCE_COLOURS: Record<FeedItemType['source_type'], string> = {
  govuk: 'bg-teal-500/15 text-teal-400',
  hansard: 'bg-blue-500/15 text-blue-400',
  committee: 'bg-purple-500/15 text-purple-400',
  legislation: 'bg-emerald-500/15 text-emerald-400',
  web_search: 'bg-amber-500/15 text-amber-400',
  forward_scan: 'bg-rose-500/15 text-rose-400',
  trade_press: 'bg-orange-500/15 text-orange-400',
  stakeholder: 'bg-cyan-500/15 text-cyan-400',
  petition: 'bg-pink-500/15 text-pink-400',
  research: 'bg-indigo-500/15 text-indigo-400',
};

const SOURCE_LABELS: Record<FeedItemType['source_type'], string> = {
  govuk: 'GOV.UK',
  hansard: 'Hansard',
  committee: 'Committee',
  legislation: 'Legislation',
  web_search: 'Web',
  forward_scan: 'Forward Scan',
  trade_press: 'Trade Press',
  stakeholder: 'Stakeholder',
  petition: 'Petition',
  research: 'Research',
};

function relevanceBorder(score: number): string {
  if (score >= 0.8) return 'border-l-red-500';
  if (score >= 0.5) return 'border-l-amber-500';
  return 'border-l-transparent';
}

function timeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  const diffWeeks = Math.floor(diffDays / 7);
  return `${diffWeeks}w ago`;
}

interface FeedItemCardProps {
  item: FeedItemType;
}

export default function FeedItemCard({ item }: FeedItemCardProps) {
  const sourceStyle = SOURCE_COLOURS[item.source_type] ?? SOURCE_COLOURS.web_search;
  const sourceLabel = SOURCE_LABELS[item.source_type] ?? item.source_name;
  const borderClass = relevanceBorder(item.relevance_score);

  return (
    <div
      className={`border-l-2 ${borderClass} border-b border-b-wh-border/50 px-3 py-2.5 transition-colors hover:bg-wh-border/20 cursor-pointer`}
      onMouseEnter={() => {
        if (item.entity_ids.length > 0) {
          dispatchGraphCommand({ type: 'highlight_entities', entityIds: item.entity_ids });
        }
      }}
      onMouseLeave={() => {
        dispatchGraphCommand({ type: 'clear_highlight' });
      }}
      onClick={() => {
        if (item.entity_ids.length > 0) {
          dispatchGraphCommand({ type: 'select_entity', entityId: item.entity_ids[0] });
        }
      }}
    >
      {/* Top row: source badge + time */}
      <div className="flex items-center justify-between gap-2">
        <span
          className={`inline-flex shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${sourceStyle}`}
        >
          {sourceLabel}
        </span>
        <span className="shrink-0 text-[10px] text-wh-text-secondary/50">
          {timeAgo(item.published_at)}
        </span>
      </div>

      {/* Title */}
      {item.url ? (
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1.5 block text-xs font-medium leading-snug text-wh-text-primary line-clamp-2 transition-colors hover:text-wh-accent-teal"
        >
          {item.title}
        </a>
      ) : (
        <p className="mt-1.5 text-xs font-medium leading-snug text-wh-text-primary line-clamp-2">
          {item.title}
        </p>
      )}

      {/* Entity tags */}
      {item.entity_ids.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {item.entity_ids.slice(0, 3).map((eid) => (
            <span
              key={eid}
              className="rounded bg-wh-border/60 px-1.5 py-0.5 text-[9px] text-wh-text-secondary/70"
            >
              {eid}
            </span>
          ))}
          {item.entity_ids.length > 3 && (
            <span className="text-[9px] text-wh-text-secondary/40">
              +{item.entity_ids.length - 3}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
