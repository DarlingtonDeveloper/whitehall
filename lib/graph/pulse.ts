import type { FeedItem } from '@/types/feed';

/**
 * Compute a recency-weighted pulse score for an entity based on feed activity
 * in the last 7 days.  More recent items contribute more.
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
