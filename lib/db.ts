import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Missing required env vars: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY must be set. See .env.example.',
  );
}

// After the guard, TypeScript needs explicit assertion for module-scope narrowing
const SUPABASE_URL: string = supabaseUrl;
const SUPABASE_KEY: string = supabaseKey;

/** Client-side Supabase client (read-only, RLS-enforced). */
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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
  return createClient(SUPABASE_URL, serviceKey);
}
