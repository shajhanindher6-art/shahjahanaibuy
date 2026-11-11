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

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Mail } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import type { PriceDropDigest } from '@/lib/price-drop-digest';

interface DigestResponse {
  digest: PriceDropDigest | null;
  preference: { frequency: 'daily' | 'weekly'; isActive: boolean };
  preferencesEnabled?: boolean;
  note?: string;
}

export default function PriceDropDigestPage() {
  const [digest, setDigest] = useState<PriceDropDigest | null>(null);
  const [frequency, setFrequency] = useState<'daily' | 'weekly'>('weekly');
  const [isActive, setIsActive] = useState(true);
  const [preferencesEnabled, setPreferencesEnabled] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (freq: 'daily' | 'weekly') => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/v1/tools/digest?frequency=${freq}`);
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success && json.data) {
        const data = json.data as DigestResponse;
        setDigest(data.digest);
        setFrequency(data.preference.frequency);
        setIsActive(data.preference.isActive);
        setPreferencesEnabled(data.preferencesEnabled !== false);
        setNote(data.note ?? null);
      } else if (res.status === 401) {
        setFailed(true);
        setNote('Sign in to see your price-drop digest.');
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load('weekly');
  }, [load]);

  async function changeFrequency(freq: 'daily' | 'weekly') {
    setError(null);
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
            <Mail className="h-7 w-7 text-blue-600" /> Price-drop digest
          </h1>
          <p className="mt-2 text-muted-foreground">
            One summary of the price drops on the products you watch — top
            deals first, with one line per deal explaining why it is a
            deal. Nothing you do not watch ever appears here. The digest
            is assembled with deterministic rules from recorded price
            drops on products you watch — no LLM, nothing guessed.
          </p>

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
            <Button variant="outline" onClick={() => void toggleActive()} disabled={saving || loading}>
              {isActive ? 'Pause digest' : 'Resume digest'}
            </Button>
          </div>
          {!preferencesEnabled ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Digest preferences are not set up yet — the owner still needs
              to run migration 033 once. The digest below still uses the
              weekly default.
            </p>
          ) : null}
          {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

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
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
