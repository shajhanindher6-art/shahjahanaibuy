// ============================================================================
// Supabase Edge Function: price-drop-notify
// ============================================================================
// What it does:
//   When invoked (manually, or on a schedule via Supabase's pg_cron /
//   scheduled-function tooling), it calls the app's existing price
//   alert checker, POST /api/v1/alerts/check. That endpoint already
//   does the whole price-drop email flow:
//     1. services/alert-checker.ts compares every active alert with
//        the latest price_history row (with a duplicate-trigger
//        cooldown via price_alert_history, so one price drop sends
//        one notification, not one per run).
//     2. services/notification-dispatch.ts drains notification_queue
//        and sends the email via Resend (services/email.ts
//        sendPriceAlertEmail), with exponential-backoff retries.
//   This function deliberately does NOT duplicate that logic in
//   Deno, and it does NOT send email itself.
//
// Why no database trigger on price_history?
//   A trigger would need pg_net + the Resend secret stored in the
//   database, and it would duplicate the checker's dedup and
//   retry logic for every inserted row. Delegating to the checker
//   keeps one code path for "price dropped -> email sent".
//
// Deploy (run by the project owner, secrets never committed):
//   supabase functions deploy price-drop-notify
//   supabase secrets set APP_URL=https://aismartbuy.netlify.app \
//     CRON_SECRET=<the same CRON_SECRET set in Netlify>
//   Then invoke it on a schedule (or call it once manually to test).
//
// Required environment (function secrets):
//   APP_URL     — the deployed SmartBuy AI origin, no trailing slash.
//   CRON_SECRET — must match the CRON_SECRET in Netlify, because
//                 /api/v1/alerts/check requires that Bearer token.
//   (SUPABASE_SERVICE_ROLE_KEY and RESEND_API_KEY must already be
//   set in Netlify for the checker / email legs to run; if either
//   is missing, the checker returns a clear error instead of
//   silently checking zero alerts or dropping emails.)
// ============================================================================

// Deno runtime globals are provided by Supabase Edge Functions;
// this file is not typechecked by the Next.js build (no tsconfig
// covers supabase/functions), so it is intentionally dependency-free.
declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response> | Response): void;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async () => {
  const appUrl = Deno.env.get('APP_URL')?.replace(/\/$/, '');
  const cronSecret = Deno.env.get('CRON_SECRET');

  if (!appUrl || !cronSecret) {
    return json(
      {
        success: false,
        error:
          'APP_URL and CRON_SECRET function secrets are required. Set them with: supabase secrets set APP_URL=... CRON_SECRET=...',
      },
      500
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${appUrl}/api/v1/alerts/check`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cronSecret}` },
    });
  } catch (err) {
    return json(
      { success: false, error: `Could not reach ${appUrl}/api/v1/alerts/check`, detail: String(err) },
      502
    );
  }

  const data = await upstream.json().catch(() => null);
  return json(
    {
      success: upstream.ok,
      checkerStatus: upstream.status,
      result: data,
    },
    upstream.ok ? 200 : upstream.status
  );
});
