'use client';

import type { FeedItem as FeedItemType } from '@/types/feed';
import { dispatchGraphCommand } from '@/lib/graphCommands';
import { entityDisplayName } from '@/lib/entities/display';

/* ------------------------------------------------------------------ */
/*  Source badge config                                                 */
/* ------------------------------------------------------------------ */

const SOURCE_DISPLAY: Record<
  FeedItemType['source_type'],
  { label: string; colour: string; bg: string }
> = {
  govuk:        { label: 'GOV.UK',      colour: '#A32D2D', bg: '#FCEBEB' },
  hansard:      { label: 'Hansard',      colour: '#854F0B', bg: '#FAEEDA' },
  committee:    { label: 'Committee',    colour: '#0F6E56', bg: '#E1F5EE' },
  legislation:  { label: 'Legislation',  colour: '#534AB7', bg: '#EEEDFE' },
  trade_press:  { label: 'Trade',        colour: '#185FA5', bg: '#E6F1FB' },
  stakeholder:  { label: 'Stakeholder',  colour: '#993556', bg: '#FBEAF0' },
  petition:     { label: 'Petition',     colour: '#5F5E5A', bg: '#F1EFE8' },
  research:     { label: 'Research',     colour: '#3B6D11', bg: '#EAF3DE' },
  web_search:   { label: 'Web',          colour: '#444441', bg: '#F1EFE8' },
  forward_scan: { label: 'Forward',      colour: '#993556', bg: '#FBEAF0' },
};

/* ------------------------------------------------------------------ */
/*  Time formatting                                                     */
/* ------------------------------------------------------------------ */

function formatPublishedTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffHours < 1) return `${Math.max(1, Math.floor(diffMs / 60000))}m ago`;
  if (diffHours < 24) return `${Math.floor(diffHours)}h ago`;
  if (diffDays < 7) return `${Math.floor(diffDays)}d ago`;

  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

/* ------------------------------------------------------------------ */
/*  Relevance helpers                                                   */
/* ------------------------------------------------------------------ */

function getBorderColour(score?: number): string {
  if (score === undefined) return 'border-l-transparent';
  if (score >= 0.6) return 'border-l-wh-accent-teal';
  if (score >= 0.4) return 'border-l-amber-400';
  return 'border-l-transparent';
}

function getScoreBg(score: number): string {
  if (score >= 0.6) return 'var(--color-wh-accent-teal)';
  if (score >= 0.4) return '#F59E0B';
  return 'var(--color-wh-bg)';
}

function getScoreText(score: number): string {
  if (score >= 0.4) return 'white';
  return 'var(--color-wh-text-secondary)';
}

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

interface FeedItemCardProps {
  item: FeedItemType;
  relevanceScore?: number;
  showScore?: boolean;
}

export default function FeedItemCard({
  item,
  relevanceScore,
  showScore = false,
}: FeedItemCardProps) {
  const source = SOURCE_DISPLAY[item.source_type] ?? {
    label: item.source_type,
    colour: '#666',
    bg: '#f0f0f0',
  };

  const borderClass = getBorderColour(relevanceScore);

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
      {/* Row 1: source badge + time + score */}
      <div className="flex items-center justify-between gap-2 mb-1">
        <span
          className="inline-flex shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium"
          style={{ color: source.colour, backgroundColor: source.bg }}
        >
          {source.label}
        </span>
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-[10px] text-wh-text-secondary/50">
            {formatPublishedTime(item.published_at)}
          </span>
          {showScore && relevanceScore !== undefined && relevanceScore >= 0.25 && (
            <span
              className="text-[10px] font-medium px-1.5 py-0.5 rounded min-w-[24px] text-center"
              style={{
                backgroundColor: getScoreBg(relevanceScore),
                color: getScoreText(relevanceScore),
              }}
            >
              {Math.round(relevanceScore * 100)}
            </span>
          )}
        </div>
      </div>

      {/* Row 2: title */}
      {item.url ? (
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="block text-xs font-medium leading-snug text-wh-text-primary line-clamp-2 transition-colors hover:text-wh-accent-teal"
        >
          {item.title}
        </a>
      ) : (
        <p className="text-xs font-medium leading-snug text-wh-text-primary line-clamp-2">
          {item.title}
        </p>
      )}

      {/* Row 3: body preview */}
      {item.body && item.body.length > 20 && (
        <p className="mt-1 text-[11px] text-wh-text-secondary/60 leading-relaxed line-clamp-2">
          {item.body.substring(0, 150)}
        </p>
      )}

      {/* Row 4: entity tags */}
      {item.entity_ids.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {item.entity_ids.slice(0, 4).map((eid) => (
            <span
              key={eid}
              className="rounded bg-wh-border/60 px-1.5 py-0.5 text-[9px] text-wh-text-secondary/70"
            >
              {entityDisplayName(eid)}
            </span>
          ))}
          {item.entity_ids.length > 4 && (
            <span className="text-[9px] text-wh-text-secondary/40">
              +{item.entity_ids.length - 4}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
