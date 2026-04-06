#!/usr/bin/env npx tsx
/**
 * Full Feed Collection Script
 *
 * Runs ALL collectors in sequence and reports totals.
 *
 * Sources (11 collectors):
 *   1. GOV.UK Atom feeds (recent items from 35+ departments)
 *   2. GOV.UK Search API (12 months historical, 17 document types)
 *   3. Hansard (spoken + written contributions)
 *   4. Parliament APIs (bills, questions, divisions, statements, EDMs, oral Qs)
 *   5. Legislation.gov.uk (9 Atom feeds — Acts, SIs, Impact Assessments)
 *   6. RSS / trade press (energy, health, general government)
 *   7. Direct sources (government bodies, regulators, industry orgs)
 *   8. Select committees (web scraping of committee pages)
 *   9. Parliament petitions (with government response/debate)
 *  10. Research briefings (Commons & Lords Library)
 *
 * Usage:
 *   npx tsx scripts/collect-all.ts
 */

import { collectGovUK, GOVUK_FEEDS } from '../lib/feeds/govuk';
import { collectGovUKSearch } from '../lib/feeds/govuk-search';
import { collectHansard } from '../lib/feeds/hansard';
import { collectParliament } from '../lib/feeds/parliament';
import { collectLegislation } from '../lib/feeds/legislation';
import { collectRss, RSS_FEEDS } from '../lib/feeds/rss';
import { collectDirectSources, DIRECT_SOURCES } from '../lib/feeds/direct-sources';
import { collectCommittees, COMMITTEES } from '../lib/feeds/committees';
import { collectPetitions } from '../lib/feeds/petitions';
import { collectResearchBriefings } from '../lib/feeds/research-briefings';

interface Result {
  inserted: number;
  skipped: number;
}

async function runCollector(
  name: string,
  fn: () => Promise<Result>,
): Promise<Result> {
  try {
    return await fn();
  } catch (err) {
    console.error(`${name} collection failed:`, err);
    console.log('Continuing with next collector...\n');
    return { inserted: 0, skipped: 0 };
  }
}

async function main() {
  const start = Date.now();

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║       Whitehall — Full Feed Collection (12 months)          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`Started at:           ${new Date().toISOString()}`);
  console.log(`GOV.UK orgs:          ${GOVUK_FEEDS.length}`);
  console.log(`RSS feeds:            ${RSS_FEEDS.length}`);
  console.log(`Direct sources:       ${DIRECT_SOURCES.length}`);
  console.log(`Select committees:    ${COMMITTEES.length}\n`);

  const results: Record<string, Result> = {};

  // ── Primary government APIs ────────────────────────────────────────────

  // Step 1: GOV.UK Atom feeds (recent items)
  results.govukAtom = await runCollector('GOV.UK Atom', collectGovUK);

  // Step 2: GOV.UK Search API (12 months historical)
  results.govukSearch = await runCollector('GOV.UK Search', collectGovUKSearch);

  // Step 3: Hansard (12 months)
  results.hansard = await runCollector('Hansard', collectHansard);

  // Step 4: Parliament APIs (bills, questions, divisions, statements, EDMs, oral Qs)
  results.parliament = await runCollector('Parliament', collectParliament);

  // Step 5: Legislation.gov.uk
  results.legislation = await runCollector('Legislation', collectLegislation);

  // ── New sources (ported from monitoring agent + additions) ─────────────

  // Step 6: RSS / trade press feeds
  results.rss = await runCollector('RSS / Trade Press', collectRss);

  // Step 7: Direct source scraping (regulators, industry orgs)
  results.directSources = await runCollector('Direct Sources', collectDirectSources);

  // Step 8: Select committee web scraping
  results.committees = await runCollector('Select Committees', collectCommittees);

  // Step 9: Parliament petitions
  results.petitions = await runCollector('Petitions', collectPetitions);

  // Step 10: Research briefings (Commons & Lords Library)
  results.researchBriefings = await runCollector('Research Briefings', collectResearchBriefings);

  // ── Summary ────────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  let totalInserted = 0;
  let totalSkipped = 0;

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║       Full Collection Summary                               ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');

  for (const [key, r] of Object.entries(results)) {
    const label = key.padEnd(22);
    console.log(`║  ${label} inserted: ${String(r.inserted).padEnd(21)}║`);
    console.log(`║  ${label} skipped:  ${String(r.skipped).padEnd(21)}║`);
    totalInserted += r.inserted;
    totalSkipped += r.skipped;
  }

  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  TOTAL inserted:      ${String(totalInserted).padEnd(37)}║`);
  console.log(`║  TOTAL skipped:       ${String(totalSkipped).padEnd(37)}║`);
  console.log(`║  Duration:            ${String(elapsed + 's').padEnd(37)}║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');

  if (totalInserted === 0 && totalSkipped === 0) {
    console.log('\nNo items collected. Check network connectivity and .env.local configuration.');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
