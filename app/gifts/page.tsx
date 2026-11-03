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

import { useState } from 'react';
import Link from 'next/link';
import { Gift, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { Price } from '@/components/region/price';
import { REGIONS } from '@/lib/region';

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
  const [occasion, setOccasion] = useState('Birthday');
  const [budgetText, setBudgetText] = useState('');
  const [country, setCountry] = useState('US');
  const [interests, setInterests] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picks, setPicks] = useState<GiftPick[] | null>(null);
  const [meta, setMeta] = useState<{ shippingNote?: string; storeKind?: string } | null>(null);

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
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl space-y-6">
          <div>
            <h1 className="flex items-center gap-2 text-3xl font-bold">
              <Gift className="h-7 w-7 text-pink-600" /> Gift Finder
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
                  <button
                    key={o}
                    onClick={() => setOccasion(o)}
                    className={`rounded-full border px-3 py-1.5 text-sm ${occasion === o ? 'border-pink-600 bg-pink-600 text-white' : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800'}`}
                  >
                    {o}
                  </button>
                ))}
              </div>
              <label className="block text-sm font-medium">Budget (hard limit — picks never exceed it)</label>
              <Input
                placeholder='e.g. under 20K PKR, under $500, under €300'
                value={budgetText}
                onChange={(e) => setBudgetText(e.target.value)}
              />
              <label className="block text-sm font-medium">Recipient&apos;s country</label>
              <select
                value={country}
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
                        <a key={s.name} className="text-sm text-blue-600 underline" href={s.searchUrl} target="_blank" rel="noopener noreferrer">
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
