import Link from 'next/link';
import { Sparkles } from 'lucide-react';

const footerLinks = {
  Product: [
    { href: '/#features', label: 'Features' },
    { href: '/#pricing', label: 'Pricing' },
    { href: '/#how-it-works', label: 'How It Works' },
    // Section 11, chunk B: the AI tools hub and the main
    // browse surfaces. Brands and Categories have no index
    // pages (only /brands/[slug] and /categories/[slug]), so
    // both point at the homepage browse section (id="browse"),
    // the same destination the mobile nav "Brands" link uses.
    { href: '/tools', label: 'AI Tools' },
    { href: '/deals', label: 'Deals' },
    { href: '/compare', label: 'Compare' },
    { href: '/platforms', label: 'Platforms' },
    { href: '/#browse', label: 'Brands' },
    { href: '/#browse', label: 'Categories' },
  ],
  Company: [
    { href: '/about', label: 'About' },
    { href: '/contact', label: 'Contact' },
    { href: '/press', label: 'Press' },
    { href: '/changelog', label: 'Changelog' },
    { href: '/privacy', label: 'Privacy Policy' },
  ],
  Resources: [
    { href: '/blog', label: 'Blog' },
    { href: '/docs', label: 'Documentation' },
    { href: '/support', label: 'Support' },
    { href: '/help', label: 'Help Center' },
    { href: '/creators', label: 'Creator Storefronts' },
    { href: '/mobile-app', label: 'Mobile App' },
  ],
  Transparency: [
    { href: '/methodology', label: 'Methodology' },
    { href: '/price-index', label: 'Price Index' },
    { href: '/market-reports', label: 'Market Reports' },
    { href: '/sustainability', label: 'Sustainability' },
    { href: '/status', label: 'Status' },
    { href: '/api-docs', label: 'API Docs' },
    { href: '/live', label: 'Live Shopping' },
    { href: '/warranty-plans', label: 'Warranty Plans' },
  ],
  Legal: [
    { href: '/terms', label: 'Terms of Service' },
    { href: '/privacy', label: 'Privacy Policy' },
    { href: '/cookies', label: 'Cookie Policy' },
  ],
};

export function SiteFooter() {
  return (
    <footer className="border-t bg-background">
      <div className="container mx-auto px-4 py-12">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-6">
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="flex items-center gap-2 font-bold text-lg">
              <Sparkles className="h-5 w-5 text-primary" />
              <span>SmartBuy AI</span>
            </Link>
            <p className="mt-3 text-sm text-muted-foreground">
              AI-powered shopping intelligence for smarter decisions.
            </p>
          </div>
          {Object.entries(footerLinks).map(([title, links]) => (
            <div key={title}>
              <h4 className="mb-3 text-sm font-semibold">{title}</h4>
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
