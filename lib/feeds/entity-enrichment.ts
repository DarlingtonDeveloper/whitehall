/**
 * Shared Entity Enrichment & RAG Classification
 *
 * Centralises the keyword-to-entity mapping and RAG status logic used by
 * all collectors.  Each collector can import these helpers rather than
 * maintaining their own duplicate maps.
 */

import * as crypto from 'crypto';

// ── Keyword → entity ID mapping ────────────────────────────────────────────
// Every collector that ingests textual items should run the title + body
// through `enrichEntityIds` to tag with the correct Whitehall entity IDs.

export const KEYWORD_ENTITY_MAP: [RegExp, string][] = [
  // Ministerial departments
  [/\bDESNZ\b|energy security|net zero|clean power|offshore wind|onshore wind/i, 'desnz'],
  [/\bDHSC\b|health and social care|NHS workforce/i, 'dhsc'],
  [/\bDfE\b|department for education|schools|curriculum/i, 'dfe'],
  [/\bDfT\b|department for transport|railways|roads|aviation/i, 'dft'],
  [/\bDLUHC\b|housing|planning reform|local government|levelling up/i, 'dluhc'],
  [/\bDefra\b|environment|biodiversity|water quality|farming/i, 'defra'],
  [/\bHM Treasury\b|treasury|fiscal|budget statement/i, 'treasury'],
  [/\bHome Office\b|immigration|policing|borders/i, 'home-office'],
  [/\bMoD\b|ministry of defence|armed forces|military/i, 'mod'],
  [/\bMoJ\b|ministry of justice|prisons|courts|sentencing/i, 'moj'],
  [/\bFCDO\b|foreign.{0,10}commonwealth|overseas development/i, 'fcdo'],
  [/\bCabinet Office\b|civil service reform/i, 'co'],
  [/\bDBT\b|business and trade|trade policy|export/i, 'dbt'],
  [/\bDCMS\b|culture.{0,10}media|sport|creative industries/i, 'dcms'],
  [/\bDSIT\b|science.{0,10}innovation|technology policy/i, 'dsit'],
  [/\bDWP\b|work and pensions|universal credit|state pension/i, 'dwp'],

  // Regulators & public bodies
  [/\bOfgem\b|energy regulation|price cap|RIIO/i, 'ofgem'],
  [/\bOfwat\b|water regulation/i, 'ofwat'],
  [/\bOfcom\b|telecoms regulation|broadband|spectrum/i, 'ofcom'],
  [/\bEnvironment Agency\b|flood risk|pollution incident/i, 'environment-agency'],
  [/\bHMRC\b|tax.{0,10}(policy|reform|revenue)|customs/i, 'hmrc'],
  [/\bMHRA\b|medicines regulation|drug approval|marketing authorisation/i, 'mhra'],
  [/\bNICE\b|health technology assessment|clinical guideline/i, 'nice'],
  [/\bCQC\b|care quality|inspection regime/i, 'cqc'],
  [/\bCMA\b|competition.{0,10}markets|merger (inquiry|review)/i, 'cma'],
  [/\bPlanning Inspectorate\b|NSIP|nationally significant/i, 'planning-inspectorate'],
  [/\bNHS England\b|NHSE\b|commissioning/i, 'nhs-improve'],
  [/\bUKHSA\b|health security|vaccine programme/i, 'ukhsa'],
  [/\bNatural England\b|habitat|protected species/i, 'natural-england'],
  [/\bFood Standards Agency\b|FSA\b|food safety/i, 'fsa'],
  [/\bHSE\b|health and safety executive|workplace safety/i, 'hse'],

  // Sector-specific bodies
  [/\bNESO\b|national energy system operator|electricity system operator/i, 'desnz'],
  [/\bCrown Estate\b|seabed lease|offshore leasing/i, 'desnz'],
  [/\bGreat British Energy\b|GBE\b/i, 'desnz'],
  [/\bNorth Sea Transition Authority\b|NSTA\b/i, 'desnz'],
  [/\bNational Audit Office\b|NAO\b/i, 'treasury'],
  [/\bClimate Change Committee\b|CCC\b.*carbon budget/i, 'defra'],

  // Cross-cutting topic triggers
  [/\bnuclear\b|Sizewell|Hinkley/i, 'desnz'],
  [/\bhydrogen\b/i, 'desnz'],
  [/\bCCUS\b|carbon capture/i, 'desnz'],
  [/\bNHS\b/i, 'dhsc'],
  [/\bclinical trial|orphan drug|rare disease/i, 'mhra'],
  [/\bVPAS\b|voluntary scheme|branded medicines/i, 'dhsc'],
  [/\bCfD\b|contracts? for difference|allocation round/i, 'desnz'],
  [/\bREMA\b|electricity market reform/i, 'desnz'],
  [/\bcapacity market|capacity auction/i, 'desnz'],
  [/\bgrid connection|grid queue|SSEP/i, 'desnz'],

  // Bill-specific department mappings
  [/\bEmployment Rights Bill|Strikes \(Minimum Service/i, 'dbt'],
  [/\bRenters['''']?\s*Rights Bill|Renters \(Reform\)|Social Housing \(Regulation\)|Levelling.up and Regeneration Bill|English Devolution/i, 'dluhc'],
  [/\bTerminally Ill Adults|Health and Care Bill|Tobacco and Vapes Bill|Medical Training/i, 'dhsc'],
  [/\bFinance \(No|Finance Bill\b|Stamp Duty|National Insurance Contributions/i, 'treasury'],
  [/\bPension Schemes Bill/i, 'dwp'],
  [/\bData \(Use and Access\) Bill|Product Security and Telecomm/i, 'dsit'],
  [/\bFootball Governance Bill|Media Bill\b/i, 'dcms'],
  [/\bCrown Estate Bill/i, 'desnz'],
  [/\bWater \(Special Measures\)|Environment Bill\b/i, 'defra'],
  [/\bBus Services.{0,10}Bill/i, 'dft'],
  [/\bPublic Order Bill|National Security Bill|Illegal Migration Bill|Nationality and Borders Bill/i, 'home-office'],
  [/\bSentencing Guidelines|Judicial Review and Courts Bill/i, 'moj'],
  [/\bProduct Regulation and Metrology|Retained EU Law|Economic Activity of Public Bodies/i, 'dbt'],
  [/\bDigital Markets.{0,10}Competition/i, 'dbt'],
  [/\bTrade \(.*Trans-Pacific|Trade \(Australia|Trade \(New Zealand/i, 'dbt'],
  [/\bProcurement Bill\b|Public Authorities \(Fraud/i, 'co'],
  [/\bNorthern Ireland Troubles/i, 'home-office'],
  [/\bEconomic Crime.{0,10}(Transparency|Corporate)/i, 'treasury'],
  [/\bGenetic Technology \(Precision Breeding\)/i, 'defra'],
  [/\bPlanning and Infrastructure Bill/i, 'dluhc'],

  // Industry bodies (map to sponsoring department)
  [/\bORE Catapult\b|offshore renewable/i, 'desnz'],
  [/\bOEUK\b|Oil & Gas UK|offshore energies/i, 'desnz'],
  [/\bCarbon Brief\b/i, 'desnz'],
  [/\bEnergy UK\b/i, 'desnz'],
  [/\bRenewableUK\b|renewable uk/i, 'desnz'],
  [/\bNIHR\b|national institute.{0,5}health research/i, 'dhsc'],
  [/\bPRA\b|Prudential Regulation/i, 'treasury'],
  [/\bFCA\b|Financial Conduct Authority/i, 'treasury'],
  [/\bBank of England\b/i, 'treasury'],
];

// ── Content-based entity patterns ─────────────────────────────────────────
// Used by tagFromContent() to tag items based on their title + body text.
// Complements the regex-based KEYWORD_ENTITY_MAP with broader coverage and
// body-level entity IDs (e.g. 'neso', 'gbe') not just department IDs.

export const CONTENT_ENTITY_PATTERNS: Record<string, string[]> = {
  // Departments
  'desnz': [
    'energy', 'net zero', 'clean power', 'offshore wind', 'onshore wind',
    'solar', 'nuclear', 'hydrogen', 'carbon capture', 'ccus',
    'decarbonisation', 'energy security', 'energy bill', 'fuel poverty',
    'heat network', 'heat pump', 'boiler', 'insulation',
    'electricity', 'renewable', 'fossil fuel', 'north sea',
    'oil and gas', 'mining', 'minerals',
  ],
  'dluhc': [
    'housing', 'planning', 'building safety', 'building regulation',
    'local government', 'levelling up', 'regeneration', 'council',
    'homelessness', 'leasehold', 'freehold', 'cladding',
    'building safety regulator',
  ],
  'defra': [
    'biodiversity', 'nature', 'wildlife', 'farming',
    'agriculture', 'food standards', 'water pollution', 'air quality',
    'waste', 'recycling', 'flood', 'coastal erosion',
  ],
  'dhsc': [
    'health', 'social care', 'hospital', 'ambulance',
    'mental health', 'patient', 'vaccine', 'pharmaceutical',
    'medicine', 'clinical trial',
  ],
  'dft': [
    'transport', 'railway', 'road', 'aviation',
    'airport', 'shipping', 'freight',
  ],
  'mod': [
    'defence', 'military', 'armed forces', 'navy', 'army',
    'procurement',
  ],
  'treasury': [
    'fiscal', 'budget', 'spending review',
    'public finance', 'borrowing',
  ],
  'home-office': [
    'immigration', 'asylum', 'border', 'policing',
    'counter-terrorism',
  ],
  'dsit': [
    'science', 'innovation', 'artificial intelligence',
    'digital', 'research', 'telecoms', 'broadband',
  ],
  'dbt': [
    'trade', 'export', 'tariff', 'industrial strategy',
  ],
  'dfe': [
    'education', 'school', 'university', 'teacher', 'pupil',
    'student', 'curriculum',
  ],
  'moj': [
    'justice', 'court', 'prison', 'probation', 'legal aid',
    'sentencing', 'judiciary',
  ],

  // Regulators
  'ofgem': [
    'ofgem', 'energy regulation', 'price cap', 'energy tariff',
    'energy supplier', 'energy market', 'network charging',
    'grid connection', 'electricity distribution', 'gas distribution',
  ],
  'ofwat': [
    'ofwat', 'water regulation', 'water company', 'sewage', 'water bill',
    'water quality', 'water industry',
  ],
  'mhra': [
    'mhra', 'medicines regulation', 'drug safety', 'medical device',
    'marketing authorisation',
  ],
  'nice': [
    'nice', 'health technology', 'appraisal', 'clinical guideline',
    'cost effectiveness',
  ],
  'cqc': [
    'care quality', 'care home', 'hospital inspection',
    'care provider',
  ],
  'hse': [
    'health and safety executive', 'workplace safety',
    'building safety regulator', 'construction safety',
  ],
  'cma': [
    'competition and markets', 'merger inquiry', 'market study',
    'merger review',
  ],

  // Bodies
  'neso': [
    'neso', 'system operator', 'electricity system', 'grid balancing',
    'strategic spatial energy plan',
  ],
  'gbe': [
    'great british energy', 'gb energy', 'public energy company',
  ],
  'crown-estate': [
    'crown estate', 'seabed', 'leasing round', 'marine estate',
  ],
  'nsta': [
    'nsta', 'north sea transition', 'oil gas authority',
    'licensing round', 'exploration licence',
  ],
  'ccc': [
    'climate change committee', 'carbon budget', 'climate advisory',
    'net zero assessment',
  ],
  'environment-agency': [
    'environment agency', 'flood risk', 'pollution incident',
    'environmental permit', 'water framework',
  ],
  'natural-england': [
    'natural england', 'biodiversity net gain',
    'habitat regulation',
  ],
  'planning-inspectorate': [
    'planning inspectorate', 'planning appeal', 'development consent',
    'nationally significant infrastructure',
  ],
  'nhs-improve': [
    'nhs england', 'commissioning', 'nhs workforce',
  ],
  'ukhsa': [
    'ukhsa', 'health security', 'vaccine programme',
    'surveillance', 'outbreak',
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Pre-compiled matchers for tagFromContent — avoids regex recompilation per call
const CONTENT_MATCHERS: { entityId: string; matchers: { type: 'regex'; re: RegExp } | { type: 'includes'; pattern: string } }[][] = [];
const CONTENT_MATCHER_ENTRIES: { entityId: string; matchers: ({ type: 'regex'; re: RegExp } | { type: 'includes'; pattern: string })[] }[] =
  Object.entries(CONTENT_ENTITY_PATTERNS).map(([entityId, patterns]) => ({
    entityId,
    matchers: patterns.map((pattern) =>
      pattern.length <= 5
        ? { type: 'regex' as const, re: new RegExp(`\\b${escapeRegex(pattern)}\\b`, 'i') }
        : { type: 'includes' as const, pattern },
    ),
  }));

/**
 * Tag items based on their content against CONTENT_ENTITY_PATTERNS.
 * Short patterns (≤5 chars) use word-boundary matching to avoid false
 * positives on common English words that happen to be acronyms.
 */
export function tagFromContent(text: string): string[] {
  const lower = text.toLowerCase();
  const matched: string[] = [];

  for (const { entityId, matchers } of CONTENT_MATCHER_ENTRIES) {
    let found = false;
    for (const matcher of matchers) {
      if (matcher.type === 'regex') {
        if (matcher.re.test(text)) { found = true; break; }
      } else {
        if (lower.includes(matcher.pattern)) { found = true; break; }
      }
    }
    if (found) {
      matched.push(entityId);
    }
  }

  return matched;
}

/**
 * Enrich an item's entity IDs by scanning title + body against BOTH the
 * regex-based KEYWORD_ENTITY_MAP and the content-based CONTENT_ENTITY_PATTERNS.
 */
export function enrichEntityIds(
  baseEntityIds: string[],
  title: string,
  body: string,
): string[] {
  const ids = new Set(baseEntityIds);
  const text = `${title} ${body}`;

  // Pass 1: regex patterns (KEYWORD_ENTITY_MAP)
  for (const [pattern, entityId] of KEYWORD_ENTITY_MAP) {
    if (entityId && pattern.test(text)) {
      ids.add(entityId);
    }
  }

  // Pass 2: content-based patterns (CONTENT_ENTITY_PATTERNS)
  for (const tag of tagFromContent(text)) {
    ids.add(tag);
  }

  return Array.from(ids);
}

// ── Topic taxonomy ──────────────────────────────────────────────────────
// Maps keyword patterns to human-readable policy topic tags.
// These are broader than entity IDs — they describe what the content is *about*.

export const TOPIC_TAG_MAP: [RegExp, string][] = [
  // Energy & climate
  [/\boffshore wind|onshore wind|wind farm|wind energy|turbine/i, 'wind-energy'],
  [/\bsolar\b|photovoltaic|solar farm/i, 'solar'],
  [/\bnuclear|Sizewell|Hinkley|fusion|small modular reactor|SMR\b/i, 'nuclear'],
  [/\bhydrogen\b|hydrogen strategy/i, 'hydrogen'],
  [/\bCCUS\b|carbon capture|CCS\b/i, 'carbon-capture'],
  [/\bnet zero|decarboni[sz]ation|climate change|carbon budget|emission/i, 'climate-change'],
  [/\benergy (security|crisis|bill|price)|fuel poverty|energy efficiency|Opposition Day.*Energy/i, 'energy-policy'],
  [/\boil and gas|oil & gas|North Sea|petroleum|fossil fuel/i, 'oil-and-gas'],
  [/\bgrid connection|grid queue|electricity grid|transmission|distribution network/i, 'grid-infrastructure'],
  [/\bCfD\b|contracts? for difference|allocation round|REMA\b|electricity market/i, 'energy-markets'],
  [/\bheat pump|boiler|insulation|EPC\b|energy performance/i, 'heat-buildings'],
  [/\bbatter(y|ies)|energy storage|pumped hydro/i, 'energy-storage'],

  // Health & social care
  [/\bNHS\b|hospital|ambulance|A&E\b|waiting list|waiting time|Medical Training/i, 'nhs'],
  [/\bmental health|suicide|psychiatric|eating disorder/i, 'mental-health'],
  [/\bsocial care|care home|domiciliary care|adult social care/i, 'social-care'],
  [/\bvaccin|immunis/i, 'vaccines'],
  [/\bpharmaceutical|medicine|drug (safety|approv|pric)|MHRA\b/i, 'pharmaceuticals'],
  [/\bGP\b|general pract|primary care|dentist|dental/i, 'primary-care'],
  [/\bcancer\b|oncolog/i, 'cancer'],
  [/\bdementia|alzheimer/i, 'dementia'],

  // Housing & planning
  [/\bhousing (target|crisis|supply|market)|housebuilding|affordable home/i, 'housing'],
  [/\bplanning (reform|permission|system|application)|NSIP\b|development consent|Planning and Infrastructure Bill/i, 'planning'],
  [/\bcladding|building safety|Grenfell|fire safety/i, 'building-safety'],
  [/\bleasehold|freehold|ground rent|service charge/i, 'leasehold-reform'],
  [/\bhomeless/i, 'homelessness'],

  // Economy & finance
  [/\bbudget\b|fiscal|public spending|spending review|Public Authorities.*Fraud|Fraud.*Recovery/i, 'fiscal-policy'],
  [/\btax (reform|relief|cut|rise|policy)|income tax|corporation tax|capital gains|Opposition Day.*Tax|[Nn]ational [Ii]nsurance [Cc]ontributions?|fuel duty/i, 'taxation'],
  [/\bFinance (\(No\.\s*\d+\)\s*)?Bill/i, 'taxation'],
  [/\binflation|cost of living|interest rate/i, 'cost-of-living'],
  [/\bpension|state pension|retirement/i, 'pensions'],
  [/\buniversal credit|benefits?|welfare|unemployment/i, 'welfare'],

  // Defence & security
  [/\bdefence (spending|review|procurement)|armed forces|military|Opposition Day.*Defence/i, 'defence'],
  [/\bUkraine|Russia|NATO\b/i, 'ukraine-russia'],
  [/\bcyber (security|attack|threat)/i, 'cyber-security'],
  [/\bterror/i, 'counter-terrorism'],

  // Immigration & borders
  [/\bimmigration|asylum|refugee|migrant|small boat|Rwanda\b|[Ii]llegal [Mm]igration/i, 'immigration'],
  [/\bvisa\b|work permit|skilled worker/i, 'visas'],

  // Justice & policing
  [/\bprison|probation|reoffending|criminal justice|jury trial/i, 'criminal-justice'],
  [/\bSentencing Bill|Victims and Courts Bill|Courts and Tribunals Bill|Public Order Act/i, 'criminal-justice'],
  [/\bpolic(e|ing)|knife crime|violent crime|county lines/i, 'policing'],
  [/\blegal aid|access to justice|court (backlog|delay)/i, 'access-to-justice'],

  // Transport
  [/\brailway|rail\b|HS2\b|train\b/i, 'railways'],
  [/\belectric vehicle|EV\b|charging (point|infrastructure)/i, 'electric-vehicles'],
  [/\broad (safety|building|investment)|pothole|highway/i, 'roads'],
  [/\baviation|airport|airspace/i, 'aviation'],

  // Education
  [/\bschool|pupil|teacher|Ofsted|academy|free school/i, 'schools'],
  [/\buniversity|higher education|student (loan|finance|debt)/i, 'higher-education'],
  [/\bapprentice/i, 'apprenticeships'],
  [/\bchildcare|early years|nursery/i, 'childcare'],

  // Environment
  [/\bbiodiversity|nature recovery|species|wildlife/i, 'biodiversity'],
  [/\bwater (pollution|quality|company)|sewage|river pollution/i, 'water-quality'],
  [/\bflood (risk|defence|warning)/i, 'flooding'],
  [/\bair quality|air pollution|clean air/i, 'air-quality'],
  [/\bwaste|recycling|circular economy|plastic/i, 'waste-recycling'],
  [/\bfarming|agriculture|food (security|production)|rural|Opposition Day.*[Rr]ural|seasonal work/i, 'agriculture'],

  // Technology & digital
  [/\bartificial intelligence|AI (regulation|safety|governance)|machine learning/i, 'ai-regulation'],
  [/\bbroadband|digital infrastructure|fibre|5G\b/i, 'digital-infrastructure'],
  [/\bdata protection|privacy|online safety|online harm/i, 'online-safety'],

  // Trade & industry
  [/\btrade (deal|agreement|policy)|tariff|WTO\b|free trade/i, 'trade-policy'],
  [/\bindustrial strategy|manufacturing|steel|automotive|Employment Rights/i, 'industrial-strategy'],
  [/\bIndustry and Exports/i, 'trade-policy'],
  [/\bfreeport|investment zone|enterprise zone/i, 'freeports'],

  // Devolution & constitution
  [/\bScotland|Scottish\b/i, 'scotland'],
  [/\bWales|Welsh\b/i, 'wales'],
  [/\bNorthern Ireland|Stormont/i, 'northern-ireland'],
  [/\bdevolution|combined authority|metro mayor|English Devolution/i, 'devolution'],
  [/\bRepresentation of the People/i, 'equality'],

  // Foreign affairs & international
  [/\bforeign (affairs|policy|secretary)|diplomat|embassy|sanction/i, 'foreign-affairs'],
  [/\binternational development|overseas aid|ODA\b|foreign aid|humanitarian/i, 'international-development'],
  [/\bChina|Beijing|Indo-Pacific|AUKUS\b/i, 'indo-pacific'],
  [/\bMiddle East|Israel|Palestine|Gaza|Iran/i, 'middle-east'],

  // Equality & human rights
  [/\bequality|discrimination|human rights|protected characteristic/i, 'equality'],
  [/\bmodern slavery|trafficking|forced labour/i, 'modern-slavery'],
  [/\bdisability|disabled|accessibility|special educational needs|SEND\b/i, 'disability'],
  [/\bgender pay|equal pay|women('s| and) equalit/i, 'gender-equality'],

  // Children & families
  [/\bchild (protection|abuse|poverty|welfare)|safeguarding|looked.after children/i, 'child-welfare'],
  [/\bdomestic (abuse|violence)|victim/i, 'domestic-abuse'],

  // Public health
  [/\bobesity|smoking|tobacco|alcohol|vaping|e-cigarette/i, 'public-health'],
  [/\bantimicrobial|antibiotic resistance|AMR\b/i, 'antimicrobial-resistance'],

  // Veterans & armed forces community
  [/\bveteran|armed forces covenant|ex-service/i, 'veterans'],

  // Space & science
  [/\bspace (industry|sector|launch|agency)|satellite|UK Space/i, 'space'],

  // Maritime & shipping
  [/\bmaritime|shipping|port (infrastructure|expansion)|seafarer/i, 'maritime'],

  // Local government & communities
  [/\blocal (government|council|authority)|council tax|municipal|Local Government Finance/i, 'local-government'],
  [/\bcommunity (safety|cohesion)|anti-social behaviour|ASB\b/i, 'community-safety'],

  // Financial services & regulation
  [/\bfinancial (conduct|regulation|services)|FCA\b|PRA\b|banking/i, 'financial-regulation'],
  [/\bcryptocurren|blockchain|digital asset|stablecoin/i, 'crypto-digital-assets'],

  // Culture, media & sport
  [/\bBBC\b|broadcasting|Channel 4|media regulation/i, 'broadcasting'],
  [/\bsport|football|Olympic|Paralympic/i, 'sport'],
  [/\bheritage|museum|listed building|cultural/i, 'heritage-culture'],

  // Gambling & addiction
  [/\bgambling|betting|lottery|casino/i, 'gambling'],

  // ── Bill-specific patterns ──────────────────────────────────────────────
  // Catches division votes and debates on specific legislation
  [/\bRenters['''']?\s*Rights Bill|Renters \(Reform\) Bill|Social Housing \(Regulation\) Bill/i, 'housing'],
  [/\bTerminally Ill Adults|End of Life Bill/i, 'end-of-life'],
  [/\bHouse of Lords \(Hereditary Peers\) Bill|Dissolution and Calling of Parliament/i, 'constitutional-reform'],
  [/\bData \(Use and Access\) Bill|Product Security and Telecommunications/i, 'online-safety'],
  [/\bCrown Estate Bill/i, 'energy-policy'],
  [/\bWater \(Special Measures\) Bill/i, 'water-quality'],
  [/\bBus Services.{0,10}Bill/i, 'public-transport'],
  [/\bDigital Markets.{0,10}Competition.{0,10}Consumers Bill/i, 'consumer-protection'],
  [/\bStrikes \(Minimum Service Levels\) Bill/i, 'industrial-strategy'],
  [/\bEconomic Crime.{0,10}(Transparency|Corporate)/i, 'financial-regulation'],
  [/\bNational Security Bill/i, 'counter-terrorism'],
  [/\bRetained EU Law \(Revocation/i, 'trade-policy'],
  [/\bProcurement Bill/i, 'fiscal-policy'],
  [/\bElections Bill\b/i, 'equality'],
  [/\bAdvanced Research and Invention Agency Bill|ARIA\b/i, 'space'],
  [/\bSkills and Post-16 Education Bill/i, 'higher-education'],
  [/\bTelecommunications \(Security\) Bill/i, 'digital-infrastructure'],
  [/\bJudicial Review and Courts Bill/i, 'access-to-justice'],
  [/\bEconomic Activity of Public Bodies \(Overseas Matters\)/i, 'trade-policy'],
  [/\bProduct Regulation and Metrology Bill/i, 'trade-policy'],
  [/\bGenetic Technology \(Precision Breeding\) Bill/i, 'agriculture'],
  [/\bMedia Bill\b/i, 'broadcasting'],
  [/\bUK Infrastructure Bank Bill/i, 'fiscal-policy'],
  [/\bSubsidy Control Bill/i, 'industrial-strategy'],
  [/\bFinancial Markets and Services Bill/i, 'financial-regulation'],
  [/\bHolocaust Memorial Bill/i, 'heritage-culture'],
  [/\bTrade \(.*Trans-Pacific|CPTPP\)/i, 'trade-policy'],
  [/\bTrade \(Australia|New Zealand\) Bill/i, 'trade-policy'],
  [/\bIllegal Migration Bill|Nationality and Borders Bill/i, 'immigration'],
  [/\bLevelling.up and Regeneration Bill/i, 'planning'],
  [/\bHealth and Care Bill/i, 'nhs'],
  [/\bEnvironment Bill\b/i, 'biodiversity'],
  [/\bPublic Order Bill/i, 'policing'],
  [/\bSentencing Guidelines.{0,40}Bill|Sentencing Guidelines \(/i, 'criminal-justice'],
  [/\bStamp Duty Land Tax/i, 'taxation'],
  [/\bHousing Bill|Building Safety Bill/i, 'building-safety'],
  [/\bEnglish Devolution.{0,30}Bill/i, 'devolution'],
  [/\bTobacco and Vapes Bill/i, 'public-health'],
  [/\bFootball Governance Bill/i, 'sport'],
  [/\bPension Schemes Bill/i, 'pensions'],
  [/\bNorthern Ireland Troubles/i, 'northern-ireland'],

  // Draft regulations / statutory instruments
  [/\bDraft Clean Heat Market Mechanism/i, 'heat-buildings'],
  [/\bDraft Electricity Capacity Mechanism/i, 'energy-markets'],
  [/\bDraft.*Detention Curfew|Home Detention/i, 'criminal-justice'],
  [/\bDraft.*Medical Devices/i, 'pharmaceuticals'],
  [/\bDraft.*Windsor Framework/i, 'northern-ireland'],
  [/\bDraft.*Enterprise Act/i, 'consumer-protection'],
  [/\bDraft.*Strikes.*Minimum Service/i, 'industrial-strategy'],
  [/\bDraft.*Official Controls.*Regulations/i, 'agriculture'],

  // Opposition day patterns
  [/\bOpposition [Dd]ay.*Winter Fuel|Winter Fuel Payment/i, 'welfare'],
  [/\bOpposition [Dd]ay.*British Indian Ocean/i, 'foreign-affairs'],
  [/\bOpposition [Dd]ay.*NHS|Opposition [Dd]ay.*Health/i, 'nhs'],
  [/\bOpposition [Dd]ay.*Housing|Opposition [Dd]ay.*Hous(e|ing)/i, 'housing'],
  [/\bOpposition [Dd]ay.*Police|Opposition [Dd]ay.*Crime/i, 'policing'],
  [/\bOpposition [Dd]ay.*Education|Opposition [Dd]ay.*School/i, 'schools'],
  [/\bOpposition [Dd]ay.*Asylum|Opposition [Dd]ay.*Immigration/i, 'immigration'],
  [/\bOpposition [Dd]ay.*Cost of Living/i, 'cost-of-living'],

  // Procedural motions (still useful to tag for filtering)
  [/\bKing'?s? Speech|Queen'?s? Speech/i, 'parliamentary-procedure'],
  [/\bMotion to sit in private|Closure motion\b|Programme motion|Privilege\b/i, 'parliamentary-procedure'],

  // GOV.UK content patterns (catch govuk items)
  [/\bappoint|reappoint|non-executive/i, 'appointments'],
  [/\binspection|investigation report|annual report/i, 'regulatory-oversight'],
  [/\btransferred to public ownership|nationalised|public ownership/i, 'public-transport'],
  [/\belectoral reform|voter registration|election/i, 'equality'],
  [/\benvironmental permit|pollution permit/i, 'biodiversity'],
  [/\brecall alert|product recall|safety alert/i, 'consumer-protection'],
  [/\bcoastal (defence|erosion|protection)|seabed mapping/i, 'maritime'],

  // ── Broader pattern gap-fillers ──────────────────────────────────────────
  // Fills gaps found via backfill coverage analysis
  [/\bflooding\b|storm.*damage|flood damage/i, 'flooding'],
  [/\boil refin|refinery|petrochemical/i, 'oil-and-gas'],
  [/\bdoctor|nurse|health (professional|workforce)|paramedic|midwi|junior doctor/i, 'nhs'],
  [/\btourism|tourist|hospitality sector/i, 'heritage-culture'],
  [/\bantisemit|islamophob|hate crime|racial hatred/i, 'equality'],
  [/\binfected blood|contaminated blood|blood scandal/i, 'nhs'],
  [/\bcompensation scheme|redress scheme/i, 'welfare'],
  [/\bpark home|mobile home|caravan site/i, 'housing'],
  [/\bwheelchair|prostheti|assistive technolog/i, 'disability'],
  [/\bfire (service|safety|brigade|authority)/i, 'community-safety'],
  [/\bcouncil (funding|budget|finance|spending)/i, 'local-government'],
  [/\binquest|coroner/i, 'criminal-justice'],
  [/\bgrocery|supermarket|food (poverty|bank|insecurity)/i, 'welfare'],

  // ── Department / answering-body patterns ─────────────────────────────────
  // Catches written questions addressed to specific departments
  [/\bSecretary of State for Defence|Ministry of Defence|MoD\b/i, 'defence'],
  [/\bSecretary of State for Energy|Department for Energy Security/i, 'energy-policy'],
  [/\bSecretary of State for (the )?Environment|Department for Environment|Defra\b/i, 'agriculture'],
  [/\bSecretary of State for Education|Department for Education|DfE\b/i, 'schools'],
  [/\bSecretary of State for Health|Department of Health|DHSC\b/i, 'nhs'],
  [/\bSecretary of State for Transport|Department for Transport|DfT\b/i, 'roads'],
  [/\bSecretary of State for Work|Department for Work and Pensions|DWP\b/i, 'welfare'],
  [/\bSecretary of State for the Home Department|Home Office|Home Secretary/i, 'immigration'],
  [/\bSecretary of State for Justice|Ministry of Justice|MoJ\b/i, 'criminal-justice'],
  [/\bSecretary of State for Business|Department for Business/i, 'industrial-strategy'],
  [/\bSecretary of State for (Science|Innovation|Technology)|DSIT\b/i, 'ai-regulation'],
  [/\bSecretary of State for Housing|Department for Levelling Up|DLUHC\b|MHCLG\b/i, 'housing'],
  [/\bSecretary of State for (Digital|Culture|Media)|DCMS\b/i, 'broadcasting'],
  [/\bHM Treasury|Chancellor of the Exchequer/i, 'fiscal-policy'],
  [/\bForeign.{0,20}Commonwealth.{0,20}Development Office|FCDO\b/i, 'foreign-affairs'],

  // ── Broader energy patterns ─────────────────────────────────────────────
  [/\benergy cost|electricity (supplier|payment|regulation)|industrial energy|energy competitiv/i, 'energy-policy'],
  [/\belectricity\b|energy (transition|mix|sector|infrastructure)/i, 'energy-policy'],

  // ── Broader defence patterns ────────────────────────────────────────────
  [/\bdefence\b|army\b|navy\b|royal air force|RAF\b|cadet/i, 'defence'],

  // ── Broader transport patterns ──────────────────────────────────────────
  [/\btransport\b|bus (service|route|network)|cycling|pedestrian|active travel/i, 'roads'],
  [/\bpublic transport/i, 'public-transport'],

  // ── Broader content patterns for GOV.UK items ───────────────────────────
  [/\bSSSI\b|Site of Special Scientific Interest|nature reserve/i, 'biodiversity'],
  [/\bslaughter|meat production|abattoir|livestock/i, 'agriculture'],
  [/\bspending over £|departmental spending|annual report and accounts/i, 'fiscal-policy'],
  [/\bfield safety notice|device alert|safety information/i, 'consumer-protection'],
  [/\bsurveillance report|mortality|flu.*report|COVID.*report/i, 'public-health'],
  [/\bbathing water|water (season|quality|framework)/i, 'water-quality'],
  [/\bSyria|Lebanon|Jordan/i, 'middle-east'],
  [/\bGermany|France|EU\b|European/i, 'foreign-affairs'],
  [/\bself assessment|HMRC\b|tax (credit|return|relief)/i, 'taxation'],
  [/\btransport strategy|road (safety|network)|traffic/i, 'roads'],
  [/\bknife|offensive weapon|violent (crime|disorder)/i, 'policing'],
  [/\bService Family Accommodation|military housing/i, 'veterans'],
  [/\bCoast Path|national trail|right of way/i, 'biodiversity'],
  [/\bfilm|cinema|creative (industr|sector)|Bollywood/i, 'heritage-culture'],
  [/\bfraud|money laundering|economic crime/i, 'financial-regulation'],
  [/\bEnergy Trends|energy statistics|fuel (mix|generation)/i, 'energy-policy'],
  [/\bbiosecurity|invasive species|plant health/i, 'agriculture'],
  [/\bcharity|voluntary sector|social enterprise/i, 'local-government'],
  [/\bpreschool|playgroup|Brownie|Scout|youth (group|club)/i, 'child-welfare'],
  [/\banniversary|commemoration|centenary|remembrance/i, 'heritage-culture'],
];

/**
 * Extract topic tags from text content.
 * Returns deduplicated array of topic tag strings.
 */
export function extractTopicTags(title: string, body: string): string[] {
  const text = `${title} ${body}`;
  const tags = new Set<string>();

  for (const [pattern, tag] of TOPIC_TAG_MAP) {
    if (pattern.test(text)) {
      tags.add(tag);
    }
  }

  return Array.from(tags);
}

/**
 * Deterministic RAG status from title + body keywords.
 */
export function determineRagStatus(title: string, body: string): 'RED' | 'AMBER' | 'GREEN' {
  const text = `${title} ${body}`.toLowerCase();

  // RED triggers
  if (
    /\burgent\b/.test(text) ||
    /\bemergency\b/.test(text) ||
    /\bimmediate\s+action\b/.test(text) ||
    /\bsafety\s+alert\b/.test(text) ||
    /\brecall\b/.test(text) ||
    /\benforcement\s+action\b/.test(text) ||
    /\bsafety\s+notice\b/.test(text) ||
    /\bprohibition\s+order\b/.test(text)
  ) {
    return 'RED';
  }

  // AMBER triggers
  if (
    /\bconsultation\b/.test(text) ||
    /\bcall\s+for\s+evidence\b/.test(text) ||
    /\bproposed\s+changes?\b/.test(text) ||
    /\bdraft\b/.test(text) ||
    /\breview\b/.test(text) ||
    /\bdelay(ed)?\b/.test(text) ||
    /\bwarning\b/.test(text) ||
    /\binquiry\b/.test(text) ||
    /\binvestigation\b/.test(text)
  ) {
    return 'AMBER';
  }

  return 'GREEN';
}

/**
 * SHA-256 fingerprint for deduplication.
 */
export function makeFingerprint(url: string, title: string): string {
  if (!url && !title) return '';
  return crypto
    .createHash('sha256')
    .update(`${url || ''}||${title || ''}`)
    .digest('hex');
}

/**
 * Strip HTML tags from a string.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
