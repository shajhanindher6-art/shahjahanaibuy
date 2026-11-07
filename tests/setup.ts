// Test setup: placeholder env vars only. The modules under test are
// pure (no network, no database), but importing them can pull in
// lib/config/env.ts, which requires NEXT_PUBLIC_SUPABASE_URL at import
// time. These placeholders satisfy that check; no real service is
// ever contacted by the tests.
process.env.NEXT_PUBLIC_SUPABASE_URL ??=
  'https://placeholder.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'placeholder-anon-key';
