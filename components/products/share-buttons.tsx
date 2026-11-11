'use client';

import { useState, useEffect } from 'react';
import { Share2, Link2, Check, MessageCircle, Twitter, Facebook, Gift } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import {
  createReferralLink,
  parseReferralCodeFromSearch,
  recordReferralClick,
} from '@/lib/referral';

/**
 * Share buttons (P0 fix, 2026-11-09 audit; S3#10, 2026-11-10).
 *
 * The public UI had no share mechanism anywhere — a visitor who
 * found a good deal had no way to send it to anyone, so every good
 * deal was a dead end for growth. These buttons sit next to the
 * Compare / Wishlist actions on the product page, and on the
 * homepage + deals page (S3#10).
 *
 * - Share: the native share sheet where the browser offers one
 *   (mobile), otherwise copies the link.
 * - Copy link: copies the current page URL, always available.
 * - WhatsApp / X / Facebook: open the network's share intent with
 *   the page title + URL.
 * - Referral link (opt-in via `enableReferral`): creates the
 *   visitor's own referral link (POST /api/v1/referrals) and copies
 *   it. THIS button contacts the server (clicks are tracked, no IP
 *   or user agent stored); the other buttons send nothing anywhere.
 */

interface ShareButtonsProps {
  title: string;
  text?: string;
  url?: string;
  /** Show the referral-link button (homepage / deals / product). */
  enableReferral?: boolean;
}

// Section 12, Chunk E — referral credit display (NON-monetary
// only). The creator-rewards ladder (lib/creator-rewards.ts) is
// points + badges for VERIFIED deals — 10 points per verified deal,
// Bronze at 1, Silver at 5, Gold at 15, Platinum at 30. GET
// /api/v1/creator-rewards/me returns the signed-in visitor's own
// points, verified-deal count, badge and next badge. The line below
// shows ONLY when that fetch succeeds and the visitor actually has
// points or verified deals — guests (401) and zero-state accounts
// see nothing, never a guessed count. No money anywhere: revenue
// share is unconfigured (Stripe is in test mode, revenue $0), so no
// payout or dollar amount is ever shown. "Friends joined" is NOT
// shown either — no data source counts signups from a referral
// link (the referrals API records clicks only), so inventing a
// joined count would be fake.
interface CreatorRewardsSummary {
  points: number;
  verifiedDeals: number;
  badgeLabel: string;
  nextBadge: { label: string; verifiedDeals: number } | null;
}

