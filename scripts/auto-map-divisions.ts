/**
 * Auto-generate bill_policy_mappings from division titles using keyword matching.
 * Uses the same TOPIC_TAG_MAP regex patterns to identify policy areas, then maps
 * to the corresponding indicator definitions.
 *
 * Usage:
 *   npx tsx scripts/auto-map-divisions.ts [--dry-run]
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

// Maps topic tags to indicator_ids and anchor configuration.
// aye = supporting the bill (usually government position on govt bills, proposer on opposition motions).
const TAG_TO_INDICATORS: Record<string, Array<{
  indicator_id: string;
  aye_anchor: number;
  no_anchor: number;
  diagnostic_strength: number;
}>> = {
  // Employment & workers' rights
  'industrial-strategy': [
    { indicator_id: 'employment.workers_rights.revealed', aye_anchor: 0.8, no_anchor: 0.2, diagnostic_strength: 0.8 },
    { indicator_id: 'ideology.economic_left_right.revealed', aye_anchor: 0.7, no_anchor: 0.3, diagnostic_strength: 0.5 },
  ],
  // Welfare & benefits
  'welfare': [
    { indicator_id: 'welfare.benefits_expansion.revealed', aye_anchor: 0.8, no_anchor: 0.2, diagnostic_strength: 0.85 },
  ],
  'pensions': [
    { indicator_id: 'welfare.benefits_expansion.revealed', aye_anchor: 0.7, no_anchor: 0.3, diagnostic_strength: 0.6 },
  ],
  'cost-of-living': [
    { indicator_id: 'welfare.benefits_expansion.revealed', aye_anchor: 0.7, no_anchor: 0.3, diagnostic_strength: 0.5 },
    { indicator_id: 'fiscal.public_spending.revealed', aye_anchor: 0.7, no_anchor: 0.3, diagnostic_strength: 0.5 },
  ],
  // Fiscal
  'fiscal-policy': [
    { indicator_id: 'fiscal.public_spending.revealed', aye_anchor: 0.65, no_anchor: 0.35, diagnostic_strength: 0.75 },
    { indicator_id: 'fiscal.fraud_recovery.revealed', aye_anchor: 0.7, no_anchor: 0.3, diagnostic_strength: 0.4 },
    { indicator_id: 'fiscal.small_business.revealed', aye_anchor: 0.5, no_anchor: 0.5, diagnostic_strength: 0.3 },
  ],
  'taxation': [
    { indicator_id: 'fiscal.taxation.revealed', aye_anchor: 0.65, no_anchor: 0.35, diagnostic_strength: 0.7 },
    { indicator_id: 'fiscal.small_business.revealed', aye_anchor: 0.6, no_anchor: 0.4, diagnostic_strength: 0.5 },
  ],
  // Immigration
  'immigration': [
    { indicator_id: 'immigration.border_control.revealed', aye_anchor: 0.25, no_anchor: 0.75, diagnostic_strength: 0.85 },
    { indicator_id: 'ideology.lib_auth.revealed', aye_anchor: 0.65, no_anchor: 0.35, diagnostic_strength: 0.4 },
  ],
  'visas': [
    { indicator_id: 'immigration.border_control.revealed', aye_anchor: 0.3, no_anchor: 0.7, diagnostic_strength: 0.5 },
  ],
  // Environment & water
  'water-quality': [
    { indicator_id: 'environment.water_regulation.revealed', aye_anchor: 0.85, no_anchor: 0.15, diagnostic_strength: 0.85 },
  ],
  'biodiversity': [
    { indicator_id: 'energy.net_zero.revealed', aye_anchor: 0.7, no_anchor: 0.3, diagnostic_strength: 0.5 },
  ],
  'air-quality': [
    { indicator_id: 'energy.net_zero.revealed', aye_anchor: 0.7, no_anchor: 0.3, diagnostic_strength: 0.5 },
  ],
  // Energy & climate
  'climate-change': [
    { indicator_id: 'energy.net_zero.revealed', aye_anchor: 0.8, no_anchor: 0.2, diagnostic_strength: 0.8 },
  ],
  'energy-policy': [
    { indicator_id: 'energy.net_zero.revealed', aye_anchor: 0.75, no_anchor: 0.25, diagnostic_strength: 0.7 },
  ],
  'oil-and-gas': [
    { indicator_id: 'energy.net_zero.revealed', aye_anchor: 0.3, no_anchor: 0.7, diagnostic_strength: 0.65 },
  ],
  'energy-markets': [
    { indicator_id: 'energy.public_ownership.revealed', aye_anchor: 0.7, no_anchor: 0.3, diagnostic_strength: 0.6 },
  ],
  'wind-energy': [
    { indicator_id: 'energy.net_zero.revealed', aye_anchor: 0.85, no_anchor: 0.15, diagnostic_strength: 0.75 },
  ],
  'solar': [
    { indicator_id: 'energy.net_zero.revealed', aye_anchor: 0.85, no_anchor: 0.15, diagnostic_strength: 0.7 },
  ],
  'nuclear': [
    { indicator_id: 'energy.net_zero.revealed', aye_anchor: 0.7, no_anchor: 0.3, diagnostic_strength: 0.55 },
  ],
  // Health
  'nhs': [
    { indicator_id: 'health.nhs_funding.public', aye_anchor: 0.75, no_anchor: 0.25, diagnostic_strength: 0.7 },
    { indicator_id: 'fiscal.public_spending.revealed', aye_anchor: 0.7, no_anchor: 0.3, diagnostic_strength: 0.4 },
  ],
  'social-care': [
    { indicator_id: 'health.nhs_funding.public', aye_anchor: 0.7, no_anchor: 0.3, diagnostic_strength: 0.6 },
  ],
  // Housing
  'housing': [
    { indicator_id: 'housing.supply.public', aye_anchor: 0.8, no_anchor: 0.2, diagnostic_strength: 0.75 },
  ],
  'building-safety': [
    { indicator_id: 'housing.supply.public', aye_anchor: 0.7, no_anchor: 0.3, diagnostic_strength: 0.5 },
  ],
  // Defence
  'defence': [
    { indicator_id: 'defence.military_spending.public', aye_anchor: 0.75, no_anchor: 0.25, diagnostic_strength: 0.7 },
  ],
  'ukraine-russia': [
    { indicator_id: 'defence.military_spending.public', aye_anchor: 0.7, no_anchor: 0.3, diagnostic_strength: 0.5 },
  ],
  // Education
  'schools': [
    { indicator_id: 'education.schools.public', aye_anchor: 0.75, no_anchor: 0.25, diagnostic_strength: 0.7 },
    { indicator_id: 'education.school_funding.revealed', aye_anchor: 0.75, no_anchor: 0.25, diagnostic_strength: 0.7 },
  ],
  'higher-education': [
    { indicator_id: 'education.schools.public', aye_anchor: 0.65, no_anchor: 0.35, diagnostic_strength: 0.5 },
    { indicator_id: 'education.university_fees.revealed', aye_anchor: 0.7, no_anchor: 0.3, diagnostic_strength: 0.7 },
  ],
  // Justice
  'criminal-justice': [
    { indicator_id: 'justice.criminal_justice.public', aye_anchor: 0.6, no_anchor: 0.4, diagnostic_strength: 0.65 },
    { indicator_id: 'ideology.lib_auth.revealed', aye_anchor: 0.6, no_anchor: 0.4, diagnostic_strength: 0.4 },
  ],
  'policing': [
    { indicator_id: 'justice.criminal_justice.public', aye_anchor: 0.55, no_anchor: 0.45, diagnostic_strength: 0.5 },
    { indicator_id: 'ideology.lib_auth.revealed', aye_anchor: 0.65, no_anchor: 0.35, diagnostic_strength: 0.4 },
  ],
  // Online safety / technology
  'online-safety': [
    { indicator_id: 'ideology.lib_auth.revealed', aye_anchor: 0.7, no_anchor: 0.3, diagnostic_strength: 0.6 },
    { indicator_id: 'digital.online_safety.revealed', aye_anchor: 0.8, no_anchor: 0.2, diagnostic_strength: 0.8 },
  ],
  'ai-regulation': [
    { indicator_id: 'ideology.lib_auth.revealed', aye_anchor: 0.65, no_anchor: 0.35, diagnostic_strength: 0.5 },
    { indicator_id: 'digital.ai_regulation.revealed', aye_anchor: 0.8, no_anchor: 0.2, diagnostic_strength: 0.75 },
  ],
  // Trade
  'trade-policy': [
    { indicator_id: 'ideology.economic_left_right.revealed', aye_anchor: 0.4, no_anchor: 0.6, diagnostic_strength: 0.4 },
    { indicator_id: 'trade.liberalisation.revealed', aye_anchor: 0.7, no_anchor: 0.3, diagnostic_strength: 0.7 },
  ],
  // Devolution & local government
  'devolution': [
    { indicator_id: 'ideology.lib_auth.revealed', aye_anchor: 0.35, no_anchor: 0.65, diagnostic_strength: 0.45 },
    { indicator_id: 'local_gov.devolution.revealed', aye_anchor: 0.8, no_anchor: 0.2, diagnostic_strength: 0.8 },
  ],
  'local-government': [
    { indicator_id: 'fiscal.public_spending.revealed', aye_anchor: 0.65, no_anchor: 0.35, diagnostic_strength: 0.4 },
    { indicator_id: 'local_gov.council_powers.revealed', aye_anchor: 0.7, no_anchor: 0.3, diagnostic_strength: 0.7 },
  ],
  // Planning
  'planning': [
    { indicator_id: 'housing.supply.public', aye_anchor: 0.75, no_anchor: 0.25, diagnostic_strength: 0.65 },
  ],
  // Transport
  'railways': [
    { indicator_id: 'fiscal.public_spending.revealed', aye_anchor: 0.7, no_anchor: 0.3, diagnostic_strength: 0.5 },
    { indicator_id: 'energy.net_zero.revealed', aye_anchor: 0.65, no_anchor: 0.35, diagnostic_strength: 0.35 },
    { indicator_id: 'transport.roads_vs_rail.revealed', aye_anchor: 0.85, no_anchor: 0.15, diagnostic_strength: 0.8 },
  ],
  'roads': [
    { indicator_id: 'fiscal.public_spending.revealed', aye_anchor: 0.6, no_anchor: 0.4, diagnostic_strength: 0.4 },
    { indicator_id: 'transport.roads_vs_rail.revealed', aye_anchor: 0.15, no_anchor: 0.85, diagnostic_strength: 0.7 },
  ],
  'electric-vehicles': [
    { indicator_id: 'energy.net_zero.revealed', aye_anchor: 0.8, no_anchor: 0.2, diagnostic_strength: 0.6 },
    { indicator_id: 'transport.roads_vs_rail.revealed', aye_anchor: 0.7, no_anchor: 0.3, diagnostic_strength: 0.4 },
  ],
  // Agriculture / environment
  'agriculture': [
    { indicator_id: 'fiscal.public_spending.revealed', aye_anchor: 0.6, no_anchor: 0.4, diagnostic_strength: 0.4 },
    { indicator_id: 'agriculture.farming_subsidies.revealed', aye_anchor: 0.75, no_anchor: 0.25, diagnostic_strength: 0.7 },
    { indicator_id: 'agriculture.food_standards.revealed', aye_anchor: 0.7, no_anchor: 0.3, diagnostic_strength: 0.5 },
  ],
  'flooding': [
    { indicator_id: 'environment.water_regulation.revealed', aye_anchor: 0.7, no_anchor: 0.3, diagnostic_strength: 0.5 },
  ],
  // Justice expanded
  'access-to-justice': [
    { indicator_id: 'justice.criminal_justice.public', aye_anchor: 0.65, no_anchor: 0.35, diagnostic_strength: 0.55 },
    { indicator_id: 'ideology.lib_auth.revealed', aye_anchor: 0.4, no_anchor: 0.6, diagnostic_strength: 0.4 },
  ],
  'domestic-abuse': [
    { indicator_id: 'justice.criminal_justice.public', aye_anchor: 0.6, no_anchor: 0.4, diagnostic_strength: 0.5 },
  ],
  // Foreign affairs
  'foreign-affairs': [
    { indicator_id: 'defence.military_spending.public', aye_anchor: 0.6, no_anchor: 0.4, diagnostic_strength: 0.35 },
    { indicator_id: 'foreign.sovereignty.revealed', aye_anchor: 0.6, no_anchor: 0.4, diagnostic_strength: 0.4 },
  ],
  'international-development': [
    { indicator_id: 'fiscal.public_spending.revealed', aye_anchor: 0.7, no_anchor: 0.3, diagnostic_strength: 0.45 },
    { indicator_id: 'ideology.economic_left_right.revealed', aye_anchor: 0.65, no_anchor: 0.35, diagnostic_strength: 0.35 },
  ],
  'middle-east': [
    { indicator_id: 'defence.military_spending.public', aye_anchor: 0.55, no_anchor: 0.45, diagnostic_strength: 0.3 },
  ],
  // Health expanded
  'mental-health': [
    { indicator_id: 'health.nhs_funding.public', aye_anchor: 0.75, no_anchor: 0.25, diagnostic_strength: 0.6 },
  ],
  'primary-care': [
    { indicator_id: 'health.nhs_funding.public', aye_anchor: 0.7, no_anchor: 0.3, diagnostic_strength: 0.55 },
  ],
  'public-health': [
    { indicator_id: 'health.nhs_funding.public', aye_anchor: 0.65, no_anchor: 0.35, diagnostic_strength: 0.5 },
    { indicator_id: 'ideology.lib_auth.revealed', aye_anchor: 0.6, no_anchor: 0.4, diagnostic_strength: 0.4 },
  ],
  // Equality & rights
  'equality': [
    { indicator_id: 'ideology.lib_auth.revealed', aye_anchor: 0.35, no_anchor: 0.65, diagnostic_strength: 0.55 },
  ],
  'disability': [
    { indicator_id: 'welfare.benefits_expansion.revealed', aye_anchor: 0.75, no_anchor: 0.25, diagnostic_strength: 0.55 },
  ],
  // Education expanded
  'apprenticeships': [
    { indicator_id: 'education.schools.public', aye_anchor: 0.7, no_anchor: 0.3, diagnostic_strength: 0.45 },
    { indicator_id: 'employment.workers_rights.revealed', aye_anchor: 0.65, no_anchor: 0.35, diagnostic_strength: 0.35 },
  ],
  'childcare': [
    { indicator_id: 'welfare.benefits_expansion.revealed', aye_anchor: 0.7, no_anchor: 0.3, diagnostic_strength: 0.5 },
  ],
  // Counter-terrorism
  'counter-terrorism': [
    { indicator_id: 'ideology.lib_auth.revealed', aye_anchor: 0.7, no_anchor: 0.3, diagnostic_strength: 0.55 },
    { indicator_id: 'defence.military_spending.public', aye_anchor: 0.6, no_anchor: 0.4, diagnostic_strength: 0.35 },
  ],
  // Veterans
  'veterans': [
    { indicator_id: 'defence.military_spending.public', aye_anchor: 0.7, no_anchor: 0.3, diagnostic_strength: 0.5 },
  ],
  // Homelessness
  'homelessness': [
    { indicator_id: 'housing.supply.public', aye_anchor: 0.8, no_anchor: 0.2, diagnostic_strength: 0.6 },
    { indicator_id: 'welfare.benefits_expansion.revealed', aye_anchor: 0.7, no_anchor: 0.3, diagnostic_strength: 0.45 },
  ],
  // Child welfare
  'child-welfare': [
    { indicator_id: 'welfare.benefits_expansion.revealed', aye_anchor: 0.7, no_anchor: 0.3, diagnostic_strength: 0.5 },
  ],
  // Modern slavery
  'modern-slavery': [
    { indicator_id: 'ideology.lib_auth.revealed', aye_anchor: 0.5, no_anchor: 0.5, diagnostic_strength: 0.3 },
    { indicator_id: 'immigration.border_control.revealed', aye_anchor: 0.5, no_anchor: 0.5, diagnostic_strength: 0.3 },
  ],
  // Financial regulation
  'financial-regulation': [
    { indicator_id: 'ideology.economic_left_right.revealed', aye_anchor: 0.65, no_anchor: 0.35, diagnostic_strength: 0.45 },
  ],
  // Community safety
  'community-safety': [
    { indicator_id: 'justice.criminal_justice.public', aye_anchor: 0.55, no_anchor: 0.45, diagnostic_strength: 0.4 },
    { indicator_id: 'ideology.lib_auth.revealed', aye_anchor: 0.6, no_anchor: 0.4, diagnostic_strength: 0.35 },
  ],
  // Scotland/Wales/NI (map to devolution-adjacent)
  'scotland': [
    { indicator_id: 'ideology.lib_auth.revealed', aye_anchor: 0.4, no_anchor: 0.6, diagnostic_strength: 0.3 },
    { indicator_id: 'local_gov.devolution.revealed', aye_anchor: 0.7, no_anchor: 0.3, diagnostic_strength: 0.5 },
  ],
  'wales': [
    { indicator_id: 'ideology.lib_auth.revealed', aye_anchor: 0.4, no_anchor: 0.6, diagnostic_strength: 0.3 },
    { indicator_id: 'local_gov.devolution.revealed', aye_anchor: 0.7, no_anchor: 0.3, diagnostic_strength: 0.5 },
  ],
  'northern-ireland': [
    { indicator_id: 'ideology.lib_auth.revealed', aye_anchor: 0.4, no_anchor: 0.6, diagnostic_strength: 0.3 },
    { indicator_id: 'local_gov.devolution.revealed', aye_anchor: 0.7, no_anchor: 0.3, diagnostic_strength: 0.5 },
  ],
  // Conscience votes / ethics
  'end-of-life': [
    { indicator_id: 'ethics.assisted_dying.revealed', aye_anchor: 0.85, no_anchor: 0.15, diagnostic_strength: 0.95 },
  ],
  // Additional bill-specific tags from entity-enrichment
  'constitutional-reform': [
    { indicator_id: 'ideology.lib_auth.revealed', aye_anchor: 0.4, no_anchor: 0.6, diagnostic_strength: 0.45 },
  ],
  'consumer-protection': [
    { indicator_id: 'ideology.economic_left_right.revealed', aye_anchor: 0.65, no_anchor: 0.35, diagnostic_strength: 0.35 },
  ],
  'public-transport': [
    { indicator_id: 'fiscal.public_spending.revealed', aye_anchor: 0.7, no_anchor: 0.3, diagnostic_strength: 0.5 },
    { indicator_id: 'energy.net_zero.revealed', aye_anchor: 0.65, no_anchor: 0.35, diagnostic_strength: 0.3 },
    { indicator_id: 'transport.roads_vs_rail.revealed', aye_anchor: 0.8, no_anchor: 0.2, diagnostic_strength: 0.7 },
  ],
  'pharmaceuticals': [
    { indicator_id: 'health.nhs_funding.public', aye_anchor: 0.6, no_anchor: 0.4, diagnostic_strength: 0.4 },
  ],
  'digital-infrastructure': [
    { indicator_id: 'fiscal.public_spending.revealed', aye_anchor: 0.6, no_anchor: 0.4, diagnostic_strength: 0.3 },
    { indicator_id: 'digital.data_privacy.revealed', aye_anchor: 0.5, no_anchor: 0.5, diagnostic_strength: 0.3 },
  ],
  'broadcasting': [
    { indicator_id: 'ideology.lib_auth.revealed', aye_anchor: 0.5, no_anchor: 0.5, diagnostic_strength: 0.2 },
    { indicator_id: 'culture.bbc_funding.revealed', aye_anchor: 0.7, no_anchor: 0.3, diagnostic_strength: 0.7 },
  ],
  'heritage-culture': [
    { indicator_id: 'fiscal.public_spending.revealed', aye_anchor: 0.6, no_anchor: 0.4, diagnostic_strength: 0.2 },
    { indicator_id: 'culture.arts_funding.revealed', aye_anchor: 0.75, no_anchor: 0.25, diagnostic_strength: 0.65 },
  ],
  'cyber-security': [
    { indicator_id: 'ideology.lib_auth.revealed', aye_anchor: 0.65, no_anchor: 0.35, diagnostic_strength: 0.4 },
    { indicator_id: 'defence.military_spending.public', aye_anchor: 0.6, no_anchor: 0.4, diagnostic_strength: 0.3 },
  ],
  'gender-equality': [
    { indicator_id: 'ideology.lib_auth.revealed', aye_anchor: 0.35, no_anchor: 0.65, diagnostic_strength: 0.5 },
  ],
  'waste-recycling': [
    { indicator_id: 'energy.net_zero.revealed', aye_anchor: 0.65, no_anchor: 0.35, diagnostic_strength: 0.35 },
  ],
  'leasehold-reform': [
    { indicator_id: 'housing.supply.public', aye_anchor: 0.7, no_anchor: 0.3, diagnostic_strength: 0.5 },
  ],
  'indo-pacific': [
    { indicator_id: 'defence.military_spending.public', aye_anchor: 0.6, no_anchor: 0.4, diagnostic_strength: 0.35 },
  ],

  // ── Previously unmapped tags ────────────────────────────────────────────
  // Health sub-topics → NHS funding
  'cancer': [
    { indicator_id: 'health.nhs_funding.public', aye_anchor: 0.75, no_anchor: 0.25, diagnostic_strength: 0.55 },
  ],
  'dementia': [
    { indicator_id: 'health.nhs_funding.public', aye_anchor: 0.7, no_anchor: 0.3, diagnostic_strength: 0.5 },
  ],
  'antimicrobial-resistance': [
    { indicator_id: 'health.nhs_funding.public', aye_anchor: 0.65, no_anchor: 0.35, diagnostic_strength: 0.4 },
  ],
  'vaccines': [
    { indicator_id: 'health.nhs_funding.public', aye_anchor: 0.65, no_anchor: 0.35, diagnostic_strength: 0.45 },
  ],
  // Energy sub-topics → net zero / public spending
  'carbon-capture': [
    { indicator_id: 'energy.net_zero.revealed', aye_anchor: 0.8, no_anchor: 0.2, diagnostic_strength: 0.7 },
    { indicator_id: 'fiscal.public_spending.revealed', aye_anchor: 0.65, no_anchor: 0.35, diagnostic_strength: 0.4 },
  ],
  'hydrogen': [
    { indicator_id: 'energy.net_zero.revealed', aye_anchor: 0.8, no_anchor: 0.2, diagnostic_strength: 0.65 },
  ],
  'energy-storage': [
    { indicator_id: 'energy.net_zero.revealed', aye_anchor: 0.75, no_anchor: 0.25, diagnostic_strength: 0.55 },
  ],
  'grid-infrastructure': [
    { indicator_id: 'energy.net_zero.revealed', aye_anchor: 0.7, no_anchor: 0.3, diagnostic_strength: 0.55 },
    { indicator_id: 'fiscal.public_spending.revealed', aye_anchor: 0.65, no_anchor: 0.35, diagnostic_strength: 0.4 },
  ],
  'heat-buildings': [
    { indicator_id: 'energy.net_zero.revealed', aye_anchor: 0.8, no_anchor: 0.2, diagnostic_strength: 0.65 },
    { indicator_id: 'housing.supply.public', aye_anchor: 0.6, no_anchor: 0.4, diagnostic_strength: 0.3 },
  ],
  // Transport
  'aviation': [
    { indicator_id: 'fiscal.public_spending.revealed', aye_anchor: 0.55, no_anchor: 0.45, diagnostic_strength: 0.3 },
    { indicator_id: 'energy.net_zero.revealed', aye_anchor: 0.5, no_anchor: 0.5, diagnostic_strength: 0.25 },
  ],
  'maritime': [
    { indicator_id: 'fiscal.public_spending.revealed', aye_anchor: 0.6, no_anchor: 0.4, diagnostic_strength: 0.3 },
    { indicator_id: 'defence.military_spending.public', aye_anchor: 0.55, no_anchor: 0.45, diagnostic_strength: 0.25 },
  ],
  // Economy
  'freeports': [
    { indicator_id: 'ideology.economic_left_right.revealed', aye_anchor: 0.35, no_anchor: 0.65, diagnostic_strength: 0.45 },
    { indicator_id: 'fiscal.public_spending.revealed', aye_anchor: 0.6, no_anchor: 0.4, diagnostic_strength: 0.35 },
    { indicator_id: 'trade.liberalisation.revealed', aye_anchor: 0.75, no_anchor: 0.25, diagnostic_strength: 0.6 },
  ],
  'crypto-digital-assets': [
    { indicator_id: 'ideology.economic_left_right.revealed', aye_anchor: 0.4, no_anchor: 0.6, diagnostic_strength: 0.3 },
    { indicator_id: 'ideology.lib_auth.revealed', aye_anchor: 0.55, no_anchor: 0.45, diagnostic_strength: 0.3 },
  ],
  // Gambling → lib/auth (regulation of personal behaviour)
  'gambling': [
    { indicator_id: 'ideology.lib_auth.revealed', aye_anchor: 0.6, no_anchor: 0.4, diagnostic_strength: 0.45 },
  ],
  // Defence / science → public spending
  'space': [
    { indicator_id: 'fiscal.public_spending.revealed', aye_anchor: 0.65, no_anchor: 0.35, diagnostic_strength: 0.3 },
    { indicator_id: 'defence.military_spending.public', aye_anchor: 0.55, no_anchor: 0.45, diagnostic_strength: 0.25 },
  ],
  // Sport → public spending (low diagnostic value)
  'sport': [
    { indicator_id: 'fiscal.public_spending.revealed', aye_anchor: 0.6, no_anchor: 0.4, diagnostic_strength: 0.2 },
  ],
  // Procedural — very low diagnostic value but still captures some signal
  'parliamentary-procedure': [
    { indicator_id: 'ideology.lib_auth.revealed', aye_anchor: 0.55, no_anchor: 0.45, diagnostic_strength: 0.1 },
  ],
  // Regulatory oversight — signals preference for state oversight
  'regulatory-oversight': [
    { indicator_id: 'ideology.lib_auth.revealed', aye_anchor: 0.6, no_anchor: 0.4, diagnostic_strength: 0.3 },
  ],
  // Appointments — too low signal, but include for completeness
  'appointments': [
    { indicator_id: 'ideology.lib_auth.revealed', aye_anchor: 0.55, no_anchor: 0.45, diagnostic_strength: 0.15 },
  ],
};

async function main() {
  const { createClient } = await import('@supabase/supabase-js');
  const { extractTopicTags } = await import('../lib/feeds/entity-enrichment');

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const dryRun = process.argv.includes('--dry-run');

  // 1. Get all unique divisions from evidence
  console.log('Scanning division votes for unique divisions...');
  const divisionMap = new Map<number, string>();
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data } = await sb.from('politician_evidence')
      .select('parsed')
      .eq('evidence_type', 'division_vote')
      .range(offset, offset + pageSize - 1);

    if (!data?.length) break;
    for (const r of data) {
      const id = r.parsed?.division_id;
      const title = r.parsed?.division_title;
      if (id && title && !divisionMap.has(id)) {
        divisionMap.set(id, title);
      }
    }
    offset += data.length;
    if (data.length < pageSize) break;
  }

  console.log(`Found ${divisionMap.size} unique divisions`);

  // 2. Match each division title against topic tags, then map to indicators
  const mappings: Array<{
    bill_id: string;
    indicator_id: string;
    aye_anchor: number;
    no_anchor: number;
    diagnostic_strength: number;
    created_by: string;
    reviewed: boolean;
    notes: string;
  }> = [];

  let matched = 0;
  let unmatched = 0;

  for (const [divId, title] of divisionMap) {
    const tags = extractTopicTags(title, '');
    if (tags.length === 0) {
      unmatched++;
      continue;
    }

    matched++;
    const seen = new Set<string>(); // Dedup indicator_id per division

    for (const tag of tags) {
      const indicators = TAG_TO_INDICATORS[tag];
      if (!indicators) continue;

      for (const ind of indicators) {
        const key = `${divId}-${ind.indicator_id}`;
        if (seen.has(key)) continue;
        seen.add(key);

        mappings.push({
          bill_id: String(divId),
          indicator_id: ind.indicator_id,
          aye_anchor: ind.aye_anchor,
          no_anchor: ind.no_anchor,
          diagnostic_strength: ind.diagnostic_strength,
          created_by: 'auto-llm',
          reviewed: false,
          notes: `Auto-mapped from title: "${title.slice(0, 100)}" via tag: ${tag}`,
        });
      }
    }
  }

  console.log(`\nDivisions matched: ${matched} / ${divisionMap.size}`);
  console.log(`Mappings generated: ${mappings.length}`);

  if (dryRun) {
    console.log('\n[DRY RUN] Would insert:');
    const byIndicator: Record<string, number> = {};
    for (const m of mappings) {
      byIndicator[m.indicator_id] = (byIndicator[m.indicator_id] || 0) + 1;
    }
    for (const [id, count] of Object.entries(byIndicator).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${id}: ${count} divisions`);
    }
    return;
  }

  // 3. Insert mappings (batch, upsert to avoid dupes)
  const batchSize = 200;
  let inserted = 0;
  for (let i = 0; i < mappings.length; i += batchSize) {
    const batch = mappings.slice(i, i + batchSize);
    const { error } = await sb.from('bill_policy_mappings').upsert(batch, {
      onConflict: 'bill_id,amendment_id,indicator_id',
    });
    if (error) {
      console.error(`Batch ${i}-${i + batch.length} error:`, error.message);
    } else {
      inserted += batch.length;
    }
  }

  console.log(`\nInserted ${inserted} bill-policy mappings`);

  // 4. Summary
  const { count } = await sb.from('bill_policy_mappings').select('*', { count: 'exact', head: true });
  console.log(`Total bill-policy mappings in DB: ${count}`);
}

main().catch(console.error);
