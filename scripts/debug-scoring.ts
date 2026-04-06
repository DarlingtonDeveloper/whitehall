/**
 * Debug scoring for specific feed items against a client config.
 *
 * Prints the full score breakdown to help diagnose why items rank
 * where they do in the relevance feed.
 *
 * Usage:
 *   npx tsx scripts/debug-scoring.ts                    # score all items
 *   npx tsx scripts/debug-scoring.ts "Norfolk Vanguard"  # filter by title
 *   npx tsx scripts/debug-scoring.ts --client sanofi     # use a different client
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

import { computeFeedRelevance } from '../lib/feed/scoring';
import type { FeedItem } from '../types/feed';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY in .env.local',
  );
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function loadClient(clientId: string) {
  // Dynamic import from data/clients
  try {
    const mod = await import(`../data/clients/${clientId}`);
    // Convention: export is CLIENT_ID_CONFIG (e.g. RWE_CONFIG, SANOFI_CONFIG)
    const configKey = Object.keys(mod).find((k) => k.endsWith('_CONFIG'));
    if (!configKey) throw new Error(`No *_CONFIG export in data/clients/${clientId}`);
    return mod[configKey];
  } catch {
    throw new Error(`Client "${clientId}" not found in data/clients/`);
  }
}

async function main() {
  const args = process.argv.slice(2);

  let clientId = 'rwe';
  let titleFilter = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--client' && args[i + 1]) {
      clientId = args[i + 1];
      i++;
    } else {
      titleFilter = args[i];
    }
  }

  const client = await loadClient(clientId);
  console.log(`\nClient: ${client.name} (${clientId})`);
  console.log(`Primary stakeholders: ${client.stakeholders.filter((s: { priority: string }) => s.priority === 'primary').map((s: { entityId: string }) => s.entityId).join(', ')}`);

  let query = supabase
    .from('feed_items')
    .select('*')
    .order('published_at', { ascending: false })
    .limit(50);

  if (titleFilter) {
    query = query.ilike('title', `%${titleFilter}%`);
    console.log(`Filter: title contains "${titleFilter}"`);
  }

  const { data: items, error } = await query;

  if (error) {
    console.error(`Query error: ${error.message}`);
    return;
  }

  if (!items || items.length === 0) {
    console.log('No items found.');
    return;
  }

  console.log(`\nScoring ${items.length} items:\n${'─'.repeat(80)}`);

  const scored = items.map((item: FeedItem) => {
    const score = computeFeedRelevance(item, client, undefined, true);
    return { item, score };
  });

  scored.sort((a: { score: number }, b: { score: number }) => b.score - a.score);

  console.log(`\n${'─'.repeat(80)}`);
  console.log('\nRanked results:\n');
  for (const { item, score } of scored) {
    const title = item.title.length > 70 ? item.title.substring(0, 70) + '...' : item.title;
    const entities = (item.entity_ids || []).join(',');
    console.log(`  ${score.toFixed(3)}  [${item.source_type}]  ${title}`);
    console.log(`         entities: ${entities || '(none)'}`);
  }
}

main().catch(console.error);
