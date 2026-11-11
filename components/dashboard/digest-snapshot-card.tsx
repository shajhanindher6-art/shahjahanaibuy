/**
 * Digest snapshot card — Section 13, Chunk F, item 48.
 *
 * DigestGrid shows saved items / alerts / recommendations but not
 * the price-drop digest deals (buildPriceDropDigest output). This
 * small card fetches the existing GET
 * /api/v1/tools/digest?frequency=weekly and shows this week's
 * digest deals — each product's drop versus its 30-day average —
 * linking to the product page. It renders the API's own honest
 * states: paused digest, no watched products, or no drops in the
 * window. A failed fetch hides the card instead of showing
 * invented deals.
 *
 * Extra new file (not in the Chunk F file list): item 48 needs a
 * home of its own — none of the 7 listed component files fits a
 * digest card, and no other chunk owns this item.
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Mail, TrendingDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { PriceDropDigest } from '@/lib/price-drop-digest';

interface DigestResponse {
  digest: PriceDropDigest | null;
  note?: string;
}

export function DigestSnapshotCard() {
  const [digest, setDigest] = useState<PriceDropDigest | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/v1/tools/digest?frequency=weekly')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled) return;
        if (json?.success && json.data) {
          const data = json.data as DigestResponse;
          setDigest(data.digest);
          setNote(typeof data.note === 'string' ? data.note : null);
        } else {
          setFailed(true);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5" aria-hidden="true" />
          This week&apos;s price-drop digest
        </CardTitle>
        <CardDescription>
          Drops on the products you watch, versus their 30-day average.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="glass-card animate-shimmer h-24" />
        ) : digest === null ? (
          <p className="text-sm text-muted-foreground">
            {note ?? 'Your weekly digest is not available right now.'}
          </p>
        ) : digest.deals.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {note ??
              `No price drops on your ${digest.watchedCount} watched product${digest.watchedCount === 1 ? '' : 's'} in the last 7 days.`}
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {digest.deals.length} deal{digest.deals.length === 1 ? '' : 's'} · watching {digest.watchedCount} product
              {digest.watchedCount === 1 ? '' : 's'}
            </p>
            <ul className="space-y-2">
              {digest.deals.slice(0, 3).map((deal) => (
                <li key={deal.productId}>
                  <Link
                    href={deal.productSlug ? `/products/${deal.productSlug}` : '/tools/price-drop-digest'}
                    className="flex items-center justify-between gap-3 rounded-lg border p-3 transition-colors hover:bg-accent"
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 text-sm font-medium">
                        <TrendingDown className="h-4 w-4 shrink-0 text-green-600" aria-hidden="true" />
                        <span className="truncate">{deal.productName ?? 'Watched product'}</span>
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {deal.reason}
                      </span>
                    </span>
                    <Badge variant="secondary" className="shrink-0">
                      {deal.percentBelowAverage.toFixed(1)}% below avg
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
            <Link href="/tools/price-drop-digest" className="text-sm font-medium text-primary hover:underline">
              View full digest →
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
