import { NextResponse } from 'next/server';
import { collectGovUK } from '@/lib/feeds/govuk';
import { collectAllGovUKSearch } from '@/lib/feeds/govuk-search';
import { collectHansard } from '@/lib/feeds/hansard';
import { collectParliament } from '@/lib/feeds/parliament';
import { collectLegislation } from '@/lib/feeds/legislation';
import { collectRss } from '@/lib/feeds/rss';
import { collectDirectSources } from '@/lib/feeds/direct-sources';
import { collectCommittees } from '@/lib/feeds/committees';
import { collectPetitions } from '@/lib/feeds/petitions';
import { collectResearchBriefings } from '@/lib/feeds/research-briefings';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface CollectorResult {
  inserted: number;
  skipped: number;
}

async function runCollector(
  name: string,
  fn: () => Promise<CollectorResult>,
): Promise<CollectorResult> {
  try {
    return await fn();
  } catch (err) {
    console.error(`[cron/collect] ${name} failed:`, err);
    return { inserted: 0, skipped: 0 };
  }
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const start = Date.now();
  const results: Record<string, CollectorResult> = {};

  // Run all structured API collectors sequentially.
  // These are HTTP fetches against public APIs — no Claude calls, no rate-limited scraping.
  results.govukAtom = await runCollector('GOV.UK Atom', collectGovUK);
  results.govukSearch = await runCollector('GOV.UK Search', collectAllGovUKSearch);
  results.hansard = await runCollector('Hansard', collectHansard);
  results.parliament = await runCollector('Parliament', collectParliament);
  results.legislation = await runCollector('Legislation', collectLegislation);
  results.rss = await runCollector('RSS', collectRss);
  results.directSources = await runCollector('Direct Sources', collectDirectSources);
  results.committees = await runCollector('Committees', collectCommittees);
  results.petitions = await runCollector('Petitions', collectPetitions);
  results.researchBriefings = await runCollector('Research Briefings', collectResearchBriefings);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  return NextResponse.json({
    ok: true,
    timestamp: new Date().toISOString(),
    elapsed_seconds: parseFloat(elapsed),
    results,
  });
}
