import type { PowerRecord } from '@/types/entity';
import _powers from './_extracted/powers.json';

export const POWERS = _powers as Record<string, PowerRecord>;

/**
 * Look up the power record for a given entity id.
 */
export function getPowers(entityId: string): PowerRecord | undefined {
  return POWERS[entityId];
}
