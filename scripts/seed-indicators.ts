/**
 * Seed indicator definitions and bill-policy mappings for real data.
 *
 * Usage:
 *   npx tsx scripts/seed-indicators.ts
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

async function main() {
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // ── 1. Indicator definitions ───────────────────────────────────────────

  const indicators = [
    // Employment & workers' rights
    { id: 'employment.workers_rights.revealed', radar: 'policy', policy_area: 'industrial-strategy', label_low: 'Opposes workers\' rights expansion', label_high: 'Supports workers\' rights expansion', description: 'Stance on employment protections, union rights, zero-hours contracts', half_life_years: 3.0 },
    { id: 'employment.workers_rights.public', radar: 'policy', policy_area: 'industrial-strategy', label_low: 'Opposes workers\' rights expansion', label_high: 'Supports workers\' rights expansion', description: 'Public statements on employment protections and workers\' rights', half_life_years: 3.0 },

    // Welfare & benefits
    { id: 'welfare.benefits_expansion.revealed', radar: 'policy', policy_area: 'welfare', label_low: 'Opposes benefit expansion', label_high: 'Supports benefit expansion', description: 'Stance on expanding welfare benefits (UC, PIP, housing)', half_life_years: 3.0 },
    { id: 'welfare.benefits_expansion.public', radar: 'policy', policy_area: 'welfare', label_low: 'Opposes benefit expansion', label_high: 'Supports benefit expansion', description: 'Public statements on welfare expansion', half_life_years: 3.0 },

    // Fiscal policy
    { id: 'fiscal.public_spending.revealed', radar: 'policy', policy_area: 'fiscal-policy', label_low: 'Favours spending restraint', label_high: 'Favours increased public spending', description: 'Stance on government spending levels', half_life_years: 3.0 },
    { id: 'fiscal.taxation.revealed', radar: 'policy', policy_area: 'taxation', label_low: 'Favours lower taxes', label_high: 'Favours higher taxes for public services', description: 'Stance on tax policy', half_life_years: 3.0 },

    // Immigration & borders
    { id: 'immigration.border_control.revealed', radar: 'policy', policy_area: 'immigration', label_low: 'Favours stricter controls', label_high: 'Favours more open immigration', description: 'Stance on border policy, asylum, immigration levels', half_life_years: 3.0 },
    { id: 'immigration.border_control.public', radar: 'policy', policy_area: 'immigration', label_low: 'Favours stricter controls', label_high: 'Favours more open immigration', description: 'Public statements on immigration and border policy', half_life_years: 3.0 },

    // Environment & water
    { id: 'environment.water_regulation.revealed', radar: 'policy', policy_area: 'water-quality', label_low: 'Opposes stronger water regulation', label_high: 'Supports stronger water regulation', description: 'Stance on water company regulation and sewage discharge', half_life_years: 3.0 },

    // Energy & climate
    { id: 'energy.net_zero.revealed', radar: 'policy', policy_area: 'climate-change', label_low: 'Sceptical of net zero agenda', label_high: 'Supports accelerated net zero', description: 'Stance on climate targets and energy transition', half_life_years: 3.0 },
    { id: 'energy.net_zero.public', radar: 'policy', policy_area: 'energy-policy', label_low: 'Sceptical of net zero agenda', label_high: 'Supports accelerated net zero', description: 'Public statements on energy policy and climate', half_life_years: 3.0 },

    // Crown Estate / energy infrastructure
    { id: 'energy.public_ownership.revealed', radar: 'policy', policy_area: 'energy-markets', label_low: 'Favours private energy sector', label_high: 'Favours public/state energy ownership', description: 'Stance on public ownership of energy infrastructure', half_life_years: 3.0 },

    // Health
    { id: 'health.nhs_funding.public', radar: 'policy', policy_area: 'nhs', label_low: 'Favours NHS reform/efficiency', label_high: 'Favours increased NHS funding', description: 'Public statements on NHS funding and reform', half_life_years: 3.0 },

    // Housing
    { id: 'housing.supply.public', radar: 'policy', policy_area: 'housing', label_low: 'Cautious on housebuilding targets', label_high: 'Supports ambitious housebuilding', description: 'Public statements on housing supply and targets', half_life_years: 3.0 },

    // Defence
    { id: 'defence.military_spending.public', radar: 'policy', policy_area: 'defence', label_low: 'Cautious on military spending', label_high: 'Supports increased defence spending', description: 'Public statements on defence and military spending', half_life_years: 3.0 },

    // Education
    { id: 'education.schools.public', radar: 'policy', policy_area: 'schools', label_low: 'Favours school choice/competition', label_high: 'Favours state school investment', description: 'Public statements on school policy', half_life_years: 3.0 },

    // Justice
    { id: 'justice.criminal_justice.public', radar: 'policy', policy_area: 'criminal-justice', label_low: 'Punitive approach', label_high: 'Rehabilitative approach', description: 'Public statements on criminal justice policy', half_life_years: 3.0 },

    // Fraud & public spending integrity
    { id: 'fiscal.fraud_recovery.revealed', radar: 'policy', policy_area: 'fiscal-policy', label_low: 'Opposes expanded fraud powers', label_high: 'Supports expanded fraud recovery powers', description: 'Stance on government powers to recover fraud and error in public spending', half_life_years: 3.0 },

    // Overseas territories / sovereignty
    { id: 'foreign.sovereignty.revealed', radar: 'policy', policy_area: 'defence', label_low: 'Pragmatic on territorial concessions', label_high: 'Hawkish on retaining sovereignty', description: 'Stance on British overseas territory sovereignty', half_life_years: 3.0 },

    // Family business / small business
    { id: 'fiscal.small_business.revealed', radar: 'policy', policy_area: 'taxation', label_low: 'Favours uniform tax treatment', label_high: 'Supports small/family business tax relief', description: 'Stance on family and small business tax policy', half_life_years: 3.0 },

    // Ethics / conscience vote indicators
    { id: 'ethics.assisted_dying.revealed', radar: 'policy', policy_area: 'end-of-life', label_low: 'Opposes assisted dying legislation', label_high: 'Supports assisted dying legislation', description: 'Stance on terminally ill adults end-of-life choice', half_life_years: 7.0 },

    // Transport
    { id: 'transport.roads_vs_rail.revealed', radar: 'policy', policy_area: 'transport', label_low: 'Prioritises road investment', label_high: 'Prioritises public transport/rail investment', description: 'Stance on roads vs public transport and rail spending', half_life_years: 3.0 },
    { id: 'transport.roads_vs_rail.public', radar: 'policy', policy_area: 'transport', label_low: 'Prioritises road investment', label_high: 'Prioritises public transport/rail investment', description: 'Public statements on transport investment priorities', half_life_years: 3.0 },
    { id: 'transport.hs2.revealed', radar: 'policy', policy_area: 'transport', label_low: 'Opposes HS2 project', label_high: 'Supports HS2 project', description: 'Stance on HS2 high-speed rail', half_life_years: 3.0 },
    { id: 'transport.hs2.public', radar: 'policy', policy_area: 'transport', label_low: 'Opposes HS2 project', label_high: 'Supports HS2 project', description: 'Public statements on HS2 high-speed rail', half_life_years: 3.0 },

    // Digital & technology
    { id: 'digital.online_safety.revealed', radar: 'policy', policy_area: 'online-safety', label_low: 'Favours platform self-regulation', label_high: 'Favours strong state regulation of online content', description: 'Stance on online safety and content regulation', half_life_years: 3.0 },
    { id: 'digital.online_safety.public', radar: 'policy', policy_area: 'online-safety', label_low: 'Favours platform self-regulation', label_high: 'Favours strong state regulation of online content', description: 'Public statements on online safety regulation', half_life_years: 3.0 },
    { id: 'digital.ai_regulation.revealed', radar: 'policy', policy_area: 'ai-regulation', label_low: 'Favours light-touch AI regulation', label_high: 'Favours strict AI regulation and oversight', description: 'Stance on artificial intelligence governance', half_life_years: 3.0 },
    { id: 'digital.ai_regulation.public', radar: 'policy', policy_area: 'ai-regulation', label_low: 'Favours light-touch AI regulation', label_high: 'Favours strict AI regulation and oversight', description: 'Public statements on AI regulation', half_life_years: 3.0 },
    { id: 'digital.data_privacy.revealed', radar: 'policy', policy_area: 'data-privacy', label_low: 'Prioritises innovation and data sharing', label_high: 'Prioritises individual data privacy protections', description: 'Stance on data protection and privacy rights', half_life_years: 3.0 },
    { id: 'digital.data_privacy.public', radar: 'policy', policy_area: 'data-privacy', label_low: 'Prioritises innovation and data sharing', label_high: 'Prioritises individual data privacy protections', description: 'Public statements on data privacy', half_life_years: 3.0 },

    // Education (expanded)
    { id: 'education.university_fees.revealed', radar: 'policy', policy_area: 'higher-education', label_low: 'Supports tuition fees / market approach', label_high: 'Supports reducing or abolishing tuition fees', description: 'Stance on university tuition fee policy', half_life_years: 3.0 },
    { id: 'education.university_fees.public', radar: 'policy', policy_area: 'higher-education', label_low: 'Supports tuition fees / market approach', label_high: 'Supports reducing or abolishing tuition fees', description: 'Public statements on university fees', half_life_years: 3.0 },
    { id: 'education.school_funding.revealed', radar: 'policy', policy_area: 'schools', label_low: 'Favours school funding restraint', label_high: 'Favours increased school funding', description: 'Stance on school funding levels and per-pupil spending', half_life_years: 3.0 },
    { id: 'education.school_funding.public', radar: 'policy', policy_area: 'schools', label_low: 'Favours school funding restraint', label_high: 'Favours increased school funding', description: 'Public statements on school funding', half_life_years: 3.0 },

    // Agriculture
    { id: 'agriculture.farming_subsidies.revealed', radar: 'policy', policy_area: 'agriculture', label_low: 'Favours reducing farm subsidies', label_high: 'Favours maintaining/increasing farm support', description: 'Stance on agricultural subsidies and farmer support payments', half_life_years: 3.0 },
    { id: 'agriculture.farming_subsidies.public', radar: 'policy', policy_area: 'agriculture', label_low: 'Favours reducing farm subsidies', label_high: 'Favours maintaining/increasing farm support', description: 'Public statements on farm subsidies', half_life_years: 3.0 },
    { id: 'agriculture.food_standards.revealed', radar: 'policy', policy_area: 'food-standards', label_low: 'Favours relaxing standards for trade deals', label_high: 'Favours maintaining high food and farming standards', description: 'Stance on food standards and imports regulation', half_life_years: 3.0 },
    { id: 'agriculture.food_standards.public', radar: 'policy', policy_area: 'food-standards', label_low: 'Favours relaxing standards for trade deals', label_high: 'Favours maintaining high food and farming standards', description: 'Public statements on food standards', half_life_years: 3.0 },

    // Trade
    { id: 'trade.liberalisation.revealed', radar: 'policy', policy_area: 'trade', label_low: 'Protectionist / strategic autonomy', label_high: 'Favours free trade and open markets', description: 'Stance on trade liberalisation vs protectionism', half_life_years: 3.0 },
    { id: 'trade.liberalisation.public', radar: 'policy', policy_area: 'trade', label_low: 'Protectionist / strategic autonomy', label_high: 'Favours free trade and open markets', description: 'Public statements on trade policy', half_life_years: 3.0 },

    // Culture & media
    { id: 'culture.bbc_funding.revealed', radar: 'policy', policy_area: 'broadcasting', label_low: 'Favours BBC reform/defunding', label_high: 'Supports maintaining BBC funding and licence fee', description: 'Stance on BBC funding model and licence fee', half_life_years: 3.0 },
    { id: 'culture.bbc_funding.public', radar: 'policy', policy_area: 'broadcasting', label_low: 'Favours BBC reform/defunding', label_high: 'Supports maintaining BBC funding and licence fee', description: 'Public statements on BBC funding', half_life_years: 3.0 },
    { id: 'culture.arts_funding.revealed', radar: 'policy', policy_area: 'culture', label_low: 'Favours reducing arts and culture subsidy', label_high: 'Supports increased arts and culture funding', description: 'Stance on public funding for arts and cultural institutions', half_life_years: 3.0 },
    { id: 'culture.arts_funding.public', radar: 'policy', policy_area: 'culture', label_low: 'Favours reducing arts and culture subsidy', label_high: 'Supports increased arts and culture funding', description: 'Public statements on arts funding', half_life_years: 3.0 },

    // Local government & devolution
    { id: 'local_gov.council_powers.revealed', radar: 'policy', policy_area: 'local-government', label_low: 'Favours central government control', label_high: 'Favours greater council autonomy and powers', description: 'Stance on local authority autonomy and funding', half_life_years: 3.0 },
    { id: 'local_gov.council_powers.public', radar: 'policy', policy_area: 'local-government', label_low: 'Favours central government control', label_high: 'Favours greater council autonomy and powers', description: 'Public statements on council powers', half_life_years: 3.0 },
    { id: 'local_gov.devolution.revealed', radar: 'policy', policy_area: 'devolution', label_low: 'Favours centralised governance', label_high: 'Supports further devolution of powers', description: 'Stance on devolution to regions and nations', half_life_years: 3.0 },
    { id: 'local_gov.devolution.public', radar: 'policy', policy_area: 'devolution', label_low: 'Favours centralised governance', label_high: 'Supports further devolution of powers', description: 'Public statements on devolution', half_life_years: 3.0 },

    // Ideology indicators
    { id: 'ideology.economic_left_right.revealed', radar: 'ideology', policy_area: null, label_low: 'Economic right (free market)', label_high: 'Economic left (state intervention)', description: 'Economic ideology spectrum', half_life_years: 5.0 },
    { id: 'ideology.lib_auth.revealed', radar: 'ideology', policy_area: null, label_low: 'Libertarian (individual freedom)', label_high: 'Authoritarian (state authority)', description: 'Social libertarian-authoritarian spectrum', half_life_years: 5.0 },
  ];

  const { error: indErr } = await sb.from('indicator_definitions').upsert(indicators, { onConflict: 'id' });
  if (indErr) {
    console.error('indicator_definitions error:', indErr.message);
    return;
  }
  console.log(`Seeded ${indicators.length} indicator definitions`);

  // ── 2. Bill-policy mappings for all 24 real divisions ──────────────────
  //
  // Division IDs are used as bill_id (since bill_ref is null in evidence).
  // Aye anchors represent: voting aye → position on indicator scale.
  // For government bills, aye = supporting the government position.

  const mappings = [
    // Employment Rights Bill (divisions 1940-1947) — Report Stage amendments
    // Government position: support the bill. Aye = pro-workers' rights.
    // Amendments were opposition attempts to weaken the bill.
    { bill_id: '1940', indicator_id: 'employment.workers_rights.revealed', aye_anchor: 0.85, no_anchor: 0.15, diagnostic_strength: 0.9, created_by: 'manual', reviewed: true, notes: 'Employment Rights Bill: New Clause 10 (fire and rehire protections)' },
    { bill_id: '1941', indicator_id: 'employment.workers_rights.revealed', aye_anchor: 0.85, no_anchor: 0.15, diagnostic_strength: 0.85, created_by: 'manual', reviewed: true, notes: 'Employment Rights Bill: New Clause 30 (flexible working)' },
    { bill_id: '1942', indicator_id: 'employment.workers_rights.revealed', aye_anchor: 0.85, no_anchor: 0.15, diagnostic_strength: 0.85, created_by: 'manual', reviewed: true, notes: 'Employment Rights Bill: New Clause 87 (zero-hours contracts)' },
    { bill_id: '1943', indicator_id: 'employment.workers_rights.revealed', aye_anchor: 0.85, no_anchor: 0.15, diagnostic_strength: 0.85, created_by: 'manual', reviewed: true, notes: 'Employment Rights Bill: Amendment 288' },
    { bill_id: '1944', indicator_id: 'employment.workers_rights.revealed', aye_anchor: 0.85, no_anchor: 0.15, diagnostic_strength: 0.85, created_by: 'manual', reviewed: true, notes: 'Employment Rights Bill: New Clause 39 (trade union facilities)' },
    { bill_id: '1945', indicator_id: 'employment.workers_rights.revealed', aye_anchor: 0.85, no_anchor: 0.15, diagnostic_strength: 0.85, created_by: 'manual', reviewed: true, notes: 'Employment Rights Bill: New Clause 110 (statutory sick pay)' },
    { bill_id: '1946', indicator_id: 'employment.workers_rights.revealed', aye_anchor: 0.85, no_anchor: 0.15, diagnostic_strength: 0.85, created_by: 'manual', reviewed: true, notes: 'Employment Rights Bill: Amendment 291' },
    { bill_id: '1947', indicator_id: 'employment.workers_rights.revealed', aye_anchor: 0.85, no_anchor: 0.15, diagnostic_strength: 0.9, created_by: 'manual', reviewed: true, notes: 'Employment Rights Bill: Amendment 297' },
    // Employment Rights Bill also signals economic left-right ideology
    { bill_id: '1940', indicator_id: 'ideology.economic_left_right.revealed', aye_anchor: 0.75, no_anchor: 0.25, diagnostic_strength: 0.6, created_by: 'manual', reviewed: true, notes: 'Employment Rights — aye signals economic left' },
    { bill_id: '1947', indicator_id: 'ideology.economic_left_right.revealed', aye_anchor: 0.75, no_anchor: 0.25, diagnostic_strength: 0.6, created_by: 'manual', reviewed: true, notes: 'Employment Rights — aye signals economic left' },

    // Finance Bill (divisions 1935-1938)
    // Government Finance Bill — aye = supporting government fiscal policy.
    { bill_id: '1935', indicator_id: 'fiscal.taxation.revealed', aye_anchor: 0.65, no_anchor: 0.35, diagnostic_strength: 0.7, created_by: 'manual', reviewed: true, notes: 'Finance Bill: New Clause 2' },
    { bill_id: '1936', indicator_id: 'fiscal.taxation.revealed', aye_anchor: 0.65, no_anchor: 0.35, diagnostic_strength: 0.7, created_by: 'manual', reviewed: true, notes: 'Finance Bill: New Clause 8' },
    { bill_id: '1937', indicator_id: 'fiscal.taxation.revealed', aye_anchor: 0.65, no_anchor: 0.35, diagnostic_strength: 0.7, created_by: 'manual', reviewed: true, notes: 'Finance Bill: Amendment 67' },
    { bill_id: '1938', indicator_id: 'fiscal.public_spending.revealed', aye_anchor: 0.7, no_anchor: 0.3, diagnostic_strength: 0.8, created_by: 'manual', reviewed: true, notes: 'Finance Bill: Third Reading' },
    { bill_id: '1938', indicator_id: 'fiscal.taxation.revealed', aye_anchor: 0.7, no_anchor: 0.3, diagnostic_strength: 0.8, created_by: 'manual', reviewed: true, notes: 'Finance Bill: Third Reading' },

    // Border Security, Asylum and Immigration Bill (division 1924)
    // Government position: strengthen border controls. Aye = support.
    { bill_id: '1924', indicator_id: 'immigration.border_control.revealed', aye_anchor: 0.2, no_anchor: 0.8, diagnostic_strength: 0.9, created_by: 'manual', reviewed: true, notes: 'Border Security Bill: Second Reading — aye = stricter controls' },
    { bill_id: '1924', indicator_id: 'ideology.lib_auth.revealed', aye_anchor: 0.7, no_anchor: 0.3, diagnostic_strength: 0.5, created_by: 'manual', reviewed: true, notes: 'Border Security Bill — aye signals authoritarian' },

    // Water (Special Measures) Bill (divisions 1921, 1925)
    { bill_id: '1921', indicator_id: 'environment.water_regulation.revealed', aye_anchor: 0.85, no_anchor: 0.15, diagnostic_strength: 0.9, created_by: 'manual', reviewed: true, notes: 'Water Bill: Amendment 9 — stronger regulation' },
    { bill_id: '1925', indicator_id: 'environment.water_regulation.revealed', aye_anchor: 0.85, no_anchor: 0.15, diagnostic_strength: 0.85, created_by: 'manual', reviewed: true, notes: 'Water Bill: Government insistence on Commons amendment' },

    // Crown Estate Bill (divisions 1927-1930)
    // Reforms to Crown Estate governance, links to energy infrastructure.
    { bill_id: '1927', indicator_id: 'energy.public_ownership.revealed', aye_anchor: 0.7, no_anchor: 0.3, diagnostic_strength: 0.7, created_by: 'manual', reviewed: true, notes: 'Crown Estate Bill: New Clause 1' },
    { bill_id: '1928', indicator_id: 'energy.public_ownership.revealed', aye_anchor: 0.7, no_anchor: 0.3, diagnostic_strength: 0.7, created_by: 'manual', reviewed: true, notes: 'Crown Estate Bill: New Clause 6' },
    { bill_id: '1929', indicator_id: 'energy.public_ownership.revealed', aye_anchor: 0.7, no_anchor: 0.3, diagnostic_strength: 0.7, created_by: 'manual', reviewed: true, notes: 'Crown Estate Bill: Amendment 4' },
    { bill_id: '1930', indicator_id: 'energy.public_ownership.revealed', aye_anchor: 0.7, no_anchor: 0.3, diagnostic_strength: 0.7, created_by: 'manual', reviewed: true, notes: 'Crown Estate Bill: Amendment 2' },

    // Public Authorities (Fraud, Error and Recovery) Bill (division 1922)
    { bill_id: '1922', indicator_id: 'fiscal.fraud_recovery.revealed', aye_anchor: 0.85, no_anchor: 0.15, diagnostic_strength: 0.85, created_by: 'manual', reviewed: true, notes: 'Public Authorities Fraud Bill: Second Reading' },

    // Opposition Day: British Indian Ocean Territory (division 1934)
    { bill_id: '1934', indicator_id: 'foreign.sovereignty.revealed', aye_anchor: 0.8, no_anchor: 0.2, diagnostic_strength: 0.8, created_by: 'manual', reviewed: true, notes: 'Opposition Day: BIOT — aye = retain sovereignty' },

    // Opposition Day: Family businesses (division 1933)
    { bill_id: '1933', indicator_id: 'fiscal.small_business.revealed', aye_anchor: 0.8, no_anchor: 0.2, diagnostic_strength: 0.75, created_by: 'manual', reviewed: true, notes: 'Opposition Day: Family businesses — aye = tax relief' },
    { bill_id: '1933', indicator_id: 'fiscal.taxation.revealed', aye_anchor: 0.3, no_anchor: 0.7, diagnostic_strength: 0.5, created_by: 'manual', reviewed: true, notes: 'Opposition Day: Family businesses — aye = lower taxes' },

    // Welfare / UC+PIP Bill (divisions 2091+) — already seeded with 'uc-pip-bill-2025',
    // but we also need the division_id versions if they exist in evidence
    // Motion to sit in private (1939) and Motion to adjourn (1917) — procedural, low diagnostic value
    { bill_id: '1939', indicator_id: 'ideology.lib_auth.revealed', aye_anchor: 0.6, no_anchor: 0.4, diagnostic_strength: 0.2, created_by: 'manual', reviewed: true, notes: 'Motion to sit in private — weak procedural signal' },
  ];

  const { error: mapErr } = await sb.from('bill_policy_mappings').upsert(mappings, { onConflict: 'bill_id,amendment_id,indicator_id' });
  if (mapErr) {
    console.error('bill_policy_mappings error:', mapErr.message);
    return;
  }
  console.log(`Seeded ${mappings.length} bill-policy mappings across ${new Set(mappings.map(m => m.bill_id)).size} divisions`);

  // ── 3. Organisation → indicator mappings ───────────────────────────────
  // Maps Register of Interests organisations to policy indicators.
  // org_name must be pre-normalised to lowercase.

  const orgMappings = [
    // Energy sector — net zero / public ownership
    { org_name: 'bp', org_aliases: ['bp plc', 'bp p.l.c.'], indicator_id: 'energy.net_zero.revealed', anchor: 0.35, weight_multiplier: 1.2, rationale: 'Major oil & gas company — financial interest signals fossil fuel alignment' },
    { org_name: 'shell', org_aliases: ['shell plc', 'shell uk'], indicator_id: 'energy.net_zero.revealed', anchor: 0.35, weight_multiplier: 1.2, rationale: 'Major oil & gas company' },
    { org_name: 'edf energy', org_aliases: ['edf', 'electricite de france'], indicator_id: 'energy.net_zero.revealed', anchor: 0.65, weight_multiplier: 1.0, rationale: 'Nuclear and renewable energy provider' },
    { org_name: 'octopus energy', org_aliases: ['octopus energy group'], indicator_id: 'energy.net_zero.revealed', anchor: 0.75, weight_multiplier: 1.0, rationale: 'Green energy supplier and investor' },
    { org_name: 'drax', org_aliases: ['drax group', 'drax power'], indicator_id: 'energy.net_zero.revealed', anchor: 0.55, weight_multiplier: 0.9, rationale: 'Biomass and power generation — mixed climate signal' },
    { org_name: 'national grid', org_aliases: ['national grid plc'], indicator_id: 'energy.net_zero.revealed', anchor: 0.6, weight_multiplier: 1.0, rationale: 'Grid infrastructure — broadly supportive of transition' },
    { org_name: 'centrica', org_aliases: ['centrica plc', 'british gas'], indicator_id: 'energy.net_zero.revealed', anchor: 0.45, weight_multiplier: 1.0, rationale: 'Gas and energy supplier' },

    // Water sector
    { org_name: 'thames water', org_aliases: ['thames water utilities'], indicator_id: 'environment.water_regulation.revealed', anchor: 0.3, weight_multiplier: 1.2, rationale: 'Major water company — financial interest signals opposition to tighter regulation' },
    { org_name: 'united utilities', org_aliases: ['united utilities group'], indicator_id: 'environment.water_regulation.revealed', anchor: 0.3, weight_multiplier: 1.0, rationale: 'Water company' },
    { org_name: 'severn trent', org_aliases: ['severn trent water', 'severn trent plc'], indicator_id: 'environment.water_regulation.revealed', anchor: 0.3, weight_multiplier: 1.0, rationale: 'Water company' },
    { org_name: 'anglian water', org_aliases: ['anglian water services'], indicator_id: 'environment.water_regulation.revealed', anchor: 0.3, weight_multiplier: 1.0, rationale: 'Water company' },

    // Property / housing
    { org_name: 'persimmon', org_aliases: ['persimmon plc', 'persimmon homes'], indicator_id: 'housing.supply.public', anchor: 0.55, weight_multiplier: 1.0, rationale: 'Major housebuilder — supports supply but may resist regulation' },
    { org_name: 'barratt developments', org_aliases: ['barratt homes', 'barratt redrow'], indicator_id: 'housing.supply.public', anchor: 0.55, weight_multiplier: 1.0, rationale: 'Major housebuilder' },
    { org_name: 'taylor wimpey', org_aliases: ['taylor wimpey plc'], indicator_id: 'housing.supply.public', anchor: 0.55, weight_multiplier: 1.0, rationale: 'Major housebuilder' },
    { org_name: 'shelter', org_aliases: ['shelter charity'], indicator_id: 'housing.supply.public', anchor: 0.85, weight_multiplier: 1.0, rationale: 'Housing and homelessness charity — strong advocate for social housing' },

    // Finance / banking — economic ideology
    { org_name: 'city of london corporation', org_aliases: ['city of london'], indicator_id: 'ideology.economic_left_right.revealed', anchor: 0.25, weight_multiplier: 1.0, rationale: 'Financial sector — free market orientation' },
    { org_name: 'cbi', org_aliases: ['confederation of british industry'], indicator_id: 'ideology.economic_left_right.revealed', anchor: 0.3, weight_multiplier: 1.0, rationale: 'Business lobby — generally pro-market' },
    { org_name: 'iod', org_aliases: ['institute of directors'], indicator_id: 'ideology.economic_left_right.revealed', anchor: 0.25, weight_multiplier: 0.9, rationale: 'Business leadership body — pro-market' },
    { org_name: 'fsb', org_aliases: ['federation of small businesses'], indicator_id: 'fiscal.small_business.revealed', anchor: 0.8, weight_multiplier: 1.0, rationale: 'Small business lobby — signals support for SME tax relief' },

    // Trade unions — workers' rights
    { org_name: 'tuc', org_aliases: ['trades union congress'], indicator_id: 'employment.workers_rights.revealed', anchor: 0.85, weight_multiplier: 1.2, rationale: 'Trade union umbrella body — strong pro-workers\' rights signal' },
    { org_name: 'unite', org_aliases: ['unite the union', 'unite union'], indicator_id: 'employment.workers_rights.revealed', anchor: 0.9, weight_multiplier: 1.2, rationale: 'Major trade union' },
    { org_name: 'unison', org_aliases: ['unison union'], indicator_id: 'employment.workers_rights.revealed', anchor: 0.85, weight_multiplier: 1.1, rationale: 'Public sector trade union' },
    { org_name: 'gmb', org_aliases: ['gmb union'], indicator_id: 'employment.workers_rights.revealed', anchor: 0.85, weight_multiplier: 1.1, rationale: 'General trade union' },
    { org_name: 'usdaw', org_aliases: ['union of shop, distributive and allied workers'], indicator_id: 'employment.workers_rights.revealed', anchor: 0.8, weight_multiplier: 1.0, rationale: 'Retail/distribution trade union' },
    { org_name: 'communication workers union', org_aliases: ['cwu'], indicator_id: 'employment.workers_rights.revealed', anchor: 0.85, weight_multiplier: 1.0, rationale: 'Postal/telecoms trade union' },
    { org_name: 'aslef', org_aliases: ['associated society of locomotive engineers and firemen'], indicator_id: 'employment.workers_rights.revealed', anchor: 0.85, weight_multiplier: 1.0, rationale: 'Train drivers\' union' },

    // Health sector
    { org_name: 'bma', org_aliases: ['british medical association'], indicator_id: 'health.nhs_funding.public', anchor: 0.75, weight_multiplier: 1.0, rationale: 'Doctors\' professional body — advocates for NHS funding' },
    { org_name: 'rcn', org_aliases: ['royal college of nursing'], indicator_id: 'health.nhs_funding.public', anchor: 0.8, weight_multiplier: 1.0, rationale: 'Nursing professional body' },
    { org_name: 'nhs confederation', org_aliases: ['nhsc'], indicator_id: 'health.nhs_funding.public', anchor: 0.7, weight_multiplier: 0.9, rationale: 'NHS leadership body' },
    { org_name: 'abpi', org_aliases: ['association of the british pharmaceutical industry'], indicator_id: 'health.nhs_funding.public', anchor: 0.5, weight_multiplier: 0.8, rationale: 'Pharma industry body — mixed NHS signal' },

    // Defence sector
    { org_name: 'bae systems', org_aliases: ['bae systems plc'], indicator_id: 'defence.military_spending.public', anchor: 0.85, weight_multiplier: 1.2, rationale: 'Major defence contractor — financial interest signals pro-defence spending' },
    { org_name: 'rolls-royce', org_aliases: ['rolls-royce holdings', 'rolls-royce plc'], indicator_id: 'defence.military_spending.public', anchor: 0.7, weight_multiplier: 1.0, rationale: 'Defence and aerospace engine manufacturer' },
    { org_name: 'qinetiq', org_aliases: ['qinetiq group'], indicator_id: 'defence.military_spending.public', anchor: 0.75, weight_multiplier: 0.9, rationale: 'Defence technology company' },
    { org_name: 'rusi', org_aliases: ['royal united services institute'], indicator_id: 'defence.military_spending.public', anchor: 0.7, weight_multiplier: 0.8, rationale: 'Defence and security think tank' },

    // Immigration / borders
    { org_name: 'migration watch', org_aliases: ['migrationwatch uk', 'migration watch uk'], indicator_id: 'immigration.border_control.revealed', anchor: 0.15, weight_multiplier: 1.0, rationale: 'Pro-controls immigration lobby' },
    { org_name: 'refugee council', org_aliases: ['the refugee council'], indicator_id: 'immigration.border_control.revealed', anchor: 0.85, weight_multiplier: 1.0, rationale: 'Refugee support charity — favours more open immigration' },

    // Environmental NGOs
    { org_name: 'greenpeace', org_aliases: ['greenpeace uk'], indicator_id: 'energy.net_zero.revealed', anchor: 0.9, weight_multiplier: 1.0, rationale: 'Environmental campaign group — strong net zero advocate' },
    { org_name: 'friends of the earth', org_aliases: ['foe', 'friends of the earth england'], indicator_id: 'energy.net_zero.revealed', anchor: 0.9, weight_multiplier: 1.0, rationale: 'Environmental campaign group' },
    { org_name: 'wwf', org_aliases: ['wwf uk', 'world wildlife fund', 'world wide fund for nature'], indicator_id: 'energy.net_zero.revealed', anchor: 0.8, weight_multiplier: 0.9, rationale: 'Conservation charity' },
    { org_name: 'rspb', org_aliases: ['royal society for the protection of birds'], indicator_id: 'energy.net_zero.revealed', anchor: 0.75, weight_multiplier: 0.8, rationale: 'Bird conservation charity — pro-environment' },
    { org_name: 'surfers against sewage', org_aliases: ['sas'], indicator_id: 'environment.water_regulation.revealed', anchor: 0.9, weight_multiplier: 1.0, rationale: 'Water pollution campaign group' },

    // Education
    { org_name: 'national education union', org_aliases: ['neu'], indicator_id: 'education.schools.public', anchor: 0.8, weight_multiplier: 1.0, rationale: 'Teachers\' union — advocates state school investment' },
    { org_name: 'universities uk', org_aliases: ['uuk'], indicator_id: 'education.schools.public', anchor: 0.7, weight_multiplier: 0.8, rationale: 'University sector body' },

    // Welfare / poverty
    { org_name: 'joseph rowntree foundation', org_aliases: ['jrf'], indicator_id: 'welfare.benefits_expansion.revealed', anchor: 0.8, weight_multiplier: 1.0, rationale: 'Anti-poverty research foundation' },
    { org_name: 'citizens advice', org_aliases: ['citizens advice bureau', 'cab'], indicator_id: 'welfare.benefits_expansion.revealed', anchor: 0.75, weight_multiplier: 0.9, rationale: 'Welfare advice charity' },
    { org_name: 'child poverty action group', org_aliases: ['cpag'], indicator_id: 'welfare.benefits_expansion.revealed', anchor: 0.85, weight_multiplier: 1.0, rationale: 'Child poverty charity — strong benefits expansion advocate' },

    // Justice
    { org_name: 'howard league', org_aliases: ['howard league for penal reform'], indicator_id: 'justice.criminal_justice.public', anchor: 0.85, weight_multiplier: 1.0, rationale: 'Penal reform charity — rehabilitative approach' },
    { org_name: 'prison reform trust', org_aliases: ['prt'], indicator_id: 'justice.criminal_justice.public', anchor: 0.85, weight_multiplier: 1.0, rationale: 'Prison reform charity' },
    { org_name: 'law society', org_aliases: ['the law society', 'law society of england and wales'], indicator_id: 'justice.criminal_justice.public', anchor: 0.6, weight_multiplier: 0.8, rationale: 'Legal professional body — moderate justice signal' },

    // Transport
    { org_name: 'network rail', org_aliases: ['network rail infrastructure'], indicator_id: 'transport.roads_vs_rail.revealed', anchor: 0.8, weight_multiplier: 1.0, rationale: 'Rail infrastructure owner — signals rail investment priority' },
    { org_name: 'transport for london', org_aliases: ['tfl'], indicator_id: 'transport.roads_vs_rail.revealed', anchor: 0.75, weight_multiplier: 0.9, rationale: 'London public transport body' },
    { org_name: 'rac', org_aliases: ['rac foundation', 'rac motoring services'], indicator_id: 'transport.roads_vs_rail.revealed', anchor: 0.2, weight_multiplier: 0.8, rationale: 'Motoring organisation — road investment focus' },
    { org_name: 'aa', org_aliases: ['automobile association', 'the aa'], indicator_id: 'transport.roads_vs_rail.revealed', anchor: 0.2, weight_multiplier: 0.8, rationale: 'Motoring organisation — road investment focus' },

    // Agriculture
    { org_name: 'nfu', org_aliases: ['national farmers union', 'national farmers\' union'], indicator_id: 'agriculture.farming_subsidies.revealed', anchor: 0.85, weight_multiplier: 1.2, rationale: 'Farmers\' union — strong advocate for farm subsidies' },
    { org_name: 'country land and business association', org_aliases: ['cla', 'country land association'], indicator_id: 'agriculture.farming_subsidies.revealed', anchor: 0.8, weight_multiplier: 1.0, rationale: 'Rural landowners\' body' },
    { org_name: 'soil association', org_aliases: ['soil association certification'], indicator_id: 'agriculture.food_standards.revealed', anchor: 0.9, weight_multiplier: 1.0, rationale: 'Organic farming body — high food standards advocate' },
    { org_name: 'sustain', org_aliases: ['sustain: the alliance for better food and farming'], indicator_id: 'agriculture.food_standards.revealed', anchor: 0.85, weight_multiplier: 1.0, rationale: 'Food and farming campaign alliance' },

    // Digital / technology
    { org_name: 'open rights group', org_aliases: ['org', 'openrightsgroup'], indicator_id: 'digital.data_privacy.revealed', anchor: 0.9, weight_multiplier: 1.0, rationale: 'Digital rights campaign group — strong privacy advocate' },
    { org_name: 'big brother watch', org_aliases: ['big brother watch uk'], indicator_id: 'digital.data_privacy.revealed', anchor: 0.9, weight_multiplier: 1.0, rationale: 'Civil liberties group — opposes mass surveillance' },
    { org_name: 'techuk', org_aliases: ['tech uk', 'technology trade association'], indicator_id: 'digital.ai_regulation.revealed', anchor: 0.3, weight_multiplier: 0.9, rationale: 'Tech industry body — favours light-touch regulation' },
    { org_name: 'nspcc', org_aliases: ['national society for the prevention of cruelty to children'], indicator_id: 'digital.online_safety.revealed', anchor: 0.85, weight_multiplier: 1.0, rationale: 'Child protection charity — strong online safety advocate' },

    // Trade
    { org_name: 'british chambers of commerce', org_aliases: ['bcc'], indicator_id: 'trade.liberalisation.revealed', anchor: 0.75, weight_multiplier: 1.0, rationale: 'Business trade body — generally pro-free trade' },

    // Culture & media
    { org_name: 'arts council', org_aliases: ['arts council england', 'ace'], indicator_id: 'culture.arts_funding.revealed', anchor: 0.8, weight_multiplier: 1.0, rationale: 'National arts funding body' },
    { org_name: 'creative industries federation', org_aliases: ['cif'], indicator_id: 'culture.arts_funding.revealed', anchor: 0.8, weight_multiplier: 0.9, rationale: 'Creative sector trade body' },

    // Local government
    { org_name: 'local government association', org_aliases: ['lga'], indicator_id: 'local_gov.council_powers.revealed', anchor: 0.8, weight_multiplier: 1.0, rationale: 'Council umbrella body — advocates greater local autonomy' },
  ];

  const { error: orgErr } = await sb.from('org_indicator_map').upsert(orgMappings, { onConflict: 'org_name,indicator_id' });
  if (orgErr) {
    console.error('org_indicator_map error:', orgErr.message);
  } else {
    console.log(`Seeded ${orgMappings.length} org-indicator mappings`);
  }

  // ── 4. APPG → indicator mappings ────────────────────────────────────────
  // Maps All-Party Parliamentary Groups to policy indicators.
  // appg_id uses the parliament.uk slug format.

  const appgMappings = [
    // Energy & climate
    { appg_id: 'renewable-and-sustainable-energy', indicator_id: 'energy.net_zero.revealed', anchor: 0.85, weight_multiplier: 0.8 },
    { appg_id: 'climate-change', indicator_id: 'energy.net_zero.revealed', anchor: 0.85, weight_multiplier: 0.8 },
    { appg_id: 'energy-costs', indicator_id: 'energy.net_zero.revealed', anchor: 0.6, weight_multiplier: 0.6 },
    { appg_id: 'solar-energy', indicator_id: 'energy.net_zero.revealed', anchor: 0.85, weight_multiplier: 0.7 },
    { appg_id: 'hydrogen', indicator_id: 'energy.net_zero.revealed', anchor: 0.8, weight_multiplier: 0.7 },
    { appg_id: 'nuclear-energy', indicator_id: 'energy.net_zero.revealed', anchor: 0.7, weight_multiplier: 0.7 },
    { appg_id: 'offshore-wind', indicator_id: 'energy.net_zero.revealed', anchor: 0.85, weight_multiplier: 0.7 },
    { appg_id: 'electric-vehicles', indicator_id: 'energy.net_zero.revealed', anchor: 0.8, weight_multiplier: 0.6 },
    { appg_id: 'net-zero', indicator_id: 'energy.net_zero.revealed', anchor: 0.85, weight_multiplier: 0.8 },

    // Environment & water
    { appg_id: 'water', indicator_id: 'environment.water_regulation.revealed', anchor: 0.75, weight_multiplier: 0.7 },
    { appg_id: 'river-health', indicator_id: 'environment.water_regulation.revealed', anchor: 0.85, weight_multiplier: 0.8 },
    { appg_id: 'biodiversity', indicator_id: 'energy.net_zero.revealed', anchor: 0.7, weight_multiplier: 0.5 },
    { appg_id: 'environmental-justice', indicator_id: 'energy.net_zero.revealed', anchor: 0.8, weight_multiplier: 0.6 },

    // Health
    { appg_id: 'health', indicator_id: 'health.nhs_funding.public', anchor: 0.7, weight_multiplier: 0.7 },
    { appg_id: 'mental-health', indicator_id: 'health.nhs_funding.public', anchor: 0.75, weight_multiplier: 0.7 },
    { appg_id: 'cancer', indicator_id: 'health.nhs_funding.public', anchor: 0.75, weight_multiplier: 0.6 },
    { appg_id: 'nhs-funding', indicator_id: 'health.nhs_funding.public', anchor: 0.85, weight_multiplier: 0.8 },
    { appg_id: 'social-care', indicator_id: 'health.nhs_funding.public', anchor: 0.7, weight_multiplier: 0.6 },

    // Housing
    { appg_id: 'housing', indicator_id: 'housing.supply.public', anchor: 0.75, weight_multiplier: 0.7 },
    { appg_id: 'homelessness', indicator_id: 'housing.supply.public', anchor: 0.85, weight_multiplier: 0.7 },
    { appg_id: 'social-housing', indicator_id: 'housing.supply.public', anchor: 0.85, weight_multiplier: 0.8 },
    { appg_id: 'leasehold-reform', indicator_id: 'housing.supply.public', anchor: 0.75, weight_multiplier: 0.6 },

    // Defence
    { appg_id: 'armed-forces', indicator_id: 'defence.military_spending.public', anchor: 0.8, weight_multiplier: 0.8 },
    { appg_id: 'veterans', indicator_id: 'defence.military_spending.public', anchor: 0.75, weight_multiplier: 0.6 },
    { appg_id: 'nato', indicator_id: 'defence.military_spending.public', anchor: 0.8, weight_multiplier: 0.7 },

    // Immigration
    { appg_id: 'migration', indicator_id: 'immigration.border_control.revealed', anchor: 0.6, weight_multiplier: 0.6 },
    { appg_id: 'refugees', indicator_id: 'immigration.border_control.revealed', anchor: 0.8, weight_multiplier: 0.7 },

    // Education
    { appg_id: 'education', indicator_id: 'education.schools.public', anchor: 0.7, weight_multiplier: 0.7 },
    { appg_id: 'apprenticeships', indicator_id: 'education.schools.public', anchor: 0.7, weight_multiplier: 0.6 },
    { appg_id: 'universities', indicator_id: 'education.schools.public', anchor: 0.65, weight_multiplier: 0.5 },

    // Workers' rights
    { appg_id: 'trade-unions', indicator_id: 'employment.workers_rights.revealed', anchor: 0.85, weight_multiplier: 0.8 },
    { appg_id: 'workers-rights', indicator_id: 'employment.workers_rights.revealed', anchor: 0.85, weight_multiplier: 0.8 },
    { appg_id: 'fire-and-rehire', indicator_id: 'employment.workers_rights.revealed', anchor: 0.85, weight_multiplier: 0.7 },

    // Welfare
    { appg_id: 'poverty', indicator_id: 'welfare.benefits_expansion.revealed', anchor: 0.8, weight_multiplier: 0.7 },
    { appg_id: 'universal-credit', indicator_id: 'welfare.benefits_expansion.revealed', anchor: 0.75, weight_multiplier: 0.7 },
    { appg_id: 'child-poverty', indicator_id: 'welfare.benefits_expansion.revealed', anchor: 0.85, weight_multiplier: 0.7 },
    { appg_id: 'food-banks', indicator_id: 'welfare.benefits_expansion.revealed', anchor: 0.85, weight_multiplier: 0.7 },

    // Justice
    { appg_id: 'criminal-justice', indicator_id: 'justice.criminal_justice.public', anchor: 0.6, weight_multiplier: 0.7 },
    { appg_id: 'penal-reform', indicator_id: 'justice.criminal_justice.public', anchor: 0.8, weight_multiplier: 0.7 },
    { appg_id: 'legal-aid', indicator_id: 'justice.criminal_justice.public', anchor: 0.75, weight_multiplier: 0.6 },
    { appg_id: 'victims-of-crime', indicator_id: 'justice.criminal_justice.public', anchor: 0.55, weight_multiplier: 0.6 },

    // Ethics
    { appg_id: 'choice-at-the-end-of-life', indicator_id: 'ethics.assisted_dying.revealed', anchor: 0.85, weight_multiplier: 0.9 },
    { appg_id: 'dying-well', indicator_id: 'ethics.assisted_dying.revealed', anchor: 0.85, weight_multiplier: 0.8 },

    // Fiscal
    { appg_id: 'taxation', indicator_id: 'fiscal.taxation.revealed', anchor: 0.5, weight_multiplier: 0.5 },
    { appg_id: 'small-business', indicator_id: 'fiscal.small_business.revealed', anchor: 0.8, weight_multiplier: 0.7 },
    { appg_id: 'entrepreneurship', indicator_id: 'fiscal.small_business.revealed', anchor: 0.7, weight_multiplier: 0.6 },

    // Transport
    { appg_id: 'rail', indicator_id: 'transport.roads_vs_rail.revealed', anchor: 0.85, weight_multiplier: 0.8 },
    { appg_id: 'high-speed-rail', indicator_id: 'transport.hs2.revealed', anchor: 0.85, weight_multiplier: 0.8 },
    { appg_id: 'cycling-and-walking', indicator_id: 'transport.roads_vs_rail.revealed', anchor: 0.75, weight_multiplier: 0.6 },
    { appg_id: 'bus-services', indicator_id: 'transport.roads_vs_rail.revealed', anchor: 0.8, weight_multiplier: 0.7 },
    { appg_id: 'roads', indicator_id: 'transport.roads_vs_rail.revealed', anchor: 0.2, weight_multiplier: 0.7 },
    { appg_id: 'infrastructure', indicator_id: 'transport.roads_vs_rail.revealed', anchor: 0.55, weight_multiplier: 0.5 },

    // Digital & technology
    { appg_id: 'artificial-intelligence', indicator_id: 'digital.ai_regulation.revealed', anchor: 0.6, weight_multiplier: 0.7 },
    { appg_id: 'data-analytics', indicator_id: 'digital.data_privacy.revealed', anchor: 0.4, weight_multiplier: 0.6 },
    { appg_id: 'internet-communications-and-technology', indicator_id: 'digital.online_safety.revealed', anchor: 0.6, weight_multiplier: 0.6 },
    { appg_id: 'online-safety', indicator_id: 'digital.online_safety.revealed', anchor: 0.8, weight_multiplier: 0.8 },

    // Agriculture
    { appg_id: 'agriculture-and-food-for-development', indicator_id: 'agriculture.farming_subsidies.revealed', anchor: 0.75, weight_multiplier: 0.7 },
    { appg_id: 'rural-business', indicator_id: 'agriculture.farming_subsidies.revealed', anchor: 0.7, weight_multiplier: 0.6 },
    { appg_id: 'food-and-drink-manufacturing', indicator_id: 'agriculture.food_standards.revealed', anchor: 0.6, weight_multiplier: 0.6 },
    { appg_id: 'animal-welfare', indicator_id: 'agriculture.food_standards.revealed', anchor: 0.8, weight_multiplier: 0.7 },

    // Trade
    { appg_id: 'trade-and-investment', indicator_id: 'trade.liberalisation.revealed', anchor: 0.75, weight_multiplier: 0.7 },
    { appg_id: 'fair-trade', indicator_id: 'trade.liberalisation.revealed', anchor: 0.55, weight_multiplier: 0.6 },

    // Culture & media
    { appg_id: 'bbc', indicator_id: 'culture.bbc_funding.revealed', anchor: 0.75, weight_multiplier: 0.8 },
    { appg_id: 'arts-health-and-wellbeing', indicator_id: 'culture.arts_funding.revealed', anchor: 0.8, weight_multiplier: 0.7 },
    { appg_id: 'creative-diversity', indicator_id: 'culture.arts_funding.revealed', anchor: 0.75, weight_multiplier: 0.6 },
    { appg_id: 'music', indicator_id: 'culture.arts_funding.revealed', anchor: 0.7, weight_multiplier: 0.6 },
    { appg_id: 'theatre', indicator_id: 'culture.arts_funding.revealed', anchor: 0.75, weight_multiplier: 0.6 },

    // Local government & devolution
    { appg_id: 'local-government', indicator_id: 'local_gov.council_powers.revealed', anchor: 0.75, weight_multiplier: 0.8 },
    { appg_id: 'devolution', indicator_id: 'local_gov.devolution.revealed', anchor: 0.8, weight_multiplier: 0.8 },
    { appg_id: 'combined-authorities', indicator_id: 'local_gov.devolution.revealed', anchor: 0.8, weight_multiplier: 0.7 },
  ];

  const { error: appgErr } = await sb.from('appg_indicator_map').upsert(appgMappings, { onConflict: 'appg_id' });
  if (appgErr) {
    console.error('appg_indicator_map error:', appgErr.message);
  } else {
    console.log(`Seeded ${appgMappings.length} APPG-indicator mappings`);
  }

  // ── 5. Committee → indicator mappings ─────────────────────────────────
  // Maps Commons select committees to policy indicators.
  // chair_anchor is higher to reflect stronger signal from chairing the committee.

  const committeeMappings = [
    // Energy & climate
    { committee_id: 'energy-security-and-net-zero', indicator_id: 'energy.net_zero.revealed', membership_anchor: 0.6, chair_anchor: 0.7, weight_multiplier: 0.8 },
    { committee_id: 'environmental-audit', indicator_id: 'energy.net_zero.revealed', membership_anchor: 0.65, chair_anchor: 0.75, weight_multiplier: 0.8 },

    // Environment & water
    { committee_id: 'environment-food-and-rural-affairs', indicator_id: 'environment.water_regulation.revealed', membership_anchor: 0.6, chair_anchor: 0.7, weight_multiplier: 0.8 },
    { committee_id: 'environment-food-and-rural-affairs', indicator_id: 'energy.net_zero.revealed', membership_anchor: 0.55, chair_anchor: 0.65, weight_multiplier: 0.5 },

    // Health
    { committee_id: 'health-and-social-care', indicator_id: 'health.nhs_funding.public', membership_anchor: 0.65, chair_anchor: 0.75, weight_multiplier: 0.8 },

    // Housing / planning
    { committee_id: 'housing-communities-and-local-government', indicator_id: 'housing.supply.public', membership_anchor: 0.6, chair_anchor: 0.7, weight_multiplier: 0.8 },
    { committee_id: 'levelling-up-housing-and-communities', indicator_id: 'housing.supply.public', membership_anchor: 0.6, chair_anchor: 0.7, weight_multiplier: 0.8 },

    // Defence
    { committee_id: 'defence', indicator_id: 'defence.military_spending.public', membership_anchor: 0.7, chair_anchor: 0.8, weight_multiplier: 0.8 },

    // Immigration
    { committee_id: 'home-affairs', indicator_id: 'immigration.border_control.revealed', membership_anchor: 0.5, chair_anchor: 0.55, weight_multiplier: 0.6 },
    { committee_id: 'home-affairs', indicator_id: 'ideology.lib_auth.revealed', membership_anchor: 0.55, chair_anchor: 0.6, weight_multiplier: 0.5 },

    // Education
    { committee_id: 'education', indicator_id: 'education.schools.public', membership_anchor: 0.6, chair_anchor: 0.7, weight_multiplier: 0.8 },

    // Justice
    { committee_id: 'justice', indicator_id: 'justice.criminal_justice.public', membership_anchor: 0.55, chair_anchor: 0.65, weight_multiplier: 0.8 },

    // Workers' rights / employment
    { committee_id: 'business-and-trade', indicator_id: 'employment.workers_rights.revealed', membership_anchor: 0.55, chair_anchor: 0.6, weight_multiplier: 0.6 },
    { committee_id: 'business-and-trade', indicator_id: 'ideology.economic_left_right.revealed', membership_anchor: 0.5, chair_anchor: 0.55, weight_multiplier: 0.5 },

    // Welfare
    { committee_id: 'work-and-pensions', indicator_id: 'welfare.benefits_expansion.revealed', membership_anchor: 0.6, chair_anchor: 0.7, weight_multiplier: 0.8 },

    // Fiscal
    { committee_id: 'treasury', indicator_id: 'fiscal.public_spending.revealed', membership_anchor: 0.55, chair_anchor: 0.6, weight_multiplier: 0.7 },
    { committee_id: 'treasury', indicator_id: 'fiscal.taxation.revealed', membership_anchor: 0.55, chair_anchor: 0.6, weight_multiplier: 0.7 },
    { committee_id: 'public-accounts', indicator_id: 'fiscal.public_spending.revealed', membership_anchor: 0.6, chair_anchor: 0.7, weight_multiplier: 0.7 },
    { committee_id: 'public-accounts', indicator_id: 'fiscal.fraud_recovery.revealed', membership_anchor: 0.65, chair_anchor: 0.75, weight_multiplier: 0.8 },

    // Foreign affairs / sovereignty
    { committee_id: 'foreign-affairs', indicator_id: 'foreign.sovereignty.revealed', membership_anchor: 0.55, chair_anchor: 0.6, weight_multiplier: 0.6 },
    { committee_id: 'foreign-affairs', indicator_id: 'defence.military_spending.public', membership_anchor: 0.55, chair_anchor: 0.6, weight_multiplier: 0.5 },

    // Science & technology
    { committee_id: 'science-innovation-and-technology', indicator_id: 'fiscal.public_spending.revealed', membership_anchor: 0.6, chair_anchor: 0.65, weight_multiplier: 0.5 },

    // Transport
    { committee_id: 'transport', indicator_id: 'fiscal.public_spending.revealed', membership_anchor: 0.55, chair_anchor: 0.6, weight_multiplier: 0.5 },
    { committee_id: 'transport', indicator_id: 'energy.net_zero.revealed', membership_anchor: 0.55, chair_anchor: 0.6, weight_multiplier: 0.4 },
    { committee_id: 'transport', indicator_id: 'transport.roads_vs_rail.revealed', membership_anchor: 0.6, chair_anchor: 0.65, weight_multiplier: 0.7 },

    // Digital & technology
    { committee_id: 'science-innovation-and-technology', indicator_id: 'digital.ai_regulation.revealed', membership_anchor: 0.6, chair_anchor: 0.65, weight_multiplier: 0.7 },
    { committee_id: 'science-innovation-and-technology', indicator_id: 'digital.data_privacy.revealed', membership_anchor: 0.55, chair_anchor: 0.6, weight_multiplier: 0.5 },

    // Culture, media & sport
    { committee_id: 'culture-media-and-sport', indicator_id: 'culture.bbc_funding.revealed', membership_anchor: 0.6, chair_anchor: 0.65, weight_multiplier: 0.7 },
    { committee_id: 'culture-media-and-sport', indicator_id: 'culture.arts_funding.revealed', membership_anchor: 0.6, chair_anchor: 0.65, weight_multiplier: 0.7 },
    { committee_id: 'culture-media-and-sport', indicator_id: 'digital.online_safety.revealed', membership_anchor: 0.6, chair_anchor: 0.65, weight_multiplier: 0.6 },

    // Agriculture
    { committee_id: 'environment-food-and-rural-affairs', indicator_id: 'agriculture.farming_subsidies.revealed', membership_anchor: 0.65, chair_anchor: 0.7, weight_multiplier: 0.8 },
    { committee_id: 'environment-food-and-rural-affairs', indicator_id: 'agriculture.food_standards.revealed', membership_anchor: 0.6, chair_anchor: 0.7, weight_multiplier: 0.7 },

    // Trade
    { committee_id: 'business-and-trade', indicator_id: 'trade.liberalisation.revealed', membership_anchor: 0.6, chair_anchor: 0.65, weight_multiplier: 0.6 },

    // Local government & devolution
    { committee_id: 'levelling-up-housing-and-communities', indicator_id: 'local_gov.council_powers.revealed', membership_anchor: 0.6, chair_anchor: 0.7, weight_multiplier: 0.7 },
    { committee_id: 'levelling-up-housing-and-communities', indicator_id: 'local_gov.devolution.revealed', membership_anchor: 0.6, chair_anchor: 0.7, weight_multiplier: 0.7 },

    // Education (expanded)
    { committee_id: 'education', indicator_id: 'education.school_funding.revealed', membership_anchor: 0.6, chair_anchor: 0.7, weight_multiplier: 0.7 },
    { committee_id: 'education', indicator_id: 'education.university_fees.revealed', membership_anchor: 0.55, chair_anchor: 0.6, weight_multiplier: 0.5 },
  ];

  const { error: cmErr } = await sb.from('committee_indicator_map').upsert(committeeMappings, { onConflict: 'committee_id,indicator_id' });
  if (cmErr) {
    console.error('committee_indicator_map error:', cmErr.message);
  } else {
    console.log(`Seeded ${committeeMappings.length} committee-indicator mappings`);
  }

  // ── 6. Verify ──────────────────────────────────────────────────────────

  const { count: indCount } = await sb.from('indicator_definitions').select('*', { count: 'exact', head: true });
  const { count: mapCount } = await sb.from('bill_policy_mappings').select('*', { count: 'exact', head: true });
  const { count: orgCount } = await sb.from('org_indicator_map').select('*', { count: 'exact', head: true });
  const { count: appgCount } = await sb.from('appg_indicator_map').select('*', { count: 'exact', head: true });
  const { count: cmCount } = await sb.from('committee_indicator_map').select('*', { count: 'exact', head: true });
  console.log(`\nTotal indicator definitions: ${indCount}`);
  console.log(`Total bill-policy mappings: ${mapCount}`);
  console.log(`Total org-indicator mappings: ${orgCount}`);
  console.log(`Total APPG-indicator mappings: ${appgCount}`);
  console.log(`Total committee-indicator mappings: ${cmCount}`);
}

main().catch(console.error);
