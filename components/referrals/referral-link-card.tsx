/**
 * Referral link card (Section 14, chunk 9) — the interactive part of
 * /referrals. Creates (or fetches the existing) referral link for
 * this visitor via lib/referral.ts `createReferralLink` and shows its
 * click count. A failed fetch shows an honest error instead of an
 * invented link. Copy uses the clipboard API with a text-field
 * fallback, following the dashboard ReferralCard pattern.
 */
'use client';

import { useState } from 'react';
import { Copy, Check, Link2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { createReferralLink } from '@/lib/referral';

export function ReferralLinkCard() {
  const [url, setUrl] = useState<string | null>(null);
  const [clicks, setClicks] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleCreate() {
    setLoading(true);
    setError(null);
    const result = await createReferralLink();
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setUrl(result.url);
    setClicks(result.clicks);
  }

  async function handleCopy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard unavailable — select the link text instead.
      const el = document.getElementById('referral-link-text') as HTMLInputElement | null;
      el?.focus();
      el?.select();
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2 className="h-4 w-4" /> Your referral link
        </CardTitle>
        <CardDescription>
          One link per account (or per browser, for guests). Share it anywhere — every visit
          through it counts as one click.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {url === null ? (
          <Button onClick={handleCreate} disabled={loading}>
            {loading ? 'Creating…' : 'Get my referral link'}
          </Button>
        ) : (
          <>
            <input
              id="referral-link-text"
              readOnly
              value={url}
              aria-label="Referral link"
              className="w-full rounded-md border bg-muted px-3 py-2 text-sm"
              onFocus={(e) => e.target.select()}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={handleCopy} size="sm" variant="outline">
                {copied ? (
                  <>
                    <Check className="mr-1 h-4 w-4" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="mr-1 h-4 w-4" /> Copy link
                  </>
                )}
              </Button>
              {clicks !== null && (
                <span className="text-sm text-muted-foreground">
                  {clicks} click{clicks !== 1 ? 's' : ''} so far
                </span>
              )}
            </div>
          </>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </CardContent>
    </Card>
  );
}
