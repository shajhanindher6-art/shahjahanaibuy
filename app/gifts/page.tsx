'use client';

/**
 * Gift Finder page: /gifts — Smart AI Gift & Occasion Recommender.
 *
 * The form is the "prompt": occasion, budget, target country, and
 * recipient interests. Matching is deterministic (no LLM, no key —
 * see services/gift-finder.ts), and the page never claims a live AI
 * wrote the picks: every "why this pick" line is computed from the
 * match itself (budget fit + interest keywords + real deal).
 * Budget is a hard filter, Sample Laptop and unpriced products are
 * never recommended, and shipping is shown only as an honest note
 * (no live shipping costs exist, so no fee or date is invented).
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Gift, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { SiteHeader } from '@/components/layout/site-header';
import { PageJsonLd } from '@/components/seo/page-json-ld';
import { SiteFooter } from '@/components/layout/site-footer';
import { Price } from '@/components/region/price';
import { REGIONS } from '@/lib/region';
import { trackAffiliateClick } from '@/lib/affiliate-beacon';
import { buildGiftShareUrl, parseGiftShareParams } from '@/lib/gift-share';
import { useRegion } from '@/components/region/region-provider';
import { tFor } from '@/lib/i18n';

const OCCASIONS = ['Birthday', 'Anniversary', 'Wedding', 'Graduation', 'New home', 'Thank you', 'Holiday', 'Just because'];

interface GiftPick {
  name: string;
  slug: string;
  brand: string | null;
  category: string | null;
  bestPriceUsd: number | null;
  merchantName: string | null;
  couponLabel: string | null;
  matchedInterests: string[];
  savingPct: number | null;
  why: string[];
  priceInRegion: number | null;
  regionCurrency: string;
  storeLinks: Array<{ name: string; country: string; searchUrl: string }>;
}

export default function GiftsPage() {
  const { language } = useRegion();
  const [occasion, setOccasion] = useState('Birthday');
  const [budgetText, setBudgetText] = useState('');
  const [country, setCountry] = useState('US');
  const [interests, setInterests] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picks, setPicks] = useState<GiftPick[] | null>(null);
  const [meta, setMeta] = useState<{ shippingNote?: string; storeKind?: string; affiliateEnabled?: boolean } | null>(null);
  const [shareCopied, setShareCopied] = useState(false);

  // Section 14, chunk 9 — shareable URL: pre-fill every input from
  // the query string (?occasion=&budget=&country=&interests=), the
  // same pattern as the quiz ?answers= URL. Only values inside the
  // picker's own option lists are accepted (see lib/gift-share.ts);
  // anything else is dropped and the field keeps its default — never
  // crash, never invent an input. Read via window.location (not
  // useSearchParams) so the page needs no Suspense boundary. The
  // budget text flows through the same server budget parser as typed
  // input: the route wraps it as "under <text>", so "1000" parses as
  // $1000 USD.
  useEffect(() => {
    try {
      const parsed = parseGiftShareParams(
        window.location.search,
        OCCASIONS,
        REGIONS.map((r) => r.code),
      );
      if (parsed.occasion) setOccasion(parsed.occasion);
      if (parsed.budgetText) setBudgetText(parsed.budgetText);
      if (parsed.country) setCountry(parsed.country);
      if (parsed.interests) setInterests(parsed.interests);
    } catch {
      // Unparseable query string: leave the fields at their defaults.
    }
  }, []);

  async function copyShareLink() {
    const url = buildGiftShareUrl(window.location.origin, {
      occasion,
      budgetText: budgetText.trim() || undefined,
      country,
      interests: interests.trim() || undefined,
    });
    try {
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
    } catch {
      // Clipboard unavailable — fall back to selecting the URL text.
      const el = document.getElementById('gift-share-link') as HTMLInputElement | null;
      if (el) {
        el.value = url;
        el.focus();
        el.select();
      }
    }
  }

  async function run() {
    setError(null);
    setPicks(null);
    setMeta(null);
    setLoading(true);
    try {
      const res = await fetch('/api/v1/gifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          occasion,
          budgetText: budgetText.trim(),
          country,
          interests: interests.split(',').map((s) => s.trim()).filter(Boolean),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? 'Gift recommendations failed.');
        return;
      }
      setPicks(Array.isArray(data.data) ? data.data : []);
      setMeta(data?.meta ?? null);
    } catch {
      setError('Gift recommendations failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      {/* Section 16, item 14: page-level JSON-LD (WebPage + BreadcrumbList). */}
      <PageJsonLd
        name="Gift Finder"
        description="Tell us the occasion, budget, recipient’s country and interests, and we’ll match real catalog products with real prices, deals, and stores."
        path="/gifts"
        crumbs={[ { name: "Home", path: "/" }, { name: "Gift Finder" } ]}
      />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl space-y-6">
          <div>
            <h1 className="flex items-center gap-2 text-3xl font-bold">
              <Gift className="h-7 w-7 text-pink-600" /> {tFor(language, 'pageHeadingGifts')}
            </h1>
            <p className="mt-2 text-muted-foreground">
              Tell us the occasion, your budget, the recipient&apos;s country and interests, and
              we&apos;ll match real catalog products with real prices, deals, and stores. Picks are
              matched from the catalog — no AI model writes them, and nothing is ever forced outside
              your budget.
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Find a gift</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="block text-sm font-medium">Occasion</label>
              <div className="flex flex-wrap gap-2">
                {OCCASIONS.map((o) => (
                  <Button
                    key={o}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setOccasion(o)}
                    className={`h-auto rounded-full px-3 py-1.5 text-sm ${occasion === o ? 'border-pink-600 bg-pink-600 text-white hover:bg-pink-600 hover:text-white' : 'bg-card dark:bg-muted'}`}
                  >
                    {o}
                  </Button>
                ))}
              </div>
              <label className="block text-sm font-medium">Budget (hard limit — picks never exceed it; leave blank for no budget limit)</label>
              <Input
                placeholder='e.g. under 20K PKR, under $500, under €300'
                value={budgetText}
                onChange={(e) => setBudgetText(e.target.value)}
              />
              <label className="block text-sm font-medium">Recipient&apos;s country</label>
              <select
                value={country}
                aria-label="Recipient's country"
                onChange={(e) => setCountry(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
              >
                {REGIONS.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.name} ({r.currency})
                  </option>
                ))}
              </select>
              <label className="block text-sm font-medium">Recipient&apos;s interests (comma-separated)</label>
              <Input
                placeholder="e.g. headphones, fitness, photography"
                value={interests}
                onChange={(e) => setInterests(e.target.value)}
              />
              <Button onClick={run} disabled={loading} className="w-full">
                <Search className="mr-2 h-4 w-4" /> {loading ? 'Matching…' : 'Find gifts'}
              </Button>
              <Button type="button" variant="outline" onClick={copyShareLink} className="w-full">
                {shareCopied ? 'Share link copied' : 'Copy share link'}
              </Button>
              {/* Hidden fallback target for browsers without clipboard
                  permission: copyShareLink writes the URL here so the
                  user can select and copy it by hand. */}
              <input id="gift-share-link" readOnly aria-hidden="true" tabIndex={-1} className="sr-only" defaultValue="" />
              <p className="text-xs text-muted-foreground">
                The share link carries your occasion, budget, country, and interests — opening it
                re-runs the same search.
              </p>
              {loading && <LoadingSpinner />}
              {error && <p className="text-sm text-red-600">{error}</p>}
            </CardContent>
          </Card>

          {picks !== null && picks.length === 0 && (
            <Card>
              <CardContent className="p-4 text-sm text-muted-foreground">
                No gifts match this budget and these interests. Try a wider budget or fewer
                interests — we&apos;d rather show nothing than an irrelevant pick.
              </CardContent>
            </Card>
          )}

          {picks !== null && picks.length > 0 && (
            <div className="space-y-4">
              {meta?.shippingNote && (
                <Card>
                  <CardContent className="p-4 text-sm text-muted-foreground">{meta.shippingNote}</CardContent>
                </Card>
              )}
              {/* Step B: affiliate disclosure, rendered ONLY when the
                  server reports a real tag/publisher id configured. */}
              {meta?.affiliateEnabled && (
                <p className="text-xs text-muted-foreground">
                  Affiliate disclosure: SmartBuy may earn a commission from qualifying purchases
                  made through these retailer links, at no extra cost to you.
                </p>
              )}
              {picks.map((pick) => (
                <Card key={pick.slug}>
                  <CardContent className="space-y-2 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold">{pick.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {[pick.brand, pick.category, pick.merchantName].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      {pick.bestPriceUsd !== null && (
                        <Price usd={pick.bestPriceUsd} className="shrink-0 font-bold text-blue-600" />
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {pick.why.map((w, i) => (
                        <Badge key={i} variant="secondary" className="font-normal">
                          {w}
                        </Badge>
                      ))}
                      {pick.couponLabel && <Badge className="bg-green-100 text-green-800">{pick.couponLabel}</Badge>}
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Link className="text-sm text-blue-600 underline" href={`/products/${pick.slug}`}>
                        View product
                      </Link>
                      {pick.storeLinks.slice(0, 3).map((s) => (
                        <a
                          key={s.name}
                          className="text-sm text-blue-600 underline"
                          href={s.searchUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() =>
                            trackAffiliateClick({
                              productSlug: pick.slug,
                              merchantName: s.name,
                              targetUrl: s.searchUrl,
                            })
                          }
                        >
                          Search on {s.name}
                        </a>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
