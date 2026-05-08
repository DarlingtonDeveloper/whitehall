/**
 * Classifier Runner Script
 *
 * Usage:
 *   npx tsx scripts/run-classifier.ts process          — Classify unprocessed evidence (batch of 100)
 *   npx tsx scripts/run-classifier.ts process --limit 500  — Classify with custom batch size
 *   npx tsx scripts/run-classifier.ts status            — Show classifier pipeline status
 *   npx tsx scripts/run-classifier.ts failures          — List unresolved classifier failures
 *   npx tsx scripts/run-classifier.ts migrate           — Run classifier tables migration
 *
 * Requires .env.local with Supabase credentials and ANTHROPIC_API_KEY.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// -- Commands ----------------------------------------------------------------

async function runProcess() {
  const limit = getArgNumber('--limit', 100);

  console.log(`\nClassifying up to ${limit} unprocessed evidence rows...\n`);

  const { processUnclassifiedEvidence } = await import('../lib/classifier');
  const result = await processUnclassifiedEvidence({ limit });

  console.log('--- Classifier Run Summary ---');
  console.log(`  Processed:   ${result.processed}`);
  console.log(`  Classified:  ${result.classified}`);
  console.log(`  Errors:      ${result.errors}`);
}

async function runStatus() {
  console.log('\n=== Classifier Pipeline Status ===\n');

  // Total evidence
  const { count: totalEvidence } = await supabase
    .from('politician_evidence')
    .select('*', { count: 'exact', head: true });
  console.log(`Total evidence rows:    ${totalEvidence ?? 0}`);

  // Classified evidence (has at least one indicator_evidence row)
  const { count: classifiedCount } = await supabase
    .from('politician_indicator_evidence')
    .select('evidence_id', { count: 'exact', head: true });
  console.log(`Classification rows:    ${classifiedCount ?? 0}`);

  // Unique classified evidence IDs
  const { data: uniqueClassified } = await supabase
    .from('politician_indicator_evidence')
    .select('evidence_id');
  const uniqueIds = new Set((uniqueClassified ?? []).map((r: { evidence_id: number }) => r.evidence_id));
  console.log(`Evidence classified:    ${uniqueIds.size}`);

  // Unclassified
  const unclassified = (totalEvidence ?? 0) - uniqueIds.size;
  console.log(`Evidence unclassified:  ${unclassified}`);

  // Failures
  const { count: failureCount } = await supabase
    .from('classifier_failures')
    .select('*', { count: 'exact', head: true })
    .eq('resolved', false);
  console.log(`Unresolved failures:    ${failureCount ?? 0}`);

  // Indicator coverage
  const { count: indicatorCount } = await supabase
    .from('indicator_definitions')
    .select('*', { count: 'exact', head: true });
  console.log(`\nIndicator definitions:  ${indicatorCount ?? 0}`);

  const { count: polIndCount } = await supabase
    .from('politician_indicators')
    .select('*', { count: 'exact', head: true });
  console.log(`Politician × indicator: ${polIndCount ?? 0}`);

  // Mapping table counts
  const { count: bpmCount } = await supabase
    .from('bill_policy_mappings')
    .select('*', { count: 'exact', head: true });
  console.log(`\nBill policy mappings:   ${bpmCount ?? 0}`);

  const { count: orgCount } = await supabase
    .from('org_indicator_map')
    .select('*', { count: 'exact', head: true });
  console.log(`Org indicator mappings: ${orgCount ?? 0}`);

  const { count: appgCount } = await supabase
    .from('appg_indicator_map')
    .select('*', { count: 'exact', head: true });
  console.log(`APPG indicator maps:    ${appgCount ?? 0}`);

  const { count: commCount } = await supabase
    .from('committee_indicator_map')
    .select('*', { count: 'exact', head: true });
  console.log(`Committee indicator maps: ${commCount ?? 0}`);

  // Evidence breakdown by type
  console.log('\n--- Evidence by Type ---');
  const types = [
    'division_vote', 'chamber_speech', 'committee_speech', 'committee_question',
    'written_question_asked', 'written_question_answered', 'edm_signature',
    'register_of_interests', 'appg_membership', 'committee_membership',
    'amendment_tabled', 'oral_question_asked', 'oral_question_answered',
    'op_ed', 'press_release', 'interview', 'social_post',
  ];
  for (const t of types) {
    const { count } = await supabase
      .from('politician_evidence')
      .select('*', { count: 'exact', head: true })
      .eq('evidence_type', t);
    if (count && count > 0) {
      console.log(`  ${t.padEnd(28)} ${count}`);
    }
  }
}

async function runFailures() {
  console.log('\n=== Unresolved Classifier Failures ===\n');

  const { data: failures } = await supabase
    .from('classifier_failures')
    .select('*')
    .eq('resolved', false)
    .order('created_at', { ascending: false })
    .limit(50);

  if (!failures || failures.length === 0) {
    console.log('No unresolved failures.');
    return;
  }

  for (const f of failures) {
    console.log(`  #${f.id} | evidence=${f.evidence_id} | ${f.error_type} | retries=${f.retry_count}`);
    if (f.error_message) {
      console.log(`         ${f.error_message.slice(0, 120)}`);
    }
  }
  console.log(`\nTotal: ${failures.length} failures shown (max 50)`);
}

async function runMigrate() {
  console.log('\nRunning classifier tables migration...\n');

  const fs = await import('fs');
  const schemaPath = path.resolve(__dirname, '..', 'supabase', 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');

  // Extract classifier table DDL (everything after the "Classifier mapping tables" comment)
  const classifierStart = schema.indexOf('-- Classifier mapping tables');
  if (classifierStart === -1) {
    console.error('Could not find classifier tables section in schema.sql');
    process.exit(1);
  }

  const classifierSql = schema.slice(classifierStart);

  // Split into individual statements and execute
  const statements = classifierSql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('--'));

  let success = 0;
  let skipped = 0;

  for (const stmt of statements) {
    const { error } = await supabase.rpc('exec_sql', { sql: stmt + ';' }).single();
    if (error) {
      if (error.message?.includes('already exists')) {
        skipped++;
      } else {
        console.warn(`  Warning: ${error.message?.slice(0, 100)}`);
      }
    } else {
      success++;
    }
  }

  console.log(`Migration complete: ${success} executed, ${skipped} already existed`);
  console.log('\nNote: If using Supabase Dashboard, paste the classifier section of schema.sql');
  console.log('into the SQL Editor for reliable execution.');
}

// -- Helpers -----------------------------------------------------------------

function getArgNumber(flag: string, defaultValue: number): number {
  const args = process.argv;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return defaultValue;
  const val = parseInt(args[idx + 1], 10);
  return isNaN(val) ? defaultValue : val;
}

// -- Main --------------------------------------------------------------------

const command = process.argv[2];

switch (command) {
  case 'process':
    runProcess().catch(console.error);
    break;
  case 'status':
    runStatus().catch(console.error);
    break;
  case 'failures':
    runFailures().catch(console.error);
    break;
  case 'migrate':
    runMigrate().catch(console.error);
    break;
  default:
    console.log(`Usage: npx tsx scripts/run-classifier.ts <command>

Commands:
  process [--limit N]   Classify unprocessed evidence (default: 100)
  status                Show classifier pipeline status
  failures              List unresolved classifier failures
  migrate               Run classifier tables migration`);
}
