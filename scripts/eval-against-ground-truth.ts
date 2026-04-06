#!/usr/bin/env npx tsx
// ---------------------------------------------------------------------------
// Evaluation script — compare a generated report against a human analyst's
// manual selections (ground truth) to measure coverage and accuracy.
//
// Usage:
//   npx tsx scripts/eval-against-ground-truth.ts \
//     --report-id <uuid> \
//     --ground-truth <path-to-json>
//
// Ground truth format (manually compiled from analyst's report):
// [
//   {
//     "title": "GB Energy call for evidence on investment priorities",
//     "source": "GOV.UK",
//     "theme": "policy_regulatory",
//     "rag": "AMBER",
//     "importance": "high"
//   }
// ]
//
// Outputs:
//   - Precision: % of system items that matched ground truth
//   - Recall:    % of ground truth items found by system
//   - F1 score
//   - RAG accuracy for matched items
//   - Theme accuracy for matched items
//   - List of missing items (in ground truth but not report)
//   - List of false positives (in report but not ground truth)
// ---------------------------------------------------------------------------

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!,
);

interface GroundTruthItem {
  title: string;
  source: string;
  theme: string;
  rag: string;
  importance: string;
}

interface ReportItem {
  ref: string;
  headline: string;
  rag: string;
  theme: string;
  confidence: number;
  summary: string;
}

// ---------------------------------------------------------------------------
// Title matching — Jaccard similarity on significant words
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'this', 'that', 'these',
  'those', 'it', 'its', 'not', 'no', 'as', 'if', 'than', 'then',
  'about', 'into', 'through', 'during', 'before', 'after', 'above',
  'between', 'under', 'uk', 'new',
]);

function significantWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOP_WORDS.has(w)),
  );
}

function titlesMatch(a: string, b: string): boolean {
  const aWords = significantWords(a);
  const bWords = significantWords(b);
  const intersection = [...aWords].filter((w) => bWords.has(w));
  const union = new Set([...aWords, ...bWords]);
  if (union.size === 0) return false;
  return intersection.length / union.size > 0.4;
}

// ---------------------------------------------------------------------------
// Extract all items from a report's sections
// ---------------------------------------------------------------------------

