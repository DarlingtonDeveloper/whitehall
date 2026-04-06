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

/**
 * Enrich an item's entity IDs by scanning title + body against the shared
 * keyword-entity map.
 */
export function enrichEntityIds(
  baseEntityIds: string[],
  title: string,
  body: string,
): string[] {
  const ids = new Set(baseEntityIds);
  const text = `${title} ${body}`;

  for (const [pattern, entityId] of KEYWORD_ENTITY_MAP) {
    if (entityId && pattern.test(text)) {
      ids.add(entityId);
    }
  }

  return Array.from(ids);
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
