// ---------------------------------------------------------------------------
// Semantic deduplication — clusters items covering the same development
// from multiple sources (e.g. an Ofgem decision covered by GOV.UK, Hansard,
// and trade press) and keeps only the highest-priority source per cluster.
//
// The monitoring agent ran semantic similarity checks; Whitehall was only
// doing exact fingerprint dedup. This closes that gap using deterministic
// heuristics: shared entities + title word overlap + temporal proximity.
// ---------------------------------------------------------------------------

import type { FeedItem } from '@/types/feed';

// Source priority — prefer primary sources over secondary coverage
const SOURCE_PRIORITY: Record<string, number> = {
  govuk: 10,
  legislation: 9,
  committee: 8,
  research: 8,
  hansard: 7,
  stakeholder: 6,
  trade_press: 5,
  forward_scan: 5,
  petition: 4,
  web_search: 4,
};

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'this', 'that', 'these',
  'those', 'it', 'its', 'not', 'no', 'as', 'if', 'than', 'then',
  'about', 'into', 'through', 'during', 'before', 'after', 'above',
  'between', 'under', 'uk', 'new', 'statement', 'update', 'report',
]);

function extractSignificantWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

function isSameDevelopment(a: FeedItem, b: FeedItem): boolean {
  // Must be published within 3 days of each other
  const daysDiff =
    Math.abs(
      new Date(a.published_at).getTime() - new Date(b.published_at).getTime(),
    ) /
    (1000 * 60 * 60 * 24);
  if (daysDiff > 3) return false;

  // Must share at least one entity tag
  const sharedEntities = (a.entity_ids || []).filter((id) =>
    (b.entity_ids || []).includes(id),
  );
  if (sharedEntities.length === 0) return false;

  // Title word overlap (Jaccard similarity > 0.3)
  const aWords = extractSignificantWords(a.title);
  const bWords = extractSignificantWords(b.title);
  const intersection = aWords.filter((w) => bWords.includes(w));
  const union = new Set([...aWords, ...bWords]);

  if (union.size === 0) return false;
  return intersection.length / union.size > 0.3;
}

/**
 * Cluster items covering the same development and keep the best source
 * per cluster. "Also covered by:" is appended to the body for context.
 */
export function deduplicateSemantic(items: FeedItem[]): FeedItem[] {
  if (items.length < 2) return items;

  const clusters: FeedItem[][] = [];
  const assigned = new Set<string>();

  // Sort by source priority (best sources first)
  const sorted = [...items].sort(
    (a, b) =>
      (SOURCE_PRIORITY[b.source_type] || 0) -
      (SOURCE_PRIORITY[a.source_type] || 0),
  );

  for (const item of sorted) {
    if (assigned.has(item.id)) continue;

    const cluster: FeedItem[] = [item];
    assigned.add(item.id);

    for (const candidate of sorted) {
      if (assigned.has(candidate.id)) continue;
      if (isSameDevelopment(item, candidate)) {
        cluster.push(candidate);
        assigned.add(candidate.id);
      }
    }

    clusters.push(cluster);
  }

  return clusters.map((cluster) => {
    if (cluster.length === 1) return cluster[0];

    // Best item is first (sorted by source priority)
    const best = cluster[0];
    const others = cluster.slice(1);
    const otherSources = others
      .map((c) => `${c.source_name}: ${c.title}`)
      .join('; ');

    return {
      ...best,
      body: [best.body || '', '', `Also covered by: ${otherSources}`]
        .join('\n')
        .trim(),
    };
  });
}
