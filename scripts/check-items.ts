import { createClient } from '@supabase/supabase-js';
import { computeFeedRelevance } from '../lib/feed/scoring';
import { getClientBySlug } from '../data/clients';
import type { FeedItem } from '../types/feed';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY || '',
);

async function check() {
  // 1. Find CCUS items (broader search)
  const { data: ccus } = await supabase
    .from('feed_items')
    .select('id, title, url, source_type, source_name, published_at, entity_ids, event_date, is_forward_scan, body')
    .ilike('title', '%ccus%')
    .order('published_at', { ascending: false })
    .limit(10);

  console.log('=== CCUS items ===');
  for (const item of ccus ?? []) {
    console.log('Title:', item.title);
    console.log('  event_date:', item.event_date);
    console.log('  is_forward_scan:', item.is_forward_scan);
    console.log('  published_at:', item.published_at);
    console.log('  entity_ids:', item.entity_ids);
    console.log('  body (first 500):', (item.body || '').substring(0, 500));
    console.log('---');
  }

  // Also search for Teesside specifically
  const { data: teesside } = await supabase
    .from('feed_items')
    .select('id, title, url, source_type, source_name, published_at, entity_ids, event_date, is_forward_scan, body')
    .ilike('title', '%teesside%')
    .order('published_at', { ascending: false })
    .limit(10);

  console.log('\n=== Teesside items ===');
  for (const item of teesside ?? []) {
    console.log('Title:', item.title);
    console.log('  event_date:', item.event_date);
    console.log('  is_forward_scan:', item.is_forward_scan);
    console.log('  published_at:', item.published_at);
    console.log('  entity_ids:', item.entity_ids);
    console.log('---');
  }

  // 2. Find Norfolk Vanguard items
  const { data: norfolk } = await supabase
    .from('feed_items')
    .select('id, title, url, source_type, source_name, published_at, entity_ids, event_date, is_forward_scan')
    .ilike('title', '%norfolk vanguard%')
    .order('published_at', { ascending: false })
    .limit(5);

  console.log('\n=== Norfolk Vanguard items ===');
  for (const item of norfolk ?? []) {
    console.log('Title:', item.title);
    console.log('  event_date:', item.event_date);
    console.log('  is_forward_scan:', item.is_forward_scan);
    console.log('  published_at:', item.published_at);
    console.log('  entity_ids:', item.entity_ids);
    console.log('---');
  }

  // 3. Check how many items have event_date set at all
  const { count: withEventDate } = await supabase
    .from('feed_items')
    .select('id', { count: 'exact', head: true })
    .not('event_date', 'is', null);

  const { count: total } = await supabase
    .from('feed_items')
    .select('id', { count: 'exact', head: true });

  console.log(`\n=== event_date coverage ===`);
  console.log(`Total items: ${total}`);
  console.log(`With event_date: ${withEventDate}`);

  // 4. Check RWE stakeholder entity IDs to verify Norfolk Vanguard would match
  const { data: rweNorfolk } = await supabase
    .from('feed_items')
    .select('id, title, entity_ids')
    .ilike('title', '%norfolk vanguard%')
    .limit(3);

  console.log('\n=== Norfolk Vanguard entity_ids check ===');
  for (const item of rweNorfolk ?? []) {
    console.log(item.title, '->', item.entity_ids);
  }

  // 5. Simulate feed_top_items for RWE with project boost
  const client = getClientBySlug('rwe');
  if (client) {
    const stakeholderIds = client.stakeholders.map(s => s.entityId);
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const clientNameLower = client.name.toLowerCase();
    const clientNameRe = new RegExp(`\\b${clientNameLower}\\b`, 'i');
    const projectCoreTerms = (client.projects ?? [])
      .map(p => p.replace(/\s*(offshore|onshore|wind\s*farm|wind|renewables|energy|power|plant|project|farm|uk)\s*/gi, ' ').trim().toLowerCase())
      .filter(t => t.length >= 4);
    const projectRegexes = projectCoreTerms.map(t => new RegExp(`\\b${t}\\b`, 'i'));

    // Split query: high-value sources + stakeholder sources
    const HIGH_VALUE_TYPES = ['govuk', 'hansard', 'committee', 'legislation', 'trade_press', 'research', 'petition', 'forward_scan'];
    const seenIds = new Set<string>();
    const rweItems: FeedItem[] = [];

    const { data: hvData } = await supabase
      .from('feed_items')
      .select('*')
      .overlaps('entity_ids', stakeholderIds)
      .in('source_type', HIGH_VALUE_TYPES)
      .gte('published_at', cutoff)
      .order('published_at', { ascending: false })
      .limit(300);
    for (const item of (hvData ?? []) as FeedItem[]) {
      if (!seenIds.has(item.id)) { seenIds.add(item.id); rweItems.push(item); }
    }

    const { data: stData } = await supabase
      .from('feed_items')
      .select('*')
      .overlaps('entity_ids', stakeholderIds)
      .in('source_type', ['stakeholder', 'web_search'])
      .gte('published_at', cutoff)
      .order('published_at', { ascending: false })
      .limit(100);
    for (const item of (stData ?? []) as FeedItem[]) {
      if (!seenIds.has(item.id)) { seenIds.add(item.id); rweItems.push(item); }
    }

    if (rweItems.length > 0) {
      const scored = (rweItems as FeedItem[])
        .map(item => {
          const score = computeFeedRelevance(item, client);
          const titleLower = item.title.toLowerCase();
          const mentionsClient = clientNameRe.test(titleLower);
          const mentionsProject = projectRegexes.some(re => re.test(titleLower));
          return { item, score, mentionsClient, mentionsProject };
        })
        .filter(s => s.score >= 0.20);

      scored.sort((a, b) => {
        const aBoost = (a.mentionsClient || a.mentionsProject) ? 1 : 0;
        const bBoost = (b.mentionsClient || b.mentionsProject) ? 1 : 0;
        if (aBoost !== bBoost) return bBoost - aBoost;
        return b.score - a.score;
      });

      console.log(`\n=== feed_top_items simulation for RWE (top 20, with project boost) ===`);
      console.log(`Total fetched: ${rweItems.length}, scored above 0.20: ${scored.length}`);
      console.log(`Project items found: ${scored.filter(s => s.mentionsProject).length}`);
      for (const { item, score, mentionsProject, mentionsClient } of scored.slice(0, 20)) {
        const flags = [mentionsProject ? 'PROJECT' : '', mentionsClient ? 'CLIENT' : ''].filter(Boolean).join(',');
        console.log(`  [${Math.round(score * 100)}]${flags ? ` {${flags}}` : ''} ${item.title}`);
        console.log(`       entities: ${item.entity_ids.join(', ')} | ${item.source_type} | ${item.published_at}`);
      }
    }

    // 6. Simulate feed_deadlines (high-value source types only)
    const HV_SOURCES = ['govuk', 'hansard', 'committee', 'legislation', 'trade_press', 'research', 'petition', 'forward_scan'];
    const deadlineKeywords = [
      'consultation', 'call for evidence', 'deadline', 'respond by', 'closes',
      'selection process', 'expression of interest', 'closing date',
    ];
    const titleConds = deadlineKeywords.map(kw => `title.ilike.%${kw}%`).join(',');
    const bodyConds = deadlineKeywords.map(kw => `body.ilike.%${kw}%`).join(',');

    const { data: deadlineItems } = await supabase
      .from('feed_items')
      .select('id, title, source_type, source_name, published_at, entity_ids, event_date, body')
      .overlaps('entity_ids', stakeholderIds)
      .in('source_type', HV_SOURCES)
      .or(`${titleConds},${bodyConds}`)
      .gte('published_at', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString())
      .order('published_at', { ascending: false })
      .limit(200);

    // Score and sort by relevance
    const scoredDeadlines = ((deadlineItems ?? []) as FeedItem[])
      .map(item => ({ item, score: computeFeedRelevance(item, client) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);

    console.log(`\n=== feed_deadlines simulation for RWE (top 20 by relevance) ===`);
    console.log(`Total matched: ${(deadlineItems ?? []).length}, showing top 20 by relevance`);
    for (const { item, score } of scoredDeadlines) {
      console.log(`  [${Math.round(score * 100)}] ${item.title}`);
      console.log(`    source: ${item.source_name} (${item.source_type}) | ${item.published_at}`);
    }
  }
}

check().catch(console.error);
