/**
 * Export unclassified evidence for Claude Code agent classification.
 *
 * Pulls LLM-type evidence from the database and writes batches to
 * .claude/classify/ as JSONL files. Each agent picks up one task file.
 *
 * Usage:
 *   npx tsx scripts/classify-export.ts                    — Export all, split into 3 task files
 *   npx tsx scripts/classify-export.ts --limit 500        — Export up to 500 items total
 *   npx tsx scripts/classify-export.ts --type chamber_speech  — Export only one evidence type
 *   npx tsx scripts/classify-export.ts --status           — Show what's available to export
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

// Evidence types that need LLM/agent classification (not deterministic)
const LLM_EVIDENCE_TYPES = [
  'chamber_speech',
  'committee_speech',
  'committee_question',
  'written_question_asked',
  'written_question_answered',
  'oral_question_asked',
  'oral_question_answered',
  'amendment_tabled',
  'op_ed',
  'press_release',
  'interview',
  'social_post',
  'edm_signature',
  'edm_proposed',
];

// Task assignments — how evidence types split across 3 agents
const TASK_ASSIGNMENTS: Record<string, string[]> = {
  'task-1-speeches': ['chamber_speech', 'committee_speech', 'committee_question'],
  'task-2-questions': ['written_question_asked', 'written_question_answered', 'oral_question_asked', 'oral_question_answered'],
  'task-3-other': ['amendment_tabled', 'op_ed', 'press_release', 'interview', 'social_post', 'edm_signature', 'edm_proposed'],
};

interface ExportRow {
  evidence_id: number;
  politician_id: string;
  politician_name: string;
  politician_party: string | null;
  politician_constituency: string | null;
  evidence_type: string;
  occurred_at: string;
  raw_content: string;
  topic_tags: string[];
  candidate_indicators: Array<{
    id: string;
    label_low: string;
    label_high: string;
    description: string;
  }>;
}

async function main() {
  const { createClient } = await import('@supabase/supabase-js');

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const args = process.argv.slice(2);

  if (args.includes('--status')) {
    return showStatus(sb);
  }

  const limitIdx = args.indexOf('--limit');
  const maxRows = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : Infinity;

  const typeIdx = args.indexOf('--type');
  const filterType = typeIdx >= 0 ? args[typeIdx + 1] : null;

  // 1. Get already-classified evidence IDs
  const { data: classifiedRows } = await sb
    .from('politician_indicator_evidence')
    .select('evidence_id');
  const classifiedIds = new Set(
    (classifiedRows ?? []).map((r: { evidence_id: number }) => r.evidence_id),
  );
  console.log(`Already classified: ${classifiedIds.size} evidence rows`);

  // 2. Get already-failed evidence IDs (skip them)
  const { data: failedRows } = await sb
    .from('classifier_failures')
    .select('evidence_id')
    .eq('resolved', false);
  const failedIds = new Set(
    (failedRows ?? []).map((r: { evidence_id: number }) => r.evidence_id),
  );

  // 3. Fetch all indicator definitions
  const { data: indicators } = await sb
    .from('indicator_definitions')
    .select('id, radar, label_low, label_high, description, policy_area')
    .in('radar', ['policy', 'ideology']);
  const allIndicators = indicators ?? [];

  // 4. Fetch unclassified evidence
  const types = filterType ? [filterType] : LLM_EVIDENCE_TYPES;
  const exportRows: ExportRow[] = [];

  for (const evidenceType of types) {
    let offset = 0;
    const pageSize = 500;

    while (exportRows.length < maxRows) {
      const { data, error } = await sb
        .from('politician_evidence')
        .select('id, politician_id, evidence_type, occurred_at, raw_content, topic_tags, parsed')
        .eq('evidence_type', evidenceType)
        .order('occurred_at', { ascending: false })
        .range(offset, offset + pageSize - 1);

      if (error || !data?.length) break;

      for (const row of data) {
        if (classifiedIds.has(row.id) || failedIds.has(row.id)) continue;
        if (!row.raw_content?.trim()) continue;

        // Pre-filter candidate indicators by topic_tags overlap
        const tags: string[] = row.topic_tags ?? [];
        let candidates = allIndicators;
        if (tags.length > 0) {
          const tagMatched = allIndicators.filter(
            (ind: { policy_area: string | null }) =>
              ind.policy_area && tags.includes(ind.policy_area),
          );
          if (tagMatched.length > 0) candidates = tagMatched;
        }
        // Cap at 15
        candidates = candidates.slice(0, 15);

        exportRows.push({
          evidence_id: row.id,
          politician_id: row.politician_id,
          politician_name: '', // filled below
          politician_party: null,
          politician_constituency: null,
          evidence_type: row.evidence_type,
          occurred_at: row.occurred_at,
          raw_content: row.raw_content,
          topic_tags: tags,
          candidate_indicators: candidates.map(
            (ind: { id: string; label_low: string; label_high: string; description: string }) => ({
              id: ind.id,
              label_low: ind.label_low,
              label_high: ind.label_high,
              description: ind.description,
            }),
          ),
        });

        if (exportRows.length >= maxRows) break;
      }

      offset += data.length;
      if (data.length < pageSize) break;
    }
  }

  if (exportRows.length === 0) {
    console.log('No unclassified evidence to export.');
    return;
  }

  // 5. Batch-fetch politician details
  const polIds = [...new Set(exportRows.map((r) => r.politician_id))];
  const polMap = new Map<string, { display_name: string; party: string | null; constituency: string | null }>();

  for (let i = 0; i < polIds.length; i += 100) {
    const batch = polIds.slice(i, i + 100);
    const { data: pols } = await sb
      .from('politicians')
      .select('id, display_name, party, constituency')
      .in('id', batch);
    for (const p of pols ?? []) {
      polMap.set(p.id, { display_name: p.display_name, party: p.party, constituency: p.constituency });
    }
  }

  for (const row of exportRows) {
    const pol = polMap.get(row.politician_id);
    if (pol) {
      row.politician_name = pol.display_name;
      row.politician_party = pol.party;
      row.politician_constituency = pol.constituency;
    }
  }

  // 6. Write task files
  const outDir = path.resolve(__dirname, '..', '.claude', 'classify');
  fs.mkdirSync(outDir, { recursive: true });

  if (filterType) {
    // Single type mode — write one file
    const outPath = path.join(outDir, `evidence-${filterType}.jsonl`);
    writeJsonl(outPath, exportRows);
    console.log(`\nExported ${exportRows.length} rows to ${outPath}`);
  } else {
    // Split into 3 task files
    for (const [taskName, taskTypes] of Object.entries(TASK_ASSIGNMENTS)) {
      const taskRows = exportRows.filter((r) => taskTypes.includes(r.evidence_type));
      if (taskRows.length === 0) continue;

      const outPath = path.join(outDir, `${taskName}.jsonl`);
      writeJsonl(outPath, taskRows);
      console.log(`  ${taskName}: ${taskRows.length} rows → ${outPath}`);
    }
  }

  // 7. Write the results template
  const resultsDir = path.join(outDir, 'results');
  fs.mkdirSync(resultsDir, { recursive: true });

  console.log(`\nTotal exported: ${exportRows.length} evidence rows`);
  console.log(`Results directory: ${resultsDir}`);
  console.log(`\nTo classify, run 3 Claude Code agents:`);
  console.log(`  claude "Read CLAUDE.md then classify .claude/classify/task-1-speeches.jsonl"`);
  console.log(`  claude "Read CLAUDE.md then classify .claude/classify/task-2-questions.jsonl"`);
  console.log(`  claude "Read CLAUDE.md then classify .claude/classify/task-3-other.jsonl"`);
}

async function showStatus(sb: any) {
  console.log('\n=== Evidence Available for Agent Classification ===\n');

  // Get already-classified
  const { data: classifiedRows } = await sb
    .from('politician_indicator_evidence')
    .select('evidence_id');
  const classifiedIds = new Set(
    (classifiedRows ?? []).map((r: { evidence_id: number }) => r.evidence_id),
  );

  for (const [taskName, taskTypes] of Object.entries(TASK_ASSIGNMENTS)) {
    let total = 0;
    console.log(`${taskName}:`);
    for (const t of taskTypes) {
      const { count } = await sb
        .from('politician_evidence')
        .select('*', { count: 'exact', head: true })
        .eq('evidence_type', t);
      const c = count ?? 0;
      if (c > 0) {
        console.log(`  ${t.padEnd(28)} ${c}`);
        total += c;
      }
    }
    console.log(`  ${'TOTAL'.padEnd(28)} ${total}\n`);
  }

  // Check for existing export files
  const outDir = path.resolve(__dirname, '..', '.claude', 'classify');
  if (fs.existsSync(outDir)) {
    console.log('Existing export files:');
    for (const f of fs.readdirSync(outDir).filter((f: string) => f.endsWith('.jsonl'))) {
      const lines = fs.readFileSync(path.join(outDir, f), 'utf-8').trim().split('\n').length;
      console.log(`  ${f}: ${lines} rows`);
    }

    // Check results
    const resultsDir = path.join(outDir, 'results');
    if (fs.existsSync(resultsDir)) {
      const resultFiles = fs.readdirSync(resultsDir).filter((f: string) => f.endsWith('.jsonl'));
      if (resultFiles.length > 0) {
        console.log('\nCompleted result files:');
        for (const f of resultFiles) {
          const lines = fs.readFileSync(path.join(resultsDir, f), 'utf-8').trim().split('\n').length;
          console.log(`  ${f}: ${lines} rows`);
        }
      }
    }
  }
}

function writeJsonl(filePath: string, rows: ExportRow[]) {
  const lines = rows.map((r) => JSON.stringify(r)).join('\n');
  fs.writeFileSync(filePath, lines + '\n', 'utf-8');
}

main().catch(console.error);
