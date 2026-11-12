/**
 * AI Price-Drop Digest — /tools/digest (Section 7, item 10).
 *
 * Client page: the daily/weekly digest of price drops for the
 * products the user watches (their active alerts) — top deals first,
 * one line per deal explaining WHY it is a deal. A frequency toggle
 * (daily/weekly) saves the preference; pausing the digest is
 * supported too.
 *
 * A product the user does not watch never appears here, and a watched
 * product with no recent drop is simply absent — never invented.
 */

'use client';

import { useRegion } from '@/components/region/region-provider';
import { tFor } from '@/lib/i18n';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Mail } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { NewsletterCapture } from '@/components/home/newsletter-capture';
import { PushOptInPrompt } from '@/components/home/push-opt-in-prompt';
import type { PriceDropDigest, PriceHistoryPointInput, WatchedProductInput } from '@/lib/price-drop-digest';
import { buildPriceDropDigest } from '@/lib/price-drop-digest';
import { loadLocalAlerts } from '@/lib/local-alerts';

interface DigestResponse {
  digest: PriceDropDigest | null;
  preference: { frequency: 'daily' | 'weekly'; isActive: boolean };
  preferencesEnabled?: boolean;
  note?: string;
}

export default function PriceDropDigestPage() {
  const { language } = useRegion();
  const router = useRouter();
  const [digest, setDigest] = useState<PriceDropDigest | null>(null);
  const [frequency, setFrequency] = useState<'daily' | 'weekly'>('weekly');
  const [isActive, setIsActive] = useState(true);
  const [preferencesEnabled, setPreferencesEnabled] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Section 12, Chunk E — guest mode: the signed-in digest above
  // needs an account, but guests already watch products on this
  // device (local price-drop alerts, lib/local-alerts.ts). When the
  // API answers 401 we build the same digest locally from those
  // alerts + the public per-product price history — no login, no
  // email, no push. Frequency is recomputed locally; pause/save
  // need an account and stay signed-in-only.
  const [mode, setMode] = useState<'signed-in' | 'guest'>('signed-in');

  // Build the digest for a guest from on-device watched products.
  // Price history comes from the public prices endpoint per
  // product; a product whose history cannot be fetched is simply
  // absent from the deals — never invented. Returns null only when
  // the guest watches nothing on this device.
  const loadGuestDigest = useCallback(async (freq: 'daily' | 'weekly') => {
    setLoading(true);
    setFailed(false);
    try {
      const alerts = loadLocalAlerts();
      const seen = new Set<string>();
      const watched: WatchedProductInput[] = [];
      for (const alert of alerts) {
        if (seen.has(alert.productId)) continue;
        seen.add(alert.productId);
        watched.push({ productId: alert.productId, productName: alert.productName });
      }
      if (watched.length === 0) {
        setMode('guest');
        setDigest({
          frequency: freq,
          windowDays: freq === 'daily' ? 1 : 7,
          generatedAt: new Date().toISOString(),
          watchedCount: 0,
          deals: [],
        });
        setFrequency(freq);
        setIsActive(true);
        setPreferencesEnabled(false);
        setNote(
          'Guest mode — this digest is built on this device from the price-drop alerts you saved here. Sign in to get email digests and sync across devices.'
        );
        return;
      }

      // Resolve product ids to slugs via the public products list
      // (catalog is small; pageSize 100 covers it). A watched
      // product that no longer resolves keeps its name but gets no
      // history — and therefore no deal.
      const slugById = new Map<string, string>();
      try {
        const listRes = await fetch('/api/v1/products?pageSize=100');
        const listJson = await listRes.json().catch(() => null);
        if (listRes.ok && Array.isArray(listJson?.data)) {
          for (const p of listJson.data as Array<{ id?: unknown; slug?: unknown }>) {
            if (typeof p?.id === 'string' && typeof p?.slug === 'string') {
              slugById.set(p.id, p.slug);
            }
          }
        }
      } catch {
        // No slug map — history fetches below simply cannot run.
      }

      const history: PriceHistoryPointInput[] = [];
      await Promise.all(
        watched.map(async (product) => {
          const slug = slugById.get(product.productId);
          if (!slug) return;
          try {
            const res = await fetch(`/api/v1/products/${encodeURIComponent(slug)}/prices?limit=100`);
            const json = await res.json().catch(() => null);
            if (!res.ok || !Array.isArray(json?.data?.history)) return;
            for (const point of json.data.history as Array<Record<string, unknown>>) {
              const price = typeof point.price === 'number' ? point.price : parseFloat(String(point.price));
              if (Number.isFinite(price) && typeof point.recordedAt === 'string') {
                history.push({ productId: product.productId, price, recordedAt: point.recordedAt });
              }
            }
          } catch {
            // One product's history failing never blocks the rest.
          }
        })
      );

      setMode('guest');
      setDigest(buildPriceDropDigest(watched, history, freq));
      setFrequency(freq);
      setIsActive(true);
      setPreferencesEnabled(false);
      setNote(
        'Guest mode — this digest is built on this device from the price-drop alerts you saved here. Sign in to get email digests and sync across devices.'
      );
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Section 13, item 56 — frequency is shareable via
  // ?frequency=daily|weekly (same pattern as /search and /deals:
  // weekly is the default, so it stays off the URL). The API
  // honors ?frequency= over the saved preference, so a shared link
  // shows the window the sender saw.
  const writeDigestUrl = useCallback(
    (freq: 'daily' | 'weekly') => {
      router.replace(
        freq === 'daily' ? '/tools/price-drop-digest?frequency=daily' : '/tools/price-drop-digest'
      );
    },
    [router]
  );

  const load = useCallback(async (freq: 'daily' | 'weekly') => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/v1/tools/digest?frequency=${freq}`);
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success && json.data) {
        const data = json.data as DigestResponse;
        setMode('signed-in');
        setDigest(data.digest);
        setFrequency(data.preference.frequency);
        // The server answers with the effective frequency (?frequency=
        // wins over the saved preference) — keep the URL on the same
        // window so a copied link reproduces this view.
        writeDigestUrl(data.preference.frequency);
        setIsActive(data.preference.isActive);
        setPreferencesEnabled(data.preferencesEnabled !== false);
        setNote(data.note ?? null);
      } else if (res.status === 401) {
        // Not signed in — fall back to the on-device guest digest
        // instead of the old "Sign in to see your digest" wall.
        await loadGuestDigest(freq);
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [loadGuestDigest, writeDigestUrl]);

  useEffect(() => {
    let initial: 'daily' | 'weekly' = 'weekly';
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('frequency') === 'daily') initial = 'daily';
    } catch {
      // Defaults stand.
    }
    void load(initial);
    // Mount-only: load is stable (useCallback with stable deps).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function changeFrequency(freq: 'daily' | 'weekly') {
    setError(null);
    // The URL is the shareable state — sync it before the fetch so
    // a copied link always matches the window on screen.
    writeDigestUrl(freq);
    // Guest mode: no server preference to save — recompute the
    // on-device digest with the new window instead.
    if (mode === 'guest') {
      await loadGuestDigest(freq);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/v1/tools/digest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frequency: freq, is_active: isActive }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setError(
          res.status === 401
            ? 'Sign in to save a digest preference.'
            : res.status === 503
              ? 'Digest preferences are not set up yet — the owner still needs to run migration 033 once.'
              : 'Could not save the digest preference.'
        );
        return;
      }
      await load(freq);
    } catch {
      setError('Could not save the digest preference.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive() {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch('/api/v1/tools/digest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frequency, is_active: !isActive }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setError(
          res.status === 503
            ? 'Digest preferences are not set up yet — the owner still needs to run migration 033 once.'
            : 'Could not update the digest preference.'
        );
        return;
      }
      await load(frequency);
    } catch {
      setError('Could not update the digest preference.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Mail className="h-7 w-7 text-blue-600" /> {tFor(language, 'toolHeadingPriceDropDigest')}
          </h1>
          <p className="mt-2 text-muted-foreground">
            One summary of the price drops on the products you watch — top
            deals first, with one line per deal explaining why it is a
            deal. Nothing you do not watch ever appears here. The digest
            is assembled with deterministic rules from recorded price
            drops on products you watch — no LLM, nothing guessed.
          </p>
          {mode === 'guest' ? (
            <p className="mt-3 rounded-lg border bg-muted/50 p-3 text-sm text-muted-foreground">
              Guest mode — this digest is built on this device from the
              price-drop alerts you saved here. No login, no email, no
              push. Sign in to save digest preferences and sync across
              devices.
            </p>
          ) : null}

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium">Frequency:</span>
            <Button
              variant={frequency === 'daily' ? 'default' : 'outline'}
              onClick={() => void changeFrequency('daily')}
              disabled={saving || loading}
            >
              Daily
            </Button>
            <Button
              variant={frequency === 'weekly' ? 'default' : 'outline'}
              onClick={() => void changeFrequency('weekly')}
              disabled={saving || loading}
            >
              Weekly
            </Button>
            {/* Pause/resume is a saved server preference — guests
                have none, so the guest digest is always on. */}
            {mode === 'signed-in' ? (
              <Button variant="outline" onClick={() => void toggleActive()} disabled={saving || loading}>
                {isActive ? 'Pause digest' : 'Resume digest'}
              </Button>
            ) : null}
          </div>
          {mode === 'guest' ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Digest preferences (pause, email delivery) need an
              account — <Link href="/sign-in" className="underline underline-offset-4">sign in</Link> to
              set them.
            </p>
          ) : !preferencesEnabled ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Digest preferences are not set up yet — the owner still needs
              to run migration 033 once. The digest below still uses the
              weekly default.
            </p>
          ) : null}
          {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

          {/* Section 13, item 52 — push opt-in on the digest page:
              a drop in the digest is only useful if the visitor is
              told about it. The prompt gates itself on the VAPID
              check and stays honest when push is not configured. */}
          <PushOptInPrompt context="home" className="mt-6" />

          {loading ? (
            <div className="mt-8 flex justify-center">
              <LoadingSpinner />
            </div>
          ) : failed ? (
            <div className="mt-8 rounded-lg border p-6">
              <p className="font-medium">Could not load your digest.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {note ?? 'Please try again later.'}
              </p>
            </div>
          ) : digest === null ? (
            <div className="mt-8 rounded-lg border p-6">
              <p className="font-medium">Your digest is paused.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {note ?? 'Resume it above to see price drops for your watched products.'}
              </p>
            </div>
          ) : digest.deals.length === 0 ? (
            <div className="mt-8">
              <EmptyState
                title={
                  digest.watchedCount === 0
                    ? 'You are not watching any products yet'
                    : `No price drops in the last ${digest.windowDays === 1 ? '24 hours' : '7 days'}`
                }
                description={
                  digest.watchedCount === 0
                    ? 'Set a price-drop alert on a product and its drops will appear here.'
                    : 'None of your watched products dropped below its 30-day average in this window. Check back later.'
                }
              />
              <p className="mt-4 text-sm text-muted-foreground">
                Watching {digest.watchedCount} product{digest.watchedCount === 1 ? '' : 's'}.
              </p>
            </div>
          ) : (
            <div className="mt-8 space-y-4">
              <p className="text-sm text-muted-foreground">
                {digest.deals.length} drop{digest.deals.length === 1 ? '' : 's'} in the last{' '}
                {digest.windowDays === 1 ? '24 hours' : '7 days'} across {digest.watchedCount}{' '}
                watched product{digest.watchedCount === 1 ? '' : 's'}.
              </p>
              {digest.deals.map((deal) => (
                <article key={deal.productId} className="rounded-lg border p-6">
                  <h2 className="text-xl font-semibold">
                    {deal.productSlug ? (
                      <Link
                        href={`/products/${deal.productSlug}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {deal.productName ?? deal.productSlug}
                      </Link>
                    ) : (
                      deal.productName ?? deal.productId
                    )}
                  </h2>
                  <p className="mt-2 text-lg">
                    <strong>${deal.currentPrice.toFixed(2)}</strong>
                    <span className="text-muted-foreground">
                      {' '}
                      — {deal.percentBelowAverage.toFixed(1)}% below its 30-day average
                      (${deal.average30d.toFixed(2)})
                    </span>
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">{deal.reason}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Latest recorded price:{' '}
                    {new Date(deal.latestRecordedAt).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </p>
                </article>
              ))}
            </div>
          )}

          {note && digest !== null && digest.deals.length > 0 ? (
            <p className="mt-6 text-sm text-muted-foreground">{note}</p>
          ) : null}

          {/* Section 13, item 51 — deal-alert capture on the digest
              page (capture only; sending starts once email delivery
              is configured — see lib/newsletter.ts). */}
          <div className="mt-10">
            <NewsletterCapture source="digest" />
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
