'use client';

import { useMemo } from 'react';
import { getClientBySlug } from '@/data/clients';
import { getEntity } from '@/data/entities';
import { generateSuggestions } from '@/lib/chat/suggestions';
import type { FeedItem } from '@/types/feed';

interface SuggestedQuestionsProps {
  clientId?: string;
  entityId?: string;
  onSelect: (question: string) => void;
  disabled?: boolean;
  feedItems?: FeedItem[];
  pulseScores?: Map<string, number>;
}

export default function SuggestedQuestions({
  clientId,
  entityId,
  onSelect,
  disabled,
  feedItems,
  pulseScores,
}: SuggestedQuestionsProps) {
  const questions = useMemo(() => {
    const client = clientId ? getClientBySlug(clientId) : undefined;
    const entity = entityId ? getEntity(entityId) : undefined;

    return generateSuggestions({
      client: client ?? undefined,
      entity: entity ?? undefined,
      recentFeedItems: feedItems,
      pulseScores,
    });
  }, [clientId, entityId, feedItems, pulseScores]);

  return (
    <div className="flex flex-wrap gap-1.5 px-1">
      {questions.map((q) => (
        <button
          key={q}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(q)}
          className="rounded-full border border-wh-border bg-wh-bg px-3 py-1.5 text-xs text-wh-text-secondary transition-all hover:border-wh-accent-teal/40 hover:text-wh-accent-teal hover:bg-wh-accent-teal/5 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {q}
        </button>
      ))}
    </div>
  );
}
