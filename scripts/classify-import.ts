/**
 * Import agent-classified evidence back into the database.
 *
 * Reads completed classification JSONL from .claude/classify/results/,
 * validates, applies public/revealed routing and post-processing,
 * and persists to politician_indicator_evidence + politician_indicators.
 *
 * Usage:
 *   npx tsx scripts/classify-import.ts                         — Import all result files
 *   npx tsx scripts/classify-import.ts --file task-1-speeches  — Import specific result file
 *   npx tsx scripts/classify-import.ts --dry-run               — Validate without writing to DB
 *   npx tsx scripts/classify-import.ts --status                — Show import status
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

// Classifier constants (matching lib/classifier/constants.ts)
const MIN_CONFIDENCE = 0.6;
const ANCHOR_MIN = 0.05;
const ANCHOR_MAX = 0.95;
const MAX_CLASSIFICATIONS_PER_EVIDENCE = 4;
const SOCIAL_POST_WEIGHT_CAP = 0.5;

const BASE_WEIGHTS: Record<string, number> = {
  chamber_speech: 1.5,
  committee_speech: 1.5,
  committee_question: 2.0,
  written_question_asked: 1.5,
  written_question_answered: 1.5,
  oral_question_asked: 1.2,
  oral_question_answered: 1.2,
  amendment_tabled: 1.8,
  op_ed: 1.5,
  press_release: 0.6,
  interview: 1.0,
  social_post: 0.4,
  edm_signature: 0.3,
  edm_proposed: 0.5,
};

// Public/revealed routing per evidence type
const ROUTING: Record<string, { primary: string; secondary?: string; secondary_factor?: number }> = {
  chamber_speech:           { primary: 'public' },
  committee_speech:         { primary: 'public' },
  committee_question:       { primary: 'public', secondary: 'revealed', secondary_factor: 0.5 },
  written_question_asked:   { primary: 'public' },
  written_question_answered: { primary: 'public' },
  oral_question_asked:      { primary: 'public' },
  oral_question_answered:   { primary: 'public' },
  amendment_tabled:         { primary: 'public' },
  op_ed:                    { primary: 'public' },
  press_release:            { primary: 'public' },
  interview:                { primary: 'public' },
  social_post:              { primary: 'public' },
  edm_signature:            { primary: 'public' },
  edm_proposed:             { primary: 'public' },
};

interface ClassificationResult {
  evidence_id: number;
  politician_id: string;
  evidence_type: string;
  classifications: Array<{
    indicator_id: string;
    anchor: number;
    confidence: number;
    reasoning: string;
  }>;
  no_classification_reason?: string;
}

async function main() {
  const { createClient } = await import('@supabase/supabase-js');

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const fileIdx = args.indexOf('--file');
  const filterFile = fileIdx >= 0 ? args[fileIdx + 1] : null;

  if (args.includes('--status')) {
    return showStatus();
  }

  const resultsDir = path.resolve(__dirname, '..', '.claude', 'classify', 'results');
  if (!fs.existsSync(resultsDir)) {
    console.log('No results directory found at .claude/classify/results/');
    console.log('Run classify-export.ts first, then have agents write results there.');
    return;
  }

  // Fetch valid indicator IDs
  const { data: indicators } = await sb
    .from('indicator_definitions')
    .select('id');
  const validIndicatorIds = new Set((indicators ?? []).map((i: { id: string }) => i.id));
  // Also include .public and .revealed suffixed versions
  for (const ind of indicators ?? []) {
    validIndicatorIds.add(`${ind.id}.public`);
    validIndicatorIds.add(`${ind.id}.revealed`);
  }

  // Read result files
  let resultFiles = fs.readdirSync(resultsDir).filter((f: string) => f.endsWith('.jsonl'));
  if (filterFile) {
    resultFiles = resultFiles.filter((f: string) => f.includes(filterFile));
  }

  if (resultFiles.length === 0) {
    console.log('No .jsonl result files found in', resultsDir);
    return;
  }

  let totalRows = 0;
  let totalClassifications = 0;
  let totalSkipped = 0;
  let totalInvalid = 0;
  let totalPersisted = 0;

  for (const fileName of resultFiles) {
    const filePath = path.join(resultsDir, fileName);
    const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean);
    console.log(`\nProcessing ${fileName} (${lines.length} rows)...`);

    for (const line of lines) {
      totalRows++;
      let result: ClassificationResult;

      try {
        result = JSON.parse(line);
      } catch {
        console.warn(`  Invalid JSON on line ${totalRows}`);
        totalInvalid++;
        continue;
      }

      // Validate required fields
      if (!result.evidence_id || !result.politician_id || !result.evidence_type) {
        console.warn(`  Missing required fields on evidence_id=${result.evidence_id}`);
        totalInvalid++;
        continue;
      }

      // Skip if no classifications
      if (!result.classifications?.length) {
        totalSkipped++;
        continue;
      }

      // Post-process classifications
      let classifications = result.classifications
        // Drop below confidence threshold
        .filter((c) => c.confidence >= MIN_CONFIDENCE)
        // Clamp anchors
        .map((c) => ({
          ...c,
          anchor: Math.max(ANCHOR_MIN, Math.min(ANCHOR_MAX, c.anchor)),
          reasoning: (c.reasoning || '').slice(0, 200),
        }));

      // Dedup: keep highest confidence per indicator
      const byIndicator = new Map<string, typeof classifications[0]>();
      for (const c of classifications) {
        const existing = byIndicator.get(c.indicator_id);
        if (!existing || c.confidence > existing.confidence) {
          byIndicator.set(c.indicator_id, c);
        }
      }
      classifications = Array.from(byIndicator.values());

      // Cap at max
      if (classifications.length > MAX_CLASSIFICATIONS_PER_EVIDENCE) {
        classifications.sort((a, b) => b.confidence - a.confidence);
        classifications = classifications.slice(0, MAX_CLASSIFICATIONS_PER_EVIDENCE);
      }

      // Apply routing (add .public/.revealed suffix)
      const routing = ROUTING[result.evidence_type];
      const routed: Array<{
        indicator_id: string;
        anchor: number;
        confidence: number;
        reasoning: string;
        raw_weight: number;
      }> = [];

      for (const c of classifications) {
        const baseWeight = (BASE_WEIGHTS[result.evidence_type] ?? 1.0) * c.confidence;
        let weight = result.evidence_type === 'social_post'
          ? Math.min(baseWeight, SOCIAL_POST_WEIGHT_CAP)
          : baseWeight;
        weight = Math.round(weight * 1000) / 1000;

        // Determine indicator_id — add suffix if not already present
        const needsSuffix = !c.indicator_id.endsWith('.public') && !c.indicator_id.endsWith('.revealed');

        if (needsSuffix && routing) {
          const primaryId = `${c.indicator_id}.${routing.primary}`;
          if (validIndicatorIds.has(primaryId)) {
            routed.push({ ...c, indicator_id: primaryId, raw_weight: weight });
          } else if (validIndicatorIds.has(c.indicator_id)) {
            routed.push({ ...c, raw_weight: weight });
          } else {
            totalInvalid++;
            continue;
          }

          if (routing.secondary) {
            const secondaryId = `${c.indicator_id}.${routing.secondary}`;
            if (validIndicatorIds.has(secondaryId)) {
              routed.push({
                ...c,
                indicator_id: secondaryId,
                raw_weight: Math.round(weight * (routing.secondary_factor ?? 0.5) * 1000) / 1000,
              });
            }
          }
        } else {
          // Already has suffix or no routing
          if (validIndicatorIds.has(c.indicator_id)) {
            routed.push({ ...c, raw_weight: weight });
          } else {
            totalInvalid++;
          }
        }
      }

      if (routed.length === 0) {
        totalSkipped++;
        continue;
      }

      totalClassifications += routed.length;

      if (dryRun) continue;

      // Persist: ensure politician_indicators rows exist
      const indicatorIds = [...new Set(routed.map((r) => r.indicator_id))];
      for (const indicatorId of indicatorIds) {
        await sb.from('politician_indicators').upsert(
          {
            politician_id: result.politician_id,
            indicator_id: indicatorId,
            alpha: 1.0,
            beta: 1.0,
            evidence_count: 0,
            last_updated: new Date().toISOString(),
          },
          { onConflict: 'politician_id,indicator_id', ignoreDuplicates: true },
        );
      }

      // Insert classification evidence
      const rows = routed.map((c) => ({
        politician_id: result.politician_id,
        indicator_id: c.indicator_id,
        evidence_id: result.evidence_id,
        anchor: c.anchor,
        raw_weight: c.raw_weight,
        effective_weight: c.raw_weight,
        classifier_version: 'agent-v1',
        classifier_reasoning: c.reasoning,
      }));

      const { error } = await sb.from('politician_indicator_evidence').insert(rows);
      if (error) {
        console.warn(`  Persist error for evidence_id=${result.evidence_id}: ${error.message}`);
      } else {
        totalPersisted += routed.length;
      }
    }
  }

  console.log(`\n=== Import Summary ===`);
  console.log(`  Result rows read:      ${totalRows}`);
  console.log(`  Classifications found:  ${totalClassifications}`);
  console.log(`  Skipped (no class.):    ${totalSkipped}`);
  console.log(`  Invalid/filtered:       ${totalInvalid}`);
  if (dryRun) {
    console.log(`  [DRY RUN — nothing written to DB]`);
  } else {
    console.log(`  Persisted to DB:        ${totalPersisted}`);
  }
}

function showStatus() {
  const baseDir = path.resolve(__dirname, '..', '.claude', 'classify');
  const resultsDir = path.join(baseDir, 'results');

  console.log('\n=== Classification Import Status ===\n');

  // Task files
  if (fs.existsSync(baseDir)) {
    const taskFiles = fs.readdirSync(baseDir).filter((f: string) => f.endsWith('.jsonl'));
    if (taskFiles.length > 0) {
      console.log('Task files (evidence to classify):');
      for (const f of taskFiles) {
        const lines = fs.readFileSync(path.join(baseDir, f), 'utf-8').trim().split('\n').length;
        console.log(`  ${f}: ${lines} evidence rows`);
      }
    } else {
      console.log('No task files found. Run classify-export.ts first.');
    }
  } else {
    console.log('No .claude/classify/ directory found. Run classify-export.ts first.');
    return;
  }

  // Result files
  if (fs.existsSync(resultsDir)) {
    const resultFiles = fs.readdirSync(resultsDir).filter((f: string) => f.endsWith('.jsonl'));
    if (resultFiles.length > 0) {
      console.log('\nResult files (agent output):');
      let totalComplete = 0;
      for (const f of resultFiles) {
        const content = fs.readFileSync(path.join(resultsDir, f), 'utf-8').trim();
        const lines = content ? content.split('\n').length : 0;
        const withClassifications = content
          ? content.split('\n').filter((l) => {
              try { return JSON.parse(l).classifications?.length > 0; } catch { return false; }
            }).length
          : 0;
        console.log(`  ${f}: ${lines} rows (${withClassifications} with classifications)`);
        totalComplete += lines;
      }
      console.log(`  TOTAL: ${totalComplete} rows`);
    } else {
      console.log('\nNo result files yet. Agents need to write to .claude/classify/results/');
    }
  } else {
    console.log('\nNo results directory. Agents will create it when they start classifying.');
  }
}

main().catch(console.error);
