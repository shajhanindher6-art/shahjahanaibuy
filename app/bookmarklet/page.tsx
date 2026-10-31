'use client';

/**
 * Bookmarklet guide page: /bookmarklet
 *
 * Teaches visitors how to track products from any external shopping
 * site without installing anything: drag the bookmarklet link to
 * the bookmarks bar, open a product page elsewhere, click it, and
 * the panel from public/bookmarklet.js appears with Search / Track
 * actions. The bookmarklet URL is built from this page's own origin
 * so it works on the live site and on local dev alike.
 *
 * Also notes the full browser extension (extension/ folder) as the
 * alternative for sites whose Content Security Policy blocks the
 * bookmarklet script.
 */

import { useState, useEffect } from 'react';
import { Bookmark, MousePointerClick, Search, Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';

export default function BookmarkletPage() {
  const [origin, setOrigin] = useState('https://aismartbuy.netlify.app');

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const bookmarkletCode =
    `javascript:(function(){var d=document,s=d.createElement('script');` +
    `s.src='${origin}/bookmarklet.js';d.body.appendChild(s);})();`;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl space-y-6">
          <div>
            <h1 className="flex items-center gap-2 text-3xl font-bold">
              <Bookmark className="h-7 w-7 text-blue-600" /> Track from any store
            </h1>
            <p className="mt-2 text-muted-foreground">
              No extension install needed. Add the SmartBuy bookmarklet once, then track
              products from Amazon, Walmart, Best Buy, eBay, or any other shopping site.
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Step 1 — Add it to your bookmarks bar</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Drag this link to your bookmarks bar (if the bar is hidden, press Ctrl+Shift+B
                in Chrome / Edge, or Cmd+Shift+B on Mac):
              </p>
              <div>
                <a
                  href={bookmarkletCode}
                  className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                  onClick={(e) => e.preventDefault()}
                  title="Drag me to your bookmarks bar"
                >
                  <Bookmark className="h-4 w-4" /> Track on SmartBuy
                </a>
              </div>
              <p className="text-sm text-muted-foreground">
                Prefer to do it manually? Create a new bookmark, name it “Track on SmartBuy”,
                and paste this as its URL:
              </p>
              <code className="block break-all rounded-md bg-slate-100 p-3 text-xs dark:bg-slate-800">
                {bookmarkletCode}
              </code>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Step 2 — Use it while shopping</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3 text-sm">
                <li className="flex gap-2">
                  <MousePointerClick className="h-4 w-4 shrink-0 text-blue-600" />
                  <span>Open any product page on an external shopping site.</span>
                </li>
                <li className="flex gap-2">
                  <Bookmark className="h-4 w-4 shrink-0 text-blue-600" />
                  <span>Click the “Track on SmartBuy” bookmark. A panel appears with the product title and detected price.</span>
                </li>
                <li className="flex gap-2">
                  <Search className="h-4 w-4 shrink-0 text-blue-600" />
                  <span>Click “Search on SmartBuy” to find the matching product here, or “Track this product” to open the tracking page.</span>
                </li>
                <li className="flex gap-2">
                  <Bell className="h-4 w-4 shrink-0 text-blue-600" />
                  <span>On the SmartBuy product page, set a price alert with your target price — you will be emailed when it drops.</span>
                </li>
              </ol>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Good to know</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>
                The bookmarklet sends nothing anywhere on its own — it only opens SmartBuy
                pages when you click a button, and price detection is best-effort (some
                stores mark prices up in ways it cannot read; the panel then shows the
                title without a price).
              </p>
              <p>
                If a site blocks the bookmarklet with a strict Content Security Policy,
                use the full browser extension instead: load the <code>extension/</code>{' '}
                folder as an unpacked extension in developer mode. It covers Amazon,
                Walmart, Best Buy, eBay, and AliExpress with the same price detection.
              </p>
              <Button variant="outline" onClick={() => window.open('/track', '_blank')}>
                Open the tracking page
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
