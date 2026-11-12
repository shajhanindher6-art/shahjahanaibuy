import { Suspense } from 'react';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/config/env';
import { getProducts } from '@/services/products';
import { getLatestPrices } from '@/services/price-history';
import { isSupportedLanguage, type Language } from '@/lib/region';
import { tFor } from '@/lib/i18n';
import { Skeleton } from '@/components/ui/skeleton';
import { Price } from '@/components/region/price';
import { StalePriceBadge } from '@/components/products/stale-price-badge';
import {
  Brain,
  TrendingDown,
  Shield,
  Search,
  BarChart3,
  LineChart,
  Globe,
  ArrowRight,
  Star,
  Compass,
  Wallet,
  Store,
  CalendarDays,
  MessageCircleQuestion,
  Recycle,
  Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { SmartDealWidget } from '@/components/deals/smart-deal-widget';
import { PersonalizedDeals } from '@/components/home/personalized-deals';
import { ShareButtons } from '@/components/products/share-buttons';
import { LocalStoresSection } from '@/components/home/local-stores-section';
import { BrowseByTaxonomy } from '@/components/home/browse-by-taxonomy';
import { StatsBar } from '@/components/home/stats-bar';
import { RecentlyViewedStrip } from '@/components/home/recently-viewed-strip';
import { HeroCopy } from '@/components/home/hero-copy';
import { TiersSection } from '@/components/pricing/tiers-section';
import { CurationGuidelines } from '@/components/curators/curation-guidelines';
import { NewsletterCapture } from '@/components/home/newsletter-capture';
import { PushOptInPrompt } from '@/components/home/push-opt-in-prompt';
// NOTE (Section 17, Stage H item 4): the eleven below-hero sections
// were tried as next/dynamic() imports to cut the 320 kB First Load
// — a controlled A/B build measured 0 kB (the sections' code lives in
// shared chunks used by other pages, so splitting the homepage import
// removes nothing from First Load). The split was reverted; the
// sections stay static imports. See docs/performance-budgets.md.

/**
 * Section 13, chunk H (i18n Phase 1): the homepage section
 * headings follow the visitor's UI language. The server reads the
 * same sb-language cookie the root layout uses for dir/lang — a
 * first-visit language switch via localStorage takes effect on
 * the next load, exactly like the layout's dir handling.
 */
function homepageLanguage(): Language {
  const saved = cookies().get('sb-language')?.value ?? null;
  return saved && isSupportedLanguage(saved) ? saved : 'en';
}

const features = [
  {
    icon: Brain,
    title: 'AI Recommendations',
    description:
      'Get personalized product recommendations powered by advanced AI that explains every suggestion.',
  },
  {
    icon: TrendingDown,
    title: 'Price Tracking',
    description:
      'Monitor price changes across retailers and get alerted when prices drop on products you care about.',
  },
  {
    icon: Search,
    title: 'Semantic Search',
    description:
      'Search with natural language — describe what you need, and our AI finds the best matches.',
  },
  {
    icon: Shield,
    title: 'Trust Scoring',
    description:
      'Make confident decisions with AI-powered trust scores for products and sellers based on real data.',
  },
  {
    icon: BarChart3,
    title: 'Review Analysis',
    description:
      'AI-summarized reviews that surface the most important insights from customer opinions.',
  },
  {
    icon: LineChart,
    title: 'Price Prediction',
    description:
      'Know the best time to buy with AI price trend predictions that forecast future price movements.',
  },
];

const steps = [
  {
    number: '01',
    title: 'Create Your Account',
    description: 'Sign up in seconds and set your preferences, budget, and shopping goals.',
  },
  {
    number: '02',
    title: 'Get AI Insights',
    description:
      'Our AI analyzes the products, reviews, and prices in our catalog to find the best options for you.',
  },
  {
    number: '03',
    title: 'Shop Smarter',
    description:
      'Make confident decisions with explainable recommendations and price-drop alerts.',
  },
];

/**
 * Tools guest preview (Section 11, chunk B) — a logged-out visitor
 * learns what each tool does WITHOUT signing in: a short honest
 * description of what the tool does, and nothing else. No sample
 * results, no invented numbers, no fake "example" output.
 *
 * What is verified here, and how:
 * - The three "No sign-in needed" tools (best time to buy, product
 *   Q&A, trade-in finder) call public APIs — their routes carry no
 *   requireAuth, unlike the other ten tool APIs. Their descriptions
 *   are taken from the tools' own pages.
 * - The three "New" tools (help-me-choose, budget-finder,
 *   store-finder) are being built in parallel: their descriptions
 *   say only what the Section 11 brief defines them to do, and no
 *   sign-in claim is made for them — their auth behaviour is not
 *   verified yet.
 * - The ten "Sign-in required" tools each call an API guarded by
 *   requireAuth and show a sign-in screen when logged out, so the
 *   preview says so plainly instead of pretending a guest can try
 *   them. Their one-liners reuse the /tools hub copy.
 */
const toolsTryNow = [
  {
    icon: Compass,
    name: 'Help Me Choose',
    href: '/tools/help-me-choose',
    badge: 'New',
    description:
      'A short guided quiz: answer a few questions about what you need and what matters most, and get a shortlist from the catalog. Your answers travel in a shareable link.',
  },
  {
    icon: Wallet,
    name: 'Budget Finder',
    href: '/tools/budget-finder',
    badge: 'New',
    description:
      'Tell it what you want and the most you want to spend — it shows the best matches in the catalog under your budget, with real recorded prices only.',
  },
  {
    icon: Store,
    name: 'Store Finder',
    href: '/tools/store-finder',
    badge: 'New',
    description:
      'Pick your country first and see which stores serve it. A directory only — it makes no shipping or delivery promises we cannot verify.',
  },
  {
    icon: CalendarDays,
    name: 'Best Time to Buy',
    href: '/tools/best-time-calendar',
    badge: 'No sign-in needed',
    description:
      'The best time of year to buy, per category, from recorded price history — ranges only, never a promised exact date.',
  },
  {
    icon: MessageCircleQuestion,
    name: 'Product Q&A',
    href: '/tools/product-qa',
    badge: 'No sign-in needed',
    description:
      'Pick a product and ask a question — the answer comes from its recorded specs and reviews only, labelled “AI answer” with its source. If the specs don’t cover it, it says so.',
  },
  {
    icon: Recycle,
    name: 'Trade-in Finder',
    href: '/tools/trade-in-finder',
    badge: 'No sign-in needed',
    description:
      'Before buying new, see what your old product is worth and where you can trade it in. Programs are listed only when a real program is confirmed — none are invented.',
  },
];

const toolsNeedSignIn: Array<{ name: string; href: string; description: string }> = [
  {
    name: 'Shopping List Optimizer',
    href: '/tools/list-optimizer',
    description: 'Your whole list, cheapest way — which item to buy from which store, with the total and the saving.',
  },
  {
    name: 'Receipt & Expense Tracker',
    href: '/tools/expense-tracker',
    description: 'What you spent, by category, each month — recorded when a purchase is confirmed.',
  },
  {
    name: 'Subscription Manager',
    href: '/tools/subscription-manager',
    description: 'Every subscription in one place — renewal reminders, and a flag for duplicates or rarely used ones.',
  },
  {
    name: 'Monthly Shopping Planner',
    href: '/tools/monthly-planner',
    description: 'Set a monthly budget and get a plan: what to buy now, what to wait on, and what to push to next month.',
  },
  {
    name: 'Savings Dashboard',
    href: '/tools/savings-dashboard',
    description: '“How much have you saved so far” — total saved, this month, and your biggest saving, from confirmed recorded savings only.',
  },
  {
    name: 'Price-Drop Digest',
    href: '/tools/price-drop-digest',
    description: 'One daily or weekly summary of your watched products — top deals first, each with one line saying why it is good.',
  },
  {
    name: 'Eco Shopping Coach',
    href: '/tools/eco-coach',
    description: 'A monthly carbon budget, with coach advice on each purchase — recorded carbon first, estimates always labelled as estimates.',
  },
  {
    name: 'Smart Home Reorder Agent',
    href: '/tools/smart-home-agent',
    description: 'Your home reorders itself: device triggers plus your reorder rules, with confirmation before every order.',
  },
  {
    name: '“Future You” Planner',
    href: '/tools/future-you-planner',
    description: 'A saving plan for big purchases — set a target and a date, and get a monthly plan, linked to price-drop alerts.',
  },
  {
    name: 'Warranty Claim Helper',
    href: '/tools/warranty-claim-helper',
    description: 'A step-by-step claim checklist from your Vault — documents, retailer or brand contact, and a reminder before expiry.',
  },
];

function ToolsPreviewSection({ language }: { language: Language }) {
  return (
    <section id="tools" className="border-t py-20 md:py-28" aria-label="AI tools">
      <div className="container mx-auto px-4">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="flex items-center justify-center gap-2 text-3xl font-bold tracking-tight md:text-4xl">
            <Wrench className="h-7 w-7 text-blue-600" /> {tFor(language, 'homeToolsHeading')}
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Every tool below does exactly what its card says — no sample
            results, no made-up examples. Three are open to everyone, three
            are new, and the rest work on your own data, so they ask you to
            sign in first.
          </p>
        </div>

        <div className="mt-16 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {toolsTryNow.map((tool) => (
            <Card key={tool.href} className="group transition-shadow hover:shadow-lg">
              <CardHeader>
                <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                  <tool.icon className="h-6 w-6" />
                </div>
                <CardTitle className="text-xl">
                  <Link href={tool.href} className="underline-offset-4 hover:underline">
                    {tool.name}
                  </Link>{' '}
                  <span className="ml-1 inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 align-middle text-xs font-semibold text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                    {tool.badge}
                  </span>
                </CardTitle>
                <CardDescription className="text-sm leading-relaxed">
                  {tool.description}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Link
                  href={tool.href}
                  className="inline-flex min-h-[44px] items-center text-sm font-medium text-blue-600 hover:underline"
                >
                  Open tool <ArrowRight className="ml-1 h-4 w-4" />
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* The ten tools that need sign-in: what each one does, in
            one line, with the sign-in requirement stated plainly.
            A guest learns what they do here — the tool pages
            themselves show a sign-in screen when logged out. */}
        <div className="mx-auto mt-12 max-w-3xl rounded-lg border p-6">
          <h3 className="text-lg font-semibold">{tFor(language, 'homeToolsMoreHeading')}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            These work on your own lists, spending, subscriptions and
            savings, so they need an account. Nothing of yours is shown
            until you sign in.
          </p>
          <ul className="mt-4 space-y-3">
            {toolsNeedSignIn.map((tool) => (
              <li key={tool.href} className="text-sm">
                <Link href={tool.href} className="font-medium underline-offset-4 hover:underline">
                  {tool.name}
                </Link>{' '}
                <span className="ml-1 inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  Sign-in required
                </span>
                <span className="block text-muted-foreground">{tool.description}</span>
              </li>
            ))}
          </ul>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Button asChild>
              <Link href="/tools">
                Browse all 16 tools
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/coming-soon">See what&apos;s coming next</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Featured-products strip (Section 10, chunk 1) — above the fold,
 * directly under the hero.
 *
 * Async server component, same anon-client pattern as
 * BrowseByTaxonomy: real products from getProducts (the existing
 * catalog data path — the health-check row is already excluded
 * there) with their latest recorded price_history price. A
 * product with no recorded price shows "Price not listed", never
 * a guessed price. When the catalog is empty or the query fails,
 * the section shows an honest "nothing to show" line instead of
 * inventing products or breaking the homepage.
 */
async function FeaturedProductsStrip({ language }: { language: Language }) {
  let products: Array<{
    id: string;
    name: string;
    slug: string;
    brand: string | null;
    category: string | null;
    imageUrl: string | null;
    price: number | null;
    /** Recorded `products.data_freshness` (Section 16, item 9). */
    dataFreshness: string | null;
  }> = [];
  try {
    const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { persistSession: false },
    });
    const { products: rows } = await getProducts(supabase, { pageSize: 6 });
    // Section 18, item 28 — was N+1: one `price_history` query per
    // product (6 sequential selects). Now a single `.in()` query
    // for the whole strip (services/price-history getLatestPrices);
    // a product with no recorded price still shows "Price not
    // listed", never a guessed price.
    const latestPrices = await getLatestPrices(
      supabase,
      rows.map((product) => product.id)
    );
    products = rows.map((product) => ({
      id: product.id,
      name: product.name,
      slug: product.slug,
      brand: product.brand,
      category: product.category,
      imageUrl: product.imageUrl,
      price: latestPrices.get(product.id) ?? null,
      // Section 16, item 9: recorded freshness rides with the
      // card so the stale-price badge + age can render under
      // the price.
      dataFreshness: product.dataFreshness ?? null,
    }));
  } catch {
    products = [];
  }

  return (
    <section className="border-t py-12 md:py-16" aria-label="Featured products">
      <div className="container mx-auto px-4">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-bold tracking-tight md:text-3xl">{tFor(language, 'homeFeaturedHeading')}</h2>
          <p className="mt-2 text-muted-foreground">
            Real products from our catalog, with their latest recorded prices.
          </p>
        </div>
        {products.length === 0 ? (
          <p className="mx-auto mt-8 max-w-xl text-center text-sm text-muted-foreground">
            No featured products to show right now — please check back soon.
          </p>
        ) : (
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((product) => (
              <Link key={product.id} href={`/products/${product.slug}`}>
                <Card className="group h-full transition-shadow hover:shadow-lg">
                  <CardContent className="p-4">
                    <div className="mb-3 h-40 overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
                      {product.imageUrl ? (
                        // Lazy + sized <img>: product photos come
                        // from merchant hosts outside next/image's
                        // remotePatterns allowlist (next.config.js),
                        // so next/image would throw at runtime.
                        <img
                          src={product.imageUrl}
                          alt={product.name}
                          width={320}
                          height={160}
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-cover transition-transform group-hover:scale-105"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                          <Search className="h-8 w-8" />
                        </div>
                      )}
                    </div>
                    <h3 className="font-semibold leading-tight">{product.name}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {[product.brand, product.category].filter(Boolean).join(' · ') || 'SmartBuy catalog'}
                    </p>
                    <div className="mt-2">
                      {product.price !== null ? (
                        <Price usd={product.price} className="text-lg font-bold text-blue-600" />
                      ) : (
                        <span className="text-xs text-muted-foreground">Price not listed</span>
                      )}
                      {/* Section 16, item 9: stale-price badge +
                          age-in-days under the price. */}
                      {product.price !== null && (
                        <div className="mt-1">
                          <StalePriceBadge dataFreshness={product.dataFreshness} />
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
        {/* Section 14, chunk 5: the full catalog lives at /products
            (search, filters, sorting, pagination) — the strip above
            only ever shows the first 6. */}
        <div className="mt-8 text-center">
          <Link
            href="/products"
            className="inline-flex min-h-[44px] items-center rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            View all products →
          </Link>
        </div>
      </div>
    </section>
  );
}

export default function HomePage() {
  const language = homepageLanguage();

  return (
    <>
      <SiteHeader />
      <main>
        {/* Hero Section */}
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent" />
          <div className="container relative mx-auto px-4 py-20 md:py-28">
            <div className="mx-auto max-w-3xl text-center">
              <HeroCopy />
            </div>
          </div>
        </section>

        {/* Featured products strip (Section 10, chunk 1) — above
            the fold, directly under the hero. Wrapped in Suspense so
            a slow or hanging catalog query never blocks the homepage
            shell: the section skeleton streams immediately and the
            strip swaps in when its data resolves (or renders its
            honest empty state on error). */}
        <Suspense
          fallback={
            <section className="border-t py-12 md:py-16" aria-label="Featured products">
              <div className="container mx-auto px-4">
                <div className="mx-auto max-w-2xl text-center">
                  <h2 className="text-2xl font-bold tracking-tight md:text-3xl">{tFor(language, 'homeFeaturedHeading')}</h2>
                  <p className="mt-2 text-muted-foreground">
                    Real products from our catalog, with their latest recorded prices.
                  </p>
                </div>
                <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="rounded-lg border p-4">
                      <Skeleton className="mb-3 h-40 w-full" />
                      <Skeleton className="h-5 w-3/4" />
                      <Skeleton className="mt-2 h-4 w-1/2" />
                    </div>
                  ))}
                </div>
                <span className="sr-only">Loading featured products…</span>
              </div>
            </section>
          }
        >
          <FeaturedProductsStrip language={language} />
        </Suspense>

        {/* Recently Viewed (Section 11, chunk C) — guest, device-local
            history recorded on product pages. Renders nothing when
            empty, so first-time visitors see no change. */}
        <RecentlyViewedStrip />

        {/* Stats Bar — real counts from the public APIs (see
            components/home/stats-bar.tsx). The old bar claimed
            10M+ products / 500+ retailers / 99.9% uptime / <200ms,
            none of which was measured or true for this catalog. */}
        <StatsBar />

        {/* Features Section */}
        <section id="features" className="py-20 md:py-28">
          <div className="container mx-auto px-4">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
                {tFor(language, 'homeFeaturesHeading')}
              </h2>
              <p className="mt-4 text-lg text-muted-foreground">
                Powerful AI-driven features that help you make the best purchasing decisions,
                every time.
              </p>
            </div>
            <div className="mt-16 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {features.map((feature) => (
                <Card
                  key={feature.title}
                  className="group transition-shadow hover:shadow-lg animate-fade-in"
                >
                  <CardHeader>
                    <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                      <feature.icon className="h-6 w-6" />
                    </div>
                    <CardTitle className="text-xl">{feature.title}</CardTitle>
                    <CardDescription className="text-sm leading-relaxed">
                      {feature.description}
                    </CardDescription>
                  </CardHeader>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* AI tools guest preview (Section 11, chunk B) — what each
            tool does, for a logged-out visitor, with no fake sample
            results. Placed right after Features so the tools are
            visible without scrolling past the deals sections. */}
        <ToolsPreviewSection language={language} />

        {/* Smart Deal Recommendations */}
        <section className="border-t py-20 md:py-28">
          <div className="container mx-auto px-4">
            <SmartDealWidget limit={6} />
            {/* S3#10 — share SmartBuy AI (WhatsApp / X / Facebook /
                copy link + your own referral link). */}
            <div className="mt-10 flex flex-col items-center gap-3">
              <p className="text-sm font-medium">Found a good deal? Share SmartBuy AI</p>
              <ShareButtons
                title="SmartBuy AI — AI-powered shopping"
                text="SmartBuy AI tracks prices and finds the best deals — check it out"
                enableReferral
              />
            </div>
            {/* S5#13 — how curation works: the public rules every
                curated deal must pass. The curated pick itself lives
                on /deals (it needs the visitor's region, which the
                server homepage does not know). */}
            <div className="mx-auto mt-10 max-w-2xl">
              <CurationGuidelines />
            </div>
          </div>
        </section>

        {/* S3#18 — personalized deals, built only from the
            visitor's own wishlist/alerts (privacy-first). Shows an
            honest empty state when there are no signals yet. */}
        <section className="border-t py-20 md:py-28">
          <div className="container mx-auto px-4">
            <PersonalizedDeals />
          </div>
        </section>

        {/* Geo-targeted local stores — directory + links only */}
        <LocalStoresSection />

        {/* Section 9 — browse the catalog by brand / category.
            Links are derived from the products table at render time
            (components/home/browse-by-taxonomy.tsx); the section
            renders nothing when the catalog has no brands or
            categories. Wrapped in id="browse" so the mobile nav
            "Brands" link (Section 10, chunk 1) lands here. */}
        <div id="browse">
          <BrowseByTaxonomy />
        </div>

        {/* How It Works */}
        <section id="how-it-works" className="border-y bg-muted/30 py-20 md:py-28">
          <div className="container mx-auto px-4">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
                {tFor(language, 'homeHowItWorksHeading')}
              </h2>
              <p className="mt-4 text-lg text-muted-foreground">
                Three simple steps to transform how you shop online.
              </p>
            </div>
            <div className="mt-16 grid gap-8 md:grid-cols-3">
              {steps.map((step) => (
                <div key={step.number} className="relative text-center">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary text-2xl font-bold text-primary-foreground">
                    {step.number}
                  </div>
                  <h3 className="mb-2 text-xl font-semibold">{step.title}</h3>
                  <p className="text-sm text-muted-foreground">{step.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Testimonials — HONESTY: these are illustrative
            examples, NOT verified customer reviews. The names,
            roles, star ratings and the "$300 saved" claim below
            are marketing copy, not real customer feedback, so
            they are labeled as such in plain sight instead of
            being presented as real reviews. Do not remove this
            note without replacing the section with real,
            verifiable reviews. */}
        <section className="py-20 md:py-28">
          <div className="container mx-auto px-4">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
                {tFor(language, 'homeTestimonialsHeading')}
              </h2>
              <p className="mt-4 text-lg text-muted-foreground">
                Shop smarter with AI.
              </p>
              <p className="mx-auto mt-3 max-w-xl rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
                Illustrative examples — not verified customer reviews. These quotes, names and
                ratings are sample copy showing the kind of feedback shoppers might give; they
                are not reviews from real customers.
              </p>
            </div>
            <div className="mt-16 grid gap-6 md:grid-cols-3">
              {[
                {
                  name: 'Sarah K.',
                  role: 'Illustrative example',
                  quote:
                    'SmartBuy AI saved me $300 on a laptop by predicting a price drop. The AI recommendations are spot on.',
                },
                {
                  name: 'Michael R.',
                  role: 'Illustrative example',
                  quote:
                    'The review analysis feature is a game changer. I can instantly see if a product is worth buying.',
                },
                {
                  name: 'Emily T.',
                  role: 'Illustrative example',
                  quote:
                    'I love how the AI explains its recommendations. It feels like having a personal shopping advisor.',
                },
              ].map((testimonial) => (
                <Card key={testimonial.name}>
                  <CardContent className="pt-6">
                    <div className="mb-4 flex gap-1">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star key={i} className="h-4 w-4 fill-warning text-warning" />
                      ))}
                    </div>
                    <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
                      &ldquo;{testimonial.quote}&rdquo;
                    </p>
                    <div>
                      <div className="font-semibold">{testimonial.name}</div>
                      <div className="text-sm text-muted-foreground">{testimonial.role}</div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing — Premium tiers 2.0 (S5#17, wave 2 wiring).
            The old 3-plan block (Free / Premium / Business) is
            replaced by TiersSection (Free / Premium / Family /
            Team, from lib/tiers.ts — Premium $9.99/month is the
            planned price, not a live charge, Family "To be
            announced", Team custom). The wrapper
            keeps id="pricing" so the header/footer #pricing anchor
            still lands here; the section itself is id="pricing-tiers". */}
        <div id="pricing">
          <TiersSection />
          {/* Section 12, chunk C — honesty note under the pricing
              cards. The TiersSection itself already states the
              price-lock dormancy, and its Premium card shows the
              stored CTA from lib/tiers.ts ("See Premium plans",
              which links back to /pricing) and lists the
              price-lock as a feature — and no trial terms exist
              anywhere in the code. This note, directly under the
              cards, says plainly that payments aren't live yet,
              no trial starts, and no lock is in force. The CTA text
              itself lives in lib/tiers.ts + the TiersSection
              component, which this chunk does not own — see the
              build report. */}
          <p className="mx-auto max-w-2xl px-4 pb-16 text-center text-sm text-muted-foreground">
            Payments aren&apos;t live yet — Stripe is in test mode, so no paid plan can be bought
            today and no free trial starts. The $9.99/month Premium price is the planned price,
            not a live charge. Price-lock is dormant until Stripe is configured — no lock is in
            force today.{' '}
            <Link href="/pricing" className="font-medium text-blue-600 underline underline-offset-4">
              See the full pricing page
            </Link>
            .
          </p>
        </div>

        {/* Section 12, chunk D — email capture for deal alerts /
            the newsletter, mounted on the homepage. */}
        <NewsletterCapture source="homepage" />

        {/* CTA */}
        <section className="py-20 md:py-28">
          <div className="container mx-auto px-4">
            <div className="relative overflow-hidden rounded-2xl bg-primary p-12 text-center text-primary-foreground md:p-20">
              <div className="absolute inset-0 bg-gradient-to-br from-primary to-chart-4 opacity-90" />
              <div className="relative">
                <Globe className="mx-auto mb-4 h-12 w-12" />
                <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
                  {tFor(language, 'homeCtaHeading')}
                </h2>
                <p className="mx-auto mt-4 max-w-xl text-lg text-primary-foreground/90">
                  {tFor(language, 'homeCtaSubheading')}
                </p>
                <Button size="lg" variant="secondary" className="mt-8" asChild>
                  <Link href="/sign-up">
                    Get Started Free
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Section 12, chunk E — push opt-in prompt, mounted on the
            homepage. The component renders its own prompt UI (and
            nothing when push is unavailable or already decided). */}
        <PushOptInPrompt />
      </main>
      <SiteFooter />
    </>
  );
}
