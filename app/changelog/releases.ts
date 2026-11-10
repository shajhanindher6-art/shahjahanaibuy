/**
 * Changelog release list — built from the real sync record
 * (shahjahanaibuy.muse-github-snapshot-sync.json, 55 entries).
 *
 * HONESTY NOTE: the sync record contains commit SHAs and changed
 * file paths only — no dates and no commit messages. Dates below
 * are shown ONLY where the project log confirms them; every other
 * entry is labelled 'Date not recorded in the sync record'. Titles
 * are short descriptions derived from the changed files, not
 * commit messages — the record has none to quote.
 */

export interface ChangelogRelease {
  sha: string;
  title: string;
  /** ISO date, only when the project log confirms it. */
  date?: string;
  paths: string[];
}

export const RELEASES: ChangelogRelease[] = [
  {
    sha: '41b520290b8d83af71202f4c63036f7cb30e7cb1',
    title: "Public pages, layout, sitemap, and support pages",
    paths: ["app/about/page.tsx", "app/blog/page.tsx", "app/contact/page.tsx", "app/cookies/page.tsx", "app/docs/page.tsx", "app/layout.tsx", "app/privacy/page.tsx", "app/sitemap.ts", "app/support/page.tsx", "app/terms/page.tsx"],
  },
  {
    sha: 'ff517e3d4483f75974dfbe90c4925eaa1727ac96',
    title: "Deployment preparation and environment example",
    paths: [".env.example", "DEPLOYMENT_PREP.md"],
  },
  {
    sha: 'c752597588c92e6278506709c4e12e9f9a1738b7',
    title: "Product page and app configuration",
    paths: ["app/products/[slug]/page.tsx", "lib/config/app.ts"],
  },
  {
    sha: 'af506315ce414997df5526943314787da1d109cf',
    title: "Search, compare, and product services",
    paths: ["app/search/page.tsx", "app/compare/page.tsx", "services/products.ts"],
  },
  {
    sha: '3c3ae12231ef5a3249f1171276bb6c84c72555c5',
    title: "Search, deals, compare, and product page",
    paths: ["app/search/page.tsx", "app/deals/page.tsx", "app/compare/page.tsx", "app/products/[slug]/page.tsx"],
  },
  {
    sha: '82103df0f7343a2177c4b9c49efcbbddede70c89',
    title: "Product page",
    paths: ["app/products/[slug]/page.tsx"],
  },
  {
    sha: 'b4680ee745507305e46cd680aa2f768a4ef5dd78',
    title: "Demo seed data",
    paths: ["supabase/seed-demo-data.sql"],
  },
  {
    sha: 'abcc151913ef21c0cc9d20b9c7dadeb650edfac1',
    title: "Seed diagnostics and merchant/deal seed, part 2",
    paths: ["supabase/diagnose-seed.sql", "supabase/seed-part2-merchants-deals.sql"],
  },
  {
    sha: '041d5b5c1164ee754de1aeea3e4c14f93c4af8ee',
    title: "Public catalog access rules (RLS fix)",
    paths: ["supabase/fix-public-catalog-rls.sql"],
  },
  {
    sha: '3945a39b69c0f5cdce3996b548b570e7b9f4598e',
    title: "Price history URL column fix",
    paths: ["supabase/fix-price-history-url-column.sql"],
  },
  {
    sha: '13ece9ac5f561cde2a133fd7f5384709719b05a7',
    title: "Alerts check, review summaries, and notifications",
    paths: ["lib/supabase/service.ts", "services/alert-checker.ts", "app/api/v1/alerts/check/route.ts", "services/review-summary.ts", "app/api/v1/products/[slug]/review-summary/route.ts", "services/notification-dispatch.ts", "services/index.ts", "types/ai.ts", "types/index.ts", "app/products/[slug]/page.tsx"],
  },
  {
    sha: 'e8cf5686e4d526b9cfa593665a12123f54156f7f',
    title: "AI review summarizer component",
    paths: ["components/products/ai-review-summarizer.tsx", "types/ai.ts", "services/review-summary.ts", "app/api/v1/products/[slug]/review-summary/route.ts", "app/products/[slug]/page.tsx"],
  },
  {
    sha: 'ea281d44f6a4f22bec224fed6270100ee8c31f46',
    title: "Price history graph and public wishlist sharing",
    paths: ["components/products/price-history-graph.tsx", "app/products/[slug]/page.tsx", "services/wishlists.ts", "services/index.ts", "app/api/v1/shared-wishlists/[id]/route.ts", "app/wishlists/[id]/page.tsx", "app/dashboard/wishlists/page.tsx", "supabase/add-public-wishlist-sharing-rls.sql"],
  },
  {
    sha: 'b1839dadbbfc58b513067810ff11985bbaaa6b9b',
    title: "AI deal-finder, bookmarklet, track page, and reviews",
    paths: ["app/api/v1/deal-finder/route.ts", "components/chat/ai-deal-finder-widget.tsx", "app/layout.tsx", "supabase/functions/price-drop-notify/index.ts", "public/bookmarklet.js", "app/bookmarklet/page.tsx", "app/track/page.tsx", "components/products/review-form.tsx", "app/products/[slug]/page.tsx", "app/api/v1/products/[slug]/reviews/route.ts"],
  },
  {
    sha: 'fe0fa58d1b6909c85531ae1143cbcdd5c7408de8',
    title: "Price refresh, smart deals, and tracking dashboard",
    paths: ["components/products/price-history-graph.tsx", "components/products/price-trend-sparkline.tsx", "services/price-refresh.ts", "app/api/v1/prices/refresh/route.ts", "supabase/functions/price-refresh-worker/index.ts", "services/smart-deals.ts", "app/api/v1/smart-deals/route.ts", "components/deals/smart-deal-widget.tsx", "services/tracking.ts", "app/api/v1/tracking/route.ts", "app/dashboard/tracking/page.tsx", "components/layout/dashboard-sidebar.tsx", "services/index.ts", "app/page.tsx", "tsconfig.json"],
  },
  {
    sha: '2c005f49e3ddccba546e73563159e0586ad20bae',
    title: "AI summaries and smart deal widget",
    paths: ["components/products/price-history-graph.tsx", "services/ai-summary.ts", "components/products/product-card.tsx", "services/smart-deals.ts", "components/deals/smart-deal-widget.tsx", "app/products/[slug]/page.tsx"],
  },
  {
    sha: '38bb8f582c40b0974764f578296aed4fb91701d4',
    title: "External search cache and AI search API",
    paths: ["services/external-search.ts", "supabase/migrations/20261101120000_016_external_search_cache.sql", "types/ai.ts", "lib/config/env.ts", ".env.example", "app/api/v1/ai-search/route.ts", "app/search/page.tsx", "services/index.ts"],
  },
  {
    sha: '9611f5d6e5bf4532589055a76a1a8989553c1247',
    title: "Currency, AI search, and chat services",
    paths: ["services/currency.ts", "services/ai-search.ts", "types/ai.ts", "services/chat.ts", "services/external-search.ts", "app/api/v1/ai-search/route.ts", "services/index.ts", "app/search/page.tsx"],
  },
  {
    sha: 'd08a452fb4731d906d4d64a78bf75fa234fdca66',
    title: "AI deals, smart deals, and merchant listings",
    paths: ["services/price-history.ts", "services/ai-search.ts", "types/ai.ts", "services/ai-deals.ts", "services/smart-deals.ts", "services/chat.ts", "app/search/page.tsx", "app/deals/page.tsx", "components/deals/smart-deal-widget.tsx", "app/products/[slug]/page.tsx", "app/api/v1/products/[slug]/merchants/route.ts", "services/index.ts"],
  },
  {
    sha: 'c6aadbb527a85f4641c5291c4ec6e154a811ac1f',
    title: "AI search service",
    paths: ["services/ai-search.ts", "types/ai.ts", "app/search/page.tsx"],
  },
  {
    sha: 'd9558458bba3a33b25f22c684067d7d792ec6322',
    title: "AI search, deals, and homepage stats",
    paths: ["app/api/v1/ai-search/route.ts", "app/search/page.tsx", "app/deals/page.tsx", "app/products/[slug]/page.tsx", "components/chat/ai-deal-finder-widget.tsx", "app/page.tsx", "components/home/stats-bar.tsx"],
  },
  {
    sha: 'a385799d1de7ff7cfc3896e92d1e36b9063419f0',
    title: "Browser extension (content script, manifest, popup) and hub page",
    paths: ["extension/content.js", "extension/manifest.json", "extension/popup.html", "app/extension/page.tsx"],
  },
  {
    sha: '1ed1f2e45717e4ea756a43a83b15d09fef2a9fd6',
    title: "Search page",
    paths: ["app/search/page.tsx"],
  },
  {
    sha: '17239104da0c415a8ddc55dc03b503b3b59e28b0',
    title: "Search page",
    paths: ["app/search/page.tsx"],
  },
  {
    sha: 'd4345bf8b95928a99ff19558e36f9f5bfb85c48b',
    title: "Dependencies update",
    paths: ["package.json", "package-lock.json"],
  },
  {
    sha: '9f610e48b6455bceed0ebb2ab210e3837aac1299',
    title: "Regions, languages, and country switcher (60 regions, 8 languages)",
    paths: ["lib/region.ts", "lib/i18n.ts", "components/region/region-provider.tsx", "components/region/price.tsx", "components/region/country-switcher.tsx", "components/region/region-banner.tsx", "components/home/hero-copy.tsx", "middleware.ts", "components/providers/index.tsx", "components/layout/site-header.tsx", "app/page.tsx", "app/search/page.tsx", "app/products/[slug]/page.tsx", "app/deals/page.tsx", "components/deals/smart-deal-widget.tsx", "app/compare/page.tsx", "components/products/product-card.tsx"],
  },
  {
    sha: '62230277dafdd4bf3d86eb013f4af53083eb7587',
    title: "Personal assistant and AI recommendations",
    paths: ["services/personal-assistant.ts", "services/chat.ts", "app/api/v1/deal-finder/route.ts", "components/chat/ai-deal-finder-widget.tsx", "services/ai-recommendations.ts"],
  },
  {
    sha: 'f5c1f14fc7dcba02013b20ccc17d7ac53d440cf2',
    title: "AI comparison service",
    paths: ["types/ai.ts", "services/ai-comparison.ts", "app/compare/page.tsx"],
  },
  {
    sha: '9978d547762b24a5e300b718c69531da84defbef',
    title: "Store directory and country stores",
    paths: ["lib/stores.ts", "app/products/[slug]/page.tsx", "supabase/add-country-stores-directory.sql"],
  },
  {
    sha: '87721c935578fdb308768d83d78417aa0b721eab',
    date: '2026-11-02',
    title: "Global expansion: 70 stores, 58 markets, 60 regions, 37 currencies",
    paths: ["lib/stores.ts", "lib/region.ts", "services/currency.ts", "components/region/region-provider.tsx", "components/region/country-switcher.tsx", "app/products/[slug]/page.tsx", "supabase/add-country-stores-directory.sql"],
  },
  {
    sha: '92a1b16552394eeaa8070c8a4aff4bcb823ed211',
    title: "Community deals and SmartPools APIs",
    paths: ["app/api/v1/community-deals/route.ts", "app/api/v1/pools/route.ts"],
  },
  {
    sha: '8651f05e39be816dd7d09abe502178835a87eb57',
    title: "Community deals and SmartPools APIs",
    paths: ["app/api/v1/community-deals/route.ts", "app/api/v1/pools/route.ts"],
  },
  {
    sha: '1372c25f6d3150d7e680009bb959640729221735',
    title: "Live FX rates, landed-cost calculator, and region arbitrage",
    paths: ["services/fx-rates.ts", "app/api/v1/fx-rates/route.ts", "components/products/landed-cost-calculator.tsx", "components/products/region-arbitrage-table.tsx", "app/products/[slug]/page.tsx", "supabase/repair-community-pools-columns.sql"],
  },
  {
    sha: '339b3220f24eb1ab1103a69494857b993394065b',
    title: "Fake-sale and link checks, trust section",
    paths: ["services/fake-sale.ts", "services/link-check.ts", "components/products/trust-check-section.tsx", "app/products/[slug]/page.tsx"],
  },
  {
    sha: '66d326bca38954a5bd2ea24c71fde8acdc92e9ca',
    title: "Trust check section",
    paths: ["components/products/trust-check-section.tsx"],
  },
  {
    sha: '31d9ff1542fc7e0ecb6627dc9f58522782f5654a',
    title: "Retailers service",
    paths: ["services/retailers.ts"],
  },
  {
    sha: 'ebd39dc5a2f902fa25b2f66f8c51c5118a9e4d6b',
    title: "Affiliate geo engine (real tags only)",
    paths: ["services/affiliate-geo.ts", "services/affiliate.ts", "services/index.ts", "app/api/v1/affiliate/geo-click/route.ts", "app/api/v1/products/[slug]/merchants/route.ts", "app/products/[slug]/page.tsx", "supabase/add-affiliate-geo-clicks.sql", ".env.example", "docs/affiliate-engine.md"],
  },
  {
    sha: 'fabed9ba7174f35ca3979f303cca24ef21152885',
    title: "Affiliate geo-click route",
    paths: ["app/api/v1/affiliate/geo-click/route.ts"],
  },
  {
    sha: '935594c223c3825f035d11d0b2db12f1c52a6d33',
    title: "Affiliate phase 4 plan (docs)",
    paths: ["docs/affiliate-phase4-plan.md"],
  },
  {
    sha: '3b778b4df50a54fd0b0c715c9fd74780affee708',
    title: "Privacy and terms pages",
    paths: ["app/privacy/page.tsx", "app/terms/page.tsx"],
  },
  {
    sha: '999c2528f4d02d20d13dbaeeebc6776341abd9ea',
    title: "Affiliate beacon, gift finder, and arbitrage table",
    paths: ["lib/affiliate-beacon.ts", "services/affiliate-geo.ts", "app/api/v1/affiliate/transform/route.ts", "app/api/v1/gifts/route.ts", "app/gifts/page.tsx", "components/products/region-arbitrage-table.tsx", "app/products/[slug]/page.tsx", "docs/affiliate-engine.md", "docs/affiliate-phase4-plan.md"],
  },
  {
    sha: '6b23709e3ed8d8af06beae1934998428b7be5166',
    title: "Affiliate step C plan (docs)",
    paths: ["docs/affiliate-step-c-plan.md"],
  },
  {
    sha: 'c96aaffa86c0d60b3c5eb3592989d13d5bffabe7',
    title: "Affiliate analytics and admin reporting",
    paths: ["services/affiliate-geo.ts", "app/api/v1/affiliate/geo-click/route.ts", "services/affiliate-analytics.ts", "services/admin.ts", "app/api/v1/admin/affiliate-clicks/route.ts", "app/admin/page.tsx", "docs/affiliate-step-c-plan.md", "docs/affiliate-engine.md"],
  },
  {
    sha: 'f61bfa99e8399051eddeacf4d659a7e4c21cf6ed',
    title: "Homepage geo-deals rotation and local stores",
    paths: ["services/deal-rotation.ts", "app/api/v1/smart-deals/route.ts", "components/deals/smart-deal-widget.tsx", "components/home/local-stores-section.tsx", "app/page.tsx", "docs/homepage-geo-deals.md"],
  },
  {
    sha: '1b216bbc20aa40092caf052809ac6dae86fdeae3',
    date: '2026-11-05',
    title: "Dashboard redesign: AI Glass (AI sidebar, animated stats, active deals)",
    paths: ["services/dashboard-helpers.ts", "app/api/v1/dashboard/drops-to-watch/route.ts", "components/dashboard/ai-chat-panel.tsx", "components/dashboard/ai-sidebar.tsx", "components/dashboard/animated-stat.tsx", "components/dashboard/active-deals-section.tsx", "components/dashboard/upcoming-deals-section.tsx", "components/dashboard/drops-to-watch-section.tsx", "docs/dashboard-ai-glass.md", "services/commerce.ts", "app/api/v1/deals/route.ts", "app/dashboard/page.tsx", "app/globals.css", "tailwind.config.ts"],
  },
  {
    sha: 'de0da1c18bd9951366db98e6676c695fa7398802',
    title: "Admin routes, rate-limit middleware, and JSON-LD",
    paths: ["lib/api/middleware.ts", "app/api/v1/admin/analytics/route.ts", "app/api/v1/admin/audit-logs/route.ts", "app/api/v1/admin/users/route.ts", "app/api/v1/admin/affiliate-clicks/route.ts", "app/admin/layout.tsx", "app/api/v1/deal-finder/route.ts", "app/api/v1/scan/route.ts", "app/api/v1/gifts/route.ts", "app/api/v1/comparison/route.ts", "app/api/v1/affiliate/transform/route.ts", "app/api/v1/affiliate/geo-click/route.ts", "lib/json-ld.ts", "app/layout.tsx", "app/products/[slug]/page.tsx", "middleware.ts", "docs/security-hardening.md"],
  },
  {
    sha: '1d3fe04f52ec47840a3764748edbef92636fee4f',
    title: "Rate limiting (Upstash Redis) on public POST routes",
    paths: ["lib/api/rate-limit.ts", "lib/api/middleware.ts", "lib/config/env.ts", "app/api/v1/deal-finder/route.ts", "app/api/v1/scan/route.ts", "app/api/v1/gifts/route.ts", "app/api/v1/comparison/route.ts", "app/api/v1/affiliate/transform/route.ts", "app/api/v1/affiliate/geo-click/route.ts", "package.json", "package-lock.json", ".env.example", "docs/security-hardening.md"],
  },
  {
    sha: '3c59708cf757dd4f147876495e93005633efe880',
    title: "Nonce-based Content Security Policy",
    paths: ["lib/csp.ts", "middleware.ts", "next.config.js", "app/layout.tsx", "components/providers/index.tsx", "components/providers/theme-provider.tsx", "components/csp-nonce-context.tsx", "app/products/[slug]/page.tsx", "docs/security-hardening.md"],
  },
  {
    sha: '93f120dd177fc7a0903bab47b9971ae01bbc2ff9',
    date: '2026-11-05',
    title: "Resend verification email link on sign-in",
    paths: ["app/sign-in/page.tsx"],
  },
  {
    sha: '9969a3a212513ba3e9e2434911b3946cd7e8b798',
    date: '2026-11-05',
    title: "Deals page made discovery-only (no Buy button on deal cards)",
    paths: ["docs/affiliate-phase4-plan.md"],
  },
  {
    sha: 'af942e741bf37e5db93a28962b6893ae6986b5e0',
    date: '2026-11-05',
    title: "Security hardening: admin guards, rate limits, migration 017",
    paths: ["lib/api/middleware.ts", "app/api/v1/data/refresh/route.ts", "services/providers/registry.ts", "app/api/v1/notifications/digest/route.ts", "app/api/v1/notifications/process/route.ts", "lib/utils/safe-redirect.ts", "app/sign-in/page.tsx", "app/api/v1/monitoring/route.ts", "app/api/v1/monitoring/providers/route.ts", "app/api/v1/monitoring/sync-history/route.ts", "components/region/region-provider.tsx", "package.json", "package-lock.json", "supabase/migrations/20261105190000_017_admin_only_catalog_writes.sql", "docs/security-hardening.md"],
  },
  {
    sha: 'be6e379a64d976daa190c15597b22fd382c472c5',
    date: '2026-11-06',
    title: "Blog (10 articles) and Option 12: SmartPools 2.0, AI Copilot",
    paths: ["lib/blog/posts.ts", "app/blog/page.tsx", "app/blog/[slug]/page.tsx", "app/sitemap.ts", "components/pools/pool-milestones.tsx", "services/smartpool.ts", "components/pools/pool-shipping-split.tsx", "components/pools/smart-pool.tsx", "app/api/v1/pools/route.ts", "supabase/migrations/20261106153700_018_smartpool_v2_shipping_city.sql", "app/api/v1/alerts/check/route.ts", "app/api/v1/prices/refresh/route.ts", "lib/fx-status.ts", "components/products/landed-cost-calculator.tsx", "components/products/region-arbitrage-table.tsx", "components/dashboard/landed-cost-widget.tsx", "app/api/v1/dashboard/landed-cost/route.ts", "app/dashboard/page.tsx", "lib/i18n.ts", "components/home/hero-copy.tsx", "app/dashboard/settings/page.tsx"],
  },
  {
    sha: '495b9189e6abb17f41c4d52875a8c1b58ab89e74',
    date: '2026-11-06',
    title: "Sitemap corrected to the live domain (32 URLs)",
    paths: ["lib/config/app.ts", "public/bookmarklet.js", "supabase/functions/price-drop-notify/index.ts", "supabase/functions/price-refresh-worker/index.ts"],
  },
  {
    sha: 'd32ebf95de6c2b1a96bfdbb6340f31c68937b0ca',
    date: '2026-11-06',
    title: "Local-first search (Local/Global tabs, 72 stores)",
    paths: ["services/local-first-search.ts", "app/api/search/route.ts", "components/search/product-search-results.tsx", "lib/stores.ts", "app/search/page.tsx"],
  },
  {
    sha: 'f4a15b4fb178723d33b45d3db94b68415d4cc660',
    date: '2026-11-10',
    title: "Crash fix: AI widget dynamic import in the root layout",
    paths: ["app/layout.tsx", "components/chat/ai-deal-finder-widget.tsx"],
  },
];

