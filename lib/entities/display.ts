/**
 * Human-readable display names for entity IDs.
 * Maps internal IDs like "desnz" to display names like "DESNZ".
 */

import { getEntity } from '@/data/entities';

const SHORT_NAMES: Record<string, string> = {
  // Departments
  'desnz': 'DESNZ',
  'dhsc': 'DHSC',
  'dluhc': 'DLUHC',
  'defra': 'Defra',
  'dsit': 'DSIT',
  'dbt': 'DBT',
  'dfe': 'DfE',
  'dft': 'DfT',
  'dwp': 'DWP',
  'mod': 'MoD',
  'moj': 'MoJ',
  'co': 'Cabinet Office',
  'treasury': 'Treasury',
  'home-office': 'Home Office',
  'fcdo': 'FCDO',
  'dcms': 'DCMS',

  // Regulators & public bodies
  'ofgem': 'Ofgem',
  'ofwat': 'Ofwat',
  'ofcom': 'Ofcom',
  'nsta': 'NSTA',
  'neso': 'NESO',
  'gbe': 'GB Energy',
  'ccc': 'CCC',
  'cma': 'CMA',
  'nao': 'NAO',
  'cqc': 'CQC',
  'mhra': 'MHRA',
  'nice': 'NICE',
  'hse': 'HSE',
  'hmrc': 'HMRC',
  'fsa': 'FSA',
  'nhs-improve': 'NHS England',
  'ukhsa': 'UKHSA',
  'environment-agency': 'Env Agency',
  'natural-england': 'Natural England',
  'planning-inspectorate': 'PINS',
  'crown-estate': 'Crown Estate',
  'mmo': 'MMO',
};

export function entityDisplayName(entityId: string): string {
  if (SHORT_NAMES[entityId]) return SHORT_NAMES[entityId];

  const entity = getEntity(entityId);
  if (entity) {
    return entity.name.length > 22 ? entityId.toUpperCase() : entity.name;
  }

  return entityId.toUpperCase();
}
