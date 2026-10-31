import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';

export default function AboutPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="text-3xl font-bold">About SmartBuy AI</h1>
          <p className="mt-4 text-muted-foreground">
            SmartBuy AI helps shoppers make confident decisions. It brings together product
            search, price tracking across retailers, price-drop alerts, and AI-powered
            recommendations, summaries, and price predictions in one place.
          </p>
          <p className="mt-4 text-muted-foreground">
            Instead of checking many stores one by one, you can compare products, follow the
            prices you care about, and get alerted when a deal is worth acting on.
          </p>
          <h2 className="mt-8 text-xl font-semibold">What you can do here</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-muted-foreground">
            <li>Search products in plain language and compare up to five at once.</li>
            <li>Track prices over time and set alerts for price drops.</li>
            <li>Save products to wishlists and follow your favourite deals.</li>
            <li>Get AI recommendations based on what you have viewed and saved.</li>
          </ul>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
