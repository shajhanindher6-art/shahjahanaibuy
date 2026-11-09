'use client';

import { useState } from 'react';
import { Share2, Link2, Check, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

/**
 * Share buttons (P0 fix, 2026-11-09 audit).
 *
 * The public UI had no share mechanism anywhere — a visitor who
 * found a good deal had no way to send it to anyone, so every good
 * deal was a dead end for growth. These buttons sit next to the
 * Compare / Wishlist actions on the product page.
 *
 * - Share: the native share sheet where the browser offers one
 *   (mobile), otherwise copies the link.
 * - Copy link: copies the current page URL, always available.
 * - WhatsApp: opens wa.me with the page title + URL.
 * Nothing is tracked or sent to a server by this component.
 */

interface ShareButtonsProps {
  title: string;
  text?: string;
  url?: string;
}

export function ShareButtons({ title, text, url }: ShareButtonsProps) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

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
    </div>
  );
}
