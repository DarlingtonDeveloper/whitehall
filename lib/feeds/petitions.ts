/**
 * UK Parliament Petitions Collector
 *
 * Fetches petitions from the UK Parliament Petitions API that have reached
 * government response or debate thresholds, or are currently open and
 * gaining significant traction.
 *
 * API: https://petition.parliament.uk/petitions.json
 *
 * Items are upserted with source_type = 'petition'.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

import {
  enrichEntityIds,
  determineRagStatus,
  makeFingerprint,
  extractTopicTags,
} from './entity-enrichment';
import { cleanTitle } from './clean-title';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY in .env.local',
  );
}

const supabaseReadonly = createClient(supabaseUrl, supabaseKey);
// Use service role for all writes (RLS blocks anon inserts)
const supabase = serviceKey ? createClient(supabaseUrl, serviceKey) : supabaseReadonly;

// ── API endpoints ─────────────────────────────────────────────────────────

const PETITIONS_API = 'https://petition.parliament.uk/petitions.json';

// Petition states we care about
const PETITION_STATES = [
  'with_response',      // Government has responded (10k+ signatures)
  'debated',            // Debated in Parliament (100k+ signatures)
  'awaiting_response',  // Has 10k+ but no response yet
  'awaiting_debate',    // Has 100k+ but not yet debated
  'open',               // Open and collecting signatures
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Main collector ────────────────────────────────────────────────────────

const BATCH_SIZE = 25;

interface PetitionData {
  type: string;
  id: number;
  links: { self: string };
  attributes: {
    action: string;
    background?: string;
    additional_details?: string;
    state: string;
    signature_count: number;
    created_at: string;
    updated_at: string;
    opened_at?: string;
    government_response_at?: string;
    debate_threshold_reached_at?: string;
    response_threshold_reached_at?: string;
    government_response?: {
      summary: string;
      details: string;
      responded_on: string;
    };
    debate?: {
      debated_on: string;
      transcript_url?: string;
      overview?: string;
    };
    departments?: Array<{ slug: string; name: string }>;
  };
}

export async function collectPetitions(since?: Date): Promise<{ inserted: number; skipped: number }> {
  let totalInserted = 0;
  let totalSkipped = 0;

  const cutoffDate = since ?? new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

  console.log(`\n=== Parliament Petitions Collector ===`);
  console.log(`States: ${PETITION_STATES.join(', ')}`);
  console.log(`Cutoff: ${cutoffDate.toISOString().slice(0, 10)}\n`);

  for (const state of PETITION_STATES) {
    let page = 1;
    let hasMore = true;
    let insertedForState = 0;
    let skippedForState = 0;

    while (hasMore) {
      try {
        const url = `${PETITIONS_API}?page=${page}&state=${state}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15_000);

        const resp = await fetch(url, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Whitehall-Monitor/1.0 (petitions-collector)',
            Accept: 'application/json',
          },
        });

        clearTimeout(timer);

        if (!resp.ok) {
          console.warn(`  [WARN] Petitions API ${resp.status} for state=${state}, page=${page}`);
          break;
        }

        const json = await resp.json();
        const petitions: PetitionData[] = json.data || [];

        if (petitions.length === 0) {
          hasMore = false;
          break;
        }

        const rows: Array<Record<string, unknown>> = [];

        for (const p of petitions) {
          const attrs = p.attributes;
          const createdAt = new Date(attrs.created_at);

          // Skip old petitions
          if (createdAt < cutoffDate) {
            hasMore = false;
            break;
          }

          // For 'open' petitions, only collect those with 1000+ signatures
          if (state === 'open' && attrs.signature_count < 1000) continue;

          const petitionUrl = `https://petition.parliament.uk/petitions/${p.id}`;

          // Build body with response/debate info if available
          let body = attrs.background || '';
          if (attrs.government_response) {
            body += `\n\nGovernment response: ${attrs.government_response.summary}`;
          }
          if (attrs.debate?.overview) {
            body += `\n\nDebate: ${attrs.debate.overview}`;
          }
          body += `\n\nSignatures: ${attrs.signature_count.toLocaleString()}`;

          const title = cleanTitle(`Petition: ${attrs.action}`);
          const entityIds = enrichEntityIds([], title, body);
          const ragStatus = determineRagStatus(title, body);
          const fingerprint = makeFingerprint(petitionUrl, attrs.action);

          // Determine published_at — use most recent significant date
          const publishedAt =
            attrs.government_response_at ||
            attrs.debate_threshold_reached_at ||
            attrs.response_threshold_reached_at ||
            attrs.opened_at ||
            attrs.created_at;

          rows.push({
            source_type: 'petition',
            source_name: 'UK Parliament Petitions',
            title,
            url: petitionUrl,
            published_at: new Date(publishedAt).toISOString(),
            body: body.slice(0, 3000) || null,
            entity_ids: entityIds,
            topic_tags: extractTopicTags(title, body),
            rag_status: ragStatus.toLowerCase(),
            relevance_score: 0.15,
            fingerprint,
            is_forward_scan: false,
            raw_data: {
              signature_count: attrs.signature_count,
              state: attrs.state,
            },
          });
        }

        // Upsert
        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
          const batch = rows.slice(i, i + BATCH_SIZE);
          const { data, error } = await supabase
            .from('feed_items')
            .upsert(batch, { onConflict: 'fingerprint', ignoreDuplicates: true })
            .select('id');

          if (error) {
            console.warn(`    [ERR] Petitions upsert failed: ${error.message}`);
            skippedForState += batch.length;
            continue;
          }

          insertedForState += data?.length ?? 0;
          skippedForState += batch.length - (data?.length ?? 0);
        }

        page++;
        // Cap pagination to avoid runaway
        if (page > 20) hasMore = false;

        await delay(300);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`  [WARN] Petitions ${state}: ${message}`);
        break;
      }
    }

    console.log(`  ${state}: ${insertedForState} inserted, ${skippedForState} skipped`);
    totalInserted += insertedForState;
    totalSkipped += skippedForState;
  }

  console.log(`\n=== Petitions Collection Complete ===`);
  console.log(`Total inserted: ${totalInserted}`);
  console.log(`Total skipped:  ${totalSkipped}\n`);

  return { inserted: totalInserted, skipped: totalSkipped };
}
