import { notFound } from 'next/navigation';
import { getServiceClient } from '@/lib/db';
import Shell from '@/components/layout/Shell';
import RadarChart from '@/components/politician/RadarChart';
import EvidenceList from '@/components/politician/EvidenceList';
import IndicatorTable from '@/components/politician/IndicatorTable';

export const dynamic = 'force-dynamic';

interface IndicatorRow {
  indicator_id: string;
  radar: string;
  alpha_decayed: number;
  beta_decayed: number;
  evidence_count: number;
}

interface EvidenceRow {
  id: number;
  evidence_type: string;
  occurred_at: string;
  raw_content: string | null;
  parsed: Record<string, unknown>;
  topic_tags: string[];
  source_url: string | null;
}

interface ClassificationRow {
  evidence_id: number;
  indicator_id: string;
  anchor: number;
  effective_weight: number;
  classifier_reasoning: string | null;
}

export default async function PoliticianPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = getServiceClient();

  // Fetch politician
  const { data: politician } = await db
    .from('politicians')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (!politician) notFound();

  // Fetch decayed indicators
  const { data: indicators } = await db
    .from('politician_indicators_decayed')
    .select('indicator_id, radar, alpha_decayed, beta_decayed, evidence_count')
    .eq('politician_id', id);

  // Fetch indicator definitions for labels
  const indicatorIds = (indicators ?? []).map((i: IndicatorRow) => i.indicator_id);
  const { data: definitions } = await db
    .from('indicator_definitions')
    .select('id, radar, policy_area, label_low, label_high, description')
    .in('id', indicatorIds.length > 0 ? indicatorIds : ['__none__']);

  const defMap = new Map((definitions ?? []).map((d: any) => [d.id, d]));

  // Fetch recent evidence (last 50)
  const { data: evidence } = await db
    .from('politician_evidence')
    .select('id, evidence_type, occurred_at, raw_content, parsed, topic_tags, source_url')
    .eq('politician_id', id)
    .order('occurred_at', { ascending: false })
    .limit(50);

  // Fetch classifications for those evidence rows
  const evidenceIds = (evidence ?? []).map((e: EvidenceRow) => e.id);
  const { data: classifications } = await db
    .from('politician_indicator_evidence')
    .select('evidence_id, indicator_id, anchor, effective_weight, classifier_reasoning')
    .eq('politician_id', id)
    .in('evidence_id', evidenceIds.length > 0 ? evidenceIds : [0]);

  // Group classifications by evidence_id
  const classificationMap = new Map<number, ClassificationRow[]>();
  for (const c of (classifications ?? []) as ClassificationRow[]) {
    if (!classificationMap.has(c.evidence_id)) classificationMap.set(c.evidence_id, []);
    classificationMap.get(c.evidence_id)!.push(c);
  }

  // Build radar data
  const radarData = (indicators ?? [])
    .filter((i: IndicatorRow) => i.evidence_count > 0)
    .map((i: IndicatorRow) => {
      const alpha = Number(i.alpha_decayed);
      const beta = Number(i.beta_decayed);
      const mean = alpha / (alpha + beta);
      const ess = Math.max(0, alpha + beta - 2);
      const confidence = ess / (ess + 5);
      const def = defMap.get(i.indicator_id);
      return {
        indicator_id: i.indicator_id,
        radar: i.radar,
        mean,
        confidence,
        evidence_count: i.evidence_count,
        label_low: def?.label_low ?? '',
        label_high: def?.label_high ?? '',
        policy_area: def?.policy_area ?? '',
        description: def?.description ?? '',
      };
    })
    .sort((a: any, b: any) => b.confidence - a.confidence);

  // Group by radar type for the chart
  const policyIndicators = radarData.filter((d: any) => d.radar === 'policy');
  const ideologyIndicators = radarData.filter((d: any) => d.radar === 'ideology');

  return (
    <Shell>
      <div className="flex h-full flex-col overflow-hidden pt-12">
        {/* Header */}
        <div className="shrink-0 border-b border-wh-border bg-wh-panel px-6 py-4">
          <div className="flex items-center gap-4">
            {politician.portrait_url && (
              <img
                src={politician.portrait_url}
                alt={politician.display_name}
                className="h-14 w-14 rounded-full object-cover border border-wh-border"
              />
            )}
            <div>
              <h1 className="text-lg font-semibold text-wh-text-primary">
                {politician.display_name}
              </h1>
              <p className="text-sm text-wh-text-secondary">
                {politician.party && <span className="mr-2">{politician.party}</span>}
                {politician.constituency && (
                  <span className="text-wh-text-tertiary">{politician.constituency}</span>
                )}
              </p>
              <p className="mt-0.5 text-xs text-wh-text-tertiary">
                {politician.house === 'commons' ? 'House of Commons' : politician.house === 'lords' ? 'House of Lords' : politician.house}
                {politician.status !== 'active' && (
                  <span className="ml-2 rounded bg-wh-border/50 px-1.5 py-0.5 text-[10px] uppercase">
                    {politician.status}
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Left: Radar + Indicators */}
          <div className="flex w-[55%] flex-col overflow-y-auto border-r border-wh-border p-6">
            {/* Radar Chart */}
            <section className="mb-6">
              <h2 className="mb-3 text-sm font-medium text-wh-text-secondary uppercase tracking-wider">
                Indicator Profile
              </h2>
              {policyIndicators.length > 0 ? (
                <RadarChart indicators={policyIndicators} ideologyIndicators={ideologyIndicators} />
              ) : (
                <p className="text-sm text-wh-text-tertiary">No indicator data available yet.</p>
              )}
            </section>

            {/* Indicator Table */}
            <section>
              <h2 className="mb-3 text-sm font-medium text-wh-text-secondary uppercase tracking-wider">
                All Indicators ({radarData.length})
              </h2>
              <IndicatorTable indicators={radarData} />
            </section>
          </div>

          {/* Right: Evidence */}
          <div className="flex w-[45%] flex-col overflow-y-auto p-6">
            <h2 className="mb-3 text-sm font-medium text-wh-text-secondary uppercase tracking-wider">
              Recent Evidence ({evidence?.length ?? 0})
            </h2>
            <EvidenceList
              evidence={(evidence ?? []) as EvidenceRow[]}
              classifications={classificationMap}
              definitions={defMap}
            />
          </div>
        </div>
      </div>
    </Shell>
  );
}
