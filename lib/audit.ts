/**
 * Audit logging — records security-relevant events.
 * Pre-auth: logs anonymously (no user attribution).
 */

import { supabase } from '@/lib/db';

export async function logAudit(
  action: string,
  resourceType?: string,
  resourceId?: string,
  metadata?: Record<string, unknown>,
  request?: Request,
) {
  const ip =
    request?.headers.get('x-forwarded-for') ||
    request?.headers.get('x-real-ip') ||
    'unknown';

  try {
    await supabase.from('audit_log').insert({
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      metadata,
      ip_address: ip,
    });
  } catch (err) {
    // Audit logging should never break the request
    console.error('[audit] Failed to log:', err);
  }
}
