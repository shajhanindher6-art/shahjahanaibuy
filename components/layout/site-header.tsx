'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Menu, X, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { useAuth } from '@/features/auth';
import { cn } from '@/lib/utils';
import { CountrySwitcher, LanguageSwitcher } from '@/components/region/country-switcher';
import { RegionBanner } from '@/components/region/region-banner';
import { useRegion } from '@/components/region/region-provider';
import { tFor, type DictKey } from '@/lib/i18n';
import { SearchAutocomplete } from '@/components/search/search-autocomplete';

const navLinks: { href: string; key: DictKey }[] = [
  { href: '/', key: 'navHome' },
  { href: '/#features', key: 'navFeatures' },
  { href: '/#how-it-works', key: 'navHowItWorks' },
  { href: '/#pricing', key: 'navPricing' },
];

// Mobile-only links (Section 10, chunk 1): the mobile menu used to
// list only the 4 homepage anchors, so a phone visitor could not
// reach Search, Deals, Compare or Brands without scrolling. Section
// 12: Search / Deals / Compare / Brands / Tools now use DictKeys
// (lib/i18n.ts navSearch, navDeals, navCompare, navBrands, navTools)
// instead of plain-English labels. Brands points at the /brands
// index page (Section 12) instead of the homepage browse section.
// Section 11, chunk B: the AI tools hub and its three new tools
// (help-me-choose, budget-finder, store-finder) are listed here too
// — the 13 Section 7 tools were live but invisible, with zero
// href="/tools" links anywhere on the site. Those three tool names
// stay plain English: no DictKeys exist for them.
const mobileExtraLinks: { href: string; key?: DictKey; label?: string }[] = [
  { href: '/search', key: 'navSearch' },
  { href: '/deals', key: 'navDeals' },
  { href: '/compare', key: 'navCompare' },
  { href: '/brands', key: 'navBrands' },
  { href: '/tools', key: 'navTools' },
  { href: '/tools/help-me-choose', label: 'Help Me Choose' },
  { href: '/tools/budget-finder', label: 'Budget Finder' },
  { href: '/tools/store-finder', label: 'Store Finder' },
];

export function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const { language } = useRegion();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [headerQuery, setHeaderQuery] = useState('');

  // Header search submits to the deep-linkable /search?q=… URL
  // (Section 10, chunk 1) — the search page reads ?q= on load,
  // so the URL is shareable and bookmarkable.
  const submitHeaderSearch = (q: string) => {
    const term = q.trim();
    if (!term) return;
    setMobileOpen(false);
    router.push(`/search?q=${encodeURIComponent(term)}`);
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur-md">
      {/* A2 narrow-viewport fix (audit: header clipped at ~500px):
          the old row hid the wordmark only below 400px and kept a
          gap-8 + full "Get Started" label, so at ~500px — especially
          with the longer German CTA — logo + selectors + buttons
          exceeded the viewport and were cut off. Now: tighter
          mobile padding/gaps, the wordmark and the full CTA label
          appear only at sm+, and the theme toggle hides below
          360px (still reachable on every larger phone). At 320px
          the row is roughly: logo icon 24 + country 64 + language
          56 + Start ~60 + menu 36 + gaps ≈ 260px + 24px padding,
          comfortably inside the viewport. No header redesign:
          same elements, same order, only breakpoints/spacing. */}
      <div className="container mx-auto flex h-16 min-w-0 items-center justify-between gap-1 px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-3 md:gap-8">
          <Link href="/" className="flex shrink-0 items-center gap-2 font-bold text-lg">
            <Sparkles className="h-6 w-6 shrink-0 text-primary" />
            <span className="hidden sm:inline">SmartBuy AI</span>
          </Link>
          <nav className="hidden items-center gap-6 md:flex">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  'text-sm font-medium text-muted-foreground transition-colors hover:text-foreground',
                  pathname === link.href && 'text-foreground'
                )}
              >
                {tFor(language, link.key)}
              </Link>
            ))}
            {/* Section 11, chunk B: desktop Tools link. Section 12:
                now translated via the navTools DictKey. Active on
                every /tools/* page. */}
            <Link
              href="/tools"
              className={cn(
                'text-sm font-medium text-muted-foreground transition-colors hover:text-foreground',
                pathname?.startsWith('/tools') && 'text-foreground'
              )}
            >
              {tFor(language, 'navTools')}
            </Link>
          </nav>
        </div>

        {/* Header search (Section 10, chunk 1): lg+ only. The header
            row is already tight below ~500px (see the A2 comment
            above), so the search box stays out of the mobile row —
            phones get the same search inside the mobile menu below.
            Submits to /search?q=…; picking a suggestion goes
            straight to that product page. */}
        <form
          className="mx-2 hidden min-w-0 max-w-sm flex-1 lg:block"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            submitHeaderSearch(headerQuery);
          }}
        >
          <SearchAutocomplete
            value={headerQuery}
            onChange={setHeaderQuery}
            onSubmit={submitHeaderSearch}
            onSelectSuggestion={(suggestion) => {
              setMobileOpen(false);
              router.push(`/products/${suggestion.slug}`);
            }}
            placeholder={tFor(language, 'searchPlaceholder')}
            inputId="header-search"
          />
        </form>

        <div className="flex min-w-0 items-center gap-1 sm:gap-2">
          {/* Global controls: country switcher collapses to a
              currency-code-only select on small screens so the
              mobile header row never wraps or overflows. */}
          <CountrySwitcher />
          <LanguageSwitcher />
          <span className="hidden min-[360px]:inline-flex shrink-0">
            <ThemeToggle />
          </span>
          {isAuthenticated ? (
            <Button asChild size="sm" className="shrink-0">
              <Link href="/dashboard">{tFor(language, 'navDashboard')}</Link>
            </Button>
          ) : (
            <>
              <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
                <Link href="/sign-in">{tFor(language, 'navSignIn')}</Link>
              </Button>
              <Button size="sm" asChild className="shrink-0">
                <Link href="/sign-up">
                  <span className="hidden sm:inline">{tFor(language, 'navGetStarted')}</span>
                  <span className="sm:hidden">Start</span>
                </Link>
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 md:hidden"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {/* Dismissible "browsing from …" banner on first geo detection. */}
      <RegionBanner />

      {mobileOpen && (
        <nav className="border-t bg-background md:hidden">
          <div className="container mx-auto flex flex-col gap-1 px-4 py-4">
            {/* Mobile search (Section 10, chunk 1): same
                autocomplete + /search?q=… submit as the desktop
                header box, inside the menu where there is room. */}
            <form
              className="mb-2"
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                submitHeaderSearch(headerQuery);
              }}
            >
              <SearchAutocomplete
                value={headerQuery}
                onChange={setHeaderQuery}
                onSubmit={submitHeaderSearch}
                onSelectSuggestion={(suggestion) => {
                  setMobileOpen(false);
                  router.push(`/products/${suggestion.slug}`);
                }}
                placeholder={tFor(language, 'searchPlaceholder')}
                inputId="mobile-search"
              />
            </form>
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => setMobileOpen(false)}
              >
                {tFor(language, link.key)}
              </Link>
            ))}
            {mobileExtraLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => setMobileOpen(false)}
              >
                {link.key ? tFor(language, link.key) : link.label}
              </Link>
            ))}
            {!isAuthenticated && (
              <Link
                href="/sign-in"
                className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => setMobileOpen(false)}
              >
                {tFor(language, 'navSignIn')}
              </Link>
            )}
          </div>
        </nav>
      )}
    </header>
  );
}
