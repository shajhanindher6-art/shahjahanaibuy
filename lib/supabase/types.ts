/**
 * Shared Supabase client type for use in service functions.
 * Accepts any Supabase client instance (browser or server).
 */

export type AnySupabaseClient = import('@supabase/supabase-js').SupabaseClient<any, any, any>;
