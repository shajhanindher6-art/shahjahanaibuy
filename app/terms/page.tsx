import type { Metadata } from 'next';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { LocalizedHeading } from '@/components/i18n/localized-heading';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'Terms of Service — SmartBuy AI',
  description:
    'SmartBuy AI Terms of Service (draft for owner review): using the site, accounts, retailer links, affiliate links, and plans.',
  alternates: {
    canonical: `${appConfig.url}/terms`,
  },
};

/**
 * Terms of Service — DRAFT for owner review before launch (see the
 * note at the bottom of the page). The terms describe only what the
 * site actually does: catalog browsing for guests, accounts with
 * wishlists/alerts, retailer links (SmartBuy does not sell the
 * products or take checkout payment itself), affiliate tags on some
 * retailer links where a real affiliate account is configured (see
 * "Affiliate links" below), plans as shown on the homepage pricing
 * section, and Stripe billing where a paid plan is offered. No
 * partnership, guarantee, or exact-delivery promise is claimed,
 * because none exists in the product.
 */
export default function TermsPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-3xl space-y-6 text-muted-foreground">
          <LocalizedHeading dictKey="footerLinkTermsOfService" className="text-3xl font-bold text-foreground" />
          <p className="text-sm">Last updated: November 2026</p>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-foreground">Using SmartBuy AI</h2>
            <p>
              By using SmartBuy AI, you agree to use the service lawfully and not to misuse it,
              attempt to access other users&apos; accounts, scrape or interfere with the service,
              or submit content you do not have the right to share. Accounts are personal, and
              you are responsible for keeping your sign-in details safe and for activity under
              your account. We may suspend or close accounts that abuse the service.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-foreground">What SmartBuy is — and is not</h2>
            <p>
              SmartBuy AI is a shopping-intelligence service: it searches a product catalog,
              compares recorded retailer prices, ranks deals, summarizes reviews, and alerts you
              to price changes. It is not a retailer. When you follow a link to buy, you buy from
              that retailer under that retailer&apos;s own terms, and the retailer — not SmartBuy
              — fulfils the order, handles shipping, returns, and warranties. Coupon codes shown
              here are copied by you into the retailer&apos;s checkout; SmartBuy cannot apply a
              code inside a retailer&apos;s checkout, and whether a code works there is the
              retailer&apos;s decision.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-foreground">Affiliate links</h2>
            <p>
              Some links to retailers may include an affiliate tag, added only where SmartBuy has
              a real affiliate account configured for that retailer and region. If you buy through
              such a link, SmartBuy may earn a commission from the retailer at no extra cost to
              you; the price you pay is the retailer&apos;s price, and the tag does not change it.
              A link with no tag configured earns nothing. SmartBuy does not guarantee that any
              particular link carries a commission, or that any purchase will qualify for one.
              Clicks on retailer links are logged anonymously (product, retailer, link, and
              country only — no IP address, browser identifier, or user account is recorded with
              them); see the Privacy Policy for details.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-foreground">Prices, deals, and predictions</h2>
            <p>
              Prices, availability, and product details shown here come from retailer listings,
              recorded price history, and other sources, and can change at any time. Some catalog
              prices are launch/demo placeholders rather than live retailer prices. The final
              price, availability, and purchase terms are set by the retailer at checkout, so
              please check them before buying. Deal percentages are each deal&apos;s listed
              discount or a saving calculated from a retailer&apos;s compare-at price, as labeled
              where shown; the two bases are not the same number. Price predictions, Deal Scores,
              and trend estimates are estimates from recorded history, not guarantees that a
              price will fall or that a product will be in stock.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-foreground">Accounts, alerts, and content you submit</h2>
            <p>
              You may browse the catalog, search, and view deals without an account. An account is
              needed for wishlists, price alerts, and other personal features. Price alerts notify
              you when a recorded price meets a target you set; they are not a price lock, a
              reservation, or a promise that the retailer will honour that price. Anything you
              submit (for example, a community deal or a review) must be truthful, must not
              infringe anyone else&apos;s rights, and may be shown publicly with the label the
              site gives it — upvotes or submissions alone never mark a deal as verified.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-foreground">Plans and billing</h2>
            <p>
              The plans and prices shown in the pricing section of the homepage are the plans
              offered. The free plan is free. If you subscribe to a paid plan, billing is handled
              through Stripe under the plan shown on the billing page; you can manage or cancel
              your subscription from the customer portal linked on that page, and cancellation
              takes effect as described there. If a paid plan is not currently offered, no charge
              is made.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-foreground">Liability and changes</h2>
            <p>
              SmartBuy AI is provided &ldquo;as is&rdquo;, without warranties that any price,
              deal, prediction, or recommendation will be accurate, available, or suitable for a
              particular purpose. To the extent permitted by law, SmartBuy is not liable for
              purchases you make from retailers, for prices or availability changing after you
              view them, or for indirect losses arising from use of the service. We may update
              these terms; the updated version will be posted here with a new &ldquo;Last
              updated&rdquo; date, and continued use after an update means you accept the updated
              terms.
            </p>
          </section>

          <p className="border-t pt-4 text-sm">
            These terms are provided as a starting draft for the site owner to review — including
            governing law, dispute resolution, refund handling, any consumer-protection
            requirements, and affiliate-disclosure requirements for the owner&apos;s jurisdiction —
            before they are relied on at launch.
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
