'use client';

/**
 * Tracking landing page: /track?title=&price=&url=&image=
 *
 * Destination of the bookmarklet's "Track this product" button.
 * It shows what the bookmarklet extracted from the external page
 * and gives the visitor the two real next steps: search SmartBuy
 * for the matching product, then set a price alert on its product
 * page. It does NOT invent a SmartBuy product or price record —
 * an external product only becomes trackable once it is matched
 * to a product already in SmartBuy's catalog.
 */

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ExternalLink, Search, Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';

function TrackContent() {
  const params = useSearchParams();
  const title = params.get('title') ?? '';
  const price = params.get('price');
  const url = params.get('url') ?? '';
  const image = params.get('image') ?? '';

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Track this product</h1>
        <p className="mt-2 text-muted-foreground">
          This is what the bookmarklet found on the external page. Find the matching
          product on SmartBuy, then set a price alert on its page.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Found on the external store</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt={title || 'Product'} className="h-40 w-auto rounded-md object-contain" />
          )}
          <p className="font-medium">{title || 'No product title was detected.'}</p>
          {price !== null && <p className="text-lg font-semibold text-green-600">${Number(price).toFixed(2)}</p>}
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-sm text-blue-600 hover:underline"
            >
              View original page <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Next steps</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button asChild className="w-full sm:w-auto">
            <Link href={title ? `/search?q=${encodeURIComponent(title)}` : '/search'}>
              <Search className="mr-2 h-4 w-4" /> Search SmartBuy for this product
            </Link>
          </Button>
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <Bell className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Once you open the matching SmartBuy product page, use its Price Alert
              button to set your target price. You will be emailed when the price
              drops to that level.
            </span>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function TrackPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-12">
        <Suspense
          fallback={
            <div className="flex justify-center py-12">
              <LoadingSpinner size="lg" />
            </div>
          }
        >
          <TrackContent />
        </Suspense>
      </main>
      <SiteFooter />
    </div>
  );
}
