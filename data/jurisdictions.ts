import type { Jurisdiction } from '@/types/entity';

export const JURISDICTIONS: Record<string, Jurisdiction> = {
  uk: {
    label: "United Kingdom",
    shortLabel: "UK",
    description: "Applies across all four nations",
  },
  gb: {
    label: "Great Britain",
    shortLabel: "GB",
    description: "England, Scotland and Wales (not NI)",
  },
  "england-wales": {
    label: "England & Wales",
    shortLabel: "Eng & Wales",
    description: "England and Wales only",
  },
  england: {
    label: "England",
    shortLabel: "England",
    description: "England only",
  },
  scotland: {
    label: "Scotland",
    shortLabel: "Scotland",
    description: "Scotland only",
  },
  wales: {
    label: "Wales",
    shortLabel: "Wales",
    description: "Wales only",
  },
  "northern-ireland": {
    label: "Northern Ireland",
    shortLabel: "N. Ireland",
    description: "Northern Ireland only",
  },
  "crown-dependencies": {
    label: "Crown Dependencies",
    shortLabel: "Crown Deps",
    description: "Jersey, Guernsey and Isle of Man",
  },
  "overseas-territories": {
    label: "Overseas Territories",
    shortLabel: "Overseas",
    description: "British Overseas Territories",
  },
};

/**
 * Maps each jurisdiction to the list of broader jurisdictions it falls under.
 * For example, "england" falls under ["uk", "gb", "england-wales", "england"].
 */
export const JURISDICTION_HIERARCHY: Record<string, string[]> = {
  uk: ["uk"],
  gb: ["uk", "gb"],
  "england-wales": ["uk", "gb", "england-wales"],
  england: ["uk", "gb", "england-wales", "england"],
  scotland: ["uk", "gb", "scotland"],
  wales: ["uk", "gb", "england-wales", "wales"],
  "northern-ireland": ["uk", "northern-ireland"],
  "crown-dependencies": ["crown-dependencies"],
  "overseas-territories": ["overseas-territories"],
};

/**
 * Check whether an entity's jurisdictions match a given filter jurisdiction.
 *
 * Returns true if the entity has no jurisdictions set (assumed UK-wide),
 * or if the filter jurisdiction appears in the hierarchy chain of any
 * of the entity's jurisdictions.
 */
export function matchesJurisdiction(
  entityJurisdictions: string[] | undefined,
  filterJurisdiction: string,
): boolean {
  // Entities with no explicit jurisdictions are treated as UK-wide
  if (!entityJurisdictions || entityJurisdictions.length === 0) {
    return filterJurisdiction === 'uk' || JURISDICTION_HIERARCHY['uk']?.includes(filterJurisdiction) === true;
  }

  return entityJurisdictions.some((ej) => {
    const chain = JURISDICTION_HIERARCHY[ej];
    return chain ? chain.includes(filterJurisdiction) : ej === filterJurisdiction;
  });
}
