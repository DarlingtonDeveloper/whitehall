import type { FeedItem } from '@/types/feed';

/**
 * Compute a recency-weighted pulse score for an entity based on feed activity
 * in the last 7 days.  More recent items contribute more.
 *
 * Scoring formula: sum of 1/max(hoursAgo, 1) for each matching item.
 * This is a deliberate inverse-recency weighting: an item published 1 hour
 * ago contributes 1.0, an item from 24 hours ago contributes ~0.04.
 * The result is that a single very recent item scores higher than many
 * old items — which correctly models "pulse" as current activity rather
 * than historical volume. The floor of max(hoursAgo, 1) prevents division
 * by zero and caps any single item's contribution at 1.0.
 */
export function computePulseScore(
  entityId: string,
  feedItems: FeedItem[],
): number {
  const now = Date.now();
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

  return feedItems
    .filter((item) => item.entity_ids.includes(entityId))
    .filter((item) => now - new Date(item.published_at).getTime() < SEVEN_DAYS)
    .reduce((score, item) => {
      const hoursAgo =
        (now - new Date(item.published_at).getTime()) / (1000 * 60 * 60);
      return score + 1 / Math.max(hoursAgo, 1);
    }, 0);
}

/**
 * Map a numeric pulse score to a discrete level.
 */
export function getPulseLevel(
  score: number,
): 'none' | 'low' | 'medium' | 'high' {
  if (score === 0) return 'none';
  if (score < 2) return 'low';
  if (score < 5) return 'medium';
  return 'high';
}

/**
 * Return a CSS colour string for a given pulse level.
 */
export function getPulseColour(
  level: 'none' | 'low' | 'medium' | 'high',
): string {
  switch (level) {
    case 'none':
      return 'transparent';
    case 'low':
      return '#2dd4bf'; // teal
    case 'medium':
      return '#f59e0b'; // amber
    case 'high':
      return '#ef4444'; // red
  }
}
