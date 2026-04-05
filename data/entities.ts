import type { Entity } from '@/types/entity';
import _entities from './_extracted/entities.json';

export const ENTITIES = _entities as Record<string, Entity>;

export const ENTITY_LIST: Entity[] = Object.values(ENTITIES);

/**
 * Look up a single entity by its id.
 */
export function getEntity(id: string): Entity | undefined {
  return ENTITIES[id];
}

/**
 * Case-insensitive search across entity name, id, and currentHolder.
 */
export function searchEntities(query: string): Entity[] {
  if (!query) return [];
  const q = query.toLowerCase();
  return ENTITY_LIST.filter((e) => {
    if (e.id.toLowerCase().includes(q)) return true;
    if (e.name.toLowerCase().includes(q)) return true;
    if (e.currentHolder && e.currentHolder.toLowerCase().includes(q)) return true;
    return false;
  });
}
