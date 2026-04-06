import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!,
);

async function main() {
  // Seed items have slug-style fingerprints (no hex hash)
  // Real items have 64-char SHA-256 hex fingerprints
  // Find seed items: fingerprints shorter than 64 chars or not all hex
  const { data: allItems } = await supabase
    .from('feed_items')
    .select('id, fingerprint')
    .limit(2000);

  if (!allItems) {
    console.log('No items found');
    return;
  }

  const hexPattern = /^[a-f0-9]{64}$/;
  const seedItems = allItems.filter((item) => !hexPattern.test(item.fingerprint));

  console.log(`Found ${seedItems.length} seed items to delete (out of ${allItems.length} total)`);

  if (seedItems.length === 0) {
    console.log('Nothing to delete');
    return;
  }

  const ids = seedItems.map((i) => i.id);

  // Delete client_feed_scores first (foreign key)
  const { count: scoreCount } = await supabase
    .from('client_feed_scores')
    .delete({ count: 'exact' })
    .in('feed_item_id', ids);
  console.log(`Deleted ${scoreCount} client_feed_scores`);

  // Delete seed feed items
  const { count: feedCount } = await supabase
    .from('feed_items')
    .delete({ count: 'exact' })
    .in('id', ids);
  console.log(`Deleted ${feedCount} feed_items`);

  // Final count
  const { count: remaining } = await supabase
    .from('feed_items')
    .select('*', { count: 'exact', head: true });
  console.log(`Remaining items: ${remaining}`);
}

main().catch(console.error);
