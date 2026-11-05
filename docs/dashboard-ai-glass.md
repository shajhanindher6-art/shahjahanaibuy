# Dashboard — AI Glass redesign (Premium 2)

User chose **Premium 2 — AI Glass** for the dashboard. The dashboard was
previously plain cards + tabs: 4 stat cards, quick actions, AI
recommendations, recent searches. This redesign keeps every existing
section and adds the approved concept: an AI sidebar, Active Deals,
Upcoming Deals, and Drops to Watch — with glass styling and
animations, and no new dependencies.

## What changed

### Layout — `app/dashboard/page.tsx`
- Two-column grid on large screens: **340px AI sidebar + main content**.
  On mobile the sidebar stacks **below** the main content.
- Glass hero (blue → violet → fuchsia gradient header, role badge kept).
- Existing sections kept with identical data behaviour: recommendations
  (limit 4), search history (limit 5), tracking summary. A failed fetch
  still hides its section instead of showing demo numbers.

### AI sidebar — `components/dashboard/ai-sidebar.tsx`
- **AI chat panel** (`components/dashboard/ai-chat-panel.tsx`): a compact
  embedded chat calling the SAME public endpoint as the floating AI Deal
  Finder widget (`POST /api/v1/deal-finder` with `{message, country}`).
  No second AI, no new backend. Same honest error fallbacks as the
  widget. Suggested prompt chips included.
- **AI picks for you**: top 3 recommendations, passed down from the page
  (no extra request).
- **Drops to watch mini-summary**: top 2 simulated drops with a link to
  the full section (`#drops-to-watch`).

### Animated stats — `components/dashboard/animated-stat.tsx`
- `useCountUp`: numbers count up 0 → real value over ~900ms (ease-out).
  The value is always the real count from the user's own tracking data.
- `prefers-reduced-motion` users see the final value immediately.

### Active Deals — `components/dashboard/active-deals-section.tsx`
- `GET /api/v1/smart-deals?limit=6` (product, discount, current price,
  reason) joined with `GET /api/v1/deals?pageSize=20` for the real
  `end_at` countdown per product.
- Countdown (`services/dashboard-helpers.ts` `formatDealCountdown`):
  "Ends in 3d 4h" / "Ends today" / "Ended". A deal with no matching
  table row shows no countdown — never a guessed date.

### Upcoming Deals — `components/dashboard/upcoming-deals-section.tsx`
- `GET /api/v1/deals?status=upcoming` — see the new `upcoming` filter
  below. "Starts in Xd" from the real `start_at`
  (`formatDealStartsIn`).
- **Honest empty state (current reality):** there are no scheduled
  upcoming deals today — all seed deals started in the past — so the
  section says "No upcoming deals scheduled yet". It fills the moment
  the owner or the community adds a future-dated deal. No future deal
  is invented.

### Drops to Watch — `components/dashboard/drops-to-watch-section.tsx`
  + `app/api/v1/dashboard/drops-to-watch/route.ts`
- Auth required, owner-scoped. Takes the user's tracked products
  (max 6) via `getUserTracking`, runs the **existing Option 10
  drop-window simulator** (`simulateDropWindow`) over each product's
  real price history (`getCachedPriceHistory`, limit 100), and returns
  only `status === 'simulated'` (`qualifiesAsDropToWatch`).
- The page fetches this once and passes it to both the sidebar mini
  summary and the full section — exactly one request.
- Every value is labelled simulated: windowDays and the target range
  are ranges, never a single date or price, with "Simulated — not a
  forecast or a guarantee" on every render.

### New `upcoming` filter — `services/commerce.ts` + `app/api/v1/deals/route.ts`
- `getDeals` accepts `upcoming?: boolean` (adds `start_at > now`,
  orders by `start_at` ascending, soonest first).
- `GET /api/v1/deals?status=upcoming` exposes it. Existing callers are
  unaffected (the option is opt-in).

### Styles — `app/globals.css` + `tailwind.config.ts`
- `.glass-card` utility: translucent white / slate, soft border,
  `backdrop-blur-xl`, rounded-2xl, soft shadow.
- `animate-shimmer` (skeleton loading) added to the Tailwind keyframes.
  `animate-fade-in` (already in the config) is used with staggered
  `animationDelay` per section/card, plus `motion-reduce:animate-none`.
- Global `prefers-reduced-motion` rule in `globals.css` disables
  animations site-wide for users who ask for it.
- No new dependency was added (no framer-motion): count-up is a small
  `requestAnimationFrame` hook, charts keep Recharts' built-in
  animation, the rest is CSS/Tailwind.

## What is deliberately NOT built
- No fake upcoming deals, no invented countdown dates, no AI answer
  that isn't from the real deal-finder endpoint.
- No hiding of the floating AI widget on the dashboard: the sidebar
  chat and the floating button both exist on this page. A follow-up
  could hide the floating button on `/dashboard` if the overlap
  bothers the owner.
- The dashboard is still signed-in only. Visitors see the homepage;
  the same glass look can be applied there as a separate step (the
  Smart Deals widget already shows active deals to visitors).

## Verification
- `tsc --noEmit`: 0 errors.
- Production build (placeholder env): pass; new route
  `/api/v1/dashboard/drops-to-watch` registered.
- Logic tests on `services/dashboard-helpers.ts` (compiled copy in
  /tmp, node assertions): **6/6 PASS** — countdown days/hours, today,
  ended, invalid date, starts-in, drop qualifier.
- Live verification still pending after push + deploy: the dashboard
  is signed-in only, so the owner must check it with a signed-in
  account (read-only constraint: no test account exists yet).
