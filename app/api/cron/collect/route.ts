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

// Groups run as separate crons so each stays well within 300s.
// Vercel fires them all at the same time — they run in parallel.
const GROUPS: Record<string, () => Promise<Record<string, CollectorResult>>> = {
  govuk: async () => ({
    govukAtom: await runCollector('GOV.UK Atom', collectGovUK),
    govukSearch: await runCollector('GOV.UK Search', collectAllGovUKSearch),
  }),
  parliament: async () => ({
    hansard: await runCollector('Hansard', collectHansard),
    parliament: await runCollector('Parliament', collectParliament),
    legislation: await runCollector('Legislation', collectLegislation),
  }),
  media: async () => ({
    rss: await runCollector('RSS', collectRss),
    directSources: await runCollector('Direct Sources', collectDirectSources),
  }),
  research: async () => ({
    committees: await runCollector('Committees', collectCommittees),
    petitions: await runCollector('Petitions', collectPetitions),
    researchBriefings: await runCollector('Research Briefings', collectResearchBriefings),
  }),
};

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const group = searchParams.get('group');

  if (!group || !GROUPS[group]) {
    return NextResponse.json(
      { error: `Invalid group. Use one of: ${Object.keys(GROUPS).join(', ')}` },
      { status: 400 },
    );
  }

  const start = Date.now();
  const results = await GROUPS[group]();
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  return NextResponse.json({
    ok: true,
    group,
    timestamp: new Date().toISOString(),
    elapsed_seconds: parseFloat(elapsed),
    results,
  });
}
