'use client';

/**
 * Widget outbound-click tracker — client island inside the embed
 * iframe. Reports widget clicks the same way the site reports
 * affiliate clicks (POST /api/v1/affiliate/geo-click via
 * navigator.sendBeacon): product slug + target URL only. Never
 * the embedding page's URL, never a visitor id. Fire-and-forget —
 * a beacon failure never blocks navigation.
 */

import type { MouseEvent, ReactNode } from 'react';

export function EmbedClickTracker({ slug, children }: { slug: string; children: ReactNode }) {
  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    try {
      const anchor = (event.target as HTMLElement).closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor || !anchor.href) return;
      if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return;
      navigator.sendBeacon(
        '/api/v1/affiliate/geo-click',
        new Blob(
          [
            JSON.stringify({
              productSlug: slug,
              productId: null,
              merchantName: 'SmartBuy widget',
              targetUrl: anchor.href,
            }),
          ],
          { type: 'application/json' }
        )
      );
    } catch {
      // Silent by design — tracking must never disturb navigation.
    }
  };

  return <div onClick={handleClick}>{children}</div>;
}
