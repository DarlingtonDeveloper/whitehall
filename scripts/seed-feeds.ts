import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load env from .env.local
dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Helper: generate a date N days ago from today
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

// Helper: simple fingerprint from title
function fingerprint(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// ── Feed items ──────────────────────────────────────────────────────────

interface SeedItem {
  source_type: string;
  source_name: string;
  title: string;
  url: string;
  published_at: string;
  body: string;
  entity_ids: string[];
  monitoring_theme: string;
  rag_status: string;
  relevance_score: number;
  fingerprint: string;
  event_date: string | null;
  is_forward_scan: boolean;
}

const feedItems: SeedItem[] = [
  // ── GOV.UK items (20) ────────────────────────────────────────────────
  {
    source_type: 'govuk',
    source_name: 'GOV.UK Publications',
    title: 'DESNZ publishes Clean Power 2030 Action Plan progress report',
    url: 'https://www.gov.uk/government/publications/clean-power-2030-progress',
    published_at: daysAgo(1),
    body: 'The Department for Energy Security and Net Zero has published its annual progress report on the Clean Power 2030 Action Plan, detailing progress towards decarbonising the electricity grid.',
    entity_ids: ['desnz'],
    monitoring_theme: 'energy-transition',
    rag_status: 'green',
    relevance_score: 0.92,
    fingerprint: fingerprint('DESNZ publishes Clean Power 2030 Action Plan progress report'),
    event_date: null,
    is_forward_scan: false,
  },
  {
    source_type: 'govuk',
    source_name: 'GOV.UK Consultations',
    title: 'Consultation: Offshore wind environmental impact assessment framework',
    url: 'https://www.gov.uk/government/consultations/offshore-wind-eia-framework',
    published_at: daysAgo(2),
    body: 'DESNZ and Natural England are jointly consulting on a revised environmental impact assessment framework for offshore wind developments, aiming to streamline consenting while maintaining ecological protections.',
    entity_ids: ['desnz', 'natural-england'],
    monitoring_theme: 'offshore-wind',
    rag_status: 'amber',
    relevance_score: 0.88,
    fingerprint: fingerprint('Consultation: Offshore wind environmental impact assessment framework'),
    event_date: daysAgo(-30),
    is_forward_scan: true,
  },
  {
    source_type: 'govuk',
    source_name: 'GOV.UK Publications',
    title: 'Great British Energy: corporate plan and investment priorities',
    url: 'https://www.gov.uk/government/publications/gbe-corporate-plan-2026',
    published_at: daysAgo(3),
    body: 'Great British Energy has published its first corporate plan, setting out investment priorities across onshore wind, solar, and tidal energy projects over the next five years.',
    entity_ids: ['gbe', 'desnz'],
    monitoring_theme: 'energy-transition',
    rag_status: 'green',
    relevance_score: 0.95,
    fingerprint: fingerprint('Great British Energy: corporate plan and investment priorities'),
    event_date: null,
    is_forward_scan: false,
  },
  {
    source_type: 'govuk',
    source_name: 'GOV.UK Publications',
    title: 'DHSC announces NHS workforce expansion programme',
    url: 'https://www.gov.uk/government/news/nhs-workforce-expansion-programme',
    published_at: daysAgo(4),
    body: 'The Department of Health and Social Care has announced a major NHS workforce expansion programme, committing to 15,000 additional clinical training places by 2028.',
    entity_ids: ['dhsc', 'nhs-improve'],
    monitoring_theme: 'nhs-workforce',
    rag_status: 'green',
    relevance_score: 0.85,
    fingerprint: fingerprint('DHSC announces NHS workforce expansion programme'),
    event_date: null,
    is_forward_scan: false,
  },
  {
    source_type: 'govuk',
    source_name: 'GOV.UK Consultations',
    title: 'MHRA consultation on innovative licensing pathway for ATMPs',
    url: 'https://www.gov.uk/government/consultations/mhra-atmp-licensing-pathway',
    published_at: daysAgo(5),
    body: 'The Medicines and Healthcare products Regulatory Agency is consulting on a new accelerated licensing pathway for Advanced Therapy Medicinal Products, including gene and cell therapies.',
    entity_ids: ['mhra', 'dhsc'],
    monitoring_theme: 'pharma-regulation',
    rag_status: 'amber',
    relevance_score: 0.91,
    fingerprint: fingerprint('MHRA consultation on innovative licensing pathway for ATMPs'),
    event_date: daysAgo(-45),
    is_forward_scan: true,
  },
  {
    source_type: 'govuk',
    source_name: 'GOV.UK Publications',
    title: 'National Grid ESO: Future Energy Scenarios 2026',
    url: 'https://www.gov.uk/government/publications/neso-future-energy-scenarios-2026',
    published_at: daysAgo(5),
    body: 'NESO has published its annual Future Energy Scenarios report, modelling four pathways to net zero and their implications for grid infrastructure investment.',
    entity_ids: ['neso', 'desnz'],
    monitoring_theme: 'grid-infrastructure',
    rag_status: 'green',
    relevance_score: 0.87,
    fingerprint: fingerprint('National Grid ESO: Future Energy Scenarios 2026'),
    event_date: null,
    is_forward_scan: false,
  },
  {
    source_type: 'govuk',
    source_name: 'GOV.UK News',
    title: 'Contracts for Difference Allocation Round 7: key dates confirmed',
    url: 'https://www.gov.uk/government/news/cfd-ar7-key-dates',
    published_at: daysAgo(6),
    body: 'DESNZ has confirmed the key dates for the seventh Contracts for Difference allocation round, with applications opening in September 2026.',
    entity_ids: ['desnz', 'lccc'],
    monitoring_theme: 'cfd-auctions',
    rag_status: 'green',
    relevance_score: 0.94,
    fingerprint: fingerprint('Contracts for Difference Allocation Round 7: key dates confirmed'),
    event_date: daysAgo(-150),
    is_forward_scan: true,
  },
  {
    source_type: 'govuk',
    source_name: 'GOV.UK Publications',
    title: 'Ofgem decision: RIIO-3 price control framework for electricity transmission',
    url: 'https://www.gov.uk/government/publications/ofgem-riio3-decision',
    published_at: daysAgo(7),
    body: 'Ofgem has published its final determination on the RIIO-3 price control for electricity transmission, setting revenue allowances for network operators from 2026 to 2031.',
    entity_ids: ['ofgem', 'desnz'],
    monitoring_theme: 'grid-infrastructure',
    rag_status: 'amber',
    relevance_score: 0.89,
    fingerprint: fingerprint('Ofgem decision: RIIO-3 price control framework for electricity transmission'),
    event_date: null,
    is_forward_scan: false,
  },
  {
    source_type: 'govuk',
    source_name: 'GOV.UK Publications',
    title: 'NICE publishes updated health technology evaluation manual',
    url: 'https://www.gov.uk/government/publications/nice-hte-manual-2026',
    published_at: daysAgo(8),
    body: 'The National Institute for Health and Care Excellence has updated its health technology evaluation manual, incorporating new methods for assessing cell and gene therapies.',
    entity_ids: ['nice', 'dhsc'],
    monitoring_theme: 'pharma-regulation',
    rag_status: 'green',
    relevance_score: 0.83,
    fingerprint: fingerprint('NICE publishes updated health technology evaluation manual'),
    event_date: null,
    is_forward_scan: false,
  },
  {
    source_type: 'govuk',
    source_name: 'GOV.UK Guidance',
    title: 'Guidance: Planning consent for battery energy storage systems over 50MW',
    url: 'https://www.gov.uk/guidance/bess-planning-consent-over-50mw',
    published_at: daysAgo(9),
    body: 'Updated guidance on the planning consent process for large-scale battery energy storage systems, following the removal of the de facto cap on NSIP thresholds.',
    entity_ids: ['desnz', 'pins'],
    monitoring_theme: 'energy-storage',
    rag_status: 'green',
    relevance_score: 0.79,
    fingerprint: fingerprint('Guidance: Planning consent for battery energy storage systems over 50MW'),
    event_date: null,
    is_forward_scan: false,
  },
  {
    source_type: 'govuk',
    source_name: 'GOV.UK News',
    title: 'UK-EU emissions trading scheme linkage: progress update',
    url: 'https://www.gov.uk/government/news/uk-eu-ets-linkage-progress',
    published_at: daysAgo(10),
    body: 'DESNZ has published an update on negotiations to link the UK Emissions Trading Scheme with the EU ETS, following the agreement in principle reached in late 2025.',
    entity_ids: ['desnz', 'defra'],
    monitoring_theme: 'carbon-markets',
    rag_status: 'amber',
    relevance_score: 0.82,
    fingerprint: fingerprint('UK-EU emissions trading scheme linkage: progress update'),
    event_date: null,
    is_forward_scan: false,
  },
  {
    source_type: 'govuk',
    source_name: 'GOV.UK Publications',
    title: 'DHSC publishes Life Sciences Vision delivery report 2026',
    url: 'https://www.gov.uk/government/publications/life-sciences-vision-delivery-2026',
    published_at: daysAgo(11),
    body: 'Annual delivery report on the UK Life Sciences Vision, covering clinical trials reform, manufacturing investment, and the NHS as a platform for innovation.',
    entity_ids: ['dhsc', 'ols'],
    monitoring_theme: 'life-sciences',
    rag_status: 'green',
    relevance_score: 0.86,
    fingerprint: fingerprint('DHSC publishes Life Sciences Vision delivery report 2026'),
    event_date: null,
    is_forward_scan: false,
  },
  {
    source_type: 'govuk',
    source_name: 'GOV.UK Publications',
    title: 'Hydrogen production business model: allocation round 2 results',
    url: 'https://www.gov.uk/government/publications/hpbm-ar2-results',
    published_at: daysAgo(12),
    body: 'DESNZ has announced the results of the second hydrogen production business model allocation round, awarding contracts for 1.2GW of electrolytic hydrogen capacity.',
    entity_ids: ['desnz'],
    monitoring_theme: 'hydrogen',
    rag_status: 'green',
    relevance_score: 0.90,
    fingerprint: fingerprint('Hydrogen production business model: allocation round 2 results'),
    event_date: null,
    is_forward_scan: false,
  },
  {
    source_type: 'govuk',
    source_name: 'GOV.UK Consultations',
    title: 'Consultation: Review of the Capacity Market for low-carbon flexibility',
    url: 'https://www.gov.uk/government/consultations/capacity-market-low-carbon-review',
    published_at: daysAgo(13),
    body: 'DESNZ is consulting on reforms to the Capacity Market to better support low-carbon flexible generation, including long-duration energy storage and demand-side response.',
    entity_ids: ['desnz', 'ofgem'],
    monitoring_theme: 'capacity-market',
    rag_status: 'amber',
    relevance_score: 0.88,
    fingerprint: fingerprint('Consultation: Review of the Capacity Market for low-carbon flexibility'),
    event_date: daysAgo(-60),
    is_forward_scan: true,
  },
  {
    source_type: 'govuk',
    source_name: 'GOV.UK News',
    title: 'MHRA grants first conditional approval under International Recognition Framework',
    url: 'https://www.gov.uk/government/news/mhra-irf-first-approval',
    published_at: daysAgo(14),
    body: 'The MHRA has granted its first conditional marketing authorisation using the International Recognition Framework, approving an oncology treatment already authorised by the FDA and EMA.',
    entity_ids: ['mhra'],
    monitoring_theme: 'pharma-regulation',
    rag_status: 'green',
    relevance_score: 0.87,
    fingerprint: fingerprint('MHRA grants first conditional approval under International Recognition Framework'),
    event_date: null,
    is_forward_scan: false,
  },
  {
    source_type: 'govuk',
    source_name: 'GOV.UK Publications',
    title: 'Carbon capture, usage and storage: Track-2 cluster sequencing update',
    url: 'https://www.gov.uk/government/publications/ccus-track2-update',
    published_at: daysAgo(15),
    body: 'DESNZ provides an update on the Track-2 CCUS cluster sequencing process, confirming Acorn and Viking CCS as the next priority clusters for government support.',
    entity_ids: ['desnz'],
    monitoring_theme: 'ccus',
    rag_status: 'green',
    relevance_score: 0.84,
    fingerprint: fingerprint('Carbon capture, usage and storage: Track-2 cluster sequencing update'),
    event_date: null,
    is_forward_scan: false,
  },
  {
    source_type: 'govuk',
    source_name: 'GOV.UK Publications',
    title: 'NHS England commercial framework for specialised medicines 2026-28',
    url: 'https://www.gov.uk/government/publications/nhse-commercial-framework-specialised-medicines',
    published_at: daysAgo(16),
    body: 'NHS England has published its updated commercial framework for specialised medicines, including new outcome-based payment models for high-cost therapies.',
    entity_ids: ['nhse', 'dhsc'],
    monitoring_theme: 'nhs-commissioning',
    rag_status: 'green',
    relevance_score: 0.81,
    fingerprint: fingerprint('NHS England commercial framework for specialised medicines 2026-28'),
    event_date: null,
    is_forward_scan: false,
  },
  {
    source_type: 'govuk',
    source_name: 'GOV.UK Publications',
    title: 'Electricity networks strategic framework: implementation plan',
    url: 'https://www.gov.uk/government/publications/electricity-networks-strategic-framework-implementation',
    published_at: daysAgo(17),
    body: 'DESNZ has published the implementation plan for the Electricity Networks Strategic Framework, setting out the timeline for transmission network acceleration measures.',
    entity_ids: ['desnz', 'ofgem', 'neso'],
    monitoring_theme: 'grid-infrastructure',
    rag_status: 'green',
    relevance_score: 0.91,
    fingerprint: fingerprint('Electricity networks strategic framework: implementation plan'),
    event_date: null,
    is_forward_scan: false,
  },
  {
    source_type: 'govuk',
    source_name: 'GOV.UK Guidance',
    title: 'Guidance: Submitting environmental statements for solar NSIP applications',
    url: 'https://www.gov.uk/guidance/solar-nsip-environmental-statements',
    published_at: daysAgo(18),
    body: 'Updated guidance from the Planning Inspectorate on the requirements for environmental statements accompanying nationally significant solar infrastructure project applications.',
    entity_ids: ['pins', 'desnz'],
    monitoring_theme: 'solar',
    rag_status: 'green',
    relevance_score: 0.72,
    fingerprint: fingerprint('Guidance: Submitting environmental statements for solar NSIP applications'),
    event_date: null,
    is_forward_scan: false,
  },
  {
    source_type: 'govuk',
    source_name: 'GOV.UK News',
    title: 'DHSC announces reforms to clinical trial approval process',
    url: 'https://www.gov.uk/government/news/clinical-trial-approval-reforms',
    published_at: daysAgo(19),
    body: 'The Department of Health and Social Care has announced streamlined clinical trial approval processes, aiming to reduce approval timelines from 30 to 14 days for low-risk trials.',
    entity_ids: ['dhsc', 'mhra', 'hra'],
    monitoring_theme: 'clinical-trials',
    rag_status: 'green',
    relevance_score: 0.88,
    fingerprint: fingerprint('DHSC announces reforms to clinical trial approval process'),
    event_date: null,
    is_forward_scan: false,
  },

  // ── Hansard items (15) ───────────────────────────────────────────────
  {
    source_type: 'hansard',
    source_name: 'Hansard - House of Commons',
    title: 'Oral Questions: Department for Energy Security and Net Zero',
    url: 'https://hansard.parliament.uk/commons/2026-03-25/debates/energy-oral-questions',
    published_at: daysAgo(3),
    body: 'Energy Security Secretary answered questions on offshore wind deployment targets, grid connection reform, and the timeline for Great British Energy investments.',
    entity_ids: ['desnz', 'desnz-sec'],
    monitoring_theme: 'energy-transition',
    rag_status: 'green',
    relevance_score: 0.80,
    fingerprint: fingerprint('Oral Questions: Department for Energy Security and Net Zero'),
    event_date: null,
    is_forward_scan: false,
  },
  {
    source_type: 'hansard',
    source_name: 'Hansard - Written Statements',
    title: 'Written Statement: Grid Connection Reform Programme',
    url: 'https://hansard.parliament.uk/commons/2026-03-20/statements/grid-connection-reform',
    published_at: daysAgo(6),
    body: 'The Energy Minister laid a written statement on the Grid Connection Reform Programme, confirming NESO will implement a new "first-ready, first-connected" queue management approach by Q4 2026.',
    entity_ids: ['desnz-energy', 'neso'],
    monitoring_theme: 'grid-infrastructure',
    rag_status: 'amber',
    relevance_score: 0.93,
    fingerprint: fingerprint('Written Statement: Grid Connection Reform Programme'),
    event_date: daysAgo(-180),
    is_forward_scan: true,
  },
  {
    source_type: 'hansard',
    source_name: 'Hansard - House of Commons',
    title: 'Debate: NHS Workforce Planning',
    url: 'https://hansard.parliament.uk/commons/2026-03-18/debates/nhs-workforce-planning',
    published_at: daysAgo(8),
    body: 'Backbench debate on NHS workforce planning, covering GP shortages, international recruitment, and the impact of the NHS Long Term Workforce Plan.',
    entity_ids: ['dhsc', 'dhsc-sec'],
    monitoring_theme: 'nhs-workforce',
    rag_status: 'green',
    relevance_score: 0.76,
    fingerprint: fingerprint('Debate: NHS Workforce Planning'),
    event_date: null,
    is_forward_scan: false,
  },
  {
    source_type: 'hansard',
    source_name: 'Hansard - House of Lords',
    title: 'Lords debate: Energy Bill [HL] - Committee Stage Day 3',
    url: 'https://hansard.parliament.uk/lords/2026-03-15/debates/energy-bill-committee-day3',
    published_at: daysAgo(10),
    body: 'Committee stage consideration of the Energy Bill, covering amendments on community benefit provisions for onshore wind, and powers for Great British Energy.',
    entity_ids: ['desnz', 'gbe'],
    monitoring_theme: 'energy-legislation',
    rag_status: 'amber',
    relevance_score: 0.85,
    fingerprint: fingerprint('Lords debate: Energy Bill [HL] - Committee Stage Day 3'),
    event_date: null,
    is_forward_scan: false,
  },
  {
    source_type: 'hansard',
    source_name: 'Hansard - Written Statements',
    title: 'Written Statement: Pharmaceutical Price Regulation Scheme annual review',
    url: 'https://hansard.parliament.uk/commons/2026-03-12/statements/pprs-annual-review',
    published_at: daysAgo(12),
    body: 'The Health Minister laid a written statement on the annual review of the Voluntary Scheme for Branded Medicines Pricing, Access and Growth (VPAG), noting total NHS savings of £2.1bn.',
    entity_ids: ['dhsc', 'nhse'],
    monitoring_theme: 'pharma-regulation',
    rag_status: 'green',
    relevance_score: 0.84,
    fingerprint: fingerprint('Written Statement: Pharmaceutical Price Regulation Scheme annual review'),
    event_date: null,
    is_forward_scan: false,
  },
  {
    source_type: 'hansard',
    source_name: 'Hansard - House of Commons',
    title: 'Urgent Question: Sizewell C construction timeline',
    url: 'https://hansard.parliament.uk/commons/2026-03-10/debates/sizewell-c-uq',
    published_at: daysAgo(14),
    body: 'Urgent question on reports of delays to the Sizewell C new nuclear construction programme, with the Energy Secretary confirming the project remains on track for FID.',
    entity_ids: ['desnz', 'szc-co'],
    monitoring_theme: 'nuclear',
    rag_status: 'red',
    relevance_score: 0.78,
    fingerprint: fingerprint('Urgent Question: Sizewell C construction timeline'),
    event_date: null,
    is_forward_scan: false,
  },
  {
    source_type: 'hansard',
    source_name: 'Hansard - House of Commons',
    title: 'Oral Questions: Department of Health and Social Care',
    url: 'https://hansard.parliament.uk/commons/2026-03-08/debates/dhsc-oral-questions',
    published_at: daysAgo(16),
    body: 'Health Secretary answered questions on NHS waiting lists, mental health investment, and the rollout of the Innovative Medicines Fund.',
    entity_ids: ['dhsc', 'dhsc-sec', 'nhse'],
    monitoring_theme: 'nhs-commissioning',
    rag_status: 'green',
    relevance_score: 0.77,
    fingerprint: fingerprint('Oral Questions: Department of Health and Social Care'),
    event_date: null,
    is_forward_scan: false,
  },
  {
    source_type: 'hansard',
    source_name: 'Hansard - Written Statements',
    title: 'Written Statement: UK carbon budget delivery plan Q1 update',
    url: 'https://hansard.parliament.uk/commons/2026-03-06/statements/carbon-budget-q1-update',
    published_at: daysAgo(18),
    body: 'DESNZ quarterly update on progress towards the Sixth Carbon Budget, noting that the power sector is ahead of trajectory while buildings remain the largest delivery risk.',
    entity_ids: ['desnz', 'ccc'],
    monitoring_theme: 'carbon-markets',
    rag_status: 'amber',
    relevance_score: 0.81,
    fingerprint: fingerprint('Written Statement: UK carbon budget delivery plan Q1 update'),
    event_date: null,
    is_forward_scan: false,
  },
  {
    source_type: 'hansard',
    source_name: 'Hansard - House of Lords',
    title: 'Lords debate: Medicines and Medical Devices Bill - Second Reading',
    url: 'https://hansard.parliament.uk/lords/2026-03-04/debates/medicines-bill-2r',
    published_at: daysAgo(20),
    body: 'Second reading debate on the Medicines and Medical Devices Bill, covering provisions for international regulatory recognition and AI-assisted diagnostics regulation.',
    entity_ids: ['dhsc', 'mhra'],
    monitoring_theme: 'pharma-regulation',
    rag_status: 'green',
    relevance_score: 0.82,
    fingerprint: fingerprint('Lords debate: Medicines and Medical Devices Bill - Second Reading'),
    event_date: null,
    is_forward_scan: false,
  },
  {
    source_type: 'hansard',
    source_name: 'Hansard - House of Commons',
    title: 'Debate: Renewable energy supply chain investment',
    url: 'https://hansard.parliament.uk/commons/2026-03-02/debates/renewable-supply-chain',
    published_at: daysAgo(22),
    body: 'Opposition day debate on UK renewable energy supply chain competitiveness, covering blade manufacturing, port infrastructure, and domestic content requirements.',
    entity_ids: ['desnz', 'dbt'],
    monitoring_theme: 'energy-transition',
    rag_status: 'green',
    relevance_score: 0.80,
    fingerprint: fingerprint('Debate: Renewable energy supply chain investment'),
    event_date: null,
    is_forward_scan: false,
  },
  {
    source_type: 'hansard',
    source_name: 'Hansard - Written Answers',
    title: 'Written Answer: NHS England vaccine procurement strategy',
    url: 'https://hansard.parliament.uk/commons/2026-02-28/writtenanswers/nhs-vaccine-procurement',
    published_at: daysAgo(24),
    body: 'Health Minister responds to a written question on NHS England vaccine procurement strategy, confirming multi-year advance purchase agreements with five manufacturers.',
    entity_ids: ['dhsc', 'nhse', 'ukhsa'],
    monitoring_theme: 'pharma-regulation',
    rag_status: 'green',
    relevance_score: 0.79,
    fingerprint: fingerprint('Written Answer: NHS England vaccine procurement strategy'),
    event_date: null,
    is_forward_scan: false,
  },
  {
    source_type: 'hansard',
    source_name: 'Hansard - House of Commons',
    title: 'Debate: Floating offshore wind in the Celtic Sea',
    url: 'https://hansard.parliament.uk/commons/2026-02-26/debates/celtic-sea-floating-wind',
    published_at: daysAgo(25),
    body: 'Westminster Hall debate on floating offshore wind opportunities in the Celtic Sea, covering the Crown Estate leasing round, port investment, and supply chain readiness.',
    entity_ids: ['desnz', 'tce', 'gbe'],
    monitoring_theme: 'offshore-wind',
    rag_status: 'green',
    relevance_score: 0.86,
    fingerprint: fingerprint('Debate: Floating offshore wind in the Celtic Sea'),
    event_date: null,
    is_forward_scan: false,
  },
  {
    source_type: 'hansard',
    source_name: 'Hansard - Written Statements',
    title: 'Written Statement: Antimicrobial resistance national action plan update',
    url: 'https://hansard.parliament.uk/commons/2026-02-24/statements/amr-national-action-plan',
    published_at: daysAgo(26),
    body: 'DHSC provides an update on the UK national action plan on antimicrobial resistance, highlighting progress on the subscription-based model for antibiotic procurement.',
    entity_ids: ['dhsc', 'ukhsa'],
    monitoring_theme: 'life-sciences',
    rag_status: 'green',
    relevance_score: 0.73,
    fingerprint: fingerprint('Written Statement: Antimicrobial resistance national action plan update'),
    event_date: null,
    is_forward_scan: false,
  },
  {
    source_type: 'hansard',
    source_name: 'Hansard - House of Commons',
    title: 'Oral Questions: Crown Estate and seabed leasing for renewables',
    url: 'https://hansard.parliament.uk/commons/2026-02-22/debates/crown-estate-seabed-leasing',
    published_at: daysAgo(27),
    body: 'Treasury oral questions session covering the Crown Estate partnership with Great British Energy, seabed leasing fees, and revenue sharing with coastal communities.',
    entity_ids: ['tce', 'gbe', 'hmt'],
    monitoring_theme: 'offshore-wind',
    rag_status: 'green',
    relevance_score: 0.83,
    fingerprint: fingerprint('Oral Questions: Crown Estate and seabed leasing for renewables'),
    event_date: null,
    is_forward_scan: false,
  },
  {
    source_type: 'hansard',
    source_name: 'Hansard - Written Answers',
    title: 'Written Answer: NICE appraisal timelines for rare disease treatments',
    url: 'https://hansard.parliament.uk/commons/2026-02-20/writtenanswers/nice-rare-disease-appraisals',
    published_at: daysAgo(28),
    body: 'Health Minister responds on NICE appraisal timelines for rare disease treatments, noting average time from marketing authorisation to NICE recommendation has fallen to 7 months.',
    entity_ids: ['nice', 'dhsc'],
    monitoring_theme: 'pharma-regulation',
    rag_status: 'green',
    relevance_score: 0.80,
    fingerprint: fingerprint('Written Answer: NICE appraisal timelines for rare disease treatments'),
    event_date: null,
    is_forward_scan: false,
  },

  // ── Committee items (15) ─────────────────────────────────────────────
  {
    source_type: 'committee',
    source_name: 'Energy Security and Net Zero Committee',
    title: 'Energy Security and Net Zero Committee: Evidence session on CfD reform',
    url: 'https://committees.parliament.uk/event/21234/evidence-session-cfd-reform',
    published_at: daysAgo(2),
    body: 'The committee heard evidence from industry witnesses on the effectiveness of the CfD mechanism, including calls for longer contract terms and technology-specific pots.',
    entity_ids: ['desnz'],
    monitoring_theme: 'cfd-auctions',
    rag_status: 'amber',
    relevance_score: 0.91,
    fingerprint: fingerprint('Energy Security and Net Zero Committee: Evidence session on CfD reform'),
    event_date: null,
    is_forward_scan: false,
  },
  {
    source_type: 'committee',
    source_name: 'Health and Social Care Committee',
    title: 'Health and Social Care Committee: Inquiry into vaccine procurement',
    url: 'https://committees.parliament.uk/event/21567/vaccine-procurement-inquiry',
    published_at: daysAgo(4),
    body: 'The committee opened a new inquiry into UK vaccine procurement strategy, examining value for money, supply chain resilience, and the role of domestic manufacturing.',
    entity_ids: ['dhsc', 'mhra'],
    monitoring_theme: 'pharma-regulation',
    rag_status: 'amber',
    relevance_score: 0.85,
    fingerprint: fingerprint('Health and Social Care Committee: Inquiry into vaccine procurement'),
    event_date: null,
    is_forward_scan: false,
  },
  {
    source_type: 'committee',
    source_name: 'Energy Security and Net Zero Committee',
    title: 'ESNZ Committee: Report on grid connections and network planning',
    url: 'https://committees.parliament.uk/publications/report-grid-connections',
    published_at: daysAgo(7),
    body: 'The committee published its report on grid connections, recommending urgent reform to connection queue management and calling for a Strategic Spatial Energy Plan by mid-2027.',
    entity_ids: ['desnz', 'neso', 'ofgem'],
    monitoring_theme: 'grid-infrastructure',
    rag_status: 'red',
    relevance_score: 0.93,
    fingerprint: fingerprint('ESNZ Committee: Report on grid connections and network planning'),
    event_date: null,
    is_forward_scan: false,
  },
  {
    source_type: 'committee',
    source_name: 'Science, Innovation and Technology Committee',
    title: 'SIT Committee: Evidence session on AI in drug discovery',
    url: 'https://committees.parliament.uk/event/21890/ai-drug-discovery',
    published_at: daysAgo(9),
    body: 'Witnesses from pharmaceutical companies and AI startups gave evidence on the potential of AI-driven drug discovery, regulatory barriers, and data access challenges.',
    entity_ids: ['dsit', 'mhra', 'dhsc'],
    monitoring_theme: 'life-sciences',
    rag_status: 'green',
    relevance_score: 0.82,
    fingerprint: fingerprint('SIT Committee: Evidence session on AI in drug discovery'),
    event_date: null,
    is_forward_scan: false,
  },
  {
    source_type: 'committee',
    source_name: 'Environmental Audit Committee',
    title: 'EAC: Evidence session on carbon border adjustment mechanism implementation',
    url: 'https://committees.parliament.uk/event/22001/cbam-implementation',
    published_at: daysAgo(11),
    body: 'The committee heard evidence on the UK CBAM implementation timeline and its potential impact on energy-intensive industries, carbon leakage, and trade relations.',
    entity_ids: ['desnz', 'hmrc', 'defra'],
    monitoring_theme: 'carbon-markets',
    rag_status: 'amber',
    relevance_score: 0.84,
    fingerprint: fingerprint('EAC: Evidence session on carbon border adjustment mechanism implementation'),
    event_date: null,
    is_forward_scan: false,
  },
  {
    source_type: 'committee',
    source_name: 'Health and Social Care Committee',
    title: 'HASC: Report on NHS use of real-world evidence in commissioning decisions',
    url: 'https://committees.parliament.uk/publications/report-rwe-commissioning',
    published_at: daysAgo(13),
    body: 'The committee published its report recommending that NHS England develop a standardised framework for using real-world evidence in specialised commissioning decisions.',
    entity_ids: ['nhse', 'dhsc', 'nice'],
    monitoring_theme: 'nhs-commissioning',
    rag_status: 'green',
    relevance_score: 0.83,
    fingerprint: fingerprint('HASC: Report on NHS use of real-world evidence in commissioning decisions'),
    event_date: null,
    is_forward_scan: false,
  },
  {
    source_type: 'committee',
    source_name: 'Energy Security and Net Zero Committee',
    title: 'ESNZ Committee: Evidence session on hydrogen transport and storage infrastructure',
    url: 'https://committees.parliament.uk/event/22123/hydrogen-infrastructure',
    published_at: daysAgo(15),
    body: 'Industry witnesses gave evidence on progress with hydrogen transport and storage business models, including the proposed hydrogen pipeline network and salt cavern storage.',
    entity_ids: ['desnz'],
    monitoring_theme: 'hydrogen',
    rag_status: 'green',
    relevance_score: 0.87,
    fingerprint: fingerprint('ESNZ Committee: Evidence session on hydrogen transport and storage infrastructure'),
    event_date: null,
    is_forward_scan: false,
  },
  {
    source_type: 'committee',
    source_name: 'Public Accounts Committee',
    title: 'PAC: Report on Hinkley Point C cost overruns and lessons learned',
    url: 'https://committees.parliament.uk/publications/report-hpc-costs',
    published_at: daysAgo(17),
    body: 'The PAC published a critical report on Hinkley Point C cost escalation, recommending stronger oversight mechanisms for future nuclear projects including Sizewell C.',
    entity_ids: ['desnz', 'nao', 'szc-co'],
    monitoring_theme: 'nuclear',
    rag_status: 'red',
    relevance_score: 0.79,
    fingerprint: fingerprint('PAC: Report on Hinkley Point C cost overruns and lessons learned'),
    event_date: null,
    is_forward_scan: false,
  },
  {
    source_type: 'committee',
    source_name: 'Health and Social Care Committee',
    title: 'HASC: Evidence session on MHRA international regulatory partnerships',
    url: 'https://committees.parliament.uk/event/22234/mhra-international-partnerships',
    published_at: daysAgo(19),
    body: 'The committee examined the MHRA international recognition framework, hearing from regulators and industry on its impact on patient access timelines for new medicines.',
    entity_ids: ['mhra', 'dhsc'],
    monitoring_theme: 'pharma-regulation',
    rag_status: 'green',
    relevance_score: 0.86,
    fingerprint: fingerprint('HASC: Evidence session on MHRA international regulatory partnerships'),
    event_date: null,
    is_forward_scan: false,
  },
  {
    source_type: 'committee',
    source_name: 'Energy Security and Net Zero Committee',
    title: 'ESNZ Committee: Evidence session on Great British Energy operational readiness',
    url: 'https://committees.parliament.uk/event/22345/gbe-operational-readiness',
    published_at: daysAgo(21),
    body: 'The committee questioned GBE officials on operational readiness, investment pipeline, and the recruitment of senior leadership ahead of the first investment decisions.',
    entity_ids: ['gbe', 'desnz'],
    monitoring_theme: 'energy-transition',
    rag_status: 'amber',
    relevance_score: 0.89,
    fingerprint: fingerprint('ESNZ Committee: Evidence session on Great British Energy operational readiness'),
    event_date: null,
    is_forward_scan: false,
  },
  {
    source_type: 'committee',
    source_name: 'Science, Innovation and Technology Committee',
    title: 'SIT Committee: Report on UK clinical trials competitiveness',
    url: 'https://committees.parliament.uk/publications/report-clinical-trials-competitiveness',
    published_at: daysAgo(22),
    body: 'The committee published its report on UK clinical trials competitiveness, recommending faster ethics approval, better data infrastructure, and incentives for industry-sponsored trials.',
    entity_ids: ['dsit', 'dhsc', 'mhra', 'hra'],
    monitoring_theme: 'clinical-trials',
    rag_status: 'amber',
    relevance_score: 0.85,
    fingerprint: fingerprint('SIT Committee: Report on UK clinical trials competitiveness'),
    event_date: null,
    is_forward_scan: false,
  },
  {
    source_type: 'committee',
    source_name: 'Environmental Audit Committee',
    title: 'EAC: Evidence session on biodiversity net gain and renewable energy development',
    url: 'https://committees.parliament.uk/event/22456/bng-renewables',
    published_at: daysAgo(23),
    body: 'Witnesses discussed the interaction between mandatory biodiversity net gain requirements and renewable energy project delivery, including potential conflicts and mitigation strategies.',
    entity_ids: ['defra', 'desnz', 'natural-england'],
    monitoring_theme: 'energy-transition',
    rag_status: 'green',
    relevance_score: 0.75,
    fingerprint: fingerprint('EAC: Evidence session on biodiversity net gain and renewable energy development'),
    event_date: null,
    is_forward_scan: false,
  },
  {
    source_type: 'committee',
    source_name: 'Health and Social Care Committee',
    title: 'HASC: Inquiry launch - NHS access to innovative cell and gene therapies',
    url: 'https://committees.parliament.uk/event/22567/cell-gene-therapy-access',
    published_at: daysAgo(24),
    body: 'The committee launched an inquiry into NHS access to innovative cell and gene therapies, examining appraisal methods, manufacturing capacity, and equitable patient access.',
    entity_ids: ['dhsc', 'nice', 'nhse'],
    monitoring_theme: 'life-sciences',
    rag_status: 'amber',
    relevance_score: 0.88,
    fingerprint: fingerprint('HASC: Inquiry launch - NHS access to innovative cell and gene therapies'),
    event_date: null,
    is_forward_scan: false,
  },
  {
    source_type: 'committee',
    source_name: 'Energy Security and Net Zero Committee',
    title: 'ESNZ Committee: Evidence session on long-duration energy storage',
    url: 'https://committees.parliament.uk/event/22678/ldes-evidence',
    published_at: daysAgo(26),
    body: 'The committee heard evidence on long-duration energy storage technologies, including compressed air, liquid air, and gravity-based systems, and the need for a dedicated revenue support mechanism.',
    entity_ids: ['desnz'],
    monitoring_theme: 'energy-storage',
    rag_status: 'green',
    relevance_score: 0.82,
    fingerprint: fingerprint('ESNZ Committee: Evidence session on long-duration energy storage'),
    event_date: null,
    is_forward_scan: false,
  },
  {
    source_type: 'committee',
    source_name: 'Treasury Committee',
    title: 'Treasury Committee: Evidence session on green gilt issuance and sovereign sustainability-linked bonds',
    url: 'https://committees.parliament.uk/event/22789/green-gilts',
    published_at: daysAgo(29),
    body: 'The committee examined the effectiveness of the UK green gilt programme, investor demand, and the potential for sovereign sustainability-linked bonds tied to climate targets.',
    entity_ids: ['hmt', 'dmo'],
    monitoring_theme: 'carbon-markets',
    rag_status: 'green',
    relevance_score: 0.71,
    fingerprint: fingerprint('Treasury Committee: Evidence session on green gilt issuance and sovereign sustainability-linked bonds'),
    event_date: null,
    is_forward_scan: false,
  },
];

// ── Client score computation ────────────────────────────────────────────

// Energy entities relevant to RWE
const rweEntities = new Set([
  'desnz', 'desnz-sec', 'desnz-energy', 'gbe', 'neso', 'ofgem',
  'lccc', 'pins', 'tce', 'szc-co', 'natural-england', 'defra',
  'ccc', 'hmt', 'dmo', 'dbt', 'hmrc', 'nao',
]);
const rweThemes = new Set([
  'energy-transition', 'offshore-wind', 'grid-infrastructure', 'cfd-auctions',
  'energy-storage', 'carbon-markets', 'hydrogen', 'nuclear', 'ccus',
  'solar', 'capacity-market', 'energy-legislation',
]);

// Health / pharma entities relevant to Sanofi
const sanofiEntities = new Set([
  'dhsc', 'dhsc-sec', 'mhra', 'nice', 'nhse', 'nhs-improve',
  'hra', 'ukhsa', 'ols', 'dsit',
]);
const sanofiThemes = new Set([
  'pharma-regulation', 'nhs-workforce', 'nhs-commissioning',
  'life-sciences', 'clinical-trials',
]);

function computeClientScore(
  item: SeedItem,
  relevantEntities: Set<string>,
  relevantThemes: Set<string>,
): { relevance_score: number; is_actionable: boolean } {
  let score = 0;

  // Entity overlap
  const overlap = item.entity_ids.filter((e) => relevantEntities.has(e)).length;
  score += Math.min(overlap * 0.25, 0.5);

  // Theme match
  if (relevantThemes.has(item.monitoring_theme)) {
    score += 0.35;
  }

  // Base relevance factor
  score += item.relevance_score * 0.15;

  // Clamp
  score = Math.round(Math.min(score, 1) * 100) / 100;

  return {
    relevance_score: score,
    is_actionable: score >= 0.6 && (item.rag_status === 'amber' || item.rag_status === 'red'),
  };
}

// ── Main seed function ──────────────────────────────────────────────────

async function seed() {
  console.log('Seeding feed_items...');

  // Insert feed items in batches of 10
  const batchSize = 10;
  const insertedItems: Array<{ id: string; index: number }> = [];

  for (let i = 0; i < feedItems.length; i += batchSize) {
    const batch = feedItems.slice(i, i + batchSize).map((item) => ({
      source_type: item.source_type,
      source_name: item.source_name,
      title: item.title,
      url: item.url,
      published_at: item.published_at,
      body: item.body,
      entity_ids: item.entity_ids,
      monitoring_theme: item.monitoring_theme,
      rag_status: item.rag_status,
      relevance_score: item.relevance_score,
      fingerprint: item.fingerprint,
      event_date: item.event_date,
      is_forward_scan: item.is_forward_scan,
    }));

    const { data, error } = await supabase
      .from('feed_items')
      .upsert(batch, { onConflict: 'fingerprint' })
      .select('id');

    if (error) {
      console.error(`Error inserting batch ${i / batchSize + 1}:`, error.message);
      continue;
    }

    if (data) {
      data.forEach((row, idx) => {
        insertedItems.push({ id: row.id, index: i + idx });
      });
    }

    console.log(`  Inserted batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(feedItems.length / batchSize)} (${batch.length} items)`);
  }

  console.log(`\nTotal feed_items inserted/upserted: ${insertedItems.length}`);

  // ── Insert client_feed_scores ──────────────────────────────────────
  console.log('\nComputing and inserting client_feed_scores...');

  const clientScores: Array<{
    feed_item_id: string;
    client_id: string;
    relevance_score: number;
    is_actionable: boolean;
  }> = [];

  for (const { id, index } of insertedItems) {
    const item = feedItems[index];

    // RWE scores
    const rweScore = computeClientScore(item, rweEntities, rweThemes);
    clientScores.push({
      feed_item_id: id,
      client_id: 'rwe',
      relevance_score: rweScore.relevance_score,
      is_actionable: rweScore.is_actionable,
    });

    // Sanofi scores
    const sanofiScore = computeClientScore(item, sanofiEntities, sanofiThemes);
    clientScores.push({
      feed_item_id: id,
      client_id: 'sanofi',
      relevance_score: sanofiScore.relevance_score,
      is_actionable: sanofiScore.is_actionable,
    });
  }

  // Insert in batches
  for (let i = 0; i < clientScores.length; i += 20) {
    const batch = clientScores.slice(i, i + 20);
    const { error } = await supabase
      .from('client_feed_scores')
      .upsert(batch, { onConflict: 'feed_item_id,client_id' });

    if (error) {
      console.error(`Error inserting client scores batch ${Math.floor(i / 20) + 1}:`, error.message);
      continue;
    }

    console.log(`  Inserted client scores batch ${Math.floor(i / 20) + 1}/${Math.ceil(clientScores.length / 20)}`);
  }

  console.log(`\nTotal client_feed_scores inserted: ${clientScores.length}`);
  console.log('\nSeed complete.');
}

seed().catch((err) => {
  console.error('Seed script failed:', err);
  process.exit(1);
});
