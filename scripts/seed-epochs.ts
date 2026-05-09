/**
 * Seed epoch_transitions with key UK political events.
 *
 * Epochs dampen evidence around major political transitions:
 * - Pre-event window: campaign rhetoric / positioning gets dampened
 * - Post-event dampening: evidence before a defection/role-change becomes less relevant
 *
 * Usage: npx tsx scripts/seed-epochs.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !serviceKey) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const db = createClient(supabaseUrl, serviceKey);

interface EpochSeed {
  politician_id: string | null;
  event_type: string;
  event_date: string;
  effective_date: string;
  pre_event_window_days: number;
  pre_event_dampening: number;
  post_event_dampening: number;
  source: string;
  notes: string;
}

const epochs: EpochSeed[] = [
  // ── Global events ─────────────────────────────────────────────────────

  // 2024 General Election — 4 July 2024
  // Parliament dissolved 30 May 2024. Campaign rhetoric is performative.
  {
    politician_id: null,
    event_type: 'general_election',
    event_date: '2024-07-04',
    effective_date: '2024-07-04',
    pre_event_window_days: 90,
    pre_event_dampening: 0.3,
    post_event_dampening: 1.0,
    source: 'manual',
    notes: '2024 UK General Election. Labour landslide. Pre-election campaign rhetoric heavily dampened.',
  },

  // ── Conservative leadership ───────────────────────────────────────────

  // Kemi Badenoch elected Conservative leader — 2 November 2024
  {
    politician_id: 'kemi-badenoch',
    event_type: 'leadership_change',
    event_date: '2024-11-02',
    effective_date: '2024-11-02',
    pre_event_window_days: 60,
    pre_event_dampening: 0.5,
    post_event_dampening: 1.0,
    source: 'manual',
    notes: 'Elected Conservative Party leader, replacing Rishi Sunak.',
  },

  // ── Labour whip suspensions — two-child benefit cap rebellion, July 2024 ──
  // Seven Labour MPs voted against the government on the two-child benefit cap.
  // Whip suspended then restored within weeks.

  ...['zarah-sultana', 'richard-burgon', 'john-mcdonnell', 'apsana-begum', 'imran-hussain', 'kim-johnson', 'rebecca-long-bailey'].map(
    (id): EpochSeed => ({
      politician_id: id,
      event_type: 'whip_withdrawn',
      event_date: '2024-07-23',
      effective_date: '2024-07-23',
      pre_event_window_days: 14,
      pre_event_dampening: 0.8,
      post_event_dampening: 0.7,
      source: 'manual',
      notes: 'Labour whip suspended for voting against govt on two-child benefit cap.',
    }),
  ),

  ...['zarah-sultana', 'richard-burgon', 'john-mcdonnell', 'apsana-begum', 'imran-hussain', 'kim-johnson', 'rebecca-long-bailey'].map(
    (id): EpochSeed => ({
      politician_id: id,
      event_type: 'whip_restored',
      event_date: '2024-10-14',
      effective_date: '2024-10-14',
      pre_event_window_days: 7,
      pre_event_dampening: 1.0,
      post_event_dampening: 1.0,
      source: 'manual',
      notes: 'Labour whip restored after suspension for two-child cap rebellion.',
    }),
  ),

  // ── Defections ────────────────────────────────────────────────────────

  // Rosie Duffield resigned Labour whip — 28 September 2024
  {
    politician_id: 'rosie-duffield',
    event_type: 'resignation',
    event_date: '2024-09-28',
    effective_date: '2024-09-28',
    pre_event_window_days: 30,
    pre_event_dampening: 0.4,
    post_event_dampening: 0.5,
    source: 'manual',
    notes: 'Resigned Labour whip citing disagreements with Starmer government. Now sits as independent.',
  },

  // Lee Anderson defected Conservative → Reform UK — 12 March 2024
  {
    politician_id: 'lee-anderson',
    event_type: 'defection',
    event_date: '2024-03-12',
    effective_date: '2024-03-12',
    pre_event_window_days: 30,
    pre_event_dampening: 0.3,
    post_event_dampening: 0.4,
    source: 'manual',
    notes: 'Defected from Conservatives to Reform UK after whip withdrawn over Islamophobia comments.',
  },

  // Dan Poulter defected Conservative → Labour — 27 April 2024
  {
    politician_id: 'dan-poulter',
    event_type: 'defection',
    event_date: '2024-04-27',
    effective_date: '2024-04-27',
    pre_event_window_days: 30,
    pre_event_dampening: 0.3,
    post_event_dampening: 0.4,
    source: 'manual',
    notes: 'Defected from Conservatives to Labour citing NHS concerns. Did not stand in 2024 election.',
  },

  // Natalie Elphicke defected Conservative → Labour — 8 May 2024
  {
    politician_id: 'natalie-elphicke',
    event_type: 'defection',
    event_date: '2024-05-08',
    effective_date: '2024-05-08',
    pre_event_window_days: 14,
    pre_event_dampening: 0.3,
    post_event_dampening: 0.4,
    source: 'manual',
    notes: 'Defected from Conservatives to Labour. Did not stand in 2024 election.',
  },

  // ── Role changes ─────────────────────────────────────────────────────

  // Keir Starmer becomes PM — 5 July 2024
  {
    politician_id: 'keir-starmer',
    event_type: 'role_change',
    event_date: '2024-07-05',
    effective_date: '2024-07-05',
    pre_event_window_days: 90,
    pre_event_dampening: 0.4,
    post_event_dampening: 1.0,
    source: 'manual',
    notes: 'Became Prime Minister. Pre-PM statements as opposition leader are campaign rhetoric.',
  },

  // ── Cabinet reshuffle — November 2024 ─────────────────────────────────

  // Louise Haigh resigned as Transport Secretary — 29 November 2024
  {
    politician_id: 'louise-haigh',
    event_type: 'resignation',
    event_date: '2024-11-29',
    effective_date: '2024-11-29',
    pre_event_window_days: 14,
    pre_event_dampening: 0.6,
    post_event_dampening: 0.8,
    source: 'manual',
    notes: 'Resigned as Transport Secretary over fraud caution disclosure.',
  },
];

async function main() {
  console.log(`Seeding ${epochs.length} epoch transitions...\n`);

  // Check which politicians exist
  const polIds = [...new Set(epochs.filter((e) => e.politician_id).map((e) => e.politician_id!))];
  const { data: existing } = await db.from('politicians').select('id').in('id', polIds);
  const existingSet = new Set((existing ?? []).map((p) => p.id));

  const missing = polIds.filter((id) => !existingSet.has(id));
  if (missing.length > 0) {
    console.log(`  Warning: ${missing.length} politicians not in DB, skipping their epochs: ${missing.join(', ')}`);
  }

  // Filter to only epochs with valid politician_id (or null for global)
  const valid = epochs.filter((e) => e.politician_id === null || existingSet.has(e.politician_id));
  console.log(`  ${valid.length} valid epochs to insert (${epochs.length - valid.length} skipped)\n`);

  // Clear existing epochs first
  const { count: existingCount } = await db.from('epoch_transitions').select('*', { count: 'exact', head: true });
  if (existingCount && existingCount > 0) {
    console.log(`  Clearing ${existingCount} existing epoch transitions...`);
    await db.from('epoch_transitions').delete().gte('id', 0);
  }

  // Insert in batches
  const batchSize = 20;
  let inserted = 0;
  for (let i = 0; i < valid.length; i += batchSize) {
    const batch = valid.slice(i, i + batchSize);
    const { error } = await db.from('epoch_transitions').insert(batch);
    if (error) {
      console.error(`  Error inserting batch ${i}: ${error.message}`);
    } else {
      inserted += batch.length;
    }
  }

  console.log(`  Inserted ${inserted} epoch transitions.\n`);

  // Verify
  const { data: all } = await db.from('epoch_transitions').select('event_type, event_date, politician_id, notes').order('event_date');
  if (all) {
    for (const row of all) {
      const scope = row.politician_id ? row.politician_id : 'GLOBAL';
      console.log(`  ${row.event_date} [${row.event_type}] ${scope} — ${row.notes?.slice(0, 60)}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
