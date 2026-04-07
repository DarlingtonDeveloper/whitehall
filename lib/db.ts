import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!;

/** Client-side Supabase client (read-only, RLS-enforced). */
export const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Server-side Supabase client with full access (bypasses RLS).
 * Only use in API routes — never import in client components.
 */
export function getServiceClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    // Fall back to publishable key if service key not configured (POC mode)
    return supabase;
  }
  return createClient(supabaseUrl, serviceKey);
}
