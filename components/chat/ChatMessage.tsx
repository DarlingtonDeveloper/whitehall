'use client';

import { useMemo } from 'react';
import { ENTITY_LIST } from '@/data/entities';
import { selectEntity } from '@/lib/panelStore';
import { dispatchGraphCommand } from '@/lib/graphCommands';

interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
}

/**
 * Build a sorted list of entity names for matching, sorted longest-first.
 *
 * DELIBERATE: longest-first ordering prevents partial matches from consuming
 * substrings of longer names. Without this, "Home" would match before
 * "Home Office", "Secretary of State" before "Secretary of State for Energy
 * Security and Net Zero", etc. The 300+ entity dataset includes many nested
 * names, so greedy shortest-first matching would produce incorrect highlights.
 */
const ENTITY_NAMES = ENTITY_LIST.map((e) => ({
  id: e.id,
  name: e.name,
})).sort((a, b) => b.name.length - a.name.length);

/**
 * Parse a message string into an array of React nodes with basic
 * markdown-like formatting and entity name highlighting.
 */
function parseContent(raw: string): React.ReactNode[] {
  if (typeof window !== 'undefined') {
    console.log('[ChatMessage] raw content:', raw.slice(0, 500));
  }
  const lines = raw.split('\n');
  const nodes: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Blank line
    if (line.trim() === '') {
      nodes.push(<br key={`br-${i}`} />);
      continue;
    }

    // Bullet list item
    if (/^\s*[-*]\s/.test(line)) {
      const content = line.replace(/^\s*[-*]\s/, '');
      nodes.push(
        <div key={`li-${i}`} className="flex gap-2 pl-2 py-0.5">
          <span className="text-wh-text-secondary select-none" aria-hidden="true">
            &bull;
          </span>
          <span>{formatInline(content, `li-${i}`)}</span>
        </div>,
      );
      continue;
    }

    // Regular line
    nodes.push(
      <p key={`p-${i}`} className="py-0.5">
        {formatInline(line, `p-${i}`)}
      </p>,
    );
  }

  return nodes;
}

/**
 * Handle inline formatting: **bold**, [links](url), and entity name highlighting.
 */
function formatInline(text: string, keyPrefix: string): React.ReactNode[] {
  // First pass: split by markdown patterns
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let partIndex = 0;

  while (remaining.length > 0) {
    // Bold: **text**
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    // Link: [text](url)
    const linkMatch = remaining.match(/\[([^\]]+)\]\(([^)]+)\)/);

    // Find the earliest match
    let earliestIdx = remaining.length;
    let matchType: 'bold' | 'link' | null = null;
    let match: RegExpMatchArray | null = null;

    if (boldMatch && boldMatch.index !== undefined && boldMatch.index < earliestIdx) {
      earliestIdx = boldMatch.index;
      matchType = 'bold';
      match = boldMatch;
    }
    if (linkMatch && linkMatch.index !== undefined && linkMatch.index < earliestIdx) {
      earliestIdx = linkMatch.index;
      matchType = 'link';
      match = linkMatch;
    }

    if (!match || matchType === null) {
      // No more matches — process the rest for entity highlighting
      parts.push(...highlightEntities(remaining, `${keyPrefix}-${partIndex}`));
      break;
    }

    // Add text before the match
    if (earliestIdx > 0) {
      parts.push(
        ...highlightEntities(
          remaining.slice(0, earliestIdx),
          `${keyPrefix}-${partIndex}`,
        ),
      );
      partIndex++;
    }

    if (matchType === 'bold') {
      // Recursively process bold content so links inside **[text](url)** render correctly
      const innerNodes = formatInline(match[1], `${keyPrefix}-b-${partIndex}`);
      parts.push(
        <strong key={`${keyPrefix}-b-${partIndex}`} className="font-semibold text-wh-text-primary">
          {innerNodes}
        </strong>,
      );
      remaining = remaining.slice(earliestIdx + match[0].length);
    } else if (matchType === 'link') {
      parts.push(
        <a
          key={`${keyPrefix}-a-${partIndex}`}
          href={match[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-wh-accent-teal underline decoration-wh-accent-teal/30 hover:decoration-wh-accent-teal transition-colors"
        >
          {match[1]}&nbsp;&#x2197;
        </a>,
      );
      remaining = remaining.slice(earliestIdx + match[0].length);
    }

    partIndex++;
  }

  return parts;
}