export function ShareButtons({ title, text, url, enableReferral }: ShareButtonsProps) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [referralBusy, setReferralBusy] = useState(false);
  const [referralCopied, setReferralCopied] = useState(false);
  // Section 12, Chunk E: the visitor's own creator-rewards
  // summary (points + badge, non-monetary). Null until a successful
  // fetch proves the data exists — never a placeholder.
  const [rewards, setRewards] = useState<CreatorRewardsSummary | null>(null);

  // Load the rewards summary only where the referral button is
  // shown. Signed-out visitors get a 401 and see nothing; a failed
  // fetch also shows nothing — the share buttons never depend on it.
  useEffect(() => {
    if (!enableReferral) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/v1/creator-rewards/me');
        if (!res.ok) return;
        const json = await res.json().catch(() => null);
        const data = json?.data as
          | {
              points?: unknown;
              verifiedDeals?: unknown;
              badgeLabel?: unknown;
              nextBadge?: unknown;
            }
          | undefined;
        if (!data || cancelled) return;
        const points = typeof data.points === 'number' ? data.points : 0;
        const verifiedDeals =
          typeof data.verifiedDeals === 'number' ? data.verifiedDeals : 0;
        if (points <= 0 && verifiedDeals <= 0) return;
        const nextBadge =
          data.nextBadge &&
          typeof data.nextBadge === 'object' &&
          typeof (data.nextBadge as { label?: unknown }).label === 'string' &&
          typeof (data.nextBadge as { verifiedDeals?: unknown }).verifiedDeals ===
            'number'
            ? (data.nextBadge as { label: string; verifiedDeals: number })
            : null;
        setRewards({
          points,
          verifiedDeals,
          badgeLabel:
            typeof data.badgeLabel === 'string' ? data.badgeLabel : 'No badge yet',
          nextBadge,
        });
      } catch {
        // No rewards line — sharing still works.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enableReferral]);

  // S3#10: record one referral click when the page was opened via a
  // referral link (?ref=sb-…). Once per code per browser session,
  // fire-and-forget — a missed click never breaks the page.
  useEffect(() => {
    try {
      if (typeof window === 'undefined') return;
      const code = parseReferralCodeFromSearch(window.location.search);
      if (!code) return;
      const seenKey = `sb-ref-recorded:${code}`;
      if (window.sessionStorage.getItem(seenKey)) return;
      window.sessionStorage.setItem(seenKey, '1');
      void recordReferralClick(code);
    } catch {
      // Never break rendering for click tracking.
    }
  }, []);

  const shareUrl =
    url ?? (typeof window !== 'undefined' ? window.location.href : '');
  const shareText = text ?? title;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      // Clipboard API unavailable (old browser / insecure context) —
      // fall back to a prompt-less selection via a temporary input.
      const input = document.createElement('input');
      input.value = shareUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
    }
    setCopied(true);
    toast({ title: 'Link copied', description: 'Share it anywhere you like.' });
    window.setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title, text: shareText, url: shareUrl });
        return;
      } catch {
        // User dismissed the sheet (AbortError) or share failed —
        // fall through to copy instead of showing an error.
      }
    }
    await copyLink();
  };

  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(
    `${shareText} ${shareUrl}`
  )}`;

  const xUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
    shareText
  )}&url=${encodeURIComponent(shareUrl)}`;

  const facebookUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(
    shareUrl
  )}`;

  const handleReferralLink = async () => {
    setReferralBusy(true);
    try {
      const result = await createReferralLink();
      if (!result.ok) {
        toast({ title: 'Referral link unavailable', description: result.error, variant: 'destructive' });
        return;
      }
      try {
        await navigator.clipboard.writeText(result.url);
      } catch {
        const input = document.createElement('input');
        input.value = result.url;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
      }
      setReferralCopied(true);
      toast({
        title: 'Referral link copied',
        description:
          result.clicks > 0
            ? `Share it anywhere — ${result.clicks} click${result.clicks === 1 ? '' : 's'} so far.`
            : 'Share it anywhere — clicks on your link are counted.',
      });
      window.setTimeout(() => setReferralCopied(false), 2000);
    } finally {
      setReferralBusy(false);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={handleShare}>
        <Share2 className="mr-2 h-4 w-4" /> Share
      </Button>
      <Button variant="outline" size="sm" onClick={copyLink}>
        {copied ? (
          <Check className="mr-2 h-4 w-4 text-green-500" />
        ) : (
          <Link2 className="mr-2 h-4 w-4" />
        )}
        {copied ? 'Copied' : 'Copy link'}
      </Button>
      <Button variant="outline" size="sm" asChild>
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Share on WhatsApp"
        >
          <MessageCircle className="mr-2 h-4 w-4" /> WhatsApp
        </a>
      </Button>
      <Button variant="outline" size="sm" asChild>
        <a
          href={xUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Share on X"
        >
          <Twitter className="mr-2 h-4 w-4" /> X
        </a>
      </Button>
      <Button variant="outline" size="sm" asChild>
        <a
          href={facebookUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Share on Facebook"
        >
          <Facebook className="mr-2 h-4 w-4" /> Facebook
        </a>
      </Button>
      {enableReferral && (
        <Button variant="outline" size="sm" onClick={handleReferralLink} disabled={referralBusy}>
          {referralCopied ? (
            <Check className="mr-2 h-4 w-4 text-green-500" />
          ) : (
            <Gift className="mr-2 h-4 w-4" />
          )}
          {referralBusy ? 'Creating…' : referralCopied ? 'Referral copied' : 'Referral link'}
        </Button>
      )}
      </div>
      {/* Section 12, Chunk E: referral credit — points + badge from
          the creator-rewards ladder, shown only when the data
          exists. Non-monetary by design: no payouts, no dollar
          amounts, no "friends joined" (no data source counts it). */}
      {enableReferral && rewards && (
        <p className="mt-2 text-xs text-muted-foreground">
          <Gift className="mr-1 inline h-3 w-3" />
          {rewards.badgeLabel} · {rewards.points} point
          {rewards.points !== 1 ? 's' : ''} · {rewards.verifiedDeals}{' '}
          verified deal{rewards.verifiedDeals !== 1 ? 's' : ''}
          {rewards.nextBadge
            ? ` · Next: ${rewards.nextBadge.label} at ${rewards.nextBadge.verifiedDeals} verified deals`
            : ' · Top badge earned'}
        </p>
      )}
    </div>
  );
}
