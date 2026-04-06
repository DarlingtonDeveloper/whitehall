import type { ClientConfig } from '@/types/client';
import type { Entity } from '@/types/entity';
import type { FeedItem } from '@/types/feed';

interface SuggestionContext {
  client?: ClientConfig;
  entity?: Entity;
  recentFeedItems?: FeedItem[];
  pulseScores?: Map<string, number>;
}

export function generateSuggestions(context: SuggestionContext): string[] {
  const suggestions: string[] = [];

  if (context.client && context.recentFeedItems?.length) {
    const thisWeekItems = context.recentFeedItems.filter((item) => {
      const age = Date.now() - new Date(item.published_at).getTime();
      return age < 7 * 24 * 60 * 60 * 1000;
    });

    const consultations = thisWeekItems.filter(
      (i) =>
        i.title.toLowerCase().includes('consultation') ||
        i.title.toLowerCase().includes('call for evidence'),
    );
    const hansardItems = thisWeekItems.filter((i) => i.source_type === 'hansard');
    const committeeItems = thisWeekItems.filter((i) => i.source_type === 'committee');

    if (consultations.length > 0) {
      suggestions.push(
        `${consultations.length} open consultation${consultations.length > 1 ? 's' : ''} — which should ${context.client.name} respond to?`,
      );
    }

    if (hansardItems.length > 0) {
      suggestions.push(
        `${hansardItems.length} parliamentary item${hansardItems.length > 1 ? 's' : ''} this week — anything ${context.client.name} should know?`,
      );
    }

    if (committeeItems.length > 0) {
      suggestions.push(
        `Committee activity this week — relevant to ${context.client.name}?`,
      );
    }

    const tradePress = thisWeekItems.filter((i) => i.source_type === 'trade_press');
    if (tradePress.length > 0) {
      suggestions.push(
        `${tradePress.length} trade press item${tradePress.length > 1 ? 's' : ''} — key industry coverage for ${context.client.name}?`,
      );
    }

    const petitions = thisWeekItems.filter(
      (i) => i.source_type === 'petition',
    );
    if (petitions.length > 0) {
      suggestions.push(
        `${petitions.length} active petition${petitions.length > 1 ? 's' : ''} — any reputational risk for ${context.client.name}?`,
      );
    }

    // Hot entity suggestion
    if (context.pulseScores) {
      const clientEntityIds = context.client.stakeholders.map((s) => s.entityId);
      const hotEntities = clientEntityIds
        .filter((id) => (context.pulseScores?.get(id) || 0) > 5)
        .slice(0, 2);

      if (hotEntities.length > 0) {
        const names = hotEntities.map((id) => id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()));
        suggestions.push(
          `${names.join(' and ')} ${hotEntities.length > 1 ? 'are' : 'is'} very active — what's happening?`,
        );
      }
    }

    if (suggestions.length === 0) {
      suggestions.push(
        `What should ${context.client.name} be paying attention to this week?`,
      );
    }
  }

  if (context.entity) {
    if (context.entity.currentHolder) {
      suggestions.push(
        `What has ${context.entity.currentHolder} said recently?`,
      );
    }
    suggestions.push(`What are the key relationships for ${context.entity.name}?`);
    suggestions.push(`What's changed at ${context.entity.name} this week?`);
  }

  // No context — generic but useful
  if (!context.client && !context.entity) {
    suggestions.push('Which departments are most active this week?');
    suggestions.push('Any consultations closing in the next 14 days?');
    suggestions.push('Show me energy sector activity');
  }

  return suggestions.slice(0, 4);
}
