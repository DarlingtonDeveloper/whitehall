import type { Entity } from '@/types/entity';
import { ENTITIES, ENTITY_LIST } from './entities';

/**
 * Get direct children of an entity (entities whose parentIds include this id).
 */
export function getChildren(entityId: string): Entity[] {
  return ENTITY_LIST.filter((e) => e.parentIds.includes(entityId));
}

/**
 * Get secondary children (entities whose secondaryParentIds include this id).
 */
export function getSecondaryChildren(entityId: string): Entity[] {
  return ENTITY_LIST.filter(
    (e) => e.secondaryParentIds?.includes(entityId) === true,
  );
}

/**
 * Get direct parents of an entity.
 */
export function getParents(entityId: string): Entity[] {
  const entity = ENTITIES[entityId];
  if (!entity) return [];
  return entity.parentIds
    .map((pid) => ENTITIES[pid])
    .filter((e): e is Entity => e !== undefined);
}

/**
 * Get secondary parents of an entity.
 */
export function getSecondaryParents(entityId: string): Entity[] {
  const entity = ENTITIES[entityId];
  if (!entity) return [];
  return (entity.secondaryParentIds ?? [])
    .map((pid) => ENTITIES[pid])
    .filter((e): e is Entity => e !== undefined);
}

/**
 * Get all relationship directions for a given entity in one call.
 */
export function getRelationships(entityId: string): {
  parents: Entity[];
  children: Entity[];
  secondaryParents: Entity[];
  secondaryChildren: Entity[];
} {
  return {
    parents: getParents(entityId),
    children: getChildren(entityId),
    secondaryParents: getSecondaryParents(entityId),
    secondaryChildren: getSecondaryChildren(entityId),
  };
}
