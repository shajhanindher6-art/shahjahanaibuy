// ============================================================================
// Supabase Edge Function: price-refresh-worker
// ============================================================================
// What it does:
//   When invoked (manually, or on a schedule), it calls the app's
//   scheduled price pipeline, POST /api/v1/prices/refresh. That endpoint
//   runs the whole chain in one call:
//     1. services/price-refresh.ts records any changed catalog price
//        for alerted / wishlisted products as a new price_history row
//        (unchanged prices create no row, so graphs show no fake moves).
//     2. services/alert-checker.ts compares active alerts with the new
//        prices (one notification per distinct triggered price).
//     3. services/notification-dispatch.ts drains the queue and sends
//        the price-drop email via Resend (services/email.ts).
//
// How it differs from the older price-drop-notify function:
//   price-drop-notify only runs step 2+3 against price_history rows
//   that already exist. If no new row ever arrived, a real drop could
//   never be noticed. This worker runs step 1 first, so it is the one
//   to schedule. price-drop-notify is left in place for callers that
//   already invoke it; do not schedule both for the same cadence, or
//   the checker will run twice (dedup keeps emails to one per price,
//   but the extra run is wasted work).
//
// What it does NOT do:
//   It does not scrape retailer websites itself and does not invent
//   prices. The "current price" in step 1 is the lowest in-stock
//   merchant_products row, as last synced by the existing provider
//   pipeline (Apify / CSV / merchant upload). Live retailer scraping
//   still needs that pipeline's provider keys configured.
//
// Deploy (run by the project owner, secrets never committed):
//   supabase functions deploy price-refresh-worker
//   supabase secrets set APP_URL=https://aismartbuy.netlify.app \
//     CRON_SECRET=<value already in Netlify>
//   Then invoke it on a schedule (or call it once manually to test).
//   Alternative free scheduler (no Supabase schedule needed): the
//   GitHub Actions workflow .github/workflows/price-refresh.yml calls
//   the same endpoint directly — pick ONE scheduler, not both.
//
// Required environment (function secrets):
//   APP_URL     — the deployed SmartBuy AI origin, no trailing slash.
//   CRON_SECRET — must match the CRON_SECRET in Netlify, because
//                 /api/v1/prices/refresh requires that Bearer token.
//   (SUPABASE_SERVICE_ROLE_KEY and RESEND_API_KEY must already be
//   set in Netlify for the refresh / email legs to run; if either
//   is missing, the endpoint returns a clear error instead of
//   silently checking zero alerts or dropping emails.)
// ============================================================================

// Deno runtime globals are provided by Supabase Edge Functions.
// This file is a module (see `export {}` at the bottom), so its
// `Deno` declaration and `json` helper are module-scoped and do not
// clash with the older price-drop-notify script, which the project's
// tsconfig (include: **/*.ts) also typechecks. It is intentionally
// dependency-free.
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
          'APP_URL and CRON_SECRET function secrets are required. Set them with: supabase secrets set APP_URL=... CRON_SECRET=<value already in Netlify>',
      },
      500
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${appUrl}/api/v1/prices/refresh`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cronSecret}` },
    });
  } catch (err) {
    return json(
      { success: false, error: `Could not reach ${appUrl}/api/v1/prices/refresh`, detail: String(err) },
      502
    );
  }

  const text = await upstream.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    // Keep the raw upstream body if it is not JSON.
  }

  return json({ success: upstream.ok, upstreamStatus: upstream.status, result: data }, upstream.ok ? 200 : 502);
});

// Module scope (see header): keeps this file's Deno/json declarations
// from colliding with supabase/functions/price-drop-notify/index.ts
// under the project's tsconfig.
export {};
