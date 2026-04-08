import { NextResponse } from 'next/server';
import { collectGovUK } from '@/lib/feeds/govuk';
import { collectGovUKByOrg, collectGovUKSearch } from '@/lib/feeds/govuk-search';
import { collectHansard } from '@/lib/feeds/hansard';
import {
  collectBills,
  collectWrittenQuestions,
  collectDivisions,
  collectLordsDivisions,
  collectWrittenStatements,
  collectEdms,
  collectOralQuestions,
} from '@/lib/feeds/parliament';
import { collectLegislation } from '@/lib/feeds/legislation';
import { collectRss } from '@/lib/feeds/rss';
import { collectDirectSources } from '@/lib/feeds/direct-sources';
import { collectCommittees } from '@/lib/feeds/committees';
import { collectPetitions } from '@/lib/feeds/petitions';
import { collectResearchBriefings } from '@/lib/feeds/research-briefings';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// 4.5 hours — gives 30 min overlap with the 4-hour cron schedule
const LOOKBACK_MS = 4.5 * 60 * 60 * 1000;

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

// Each group is a separate Vercel cron — all fire at the same time.
// Heavy collectors (GOV.UK Search, Parliament) are split so each
// stays well within the 300s Pro limit.
function makeGroups(since: Date): Record<string, () => Promise<Record<string, CollectorResult>>> {
  return {
    govuk: async () => ({
      govukAtom: await runCollector('GOV.UK Atom', collectGovUK),
      govukByOrg: await runCollector('GOV.UK By Org', () => collectGovUKByOrg(since)),
    }),
    govuk_search: async () => ({
      govukSearch: await runCollector('GOV.UK Search', () => collectGovUKSearch(since)),
    }),
    hansard: async () => ({
      hansard: await runCollector('Hansard', () => collectHansard(since)),
    }),
    parliament_bills: async () => ({
      bills: await runCollector('Bills', () => collectBills(since)),
      writtenQuestions: await runCollector('Written Questions', () => collectWrittenQuestions(since)),
      writtenStatements: await runCollector('Written Statements', () => collectWrittenStatements(since)),
    }),
    parliament_activity: async () => ({
      divisions: await runCollector('Divisions', () => collectDivisions(since)),
      lordsDivisions: await runCollector('Lords Divisions', () => collectLordsDivisions(since)),
      edms: await runCollector('EDMs', () => collectEdms(since)),
      oralQuestions: await runCollector('Oral Questions', () => collectOralQuestions(since)),
    }),
    legislation: async () => ({
      legislation: await runCollector('Legislation', () => collectLegislation(since)),
    }),
    media: async () => ({
      rss: await runCollector('RSS', () => collectRss(since)),
      directSources: await runCollector('Direct Sources', collectDirectSources),
    }),
    research: async () => ({
      committees: await runCollector('Committees', collectCommittees),
      petitions: await runCollector('Petitions', () => collectPetitions(since)),
      researchBriefings: await runCollector('Research Briefings', () => collectResearchBriefings(since)),
    }),
  };
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const group = searchParams.get('group');

  const since = new Date(Date.now() - LOOKBACK_MS);
  const groups = makeGroups(since);

  if (!group || !groups[group]) {
    return NextResponse.json(
      { error: `Invalid group. Use one of: ${Object.keys(groups).join(', ')}` },
      { status: 400 },
    );
  }

  const start = Date.now();
  const results = await groups[group]();
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  return NextResponse.json({
    ok: true,
    group,
    since: since.toISOString(),
    timestamp: new Date().toISOString(),
    elapsed_seconds: parseFloat(elapsed),
    results,
  });
}
