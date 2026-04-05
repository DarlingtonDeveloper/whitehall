// ---------------------------------------------------------------------------
// Data gathering — queries Supabase for feed items and groups them by
// monitoring theme using the same deterministic classifier as the monitoring
// agent (source-type routing → entity overlap → keyword match → fallback).
// ---------------------------------------------------------------------------

import { supabase } from '@/lib/db';
import type { ClientConfig } from '@/types/client';
import type { FeedItem } from '@/types/feed';

/**
 * Two-query merge strategy: first query matches by entity overlap with
 * stakeholder IDs, second matches by keyword in title. Results are merged
 * and deduplicated by id. This mirrors the monitoring agent's two-pass
 * collection approach — cast a wide net, then filter in groupByTheme.
 */
export async function gatherItems(
  client: ClientConfig,
  from: Date,
  to: Date,
): Promise<FeedItem[]> {
  const stakeholderIds = client.stakeholders.map((s) => s.entityId);

  // Query 1: entity overlap
  const { data: entityItems } = await supabase
    .from('feed_items')
    .select('*')
    .overlaps('entity_ids', stakeholderIds)
    .gte('published_at', from.toISOString())
    .lte('published_at', to.toISOString())
    .order('published_at', { ascending: false })
    .limit(500);

  // Query 2: keyword matches in title (top 30 keywords to stay within
  // Supabase OR filter limits)
  const topKeywords = client.allKeywords.slice(0, 30);
  const keywordFilter = topKeywords
    .map((kw) => `title.ilike.%${kw.replace(/[%_]/g, '\\$&')}%`)
    .join(',');

  const { data: keywordItems } = await supabase
    .from('feed_items')
    .select('*')
    .or(keywordFilter)
    .gte('published_at', from.toISOString())
    .lte('published_at', to.toISOString())
    .order('published_at', { ascending: false })
    .limit(500);

  // Merge and deduplicate by id
  const seen = new Set<string>();
  const merged: FeedItem[] = [];
  for (const item of [...(entityItems ?? []), ...(keywordItems ?? [])]) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      merged.push(item as FeedItem);
    }
  }

  return merged;
}

/**
 * Deterministic theme classifier — routes each item to a single monitoring
 * theme using a priority chain: source-type hint → entity overlap → keyword
 * match → 'other' bucket. This matches the monitoring agent's
 * route_items_to_themes logic.
 */
export function groupByTheme(
  items: FeedItem[],
  client: ClientConfig,
): Record<string, FeedItem[]> {
  const groups: Record<string, FeedItem[]> = {};

  // Initialise all themes with empty arrays
  for (const theme of client.monitoringThemes) {
    groups[theme.id] = [];
  }
  groups['other'] = [];

  for (const item of items) {
    let matched = false;

    for (const theme of client.monitoringThemes) {
      // Match by entity overlap
      if (item.entity_ids?.some((id) => theme.entityIds.includes(id))) {
        groups[theme.id].push(item);
        matched = true;
        break;
      }
      // Match by keyword in title
      const text = item.title.toLowerCase();
      if (theme.keywords.some((kw) => text.includes(kw.toLowerCase()))) {
        groups[theme.id].push(item);
        matched = true;
        break;
      }
    }

    if (!matched) {
      groups['other'].push(item);
    }
  }

  return groups;
}