/**
 * Check whether the character at a boundary position is a word-break
 * (i.e. not a letter or digit). Undefined (start/end of string) counts as a boundary.
 */
function isWordBoundary(ch: string | undefined): boolean {
  if (!ch) return true;
  return /[^a-zA-Z0-9]/.test(ch);
}

/**
 * Highlight known entity names in teal, with word-boundary checks to prevent
 * partial matches (e.g. "tate" inside "Estate", "rwe" inside "Harwell").
 */
function highlightEntities(text: string, keyPrefix: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let idx = 0;

  while (remaining.length > 0) {
    let foundMatch = false;

    for (const entity of ENTITY_NAMES) {
      const lowerRemaining = remaining.toLowerCase();
      const lowerName = entity.name.toLowerCase();

      // Scan for all occurrences, skipping those that fail boundary checks
      let searchFrom = 0;
      while (searchFrom < lowerRemaining.length) {
        const pos = lowerRemaining.indexOf(lowerName, searchFrom);
        if (pos === -1) break;

        const charBefore = remaining[pos - 1];
        const charAfter = remaining[pos + entity.name.length];

        // Short names (< 4 chars) must match case-sensitively to avoid
        // false positives like "CMA" inside "eCMAscript"
        if (entity.name.length < 4) {
          const exact = remaining.slice(pos, pos + entity.name.length);
          if (exact !== entity.name) {
            searchFrom = pos + 1;
            continue;
          }
        }

        if (!isWordBoundary(charBefore) || !isWordBoundary(charAfter)) {
          searchFrom = pos + 1;
          continue;
        }

        // Valid match — add text before, then the entity button
        if (pos > 0) {
          parts.push(
            <span key={`${keyPrefix}-t-${idx}`}>{remaining.slice(0, pos)}</span>,
          );
          idx++;
        }

        const entityId = entity.id;
        parts.push(
          <button
            key={`${keyPrefix}-e-${idx}`}
            type="button"
            onMouseEnter={() =>
              dispatchGraphCommand({ type: 'highlight_entities', entityIds: [entityId] })
            }
            onMouseLeave={() =>
              dispatchGraphCommand({ type: 'clear_highlight' })
            }
            onClick={() => selectEntity(entityId)}
            className="text-wh-accent-teal font-medium hover:underline decoration-wh-accent-teal/40 cursor-pointer"
            title={`View ${entity.name}`}
          >
            {remaining.slice(pos, pos + entity.name.length)}
          </button>,
        );
        idx++;

        remaining = remaining.slice(pos + entity.name.length);
        foundMatch = true;
        break;
      }

      if (foundMatch) break;
    }

    if (!foundMatch) {
      parts.push(
        <span key={`${keyPrefix}-t-${idx}`}>{remaining}</span>,
      );
      break;
    }
  }

  return parts;
}

export default function ChatMessage({ role, content, isStreaming }: ChatMessageProps) {
  const formattedContent = useMemo(() => parseContent(content), [content]);

  if (role === 'user') {
    return (
      <div className="flex justify-end animate-[fadeSlideIn_0.2s_ease-out]">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-wh-accent-teal/15 border border-wh-accent-teal/20 px-4 py-2.5 text-sm text-wh-text-primary">
          {formattedContent}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start animate-[fadeSlideIn_0.2s_ease-out]">
      <div className="max-w-[90%] rounded-2xl rounded-bl-md bg-wh-panel border border-wh-border px-4 py-2.5 text-sm text-wh-text-primary leading-relaxed break-words [overflow-wrap:anywhere]">
        {formattedContent}
        {isStreaming && (
          <span className="inline-block ml-1 w-2 h-4 bg-wh-accent-teal/60 animate-pulse rounded-sm" />
        )}
      </div>
    </div>
  );
}
