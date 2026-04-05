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
  id: 'rwe',
  name: 'RWE',
  sector: 'energy',
  description: 'Major renewable energy company operating offshore wind farms in the UK.',

  stakeholders: [
    // --- Primary: sponsoring department & key ministers ---
    { entityId: 'desnz', priority: 'primary' as const, role: 'Sponsoring department' },
    { entityId: 'desnz-sec', priority: 'primary' as const, role: 'Secretary of State for Energy' },
    { entityId: 'desnz-energy', priority: 'primary' as const, role: 'Minister of State for Energy' },
    { entityId: 'desnz-climate', priority: 'primary' as const, role: 'Parliamentary Under-Secretary for Climate' },
    { entityId: 'desnz-consumers', priority: 'primary' as const, role: 'Parliamentary Under-Secretary for Energy Consumers' },
    { entityId: 'desnz-industry', priority: 'primary' as const, role: 'Parliamentary Under-Secretary for Industry' },
    { entityId: 'desnz-perm-sec', priority: 'primary' as const, role: 'Permanent Secretary, DESNZ' },

    // --- Primary: key regulators & bodies ---
    { entityId: 'ofgem', priority: 'primary' as const, role: 'Energy regulator' },
    { entityId: 'nsta', priority: 'primary' as const, role: 'North Sea Transition Authority' },
    { entityId: 'environment-agency', priority: 'primary' as const, role: 'Environmental regulator' },
    { entityId: 'ccc', priority: 'primary' as const, role: 'Climate advisory body' },
    { entityId: 'gbe', priority: 'primary' as const, role: 'Great British Energy — public investment vehicle' },
    { entityId: 'neso', priority: 'primary' as const, role: 'National Energy System Operator' },

    // --- Secondary: related bodies ---
    { entityId: 'nda', priority: 'secondary' as const, role: 'Nuclear Decommissioning Authority' },
    { entityId: 'ukaea', priority: 'secondary' as const, role: 'UK Atomic Energy Authority' },
    { entityId: 'hse', priority: 'secondary' as const, role: 'Health and Safety Executive' },
    { entityId: 'nista', priority: 'secondary' as const, role: 'National Infrastructure and Service Transformation Authority' },

    // --- Secondary: cross-government departments ---
    { entityId: 'dluhc', priority: 'secondary' as const, role: 'Planning and housing department' },
    { entityId: 'defra', priority: 'secondary' as const, role: 'Environment department' },
    { entityId: 'planning-inspectorate', priority: 'secondary' as const, role: 'Planning decisions and appeals' },
    { entityId: 'natural-england', priority: 'secondary' as const, role: 'Nature conservation adviser' },
    { entityId: 'mmo', priority: 'secondary' as const, role: 'Marine Management Organisation' },

    // --- Tertiary: Treasury & political ---
    { entityId: 'treasury', priority: 'tertiary' as const, role: 'HM Treasury — fiscal policy' },
    { entityId: 'chancellor', priority: 'tertiary' as const, role: 'Chancellor of the Exchequer' },
    { entityId: 'crown-estate', priority: 'tertiary' as const, role: 'Seabed leasing authority' },
    { entityId: 'pm', priority: 'tertiary' as const, role: 'Prime Minister' },
  ],

  projects: [
    'Sofia offshore wind',
    'Norfolk Vanguard offshore wind',
    'Norfolk Boreas offshore wind',
    'Triton Knoll wind farm',
    'RWE renewables UK',
  ],

  competitors: [
    'Orsted',
    'SSE Renewables',
    'Equinor',
    'Iberdrola',
    'ScottishPower Renewables',
    'Vattenfall',
    'EDF Renewables',
    'TotalEnergies',
    'Shell New Energies',
    'BP wind',
  ],

  policyKeywords: [
    'CfD', 'Contracts for Difference', 'allocation round', 'AR7', 'AR8',
    'offshore wind', 'onshore wind', 'Clean Power 2030', 'net zero',
    'grid connection', 'grid queue', 'REMA', 'electricity market reform',
    'energy security', 'Great British Energy', 'GB Energy',
    'SSEP', 'strategic spatial energy plan',
    'crown estate seabed', 'leasing round',
    'carbon capture', 'CCUS', 'hydrogen',
    'capacity market', 'renewable obligation',
  ],

  industryKeywords: [
    'RenewableUK',
    'Energy UK',
    'Wind Europe',
    'Recharge News',
    'offshore wind supply chain',
  ],

  forwardScanQueries: [
    'UK energy consultation deadline upcoming',
    'CfD allocation round timeline',
    'SSEP strategic spatial energy plan publication date',
    'Great British Energy investment fund launch date',
    'offshore wind industry conference UK',
    'Crown Estate leasing round timeline',
    'Ofgem RIIO consultation deadline',
    'Energy Security Committee inquiry',
  ],

  monitoringThemes: [
    {
      id: 'policy_regulatory',
      name: 'Policy & Regulatory Developments',
      entityIds: ['desnz', 'desnz-sec', 'desnz-energy', 'ofgem', 'nsta'],
      keywords: ['policy', 'regulation', 'consultation', 'guidance', 'framework'],
    },
    {
      id: 'market_commercial',
      name: 'Market & Commercial',
      entityIds: ['ofgem', 'neso', 'crown-estate'],
      keywords: ['CfD', 'allocation round', 'strike price', 'capacity market', 'seabed'],
    },
    {
      id: 'infrastructure_grid',
      name: 'Infrastructure & Grid',
      entityIds: ['neso', 'ofgem', 'nista'],
      keywords: ['grid', 'connection', 'transmission', 'infrastructure', 'SSEP'],
    },
    {
      id: 'planning_environment',
      name: 'Planning & Environment',
      entityIds: ['dluhc', 'planning-inspectorate', 'natural-england', 'mmo', 'environment-agency'],
      keywords: ['planning', 'consent', 'environmental impact', 'marine licence', 'DCO'],
    },
    {
      id: 'political_parliamentary',
      name: 'Political & Parliamentary',
      entityIds: ['pm', 'chancellor', 'desnz-sec'],
      keywords: ['debate', 'question', 'committee', 'bill', 'statement'],
    },
    {
      id: 'competitor_industry',
      name: 'Competitor & Industry',
      entityIds: [],
      keywords: ['Orsted', 'SSE', 'Equinor', 'Iberdrola', 'Vattenfall', 'supply chain'],
    },
  ],
} satisfies Omit<ClientConfig, 'allKeywords'>;

export const RWE_CONFIG: ClientConfig = {
  ...base,
  allKeywords: computeAllKeywords(base),
};
