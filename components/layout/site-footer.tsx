'use client';

import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { NewsletterCapture } from '@/components/home/newsletter-capture';
import { useRegion } from '@/components/region/region-provider';
import { tFor, type DictKey } from '@/lib/i18n';

// Section 13, chunk H (i18n Phase 1): the group keys are DictKeys
// (footerProduct, footerCompany, …) and render through tFor, so
// the footer groups and tagline follow the visitor's UI language
// like the header nav does. The link labels themselves stay
// English — Phase 2/3 covers deeper chrome.
const footerLinks = {
  footerProduct: [
    { href: '/#features', label: 'Features' },
    // Section 12, chunk C: pricing is a real page now
    // (app/pricing/page.tsx), so this links there instead of the
    // homepage anchor.
    { href: '/pricing', label: 'Pricing' },
    { href: '/#how-it-works', label: 'How It Works' },
    // Section 12, chunk C: /brands and /categories index pages
    // exist now (Chunk A) — the old /#browse anchor is retired
    // for these two links.
    { href: '/tools', label: 'AI Tools' },
    { href: '/deals', label: 'Deals' },
    { href: '/compare', label: 'Compare' },
    { href: '/platforms', label: 'Platforms' },
    { href: '/brands', label: 'Brands' },
    { href: '/categories', label: 'Categories' },
    // Section 13, item 62 — these pages existed but were reachable
    // only via the sitemap or a direct URL; they now have footer
    // links like everything else.
    { href: '/scan', label: 'Scan a Product' },
    { href: '/events', label: 'Events' },
    { href: '/bundles', label: 'Bundles' },
    { href: '/gifts', label: 'Gift Finder' },
    { href: '/track', label: 'Track a Price' },
  ],
  footerCompany: [
    { href: '/about', label: 'About' },
    { href: '/contact', label: 'Contact' },
    { href: '/press', label: 'Press' },
    { href: '/changelog', label: 'Changelog' },
    { href: '/privacy', label: 'Privacy Policy' },
  ],
  footerResources: [
    { href: '/blog', label: 'Blog' },
    { href: '/docs', label: 'Documentation' },
    { href: '/support', label: 'Support' },
    { href: '/help', label: 'Help Center' },
    { href: '/creators', label: 'Creator Storefronts' },
    { href: '/mobile-app', label: 'Mobile App' },
    // Section 13, item 62 — same as the Product group: reachable
    // before only via sitemap / direct URL.
    { href: '/p2p-match', label: 'P2P Match' },
    { href: '/widgets', label: 'Widgets' },
    { href: '/extension', label: 'Browser Extension' },
    { href: '/bookmarklet', label: 'Bookmarklet' },
    { href: '/coming-soon', label: 'Coming Soon' },
  ],
  footerTransparency: [
    { href: '/methodology', label: 'Methodology' },
    // Section 12, chunk C: affiliate disclosure. The disclosure
    // itself lives in the Methodology page ("Affiliate disclosure"
    // section, id="affiliate-disclosure").
    { href: '/methodology#affiliate-disclosure', label: 'Affiliate Disclosure' },
    { href: '/price-index', label: 'Price Index' },
    { href: '/market-reports', label: 'Market Reports' },
    { href: '/sustainability', label: 'Sustainability' },
    { href: '/status', label: 'Status' },
    { href: '/api-docs', label: 'API Docs' },
    { href: '/live', label: 'Live Shopping' },
    { href: '/warranty-plans', label: 'Warranty Plans' },
  ],
  footerLegal: [
    { href: '/terms', label: 'Terms of Service' },
    { href: '/privacy', label: 'Privacy Policy' },
    { href: '/cookies', label: 'Cookie Policy' },
  ],
};

export function SiteFooter() {
  const { language } = useRegion();

  return (
    <footer className="border-t bg-background">
      <div className="container mx-auto px-4 py-12">
        {/* Section 12, chunk D: email capture for deal alerts /
            the newsletter. The component (built by Chunk D) renders
            its own complete UI and honest empty states; the footer
            only mounts it. */}
        <div className="mb-10">
          <NewsletterCapture source="footer" />
        </div>
        <div className="grid grid-cols-2 gap-8 md:grid-cols-6">
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="flex items-center gap-2 font-bold text-lg">
              <Sparkles className="h-5 w-5 text-primary" />
              <span>SmartBuy AI</span>
            </Link>
            <p className="mt-3 text-sm text-muted-foreground">
              {tFor(language, 'footerTagline')}
            </p>
          </div>
          {Object.entries(footerLinks).map(([title, links]) => (
            <div key={title}>
              <h4 className="mb-3 text-sm font-semibold">{tFor(language, title as DictKey)}</h4>
              <ul className="space-y-2">
                {links.map((link) => (
                  <li key={`${link.href}-${link.label}`}>
                    <Link
                      href={link.href}
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        {/* No social icons: the old Twitter/GitHub/LinkedIn icons
            all linked to "#" — dead placeholder links, not real
            SmartBuy accounts. They are removed rather than pointed
            at invented profiles; re-add them only with real URLs. */}
        <div className="mt-8 flex flex-col items-center justify-between gap-4 border-t pt-8 sm:flex-row">
          <p className="text-sm text-muted-foreground">
            &copy; {new Date().getFullYear()} SmartBuy AI. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
