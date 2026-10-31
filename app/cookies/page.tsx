import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';

export default function CookiesPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl space-y-4 text-muted-foreground">
          <h1 className="text-3xl font-bold text-foreground">Cookie Policy</h1>
          <p>
            SmartBuy AI uses cookies and similar storage to keep you signed in, remember
            your theme and preferences, and understand how the site is used so it can be
            improved.
          </p>
          <p>
            Essential cookies are needed for sign-in and security and cannot be switched
            off in the site itself. You can still control cookies through your browser
            settings, although blocking essential cookies may stop some features from
            working.
          </p>
          <p>
            If analytics or advertising cookies are added in future, this page will be
            updated to list them and explain how to opt out.
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
