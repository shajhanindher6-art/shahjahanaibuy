'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Package } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DealScoreBadge } from '@/components/products/deal-score-badge';
import { StalePriceBadge } from '@/components/products/stale-price-badge';
import { Price } from '@/components/region/price';
import {
  priceVerificationLabel,
  normalizePriceVerificationStatus,
} from '@/services/price-verification';
import { cn } from '@/lib/utils';

export interface ProductCardData {
  id: string;
  name: string;
  slug: string;
  brand: string | null;
  category: string | null;
  imageUrl: string | null;
  description?: string | null;
  price?: number | null;
  /** Merchants with this product in stock (0 = unknown / none recorded). */
  merchantCount?: number | null;
  dealScore?: number | null;
  /**
   * Recorded price-history points behind dealScore (Section 16,
   * item 10). When dealScore is null and this is known and below
   * 5, the card says why the score is withheld instead of showing
   * no badge with no explanation.
   */
  dealScoreDataPoints?: number | null;
  /**
   * Recorded `products.data_freshness` (Section 16, item 9).
   * Drives the stale-price badge + age-in-days under the price;
   * null/undefined renders no label, never a guessed age.
   */
  dataFreshness?: string | null;
  /**
   * Section 17, Stage C item 14 (migration 045, unapplied):
   * verification of the shown price. When supplied, the card
   * renders the short honest label under the price; when absent
   * the card renders no verification claim at all — it never
   * assumes a price is verified.
   */
  priceVerificationStatus?: import('@/services/price-verification').PriceVerificationStatus;
  matchScore?: number | null;
  reason?: string | null;
}

interface ProductCardProps {
  product: ProductCardData;
  href?: string;
  className?: string;
  showReason?: boolean;
}

export function ProductCard({ product, href, className, showReason }: ProductCardProps) {
  const link = href ?? `/products/${product.slug}`;
  // A dead image URL (e.g. the Lenovo ThinkPad X1 image in Similar
  // Products) used to render as a broken-image icon. Fall back to the
  // same Package placeholder used when there is no image at all.
  const [imageFailed, setImageFailed] = useState(false);

  return (
    <Card className={cn('group cursor-pointer overflow-hidden transition-all hover:shadow-lg hover:border-blue-200 focus-within:ring-2 focus-within:ring-blue-600 dark:hover:border-blue-800', className)}>
      <Link href={link} aria-label={`View ${product.name}`} className="block focus-visible:outline-none">
        <div className="relative h-40 overflow-hidden bg-muted">
          {product.imageUrl && !imageFailed ? (
            <img
              src={product.imageUrl}
              alt={product.name}
              // Section 16, #47: intrinsic size for the layout — the
              // rendered box is fluid width (the xl 4-col grid card,
              // ~300px) × fixed h-40 (160px); CSS h-full w-full
              // object-cover still governs display, the attributes
              // only give the browser the aspect ratio.
              width={300}
              height={160}
              loading="lazy"
              decoding="async"
              onError={() => setImageFailed(true)}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <Package className="h-10 w-10 text-muted-foreground" />
            </div>
          )}
          {/* (g) A match/similarity score is NOT a Deal Score and must
              never wear the Deal Score badge: similar-products cards
              used to render matchScore through this badge, so the same
              product showed a different "Deal Score" on a similar card
              than on its own page (and the similar API's matchScore
              even includes a random component — see report). A real
              dealScore still gets the badge; a match-only card gets a
              neutral "Match N%" chip that cannot be mistaken for one. */}
          {product.dealScore != null && (
            <div className="absolute right-2 top-2">
              <DealScoreBadge
                score={product.dealScore}
                dataPoints={product.dealScoreDataPoints}
                size="sm"
              />
            </div>
          )}
          {product.dealScore == null && product.matchScore != null && (
            <div className="absolute right-2 top-2">
              {/* Intentionally NOT a design token (Section 10 sweep):
                  this chip sits on the product image and must stay a
                  dark translucent surface with white text in BOTH
                  modes — bg-foreground would flip light in dark mode. */}
              <span className="rounded-full bg-slate-900/80 px-2 py-1 text-xs font-semibold text-white">
                Match {Math.round(Math.max(0, Math.min(100, product.matchScore)))}%
              </span>
            </div>
          )}
        </div>
        <CardContent className="p-4">
          <div className="flex items-center gap-1.5">
            {product.brand && (
              <Badge variant="secondary" className="text-xs">{product.brand}</Badge>
            )}
            {product.category && (
              <Badge variant="outline" className="text-xs">{product.category}</Badge>
            )}
          </div>
          <h3 className="mt-1.5 font-semibold text-sm leading-tight line-clamp-2">{product.name}</h3>
          {product.description && (
            <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{product.description}</p>
          )}
          {product.price != null && (
            <p className="mt-2 text-lg font-bold text-blue-600">
              <Price usd={product.price} />
              {/* Section 14, chunk 5: how many merchants have it in
                  stock, from real merchant_products rows. Shown only
                  when the count is recorded (> 0); a card without a
                  recorded count shows no claim. */}
              {product.merchantCount != null && product.merchantCount > 0 && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  at {product.merchantCount} {product.merchantCount === 1 ? 'store' : 'stores'}
                </span>
              )}
            </p>
          )}
          {/* Section 16, item 9: stale-price badge + age-in-days
              under the price (nothing when the freshness is
              unknown). Only meaningful next to a shown price. */}
          {product.price != null && (
            <div className="mt-1">
              <StalePriceBadge dataFreshness={product.dataFreshness} />
            </div>
          )}
          {/* Section 17, Stage C item 14: short honest verification
              label under the price — only when the caller supplied
              a status (the /products list does, from the cheapest
              listing). Never claims "live"; the full label with
              the check date lives on the product detail page. */}
          {product.price != null && product.priceVerificationStatus && (
            <p className="mt-1 text-xs text-muted-foreground">
              {priceVerificationLabel(
                normalizePriceVerificationStatus(product.priceVerificationStatus),
                null
              ).shortText}
            </p>
          )}
          {/* Section 16, item 10: the withheld Deal Score note lives
              in the card body (not over the image, where the badge
              sits) — a card whose score is hidden for too few price
              points says why. Unknown count → no note, never a
              guessed count. */}
          {product.dealScore == null &&
            product.dealScoreDataPoints != null &&
            product.dealScoreDataPoints < 5 && (
              <p className="mt-1 text-xs text-muted-foreground">
                Deal Score withheld — {product.dealScoreDataPoints} of 5
                price points
              </p>
            )}
          {showReason && product.reason && (
            <div className="mt-2 rounded-md bg-blue-50 p-2 text-xs text-blue-700 dark:bg-blue-950 dark:text-blue-300">
              {product.reason}
            </div>
          )}
        </CardContent>
      </Link>
    </Card>
  );
}
