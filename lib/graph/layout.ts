import { TIER_MAP } from './tiers';
import { parentsOf } from './tiers';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RingData {
  tier: number;
  radius: number;
  orderedIds: string[];
  step: number; // angular step between entities
  baseRotation: number;
}

export interface LayoutResult {
  positions: Map<string, { x: number; y: number }>;
  nodeAngles: Map<string, number>;
  rings: Map<number, RingData>;
}

// ---------------------------------------------------------------------------
// Helpers (mirrors bundle `de` and `Ze`)
// ---------------------------------------------------------------------------

/** Normalise an angle into [0, 2*PI). */
function normaliseAngle(a: number): number {
  return ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
}

/** Circular mean of a list of angles. */
function circularMean(angles: number[]): number {
  if (angles.length === 0) return 0;
  const sinSum = angles.reduce((s, a) => s + Math.sin(a), 0);
  const cosSum = angles.reduce((s, a) => s + Math.cos(a), 0);
  return Math.atan2(sinSum / angles.length, cosSum / angles.length);
}

// ---------------------------------------------------------------------------
// Radius lookup (mirrors bundle `St`)
// ---------------------------------------------------------------------------

function tierRadius(tier: number): number {
  const lookup = (t: number): number => {
    const table: Record<number, number> = { 1: 180, 2: 330, 3: 520, 4: 720 };
    return table[t] ?? 720 + (t - 4) * 220;
  };

  const floor = Math.floor(tier);
  if (tier === floor) return lookup(floor);
  const frac = tier - floor;
  return lookup(floor) + frac * (lookup(floor + 1) - lookup(floor));
}

// ---------------------------------------------------------------------------
// Layout computation (mirrors bundle `Ut`)
// ---------------------------------------------------------------------------

export function computeLayout(): LayoutResult {
  // Group entities by tier.
  const tierGroups = new Map<number, string[]>();
  for (const [id, tier] of TIER_MAP) {
    if (!tierGroups.has(tier)) tierGroups.set(tier, []);
    tierGroups.get(tier)!.push(id);
  }

  const positions = new Map<string, { x: number; y: number }>();
  const nodeAngles = new Map<string, number>();
  const rings = new Map<number, RingData>();

  // PM is always at centre.
  positions.set('pm', { x: 0, y: 0 });
  nodeAngles.set('pm', 0);

  // Process tiers in ascending order.
  const sortedTiers = [...tierGroups.keys()].sort((a, b) => a - b);

  for (const tier of sortedTiers) {
    const ids = (tierGroups.get(tier) ?? []).filter((id) => id !== 'pm');
    const count = ids.length;
    if (count === 0) continue;

    const radius = tierRadius(tier);

    // Compute desired angle for each entity as the circular mean of its
    // parents' already-assigned angles.
    const desiredAngle = new Map<string, number>();
    for (const id of ids) {
      const parentAngles: number[] = [];
      for (const pid of parentsOf.get(id) ?? []) {
        if (nodeAngles.has(pid)) parentAngles.push(nodeAngles.get(pid)!);
      }
      desiredAngle.set(
        id,
        parentAngles.length > 0 ? circularMean(parentAngles) : -Math.PI / 2,
      );
    }

    // Sort entities by their normalised desired angle.
    ids.sort((a, b) => {
      return normaliseAngle(desiredAngle.get(a)!) - normaliseAngle(desiredAngle.get(b)!);
    });

    const step = (2 * Math.PI) / count;

    // Find the rotation offset that minimises total angular error.
    let bestOffset = 0;
    let bestError = Infinity;
    for (let k = 0; k < count; k++) {
      let error = 0;
      for (let j = 0; j < count; j++) {
        const slotAngle = normaliseAngle(step * ((j + k) % count));
        const desired = normaliseAngle(desiredAngle.get(ids[j])!);
        let diff = Math.abs(slotAngle - desired);
        if (diff > Math.PI) diff = 2 * Math.PI - diff;
        error += diff;
      }
      if (error < bestError) {
        bestError = error;
        bestOffset = k;
      }
    }

    // Assign positions.
    for (let j = 0; j < count; j++) {
      const angle = step * ((j + bestOffset) % count);
      const id = ids[j];
      positions.set(id, {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      });
      nodeAngles.set(id, angle);
    }

    rings.set(tier, {
      tier,
      radius,
      orderedIds: [...ids],
      step,
      baseRotation: bestOffset,
    });
  }

  return { positions, nodeAngles, rings };
}

export const LAYOUT = computeLayout();
