/**
 * Shared Supabase client type for use in service functions.
 * Accepts any Supabase client instance (browser or server).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnySupabaseClient = import('@supabase/supabase-js').SupabaseClient<any, any, any>;
