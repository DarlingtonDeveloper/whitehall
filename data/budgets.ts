import type { BudgetProfile } from '@/types/entity';
import _budgets from './_extracted/budgets.json';

export const BUDGETS = _budgets as Record<string, BudgetProfile>;

/**
 * Look up the budget profile for a given entity id.
 */
export function getBudget(entityId: string): BudgetProfile | undefined {
  return BUDGETS[entityId];
}
