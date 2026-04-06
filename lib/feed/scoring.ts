// ---------------------------------------------------------------------------
// Algorithmic feed relevance scoring — replaces chronological sort with a
// composite score derived from entity overlap, keyword matches, source
// quality, recency decay, actionable content signals, and learned signals
// from the feedback loop.
//
// Score components (maximum contribution):
//   1. Entity overlap with stakeholder map  — up to 0.30
//   2. Keyword matches                      — up to 0.25
//   3. Source type quality                   — up to 0.10
//   4. Recency decay                        — up to 0.15
//   5. Actionable content bonus             — up to 0.10
//   6. Learned signals (feedback loop)      — up to 0.10
//                                             --------
//                                     Total:   1.00
// ---------------------------------------------------------------------------

import type { FeedItem } from '@/types/feed';
import type { ClientConfig } from '@/types/client';

export interface LearnedSignals {
  source_boosts: Record<string, number>;
  keyword_boosts: Record<string, number>;
  rag_adjustments: Record<string, { red_threshold: number; amber_threshold: number }>;
}

// Strip generic type words from project names to extract the distinctive
// proper-noun part (e.g. "Sofia offshore wind" → "sofia").
const GENERIC_PROJECT_SUFFIXES =
  /\b(offshore|onshore|wind\s*farm|wind|renewables|energy|power|plant|project|farm|UK)\b/gi;

function extractClientTerms(client: ClientConfig): string[] {
  const terms: string[] = [client.name.toLowerCase()];

  for (const p of client.projects || []) {
    const full = p.toLowerCase();
    terms.push(full);

    // Also add the core proper-noun part
    const core = p.replace(GENERIC_PROJECT_SUFFIXES, '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (core.length >= 4 && core !== full) {
      terms.push(core);
    }
  }

  return [...new Set(terms)];
}

export function computeFeedRelevance(
  item: FeedItem,
  client: ClientConfig,
  learnedSignals?: LearnedSignals,
  debug: boolean = false,
): number {
  let score = 0;
  const text = `${item.title} ${item.body || ''}`.toLowerCase();

  // 1. Entity overlap with stakeholder map (up to 0.30)
  const stakeholderIds = client.stakeholders.map(s => s.entityId);
  const overlap = (item.entity_ids || []).filter(id => stakeholderIds.includes(id));
  let entityScore = 0;
  for (const id of overlap) {
    const stakeholder = client.stakeholders.find(s => s.entityId === id);
    if (stakeholder?.priority === 'primary') entityScore += 0.15;
    else if (stakeholder?.priority === 'secondary') entityScore += 0.08;
    else entityScore += 0.03;
  }
  score += Math.min(entityScore, 0.30);

  // 2. Keyword matches (up to 0.25)
  const allKeywords = client.allKeywords;
  const kwMatches = allKeywords.filter(kw => text.includes(kw.toLowerCase())).length;
  score += Math.min(kwMatches * 0.04, 0.25);

  // 3. Source type quality (up to 0.10)
  const sourceWeights: Record<string, number> = {
    govuk: 0.10,
    hansard: 0.10,
    committee: 0.08,
    legislation: 0.08,
    research: 0.08,
    trade_press: 0.06,
    stakeholder: 0.07,
    petition: 0.05,
    forward_scan: 0.06,
    web_search: 0.05,
  };
  score += sourceWeights[item.source_type] || 0.03;

  // 4. Recency decay (up to 0.15)
  const hoursAgo = (Date.now() - new Date(item.published_at).getTime()) / (1000 * 60 * 60);
  if (hoursAgo < 6) score += 0.15;
  else if (hoursAgo < 24) score += 0.12;
  else if (hoursAgo < 72) score += 0.08;
  else if (hoursAgo < 168) score += 0.04;
  else score += 0.01;

  // 5. Actionable content bonus (up to 0.10)
  if (text.includes('consultation') || text.includes('call for evidence')) score += 0.10;
  else if (text.includes('statement') || text.includes('announcement')) score += 0.05;

  // 6. Learned signals (up to 0.10)
  if (learnedSignals) {
    const sourceBoost = learnedSignals.source_boosts[item.source_name] || 0;
    score += Math.min(sourceBoost, 0.05);

    const kwBoost = allKeywords.reduce((sum, kw) => {
      if (text.includes(kw.toLowerCase()) && learnedSignals.keyword_boosts[kw]) {
        return sum + learnedSignals.keyword_boosts[kw];
      }
      return sum;
    }, 0);
    score += Math.min(kwBoost, 0.05);
  }

  // ── Source floors ──────────────────────────────────────────────────────
  // Priority sources get minimum scores to prevent relevant items from
  // important entities being filtered out when keyword overlap is low.

  // Tier 1: Client named directly — almost always relevant
  // Also match core project names (e.g. "Sofia" from "Sofia offshore wind")
  const clientNameTerms = extractClientTerms(client);
  const clientMentioned = clientNameTerms.some(term => text.includes(term));
  if (clientMentioned) {
    score = Math.max(score, 0.60);
  }

  // Primary stakeholder floor: items tagged to a primary stakeholder
  // always score at least 0.30 (above the 0.25 threshold in generate.ts)
  const primaryEntityIds = client.stakeholders
    .filter(s => s.priority === 'primary')
    .map(s => s.entityId);
  const hasPrimaryEntity = (item.entity_ids || []).some(id =>
    primaryEntityIds.includes(id),
  );
  if (hasPrimaryEntity) {
    score = Math.max(score, 0.30);
  }

  // Secondary stakeholder floor: 0.20 — below threshold but close enough
  // that any keyword match pushes them over
  const secondaryEntityIds = client.stakeholders
    .filter(s => s.priority === 'secondary')
    .map(s => s.entityId);
  const hasSecondaryEntity = (item.entity_ids || []).some(id =>
    secondaryEntityIds.includes(id),
  );
  if (hasSecondaryEntity && !hasPrimaryEntity) {
    score = Math.max(score, 0.20);
  }

  const finalScore = Math.min(score, 1.0);

  if (debug) {
    console.log(`[SCORE] ${item.title.substring(0, 80)}`);
    console.log(`  entities: ${(item.entity_ids || []).join(', ')}`);
    console.log(`  entity=${Math.min(entityScore, 0.30).toFixed(2)} kw=${Math.min(kwMatches * 0.04, 0.25).toFixed(2)} source=${(sourceWeights[item.source_type] || 0.03).toFixed(2)}`);
    console.log(`  clientFloor=${clientMentioned ? 0.60 : 0} primaryFloor=${hasPrimaryEntity ? 0.30 : 0} secondaryFloor=${hasSecondaryEntity && !hasPrimaryEntity ? 0.20 : 0}`);
    console.log(`  final=${finalScore.toFixed(3)}`);
  }

  return finalScore;
}
