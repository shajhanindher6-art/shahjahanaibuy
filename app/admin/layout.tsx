/**
 * Admin layout — server-side guard.
 *
 * The admin page used to rely on a client-side role check, so the
 * shell rendered for everyone and only the data calls decided what
 * a visitor could see. This layout enforces it on the server before
 * anything renders: no session → /sign-in; signed in but not admin
 * → /dashboard. Fail closed: a missing service client or a missing
 * profile also redirects away, never through.
 */

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const service = createSupabaseServiceClient();
  const { data: profile } = service
    ? await service.from('profiles').select('role').eq('id', user.id).single()
    : { data: null };
  if ((profile as { role?: unknown } | null)?.role !== 'admin') {
    redirect('/dashboard');
  }

  return <>{children}</>;
}
