/**
 * Verify monitoring agent items exist in Whitehall's Supabase.
 *
 * Checks each of the 22 items from the monitoring agent's v10 report
 * (w/c 23 March 2026) against the feed_items table, scores any found
 * items with the RWE client config, and analyses coverage gaps.
 *
 * Usage: npx tsx scripts/verify-monitoring-agent-items.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

import { computeFeedRelevance } from '../lib/feed/scoring';
import type { FeedItem } from '../types/feed';

// Load RWE config dynamically (same pattern as debug-scoring.ts)
async function loadRweConfig() {
  const mod = await import('../data/clients/rwe');
  return mod.RWE_CONFIG;
}

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY in .env.local',
  );
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ── Item definitions ──────────────────────────────────────────────────────

interface MonitoringItem {
  id: number;
  label: string;
  category: 'GOV.UK' | 'Hansard' | 'Trade press' | 'Industry body';
  searchTerms: string[];
  sourceTypeFilter?: string;
}

const ITEMS: MonitoringItem[] = [
  // GOV.UK items (1-8)
  {
    id: 1,
    label: 'CCUS East Coast Cluster Teesside',
    category: 'GOV.UK',
    searchTerms: ['%CCUS%Teesside%', '%East Coast Cluster%', '%CCUS%cluster%'],
  },
  {
    id: 2,
    label: 'Energy Company Obligation',
    category: 'GOV.UK',
    searchTerms: ['%Energy Company Obligation%', '%ECO%scheme%', '%ECO4%'],
  },
  {
    id: 3,
    label: 'Energy digitalisation framework',
    category: 'GOV.UK',
    searchTerms: ['%energy digitalisation%', '%digitalisation framework%', '%digital%energy%framework%'],
  },
  {
    id: 4,
    label: 'Cyber resilience downstream gas electricity',
    category: 'GOV.UK',
    searchTerms: ['%cyber resilience%', '%cyber%downstream%', '%cyber%gas%electricity%'],
  },
  {
    id: 5,
    label: 'Energy code reform',
    category: 'GOV.UK',
    searchTerms: ['%energy code reform%', '%code manager licence%', '%energy code%'],
  },
  {
    id: 6,
    label: 'Planning Inspectorate local plan guidance',
    category: 'GOV.UK',
    searchTerms: ['%local plan examination%', '%Planning Inspectorate%guidance%', '%local plan%guidance%'],
  },
  {
    id: 7,
    label: 'Anti-profiteering nuclear delivery',
    category: 'GOV.UK',
    searchTerms: ['%anti-profiteering%', '%nuclear delivery%', '%profiteering%nuclear%'],
  },
  {
    id: 8,
    label: 'NSIP application fees April 2026',
    category: 'GOV.UK',
    searchTerms: ['%NSIP%fees%', '%application fees%April%', '%NSIP%application%'],
  },

  // Hansard items (9-14)
  {
    id: 9,
    label: 'North Sea debate Conservative energy',
    category: 'Hansard',
    searchTerms: ['%North Sea%'],
    sourceTypeFilter: 'hansard',
  },
  {
    id: 10,
    label: 'DCO decision deadlines offshore wind',
    category: 'Hansard',
    searchTerms: ['%DCO%deadline%', '%development consent%offshore%', '%DCO%decision%'],
  },
  {
    id: 11,
    label: 'MingYang turbines banned Chinese',
    category: 'Hansard',
    searchTerms: ['%MingYang%', '%Chinese%turbine%', '%Ming Yang%'],
  },
  {
    id: 12,
    label: 'Onshore wind repowering CfD',
    category: 'Hansard',
    searchTerms: ['%onshore wind%repow%', '%repowered%CfD%', '%repower%wind%'],
  },
  {
    id: 13,
    label: 'North Sea transition parliamentary debate',
    category: 'Hansard',
    searchTerms: ['%North Sea%transition%', '%north sea transition%', '%North Sea%debate%'],
    sourceTypeFilter: 'hansard',
  },
  {
    id: 14,
    label: 'Grid connections delays 300GW',
    category: 'Hansard',
    searchTerms: ['%grid connection%', '%300GW%', '%grid%queue%delay%'],
  },

  // Trade press / web search items (15-19)
  {
    id: 15,
    label: 'Norfolk Vanguard Vestas turbine V236',
    category: 'Trade press',
    searchTerms: ['%Norfolk Vanguard%', '%Vestas%V236%', '%Vestas%order%'],
  },
  {
    id: 16,
    label: 'Vestas Scottish nacelle factory',
    category: 'Trade press',
    searchTerms: ['%Vestas%Scottish%', '%Vestas%factory%', '%nacelle%'],
  },
  {
    id: 17,
    label: 'Port of Nigg investment offshore wind',
    category: 'Trade press',
    searchTerms: ['%Port of Nigg%', '%Nigg%offshore%', '%Maraen%'],
  },
  {
    id: 18,
    label: 'Discounted electricity wind farm communities',
    category: 'Trade press',
    searchTerms: ['%discounted electricity%', '%wind farm communit%', '%curtailment%communit%'],
  },
  {
    id: 19,
    label: 'Zero carbon accounting imported electricity',
    category: 'Trade press',
    searchTerms: ['%zero carbon%account%', '%imported electricity%', '%Not A Lot%'],
  },

  // Industry body items (20-22)
  {
    id: 20,
    label: 'OEUK Business Outlook Report 2026',
    category: 'Industry body',
    searchTerms: ['%OEUK%Business Outlook%', '%OEUK%import%', '%OEUK%outlook%'],
  },
  {
    id: 21,
    label: 'OEUK position oil and gas debate',
    category: 'Industry body',
    searchTerms: ['%OEUK%position%', '%OEUK%oil%gas%', '%OEUK%debate%'],
  },
  {
    id: 22,
    label: 'Crown Estate Round 5 Celtic Sea',
    category: 'Industry body',
    searchTerms: ['%Crown Estate%Round 5%', '%Celtic Sea%floating%', '%Celtic Sea%wind%'],
  },
];

// ── RSS feed names for coverage analysis ──────────────────────────────────

const RSS_FEED_NAMES = [
  'Recharge News', 'Windpower Monthly', 'Current±', 'Utility Week',
  'New Power', 'RenewableUK', 'Energy UK', 'Ofgem Blog',
  'Climate Change Committee', 'MHRA Press Releases', 'NICE News',
  'HSJ', 'Pulse Today', 'PharmaTimes', 'The BMJ News',
  'Civil Service World', 'Public Finance', 'Institute for Government',
];

const DIRECT_SOURCE_NAMES = [
  'Ofgem Publications', 'NESO News', 'Crown Estate',
  'Great British Energy', 'North Sea Transition Authority',
  'RenewableUK', 'Energy UK', 'OEUK', 'ORE Catapult',
  'Climate Change Committee', 'MHRA', 'NICE', 'CQC',
  'NHS England News', 'UKHSA', 'National Audit Office',
  'CMA Publications', 'Planning Inspectorate',
];

// ── Coverage gap analysis ─────────────────────────────────────────────────

interface CoverageAnalysis {
  rss: boolean;
  directSource: boolean;
  webSearch: boolean;
  govuk: boolean;
  hansard: boolean;
  notes: string;
}

function analyseCoverage(item: MonitoringItem): CoverageAnalysis {
  const label = item.label.toLowerCase();

  // GOV.UK items should be covered by the GOV.UK collector
  const govuk = item.category === 'GOV.UK' ||
    label.includes('planning inspectorate') ||
    label.includes('nsip');

  // Hansard items should be covered by the Hansard collector
  const hansard = item.category === 'Hansard' ||
    label.includes('debate') ||
    label.includes('parliamentary');

  // RSS: trade press publications
  const rssKeywords = ['vestas', 'norfolk vanguard', 'nacelle', 'port of nigg',
    'discounted electricity', 'curtailment', 'zero carbon', 'oeuk'];
  const rss = rssKeywords.some(k => label.toLowerCase().includes(k));

  // Direct sources: specific orgs
  const directKeywords = ['oeuk', 'crown estate', 'planning inspectorate'];
  const directSource = directKeywords.some(k => label.toLowerCase().includes(k));

  // Web search: would RWE search queries find this?
  // RWE queries include project names, competitor names, policy keywords
  const webSearchTerms = [
    'norfolk vanguard', 'vestas', 'offshore wind', 'onshore wind', 'ccus',
    'grid connection', 'cfd', 'contracts for difference', 'north sea',
    'crown estate', 'rwe', 'oeuk', 'celtic sea',
  ];
  const webSearch = webSearchTerms.some(t => label.toLowerCase().includes(t));

  const sources: string[] = [];
  if (govuk) sources.push('GOV.UK collector');
  if (hansard) sources.push('Hansard collector');
  if (rss) sources.push('RSS feeds');
  if (directSource) sources.push('Direct source scraper');
  if (webSearch) sources.push('Web search');

  const notes = sources.length > 0
    ? `Covered by: ${sources.join(', ')}`
    : 'TRUE GAP — no collector would find this';

  return { rss, directSource, webSearch, govuk, hansard, notes };
}

// ── Main ──────────────────────────────────────────────────────────────────

interface SearchResult {
  found: boolean;
  item?: FeedItem;
  score?: number;
  searchTermUsed?: string;
}

async function searchItem(mi: MonitoringItem): Promise<SearchResult> {
  for (const term of mi.searchTerms) {
    let query = supabase
      .from('feed_items')
      .select('*')
      .ilike('title', term)
      .order('published_at', { ascending: false })
      .limit(5);

    if (mi.sourceTypeFilter) {
      query = query.eq('source_type', mi.sourceTypeFilter);
    }

    const { data, error } = await query;

    if (error) {
      console.warn(`  [ERR] Search for "${term}": ${error.message}`);
      continue;
    }

    if (data && data.length > 0) {
      return { found: true, item: data[0] as FeedItem, searchTermUsed: term };
    }
  }

  return { found: false };
}

async function main() {
  const client = await loadRweConfig();

  console.log(`\n${'═'.repeat(80)}`);
  console.log('  MONITORING AGENT v10 ITEMS — WHITEHALL VERIFICATION');
  console.log(`  Client: ${client.name} | Date: ${new Date().toISOString().slice(0, 10)}`);
  console.log(`${'═'.repeat(80)}\n`);

  const results: Array<{
    mi: MonitoringItem;
    result: SearchResult;
    coverage: CoverageAnalysis;
  }> = [];

  for (const mi of ITEMS) {
    console.log(`\n[${mi.id}/${ITEMS.length}] ${mi.label} (${mi.category})`);
    console.log(`  Search terms: ${mi.searchTerms.join(' | ')}`);

    const result = await searchItem(mi);

    if (result.found && result.item) {
      const score = computeFeedRelevance(result.item, client, undefined, true);
      result.score = score;

      console.log(`  FOUND — matched on: ${result.searchTermUsed}`);
      console.log(`    id:           ${result.item.id}`);
      console.log(`    title:        ${result.item.title.substring(0, 100)}`);
      console.log(`    source_type:  ${result.item.source_type}`);
      console.log(`    source_name:  ${result.item.source_name}`);
      console.log(`    entity_ids:   ${(result.item.entity_ids || []).join(', ')}`);
      console.log(`    published_at: ${result.item.published_at}`);
      console.log(`    score:        ${score.toFixed(3)}`);
    } else {
      console.log(`  MISSING — tried: ${mi.searchTerms.join(', ')}`);
    }

    const coverage = analyseCoverage(mi);
    results.push({ mi, result, coverage });
  }

  // ── Summary table ───────────────────────────────────────────────────────

  console.log(`\n\n${'═'.repeat(100)}`);
  console.log('  SUMMARY TABLE');
  console.log(`${'═'.repeat(100)}\n`);

  console.log('| #  | Item                                        | Found?  | Source type  | Score | Entity tags                |');
  console.log('|----|---------------------------------------------|---------|--------------|-------|----------------------------|');

  for (const { mi, result } of results) {
    const found = result.found ? 'YES' : 'MISSING';
    const sourceType = result.item?.source_type || '-';
    const score = result.score !== undefined ? result.score.toFixed(3) : '-';
    const entities = result.item ? (result.item.entity_ids || []).join(', ') : '-';
    const label = mi.label.length > 43 ? mi.label.substring(0, 40) + '...' : mi.label;

    console.log(
      `| ${String(mi.id).padStart(2)} | ${label.padEnd(43)} | ${found.padEnd(7)} | ${sourceType.padEnd(12)} | ${String(score).padEnd(5)} | ${entities.padEnd(26)} |`,
    );
  }

  // ── Statistics ──────────────────────────────────────────────────────────

  const found = results.filter(r => r.result.found);
  const missing = results.filter(r => !r.result.found);
  const scores = found.map(r => r.result.score!);
  const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const belowThreshold = found.filter(r => r.result.score! < 0.25);

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Total found:   ${found.length}/22`);
  console.log(`Total missing: ${missing.length}/22`);
  console.log(`Average score: ${avgScore.toFixed(3)}`);
  console.log(`Below 0.25 threshold (would be filtered): ${belowThreshold.length}`);

  if (belowThreshold.length > 0) {
    console.log('\nItems scoring below 0.25:');
    for (const { mi, result } of belowThreshold) {
      console.log(`  [${mi.id}] ${mi.label} — ${result.score!.toFixed(3)} (${result.item!.source_type})`);
    }
  }

  // ── Missing items breakdown ─────────────────────────────────────────────

  if (missing.length > 0) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log('MISSING ITEMS — COVERAGE GAP ANALYSIS\n');

    for (const { mi, coverage } of missing) {
      console.log(`  [${mi.id}] ${mi.label} (${mi.category})`);
      console.log(`       ${coverage.notes}`);
    }

    // Category breakdown of missing items
    console.log('\nMissing by category:');
    const categories = ['GOV.UK', 'Hansard', 'Trade press', 'Industry body'] as const;
    for (const cat of categories) {
      const catMissing = missing.filter(r => r.mi.category === cat);
      if (catMissing.length > 0) {
        console.log(`  ${cat}: ${catMissing.length} missing`);
        for (const { mi } of catMissing) {
          console.log(`    - ${mi.label}`);
        }
      }
    }

    // True gaps
    const trueGaps = missing.filter(r => {
      const c = r.coverage;
      return !c.rss && !c.directSource && !c.webSearch && !c.govuk && !c.hansard;
    });
    if (trueGaps.length > 0) {
      console.log(`\nTRUE COVERAGE GAPS (${trueGaps.length} items — no collector would find these):`);
      for (const { mi } of trueGaps) {
        console.log(`  [${mi.id}] ${mi.label} (${mi.category})`);
      }
    }
  }

  // ── Found items by category ─────────────────────────────────────────────

  if (found.length > 0) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log('FOUND ITEMS BY SCORE\n');

    const sorted = [...found].sort((a, b) => b.result.score! - a.result.score!);
    for (const { mi, result } of sorted) {
      const scoreStr = result.score!.toFixed(3);
      const flag = result.score! < 0.25 ? ' ** BELOW THRESHOLD **' : '';
      console.log(`  ${scoreStr}  [${mi.id}] ${mi.label} (${result.item!.source_type})${flag}`);
    }
  }

  console.log(`\n${'═'.repeat(80)}\n`);
}

main().catch(console.error);
