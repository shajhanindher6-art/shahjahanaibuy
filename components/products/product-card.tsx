'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Package } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DealScoreBadge } from '@/components/products/deal-score-badge';
import { Price } from '@/components/region/price';
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
  dealScore?: number | null;
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
