'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Star } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { getDealOfTheDay, type CuratedSlot } from '@/lib/curators';

/**
 * Curated deal of the day (Section 5, item 13).
 *
 * Shows the slot an admin curated for this region today — a real
 * product, with the curator's note when one was recorded. When no
 * slot exists (the normal state until curation starts), the honest
 * empty state is shown: no placeholder deal, no invented pick.
 * Reads the public `curated_slots` table directly (public SELECT,
 * migration 029); when the table does not exist yet the read fails
 * safe to the same empty state.
 */
export function CuratedDealOfTheDay({ regionCode }: { regionCode: string }) {
  const [slot, setSlot] = useState<CuratedSlot | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        const result = await getDealOfTheDay(supabase, regionCode);
        if (!cancelled) setSlot(result);
      } catch {
        if (!cancelled) setSlot(null);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [regionCode]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Star className="h-5 w-5 text-amber-500" /> Deal of the day — {regionCode}
        </CardTitle>
        <CardDescription>
          Hand-picked by a regional curator, checked against the recorded price. Not an
          algorithmic pick.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!loaded && <p className="text-sm text-muted-foreground">Checking today&apos;s curated deal…</p>}
        {loaded && slot === null && (
          <p className="text-sm text-muted-foreground">
            No curated deal today for {regionCode}. Curation for this market has not started yet —
            deals here still come from the regular rotation.
          </p>
        )}
        {loaded && slot !== null && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>Curated pick</Badge>
              <span className="text-xs text-muted-foreground">{slot.slotDate}</span>
            </div>
            {slot.productSlug && slot.productName ? (
              <Link href={`/products/${slot.productSlug}`} className="text-lg font-semibold hover:underline">
                {slot.productName}
              </Link>
            ) : (
              <p className="text-lg font-semibold">Curated product</p>
            )}
            {slot.note && <p className="text-sm text-muted-foreground">{slot.note}</p>}
            <p className="text-xs text-muted-foreground">
              Curated deals pass the curation guidelines: real recorded price, no fake-discount
              pattern, working retailer link. Upvotes never verify a deal.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
