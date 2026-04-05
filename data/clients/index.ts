import { RWE_CONFIG } from './rwe';
import { SANOFI_CONFIG } from './sanofi';
import type { ClientConfig } from '@/types/client';

export const ALL_CLIENTS: ClientConfig[] = [RWE_CONFIG, SANOFI_CONFIG];

export function getClientBySlug(slug: string): ClientConfig | undefined {
  return ALL_CLIENTS.find((c) => c.id === slug);
}
