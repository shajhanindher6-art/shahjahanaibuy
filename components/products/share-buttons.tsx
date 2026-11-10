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

export function ShareButtons({ title, text, url, enableReferral }: ShareButtonsProps) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [referralBusy, setReferralBusy] = useState(false);
  const [referralCopied, setReferralCopied] = useState(false);

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
  );
}
