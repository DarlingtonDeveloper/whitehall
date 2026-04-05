import type { ClientConfig } from '@/types/client';

function computeAllKeywords(config: Omit<ClientConfig, 'allKeywords'>): string[] {
  const all = [
    ...config.policyKeywords,
    ...config.industryKeywords,
    ...config.competitors,
    ...config.projects,
  ];
  return [...new Set(all)];
}

const base = {
  id: 'sanofi',
  name: 'Sanofi',
  sector: 'pharmaceuticals',
  description: 'Global pharmaceutical and healthcare company with major UK operations in vaccines, specialty care, and general medicines.',

  stakeholders: [
    // --- Primary: sponsoring department & key ministers ---
    { entityId: 'dhsc', priority: 'primary' as const, role: 'Sponsoring department' },
    { entityId: 'dhsc-sec', priority: 'primary' as const, role: 'Secretary of State for Health' },
    { entityId: 'dhsc-innovation', priority: 'primary' as const, role: 'Parliamentary Under-Secretary for Health Innovation' },
    { entityId: 'dhsc-secondary-care', priority: 'primary' as const, role: 'Minister of State for Secondary Care' },

    // --- Primary: key regulators & bodies ---
    { entityId: 'mhra', priority: 'primary' as const, role: 'Medicines and Healthcare Products Regulatory Agency' },
    { entityId: 'nice', priority: 'primary' as const, role: 'National Institute for Health and Care Excellence' },
    { entityId: 'cqc', priority: 'primary' as const, role: 'Care Quality Commission' },

    // --- Secondary: NHS & health bodies ---
    { entityId: 'nhs-improve', priority: 'secondary' as const, role: 'NHS England' },
    { entityId: 'uk-health-security', priority: 'secondary' as const, role: 'UK Health Security Agency' },
    { entityId: 'hra', priority: 'secondary' as const, role: 'Health Research Authority' },
    { entityId: 'hfea', priority: 'secondary' as const, role: 'Human Fertilisation and Embryology Authority' },

    // --- Secondary: science & research ---
    { entityId: 'dsit', priority: 'secondary' as const, role: 'Science, Innovation & Technology department' },
    { entityId: 'ukri', priority: 'secondary' as const, role: 'UK Research and Innovation' },
    { entityId: 'mrc', priority: 'secondary' as const, role: 'Medical Research Council' },

    // --- Tertiary: cross-government ---
    { entityId: 'treasury', priority: 'tertiary' as const, role: 'HM Treasury — fiscal policy and life sciences funding' },
    { entityId: 'dbt', priority: 'tertiary' as const, role: 'Department for Business and Trade — trade and investment' },
    { entityId: 'pm', priority: 'tertiary' as const, role: 'Prime Minister' },
    { entityId: 'chancellor', priority: 'tertiary' as const, role: 'Chancellor of the Exchequer' },
  ],

  projects: [
    'Sanofi UK manufacturing',
    'Sanofi vaccines programme',
    'Dupixent UK launch',
    'Sanofi rare disease therapies',
    'Sanofi consumer healthcare',
  ],

  competitors: [
    'AstraZeneca',
    'GSK',
    'Pfizer',
    'Roche',
    'Novartis',
    'Johnson & Johnson',
    'Merck',
    'Novo Nordisk',
    'Eli Lilly',
    'AbbVie',
  ],

  policyKeywords: [
    'life sciences strategy', 'VPAS', 'voluntary pricing scheme',
    'NICE appraisal', 'health technology assessment', 'HTA',
    'MHRA approval', 'marketing authorisation', 'clinical trials',
    'NHS long term plan', 'NHS workforce plan',
    'medicines pricing', 'branded medicines', 'generic medicines',
    'vaccine procurement', 'immunisation programme',
    'antimicrobial resistance', 'AMR',
    'rare disease framework', 'orphan drugs',
    'genomics', 'precision medicine',
    'AI in healthcare', 'digital health',
    'PPRS', 'patient access scheme',
  ],

  industryKeywords: [
    'ABPI',
    'BioIndustry Association',
    'Pharma Times',
    'life sciences ecosystem',
    'UK BioBank',
  ],

  forwardScanQueries: [
    'UK NICE appraisal consultation deadline',
    'MHRA regulatory pathway update timeline',
    'NHS England procurement framework review',
    'life sciences industrial strategy publication date',
    'VPAS renegotiation timeline',
    'UK vaccine procurement schedule',
    'Health and Social Care Committee inquiry',
    'DHSC consultation deadline upcoming',
  ],

  monitoringThemes: [
    {
      id: 'regulatory_approvals',
      name: 'Regulatory Approvals & Pricing',
      entityIds: ['mhra', 'nice', 'dhsc', 'dhsc-sec', 'dhsc-innovation'],
      keywords: ['approval', 'authorisation', 'NICE appraisal', 'pricing', 'VPAS', 'HTA'],
    },
    {
      id: 'nhs_commissioning',
      name: 'NHS Commissioning & Procurement',
      entityIds: ['nhs-improve', 'dhsc-secondary-care', 'cqc'],
      keywords: ['commissioning', 'procurement', 'formulary', 'NHS', 'patient access'],
    },
    {
      id: 'research_innovation',
      name: 'Research & Innovation',
      entityIds: ['dsit', 'ukri', 'mrc', 'hra'],
      keywords: ['clinical trial', 'research', 'genomics', 'precision medicine', 'AI'],
    },
    {
      id: 'public_health',
      name: 'Public Health & Vaccines',
      entityIds: ['uk-health-security', 'dhsc', 'nhs-improve'],
      keywords: ['vaccine', 'immunisation', 'pandemic', 'AMR', 'public health'],
    },
    {
      id: 'political_parliamentary',
      name: 'Political & Parliamentary',
      entityIds: ['pm', 'chancellor', 'dhsc-sec'],
      keywords: ['debate', 'question', 'committee', 'bill', 'statement'],
    },
    {
      id: 'trade_investment',
      name: 'Trade & Investment',
      entityIds: ['dbt', 'treasury'],
      keywords: ['life sciences', 'investment', 'trade', 'manufacturing', 'supply chain'],
    },
    {
      id: 'competitor_industry',
      name: 'Competitor & Industry',
      entityIds: [],
      keywords: ['AstraZeneca', 'GSK', 'Pfizer', 'Roche', 'Novartis', 'ABPI'],
    },
  ],
} satisfies Omit<ClientConfig, 'allKeywords'>;

export const SANOFI_CONFIG: ClientConfig = {
  ...base,
  allKeywords: computeAllKeywords(base),
};
