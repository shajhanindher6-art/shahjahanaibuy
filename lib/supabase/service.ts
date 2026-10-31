/**
 * Server-only Supabase service-role client.
 *
 * Bypasses Row Level Security. Use ONLY in server-side cron/admin code
 * that must read rows belonging to many users (for example the price
 * alert checker, which reads every user's active alerts). Never import
 * this file from client components, and never expose the service-role
 * key to the browser — it is only read from SUPABASE_SERVICE_ROLE_KEY
 * on the server.
 *
 * Returns null when SUPABASE_SERVICE_ROLE_KEY is not configured, so
 * callers can fail with a clear message instead of silently running
 * as the anon role and seeing zero rows.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/config/env';

let cached: SupabaseClient | null = null;

export function createSupabaseServiceClient(): SupabaseClient | null {
  if (!env.supabaseServiceRoleKey) {
    return null;
  }

  if (!cached) {
    cached = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return cached;
}