/**
 * Later releases known from the project log that are NOT yet in the
 * sync record above. Shown separately so the record above stays
 * exactly what the sync file contains; these await sync-record
 * confirmation before they join the main list.
 */
export const PENDING_SYNC_RELEASES: ChangelogRelease[] = [
  {
    sha: 'ace168da',
    date: '2026-11-08',
    title: "Hugging Face endpoint fix for visual search (router host)",
    paths: [],
  },
  {
    sha: '83d848ac',
    date: '2026-11-09',
    title: "P0 batch: server metadata/SSR, compare timeouts, code-split, PostHog CSP fix, guest wishlist + share buttons",
    paths: [],
  },
  {
    sha: '52d48f6b',
    date: '2026-11-09',
    title: "Stale public/robots.txt removed",
    paths: [],
  },
  {
    sha: '88eea163',
    date: '2026-11-09',
    title: "Option 16: repairability index + Decision Suite (migration 019)",
    paths: [],
  },
  {
    sha: '36f62ded',
    date: '2026-11-09',
    title: "Option 17: hardware endurance + sustainability (migration 020)",
    paths: [],
  },
  {
    sha: 'd758b3d6',
    date: '2026-11-09',
    title: "Option 18: weight & power anti-trap checks (migration 021)",
    paths: [],
  },
  {
    sha: '588e2316',
    date: '2026-11-09',
    title: "Option 19: recorded resale-rate + mandatory-accessories overrides (migration 022)",
    paths: [],
  },
  {
    sha: 'c7c693b0',
    date: '2026-11-09',
    title: "Option 20: global readiness \u2014 availability, warranty, next-gen (migration 023)",
    paths: [],
  },
];
