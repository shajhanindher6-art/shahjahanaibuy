/**
 * Browser-side Supabase client singleton.
 * Uses the anon key — RLS policies enforce data isolation.
 */

import { createBrowserClient } from '@supabase/ssr';
import { env } from '@/lib/config/env';

export function createClient() {
  return createBrowserClient(env.supabaseUrl, env.supabaseAnonKey);
}

let client: ReturnType<typeof createClient> | null = null;

export function getSupabaseBrowserClient() {
  if (!client) {
    client = createClient();
  }
  return client;
}
