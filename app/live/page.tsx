/**
 * Live shopping sessions index — /live.
 *
 * Lists scheduled live shopping sessions from the live_shopping_sessions
 * table (migration 033). Until that migration runs, the honest empty
 * state below is shown — no sessions, schedules, or stream URLs are
 * ever invented. Status is derived from dates + stream_url presence
 * (see lib/live-sessions.ts); SmartBuy hosts no stream and embeds
 * none — a session links OUT to the provider's stream.
 */

import Link from 'next/link';
import { Radio } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { EventCountdown } from '@/components/seasonal/countdown';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getLiveSessions, liveSessionStatusLabel } from '@/lib/live-sessions';

export const dynamic = 'force-dynamic';

export default async function LiveSessionsPage() {
  const supabase = await createSupabaseServerClient();
  const { sessions, liveEnabled } = await getLiveSessions(supabase);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Radio className="h-7 w-7 text-blue-600" /> Live shopping
          </h1>
          <p className="mt-2 text-muted-foreground">
            Scheduled live shopping sessions — a host walks through real
            products, and every product shown links to its product page
            with its real current price. SmartBuy does not host the video:
            when a session is live, the session page links out to the
            stream on the provider&apos;s own site.
          </p>

          {!liveEnabled ? (
            <div className="mt-8 rounded-lg border p-6">
              <p className="font-medium">No live shopping sessions scheduled yet.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Live shopping is not set up yet. Sessions will appear here
                once they are scheduled — nothing is listed until a real
                session with a real date exists.
              </p>
            </div>
          ) : sessions.length === 0 ? (
            <div className="mt-8 rounded-lg border p-6">
              <p className="font-medium">No live shopping sessions scheduled yet.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Check back later, or browse the{' '}
                <Link href="/deals" className="underline">
                  deals page
                </Link>{' '}
                for what is available right now.
              </p>
            </div>
          ) : (
            <div className="mt-8 space-y-4">
              {sessions.map((session) => (
                <article key={session.id} className="rounded-lg border p-6">
                  <p className="text-sm font-medium text-muted-foreground">
                    {liveSessionStatusLabel(session.status)}
                  </p>
                  <h2 className="mt-1 text-xl font-semibold">
                    <Link
                      href={`/live/${session.slug}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {session.title}
                    </Link>
                  </h2>
                  {session.hostNote ? (
                    <p className="mt-1 text-sm text-muted-foreground">{session.hostNote}</p>
                  ) : null}
                  <p className="mt-2 text-sm text-muted-foreground">
                    Starts{' '}
                    <time dateTime={session.startsAt}>
                      {new Date(session.startsAt).toLocaleDateString('en-US', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </time>
                  </p>
                  {session.status === 'upcoming' ? (
                    <EventCountdown targetIso={session.startsAt} label={session.title} />
                  ) : null}
                  <Link
                    href={`/live/${session.slug}`}
                    className="mt-4 inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                  >
                    View session →
                  </Link>
                </article>
              ))}
            </div>
          )}

          <p className="mt-8 text-sm text-muted-foreground">
            Want a reminder when a product in a session drops to the price
            you would actually pay? That uses the same price-drop alerts as
            the rest of the site — open the product, sign in, and set an
            alert. There is no separate live-session alert system.
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
