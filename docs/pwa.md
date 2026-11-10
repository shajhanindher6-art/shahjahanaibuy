# SmartBuy AI — PWA

**Date:** 10 November 2026 (Section 2 item 29 / Section 3 item 9)
**Status:** install prompt + offline basics shipped; no permission changes.

## What exists

| Piece | File | Notes |
|---|---|---|
| Manifest | `public/manifest.json` | name "SmartBuy AI — AI-Powered Shopping Intelligence", `short_name` SmartBuy, `display: standalone`, `theme_color #1e40af`, `background_color #0f172a`, icons 192 + 512 (`purpose: any maskable`) |
| Icons | `public/icon-192.png`, `public/icon-512.png` | Exist; the old 404 is fixed |
| Service worker | `public/sw.js` (cache `smartbuy-v2`) | See caching strategy below |
| Registration | `components/pwa/service-worker-register.tsx` | Registers `/sw.js` in production only; silent failure |
| Install prompt | `components/pwa/install-prompt.tsx` | `beforeinstallprompt`, dismissible, honest (below) |
| Offline page | `app/offline/page.tsx` | Served by the SW when a navigation fails offline |

The root layout (`app/layout.tsx`) links the manifest, sets
`theme-color` / Apple web-app meta tags, and renders
`ServiceWorkerRegister` + `InstallPrompt` inside `Providers`.

## Install prompt

- Listens for the browser's `beforeinstallprompt` event (Chromium
  desktop + Android). `event.preventDefault()` suppresses the
  browser's automatic mini-infobar so the visitor sees one prompt,
  not two.
- Shows a dismissible card (bottom-left, above content): **Install**
  calls the deferred prompt; **Not now** / ✕ hides it and writes
  `sb-pwa-install-dismissed=1` to localStorage, so it never shows
  again in that browser.
- `appinstalled` hides the card. In standalone (installed) mode, or
  on browsers without `beforeinstallprompt` (e.g. iOS Safari), the
  component renders nothing — there is no fake install button.
- **Honest copy:** the card says pages already visited "keep working
  offline" and that live prices need a connection. It never claims
  the app works fully offline.
- Limitation: the event can only be caught after this component
  mounts. It mounts in the root layout, so in practice the prompt is
  registered before the browser fires the event; if a browser ever
  fires it earlier, that visit simply shows no card (the browser's
  own install UI still works).
- No permission changes: installation is a user gesture, and the
  service worker only caches same-origin pages/assets.

## Caching strategy (`public/sw.js`)

- **Install:** precaches `/`, `/search`, `/compare`, `/deals`,
  `/manifest.json`, `/robots.txt`, `/offline`. (If any precache
  fetch fails, the whole `cache.addAll` fails — the shell pages
  above are all served by the app, so this is expected to succeed.)
- **Images:** stale-while-revalidate (serve cache, refresh in
  background).
- **Navigations:** network-first; on failure, serve the cached
  response for that URL, else the `/offline` page.
- **Other static assets:** cache-first.
- **Never cached:** `/api/*` requests (always network) — prices,
  alerts and search results are never served stale.
- **Push:** `push` / `notificationclick` handlers exist for
  signed-in web-push alerts (VAPID wiring is separate; see the
  alert docs). The service worker itself sends no notification
  without a push event.
- **Updates:** `SKIP_WAITING` message handler; a new worker takes
  over on next navigation. Bump `CACHE_VERSION` when the shell
  changes (currently `smartbuy-v2`).

## What the PWA does NOT do (honest limits)

- No app-store listing; installation is browser-based only.
- Offline mode covers cached shell pages and images only. Product
  data, prices, search, compare results, alerts and checkout links
  all need a connection — the offline page says so.
- No background sync, no offline wishlist/alert queue (future work
  if the PWA becomes a priority).
- iOS: no `beforeinstallprompt` — Safari users install via
  Share → Add to Home Screen; the app does not (and cannot) prompt
  them. The manifest + Apple meta tags are in place for that flow.

## Verifying (manual — no automated test covers the SW)

1. Production build on the live site (SW only registers when
   `NODE_ENV === 'production'`).
2. Open DevTools → Application → Service Workers: `/sw.js` active.
3. Application → Manifest: no errors, icons load.
4. In Chrome, the install card appears on first visit (or use
   DevTools → Application → Manifest → "Install" / the
   `beforeinstallprompt` simulation). Dismiss → reload → card stays
   hidden. Clear `sb-pwa-install-dismissed` in localStorage to
   re-test.
5. DevTools → Network → Offline → reload a visited page: cached
   version serves; reload an unvisited page: `/offline` serves.
