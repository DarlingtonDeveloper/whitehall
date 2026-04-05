import type { StaffProfile } from '@/types/entity';
import _staff from './_extracted/staff.json';

export const STAFF = _staff as Record<string, StaffProfile>;

/**
 * Look up the staff profile for a given entity id.
 */
export function getStaff(entityId: string): StaffProfile | undefined {
  return STAFF[entityId];
}
