import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';

export default function TermsPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl space-y-4 text-muted-foreground">
          <h1 className="text-3xl font-bold text-foreground">Terms of Service</h1>
          <p>
            By using SmartBuy AI, you agree to use the service lawfully and not to misuse
            it, attempt to access other users&apos; accounts, or interfere with the service.
            Accounts are personal, and you are responsible for keeping your sign-in details
            safe.
          </p>
          <p>
            Prices, availability, and product details shown here come from retailers and
            other sources and can change at any time. The final price and purchase terms
            are set by the retailer at checkout, so please check them before buying.
          </p>
          <p>
            Premium is billed through Stripe under the plan shown on the billing page. You
            can manage or cancel your subscription from the customer portal linked on that
            page. This is starter terms text and should be reviewed by the site owner
            before launch.
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
