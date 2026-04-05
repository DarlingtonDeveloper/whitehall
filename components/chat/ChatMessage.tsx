'use client';

import { useMemo } from 'react';
import { ENTITY_LIST } from '@/data/entities';
import { selectEntity } from '@/lib/panelStore';

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
      parts.push(
        <strong key={`${keyPrefix}-b-${partIndex}`} className="font-semibold text-wh-text-primary">
          {match[1]}
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
          {match[1]}
        </a>,
      );
      remaining = remaining.slice(earliestIdx + match[0].length);
    }

    partIndex++;
  }

  return parts;
}

/**
 * Highlight known entity names in teal.
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
      const pos = lowerRemaining.indexOf(lowerName);

      if (pos !== -1) {
        // Add text before the entity
        if (pos > 0) {
          parts.push(
            <span key={`${keyPrefix}-t-${idx}`}>{remaining.slice(0, pos)}</span>,
          );
          idx++;
        }

        // Add the entity name as a clickable button
        const entityId = entity.id;
        parts.push(
          <button
            key={`${keyPrefix}-e-${idx}`}
            type="button"
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
      <div className="max-w-[90%] rounded-2xl rounded-bl-md bg-wh-panel border border-wh-border px-4 py-2.5 text-sm text-wh-text-primary leading-relaxed">
        {formattedContent}
        {isStreaming && (
          <span className="inline-block ml-1 w-2 h-4 bg-wh-accent-teal/60 animate-pulse rounded-sm" />
        )}
      </div>
    </div>
  );
}
