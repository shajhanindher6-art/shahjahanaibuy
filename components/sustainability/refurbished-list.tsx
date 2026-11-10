import { Recycle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Price } from '@/components/region/price';
import type { RefurbishedListing } from '@/lib/sustainability';

/**
 * Certified refurbished listings (Section 5, item 18).
 *
 * Lists only listings an admin verified against a real source
 * (`refurbished_listings`, migration 029). The table starts empty
 * and the empty state says so plainly — no placeholder listings, no
 * "typical" refurbished price, no claimed certification that was
 * never checked.
 */
export function RefurbishedList({ listings }: { listings: RefurbishedListing[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Recycle className="h-5 w-5 text-emerald-600" /> Certified refurbished listings
        </CardTitle>
        <CardDescription>
          Second-hand and refurbished offers verified against a real source. Only
          certified-refurbished and refurbished conditions are listed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {listings.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No certified refurbished listings yet. Listings appear here only after an admin
            verifies one against a real source — SmartBuy does not invent refurbished offers or
            prices.
          </p>
        ) : (
          <ul className="space-y-2">
            {listings.map((listing) => (
              <li
                key={listing.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
              >
                <div>
                  <a
                    href={listing.listingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium hover:underline"
                  >
                    {listing.merchantName}
                  </a>
                  <p className="text-xs text-muted-foreground">
                    {listing.sourceNote ?? 'Verified against the merchant listing.'}
                    {listing.verifiedAt ? ` Verified ${listing.verifiedAt.slice(0, 10)}.` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">
                    {listing.condition === 'certified-refurbished'
                      ? 'Certified refurbished'
                      : 'Refurbished'}
                  </Badge>
                  {listing.priceUsd !== null ? (
                    <span className="text-sm font-medium">
                      <Price usd={listing.priceUsd} />
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">Price not recorded</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          Refurbished condition and certification are only claimed when the source listing says
          so. Always confirm condition, warranty, and returns with the seller before buying.
        </p>
      </CardContent>
    </Card>
  );
}
