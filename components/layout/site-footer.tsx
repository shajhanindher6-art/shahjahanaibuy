'use client';

import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { NewsletterCapture } from '@/components/home/newsletter-capture';
import { useRegion } from '@/components/region/region-provider';
import { tFor, type DictKey } from '@/lib/i18n';

// Section 13, chunk H (i18n Phase 1): the group keys are DictKeys
// (footerProduct, footerCompany, …) and render through tFor, so
// the footer groups and tagline follow the visitor's UI language
// like the header nav does. Section 14, I-2: the link labels are
// DictKeys too (footerLink* — 35 new keys, all 20 languages —
// plus 6 reused nav keys: Features, Pricing, How It Works, Deals,
// Compare, Brands), so the whole footer follows the UI language.
// The brand name "SmartBuy AI" and the copyright line stay
// English in every language, as a proper name / legal line.
type FooterGroupKey =
  | 'footerProduct'
  | 'footerCompany'
  | 'footerResources'
  | 'footerTransparency'
  | 'footerLegal';
const footerLinks: Record<FooterGroupKey, Array<{ href: string; labelKey: DictKey }>> = {
  footerProduct: [
    { href: '/#features', labelKey: 'navFeatures' },
    // Section 12, chunk C: pricing is a real page now
    // (app/pricing/page.tsx), so this links there instead of the
    // homepage anchor.
    { href: '/pricing', labelKey: 'navPricing' },
    { href: '/#how-it-works', labelKey: 'navHowItWorks' },
    // Section 12, chunk C: /brands and /categories index pages
    // exist now (Chunk A) — the old /#browse anchor is retired
    // for these two links.
    { href: '/tools', labelKey: 'footerLinkAiTools' },
    { href: '/deals', labelKey: 'navDeals' },
    { href: '/compare', labelKey: 'navCompare' },
    { href: '/platforms', labelKey: 'footerLinkPlatforms' },
    { href: '/brands', labelKey: 'navBrands' },
    { href: '/categories', labelKey: 'footerLinkCategories' },
    // Section 13, item 62 — these pages existed but were reachable
    // only via the sitemap or a direct URL; they now have footer
    // links like everything else.
    { href: '/scan', labelKey: 'footerLinkScanProduct' },
    { href: '/events', labelKey: 'footerLinkEvents' },
    { href: '/bundles', labelKey: 'footerLinkBundles' },
    { href: '/gifts', labelKey: 'footerLinkGiftFinder' },
    { href: '/track', labelKey: 'footerLinkTrackPrice' },
  ],
  footerCompany: [
    { href: '/about', labelKey: 'footerLinkAbout' },
    { href: '/contact', labelKey: 'footerLinkContact' },
    { href: '/press', labelKey: 'footerLinkPress' },
    { href: '/changelog', labelKey: 'footerLinkChangelog' },
    { href: '/privacy', labelKey: 'footerLinkPrivacyPolicy' },
    // Section 14: /partners page (no partnership program yet —
    // the page says so honestly).
    { href: '/partners', labelKey: 'footerLinkPartners' },
  ],
  footerResources: [
    { href: '/blog', labelKey: 'footerLinkBlog' },
    { href: '/docs', labelKey: 'footerLinkDocumentation' },
    { href: '/support', labelKey: 'footerLinkSupport' },
    { href: '/help', labelKey: 'footerLinkHelpCenter' },
    { href: '/creators', labelKey: 'footerLinkCreatorStorefronts' },
    { href: '/mobile-app', labelKey: 'footerLinkMobileApp' },
    // Section 14: /referrals explainer (points/badge only,
    // non-monetary — the page states the honest rules).
    { href: '/referrals', labelKey: 'footerLinkReferrals' },
    // Section 13, item 62 — same as the Product group: reachable
    // before only via sitemap / direct URL.
    { href: '/p2p-match', labelKey: 'footerLinkP2pMatch' },
    { href: '/widgets', labelKey: 'footerLinkWidgets' },
    { href: '/extension', labelKey: 'footerLinkBrowserExtension' },
    { href: '/bookmarklet', labelKey: 'footerLinkBookmarklet' },
    { href: '/coming-soon', labelKey: 'footerLinkComingSoon' },
  ],
  footerTransparency: [
    { href: '/methodology', labelKey: 'footerLinkMethodology' },
    // Section 12, chunk C: affiliate disclosure. The disclosure
    // itself lives in the Methodology page ("Affiliate disclosure"
    // section, id="affiliate-disclosure").
    { href: '/methodology#affiliate-disclosure', labelKey: 'footerLinkAffiliateDisclosure' },
    { href: '/price-index', labelKey: 'footerLinkPriceIndex' },
    { href: '/market-reports', labelKey: 'footerLinkMarketReports' },
    { href: '/sustainability', labelKey: 'footerLinkSustainability' },
    { href: '/status', labelKey: 'footerLinkStatus' },
    { href: '/api-docs', labelKey: 'footerLinkApiDocs' },
    { href: '/live', labelKey: 'footerLinkLiveShopping' },
    { href: '/warranty-plans', labelKey: 'footerLinkWarrantyPlans' },
  ],
  footerLegal: [
    { href: '/terms', labelKey: 'footerLinkTermsOfService' },
    { href: '/privacy', labelKey: 'footerLinkPrivacyPolicy' },
    { href: '/cookies', labelKey: 'footerLinkCookiePolicy' },
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
              {/* Section 15, C7 (runtime a11y): these are h2, not h4 —
                  the page's h1 is the only heading before them, so
                  h4 skipped two levels and axe-core flagged
                  heading-order on every page. The visual size comes
                  from the text-sm class, not the heading level, so
                  the footer looks identical. */}
              <h2 className="mb-3 text-sm font-semibold">{tFor(language, title as DictKey)}</h2>
              <ul className="space-y-2">
                {links.map((link) => (
                  <li key={`${link.href}-${link.labelKey}`}>
                    <Link
                      href={link.href}
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {tFor(language, link.labelKey)}
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
