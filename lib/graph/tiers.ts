import { ENTITIES, ENTITY_LIST } from '@/data/entities';

// ---------------------------------------------------------------------------
// Adjacency lists
// ---------------------------------------------------------------------------

/** Maps a parent id to the set of entity ids that list it as a parent. */
const childrenOf = new Map<string, Set<string>>();

/** Maps an entity id to the set of its parent ids. */
const parentsOf = new Map<string, Set<string>>();

for (const entity of ENTITY_LIST) {
  if (!childrenOf.has(entity.id)) childrenOf.set(entity.id, new Set());
  if (!parentsOf.has(entity.id)) parentsOf.set(entity.id, new Set());

  for (const pid of entity.parentIds) {
    if (!childrenOf.has(pid)) childrenOf.set(pid, new Set());
    childrenOf.get(pid)!.add(entity.id);
    parentsOf.get(entity.id)!.add(pid);
  }

  for (const pid of entity.secondaryParentIds ?? []) {
    if (!childrenOf.has(pid)) childrenOf.set(pid, new Set());
    childrenOf.get(pid)!.add(entity.id);
    parentsOf.get(entity.id)!.add(pid);
  }
}

export { childrenOf, parentsOf };

// ---------------------------------------------------------------------------
// Base-tier classification (mirrors bundle `Ct`)
// ---------------------------------------------------------------------------

function baseTier(id: string): number {
  const e = ENTITIES[id];
  if (!e) return 99;
  if (id === 'pm') return 0;
  if (e.category === 'official' && e.subtype === 'cabinet-minister') return 1;
  if (e.category === 'official' && e.subtype === 'junior-minister') return 2;
  if (
    e.category === 'department' &&
    (e.subtype === 'ministerial' || e.subtype === 'non-ministerial')
  )
    return 3;
  if (
    e.category === 'department' &&
    (e.subtype === 'agency' || e.subtype === 'division-directorate')
  )
    return 4;
  return -1;
}

// ---------------------------------------------------------------------------
// Full tier computation (mirrors bundle `It`)
// ---------------------------------------------------------------------------

export function computeTiers(): Map<string, number> {
  const tiers = new Map<string, number>();

  // 1. Assign base tiers for entities that have a known classification.
  for (const id of Object.keys(ENTITIES)) {
    const bt = baseTier(id);
    if (bt >= 0) tiers.set(id, bt);
  }

  // 2. BFS from tiers 1-4 outward through both children and parents.
  const queue: { id: string; tier: number }[] = [];
  for (const [id, tier] of tiers) {
    if (tier >= 1 && tier <= 4) queue.push({ id, tier });
  }

  while (queue.length > 0) {
    const { id, tier } = queue.shift()!;
    const neighbours = [
      ...(childrenOf.get(id) ?? []),
      ...(parentsOf.get(id) ?? []),
    ];

    for (const nid of neighbours) {
      const ne = ENTITIES[nid];
      if (!ne) continue;
      if (tiers.has(nid)) continue;
      // Skip groups entirely; skip civil servants and independents (handled later).
      if (ne.category === 'group') continue;
      if (
        ne.category === 'official' &&
        (ne.subtype === 'civil-servant' || ne.subtype === 'independent')
      )
        continue;

      const newTier = Math.max(5, tier + 1);
      tiers.set(nid, newTier);
      queue.push({ id: nid, tier: newTier });
    }
  }

  // 3. Civil servants and independent officials: place at (min child tier) - 0.5
  for (const id of Object.keys(ENTITIES)) {
    const e = ENTITIES[id];
    if (e.category !== 'official') continue;
    if (e.subtype !== 'civil-servant' && e.subtype !== 'independent') continue;
    if (tiers.has(id)) continue;

    const children = childrenOf.get(id) ?? new Set<string>();
    let minChildTier = Infinity;
    for (const cid of children) {
      const ct = tiers.get(cid);
      if (ct != null && ct < minChildTier) minChildTier = ct;
    }

    if (minChildTier < Infinity) {
      tiers.set(id, minChildTier - 0.5);
    }
  }

  // 4. Everything still unassigned gets tier 12.
  for (const id of Object.keys(ENTITIES)) {
    if (!tiers.has(id)) tiers.set(id, 12);
  }

  return tiers;
}

export const TIER_MAP = computeTiers();
