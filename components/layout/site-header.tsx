'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Menu, X, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { useAuth } from '@/features/auth';
import { cn } from '@/lib/utils';
import { CountrySwitcher, LanguageToggle } from '@/components/region/country-switcher';
import { RegionBanner } from '@/components/region/region-banner';
import { useRegion } from '@/components/region/region-provider';
import { tFor, type DictKey } from '@/lib/i18n';

const navLinks: { href: string; key: DictKey }[] = [
  { href: '/', key: 'navHome' },
  { href: '/#features', key: 'navFeatures' },
  { href: '/#how-it-works', key: 'navHowItWorks' },
  { href: '/#pricing', key: 'navPricing' },
];

export function SiteHeader() {
  const pathname = usePathname();
  const { isAuthenticated } = useAuth();
  const { language } = useRegion();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur-md">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex shrink-0 items-center gap-2 font-bold text-lg">
            <Sparkles className="h-6 w-6 shrink-0 text-primary" />
            {/* Logo wordmark hides on very narrow screens so the
                header row (now carrying the country switcher +
                language toggle) never overflows on phones. */}
            <span className="hidden min-[400px]:inline">SmartBuy AI</span>
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
          </nav>
        </div>

        <div className="flex min-w-0 items-center gap-1 sm:gap-2">
          {/* Global controls: country switcher collapses to a
              currency-code-only select on small screens so the
              mobile header row never wraps or overflows. */}
          <CountrySwitcher />
          <LanguageToggle />
          <ThemeToggle />
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
                  <span className="hidden min-[380px]:inline">{tFor(language, 'navGetStarted')}</span>
                  <span className="min-[380px]:hidden">Start</span>
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
