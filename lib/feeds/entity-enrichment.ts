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

/**
 * Tag items based on their content against CONTENT_ENTITY_PATTERNS.
 * Short patterns (≤5 chars) use word-boundary matching to avoid false
 * positives on common English words that happen to be acronyms.
 */
export function tagFromContent(text: string): string[] {
  const lower = text.toLowerCase();
  const matched: string[] = [];

  for (const [entityId, patterns] of Object.entries(CONTENT_ENTITY_PATTERNS)) {
    let found = false;
    for (const pattern of patterns) {
      if (pattern.length <= 5) {
        // Short patterns — word boundary to avoid "nice report" → NICE
        const re = new RegExp(`\\b${escapeRegex(pattern)}\\b`, 'i');
        if (re.test(text)) {
          found = true;
          break;
        }
      } else {
        if (lower.includes(pattern)) {
          found = true;
          break;
        }
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
  [/\benergy (security|crisis|bill|price)|fuel poverty|energy efficiency/i, 'energy-policy'],
  [/\boil and gas|oil & gas|North Sea|petroleum|fossil fuel/i, 'oil-and-gas'],
  [/\bgrid connection|grid queue|electricity grid|transmission|distribution network/i, 'grid-infrastructure'],
  [/\bCfD\b|contracts? for difference|allocation round|REMA\b|electricity market/i, 'energy-markets'],
  [/\bheat pump|boiler|insulation|EPC\b|energy performance/i, 'heat-buildings'],
  [/\bbatter(y|ies)|energy storage|pumped hydro/i, 'energy-storage'],

  // Health & social care
  [/\bNHS\b|hospital|ambulance|A&E\b|waiting list|waiting time/i, 'nhs'],
  [/\bmental health|suicide|psychiatric|eating disorder/i, 'mental-health'],
  [/\bsocial care|care home|domiciliary care|adult social care/i, 'social-care'],
  [/\bvaccin|immunis/i, 'vaccines'],
  [/\bpharmaceutical|medicine|drug (safety|approv|pric)|MHRA\b/i, 'pharmaceuticals'],
  [/\bGP\b|general pract|primary care|dentist|dental/i, 'primary-care'],
  [/\bcancer\b|oncolog/i, 'cancer'],
  [/\bdementia|alzheimer/i, 'dementia'],

  // Housing & planning
  [/\bhousing (target|crisis|supply|market)|housebuilding|affordable home/i, 'housing'],
  [/\bplanning (reform|permission|system|application)|NSIP\b|development consent/i, 'planning'],
  [/\bcladding|building safety|Grenfell|fire safety/i, 'building-safety'],
  [/\bleasehold|freehold|ground rent|service charge/i, 'leasehold-reform'],
  [/\bhomeless/i, 'homelessness'],

  // Economy & finance
  [/\bbudget\b|fiscal|public spending|spending review/i, 'fiscal-policy'],
  [/\btax (reform|relief|cut|rise|policy)|income tax|corporation tax|capital gains/i, 'taxation'],
  [/\binflation|cost of living|interest rate/i, 'cost-of-living'],
  [/\bpension|state pension|retirement/i, 'pensions'],
  [/\buniversal credit|benefits?|welfare/i, 'welfare'],

  // Defence & security
  [/\bdefence (spending|review|procurement)|armed forces|military/i, 'defence'],
  [/\bUkraine|Russia|NATO\b/i, 'ukraine-russia'],
  [/\bcyber (security|attack|threat)/i, 'cyber-security'],
  [/\bterror/i, 'counter-terrorism'],

  // Immigration & borders
  [/\bimmigration|asylum|refugee|migrant|small boat|Rwanda\b/i, 'immigration'],
  [/\bvisa\b|work permit|skilled worker/i, 'visas'],

  // Justice & policing
  [/\bprison|probation|reoffending|criminal justice/i, 'criminal-justice'],
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
  [/\bfarming|agriculture|food (security|production)|rural/i, 'agriculture'],

  // Technology & digital
  [/\bartificial intelligence|AI (regulation|safety|governance)|machine learning/i, 'ai-regulation'],
  [/\bbroadband|digital infrastructure|fibre|5G\b/i, 'digital-infrastructure'],
  [/\bdata protection|privacy|online safety|online harm/i, 'online-safety'],

  // Trade & industry
  [/\btrade (deal|agreement|policy)|tariff|WTO\b|free trade/i, 'trade-policy'],
  [/\bindustrial strategy|manufacturing|steel|automotive/i, 'industrial-strategy'],
  [/\bfreeport|investment zone|enterprise zone/i, 'freeports'],

  // Devolution & constitution
  [/\bScotland|Scottish\b/i, 'scotland'],
  [/\bWales|Welsh\b/i, 'wales'],
  [/\bNorthern Ireland|Stormont/i, 'northern-ireland'],
  [/\bdevolution|combined authority|metro mayor/i, 'devolution'],
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
    /\bdelayed?\b/.test(text) ||
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
  return crypto
    .createHash('sha256')
    .update(`${url}||${title}`)
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
    .replace(/\s+/g, ' ')
    .trim();
}
