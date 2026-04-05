'use client';

import { useMemo } from 'react';
import { getClientBySlug } from '@/data/clients';
import { getEntity } from '@/data/entities';

interface SuggestedQuestionsProps {
  clientId?: string;
  entityId?: string;
  onSelect: (question: string) => void;
  disabled?: boolean;
}

function getQuestions(clientId?: string, entityId?: string): string[] {
  // Entity-specific questions
  if (entityId) {
    const entity = getEntity(entityId);
    const name = entity?.name ?? entityId;
    return [
      `What powers does ${name} have?`,
      `What's happened here recently?`,
      `Who leads ${name}?`,
      `What bodies report to ${name}?`,
    ];
  }

  // Client-specific questions
  if (clientId) {
    const client = getClientBySlug(clientId);
    const name = client?.name ?? clientId;
    return [
      `What should ${name} focus on?`,
      'Who are the key decision-makers?',
      'What consultations are open?',
      `Summarise ${name}'s stakeholder landscape`,
    ];
  }

  // Pulse / default questions
  return [
    "What's the most active department?",
    'Any consultations closing soon?',
    "Summarise this week's activity",
    'Which ministers have new portfolios?',
  ];
}

export default function SuggestedQuestions({
  clientId,
  entityId,
  onSelect,
  disabled,
}: SuggestedQuestionsProps) {
  const questions = useMemo(
    () => getQuestions(clientId, entityId),
    [clientId, entityId],
  );

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