function extractReportItems(sections: Record<string, any>): ReportItem[] {
  const items: ReportItem[] = [];
  for (const [themeId, section] of Object.entries(sections)) {
    for (const item of (section as any).items || []) {
      items.push({
        ref: item.ref,
        headline: item.headline,
        rag: item.rag,
        theme: themeId,
        confidence: item.confidence ?? 1,
        summary: item.summary || '',
      });
    }
    for (const item of (section as any).significant_items || []) {
      items.push({
        ref: item.ref,
        headline: item.headline,
        rag: item.rag,
        theme: themeId,
        confidence: item.confidence ?? 1,
        summary: item.summary || '',
      });
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// Match report items to ground truth
// ---------------------------------------------------------------------------

interface MatchResult {
  matched: number;
  pairs: Array<{ report: ReportItem; truth: GroundTruthItem }>;
  missing: GroundTruthItem[];
  falsePositives: ReportItem[];
}

function matchItems(
  reportItems: ReportItem[],
  groundTruth: GroundTruthItem[],
): MatchResult {
  const pairs: MatchResult['pairs'] = [];
  const matchedTruth = new Set<number>();
  const matchedReport = new Set<number>();

  for (let ri = 0; ri < reportItems.length; ri++) {
    for (let gi = 0; gi < groundTruth.length; gi++) {
      if (matchedTruth.has(gi)) continue;

      if (titlesMatch(reportItems[ri].headline, groundTruth[gi].title)) {
        pairs.push({ report: reportItems[ri], truth: groundTruth[gi] });
        matchedTruth.add(gi);
        matchedReport.add(ri);
        break;
      }
    }
  }

  return {
    matched: pairs.length,
    pairs,
    missing: groundTruth.filter((_, i) => !matchedTruth.has(i)),
    falsePositives: reportItems.filter((_, i) => !matchedReport.has(i)),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);

  const reportIdIdx = args.indexOf('--report-id');
  const groundTruthIdx = args.indexOf('--ground-truth');

  if (reportIdIdx === -1 || groundTruthIdx === -1) {
    console.error(
      'Usage: npx tsx scripts/eval-against-ground-truth.ts --report-id <uuid> --ground-truth <path>',
    );
    process.exit(1);
  }

  const reportId = args[reportIdIdx + 1];
  const groundTruthPath = args[groundTruthIdx + 1];

  // Load report
  const { data: draft, error } = await supabase
    .from('report_drafts')
    .select('sections, client_id, date_range_from, date_range_to')
    .eq('id', reportId)
    .single();

  if (error || !draft) {
    console.error('Failed to load report:', error?.message || 'not found');
    process.exit(1);
  }

  // Load ground truth
  if (!fs.existsSync(groundTruthPath)) {
    console.error(`Ground truth file not found: ${groundTruthPath}`);
    process.exit(1);
  }
  const groundTruth: GroundTruthItem[] = JSON.parse(
    fs.readFileSync(groundTruthPath, 'utf-8'),
  );

  // Extract report items
  const reportItems = extractReportItems(
    (draft.sections as any).sections || {},
  );

  // Match
  const match = matchItems(reportItems, groundTruth);

  // Compute metrics
  const precision =
    reportItems.length > 0 ? match.matched / reportItems.length : 0;
  const recall =
    groundTruth.length > 0 ? match.matched / groundTruth.length : 0;
  const f1 =
    precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : 0;

  // RAG accuracy
  const ragCorrect = match.pairs.filter(
    (p) => p.report.rag === p.truth.rag,
  ).length;
  const ragAccuracy =
    match.pairs.length > 0 ? ragCorrect / match.pairs.length : 0;

  // Theme accuracy
  const themeCorrect = match.pairs.filter(
    (p) => p.report.theme === p.truth.theme,
  ).length;
  const themeAccuracy =
    match.pairs.length > 0 ? themeCorrect / match.pairs.length : 0;

  // Output
  console.log('\n════════════════════════════════════════════════');
  console.log('  EVALUATION RESULTS');
  console.log('════════════════════════════════════════════════');
  console.log(`  Client:       ${draft.client_id}`);
  console.log(
    `  Period:       ${draft.date_range_from?.toString().slice(0, 10)} → ${draft.date_range_to?.toString().slice(0, 10)}`,
  );
  console.log(`  Report items: ${reportItems.length}`);
  console.log(`  Ground truth: ${groundTruth.length}`);
  console.log(`  Matched:      ${match.matched}`);
  console.log('────────────────────────────────────────────────');
  console.log(`  Precision:    ${(precision * 100).toFixed(1)}%`);
  console.log(`  Recall:       ${(recall * 100).toFixed(1)}%`);
  console.log(`  F1:           ${(f1 * 100).toFixed(1)}%`);
  console.log(`  RAG accuracy: ${(ragAccuracy * 100).toFixed(1)}%`);
  console.log(`  Theme acc:    ${(themeAccuracy * 100).toFixed(1)}%`);
  console.log('════════════════════════════════════════════════');

  if (match.missing.length > 0) {
    console.log('\n── MISSING (in ground truth, not in report) ──');
    for (const item of match.missing) {
      console.log(
        `  [${item.theme}] [${item.rag}] ${item.title} (${item.source})`,
      );
    }
  }

  if (match.falsePositives.length > 0) {
    console.log('\n── FALSE POSITIVES (in report, not in ground truth) ──');
    for (const item of match.falsePositives) {
      console.log(
        `  [${item.theme}] [${item.rag}] ${item.ref}: ${item.headline}`,
      );
    }
  }

  if (match.pairs.length > 0) {
    const ragMismatches = match.pairs.filter(
      (p) => p.report.rag !== p.truth.rag,
    );
    if (ragMismatches.length > 0) {
      console.log('\n── RAG MISMATCHES ──');
      for (const p of ragMismatches) {
        console.log(
          `  ${p.report.ref}: ${p.report.headline}  system=${p.report.rag}  truth=${p.truth.rag}`,
        );
      }
    }

    const themeMismatches = match.pairs.filter(
      (p) => p.report.theme !== p.truth.theme,
    );
    if (themeMismatches.length > 0) {
      console.log('\n── THEME MISMATCHES ──');
      for (const p of themeMismatches) {
        console.log(
          `  ${p.report.ref}: ${p.report.headline}  system=${p.report.theme}  truth=${p.truth.theme}`,
        );
      }
    }
  }

  console.log('');
}

main().catch((err) => {
  console.error('Evaluation failed:', err);
  process.exit(1);
});
