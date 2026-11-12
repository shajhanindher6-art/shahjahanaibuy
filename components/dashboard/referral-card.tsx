/**
 * Referral + creator-credit card — Section 13, Chunk F, item 46.
 *
 * No dashboard view of either existed. Self-fetching card:
 *   - GET /api/v1/creator-rewards/me → points, verified deals,
 *     badge, next badge (honest zero state when the user has never
 *     earned a reward or migration 031 has not run).
 *   - POST /api/v1/referrals → the user's own referral link
 *     ({code, url, clicks}); one link per owner, created on first
 *     call. Referral credit is points and badges only — never money
 *     (Section 12 rule).
 *
 * A failed fetch hides the card instead of showing invented
 * points, clicks, or a guessed link. Copy uses the clipboard API
 * with a text-field fallback for browsers without clipboard
 * permission.
 */

'use client';

import { useRegion } from '@/components/region/region-provider';
import { tFor } from '@/lib/i18n';
import { useEffect, useState } from 'react';
import { Copy, Check, Share2, Award, Link2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { badgeLabel, type CreatorBadge, type BadgeThreshold } from '@/lib/creator-rewards';

interface RewardsMe {
  points: number;
  verifiedDeals: number;
  badge: CreatorBadge;
  badgeLabel: string;
  nextBadge: BadgeThreshold | null;
}

interface ReferralLink {
  code: string;
  url: string;
  clicks: number;
}

export function ReferralCard() {
  const { language } = useRegion();
  const [rewards, setRewards] = useState<RewardsMe | null>(null);
  const [referral, setReferral] = useState<ReferralLink | null>(null);
  // Section 15, B13 — the referrer's own signup count from real
  // referral_signups rows (GET /api/v1/referrals?mine=1). null
  // means "unknown / unavailable" (e.g. migration 038 not applied
  // yet): no count line is shown then, never a guessed number.
  const [signups, setSignups] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('/api/v1/creator-rewards/me')
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => {
          if (!cancelled && json?.success && json.data) setRewards(json.data as RewardsMe);
        })
        .catch(() => undefined),
      fetch('/api/v1/referrals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => {
          if (!cancelled && json?.success && json.data?.url) setReferral(json.data as ReferralLink);
        })
        .catch(() => undefined),
      fetch('/api/v1/referrals?mine=1')
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => {
          // Only a real, available count is ever shown. When the
          // count is unavailable the line stays hidden; when it
          // is 0 the honest empty state below renders instead.
          if (
            !cancelled &&
            json?.success &&
            json.data?.available === true &&
            typeof json.data?.signups === 'number'
          ) {
            setSignups(json.data.signups);
          }
        })
        .catch(() => undefined),
    ]).then(() => {
      if (!cancelled) setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Both sources failed (e.g. signed out): hide, never invent.

  async function handleCopy() {
    if (!referral) return;
    try {
      await navigator.clipboard.writeText(referral.url);
      setCopied(true);
    } catch {
      // Clipboard unavailable — select the link text instead.
      const el = document.getElementById('referral-link-text');
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
      setCopied(true);
    }
    setTimeout(() => setCopied(false), 2000);
  }

  if (loaded && rewards === null && referral === null) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Share2 className="h-5 w-5" aria-hidden="true" />
          Refer &amp; earn creator credit
        </CardTitle>
        <CardDescription>
          Share your referral link — friends who join earn you points and badges, never money.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {referral ? (
          <div>
            <p className="text-xs font-medium text-muted-foreground">{tFor(language, 'dashReferralLink')}</p>
            <div className="mt-1 flex items-center gap-2">
              <code id="referral-link-text" className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 text-xs">
                {referral.url}
              </code>
              <Button size="sm" variant="outline" onClick={handleCopy} aria-label="Copy referral link">
                {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
              {referral.clicks} click{referral.clicks === 1 ? '' : 's'} so far
            </p>
            {signups !== null && signups > 0 && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                {signups} friend{signups === 1 ? '' : 's'} joined
              </p>
            )}
            {signups === 0 && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                No friends have joined yet — share your link to get started.
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Your referral link is not available yet — it is created when referral links are enabled for your account.
          </p>
        )}
        {rewards && (
          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            <Award className="h-4 w-4 text-amber-600" aria-hidden="true" />
            <Badge variant="secondary">{badgeLabel(rewards.badge)}</Badge>
            <span className="text-sm">
              {rewards.points} point{rewards.points === 1 ? '' : 's'} · {rewards.verifiedDeals} verified deal
              {rewards.verifiedDeals === 1 ? '' : 's'}
            </span>
            {rewards.nextBadge && (
              <span className="text-xs text-muted-foreground">
                Next badge: {rewards.nextBadge.label} at {rewards.nextBadge.verifiedDeals} verified deals
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
