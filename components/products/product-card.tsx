'use client';

import Link from 'next/link';
import { Package } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DealScoreBadge } from '@/components/products/deal-score-badge';
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

  return (
    <Card className={cn('group cursor-pointer overflow-hidden transition-all hover:shadow-lg hover:border-blue-200 dark:hover:border-blue-800', className)}>
      <Link href={link}>
        <div className="relative h-40 overflow-hidden bg-slate-100 dark:bg-slate-800">
          {product.imageUrl ? (
            <img
              src={product.imageUrl}
              alt={product.name}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <Package className="h-10 w-10 text-muted-foreground" />
            </div>
          )}
          {(product.dealScore != null || product.matchScore != null) && (
            <div className="absolute right-2 top-2">
              <DealScoreBadge
                score={product.dealScore ?? product.matchScore ?? 0}
                size="sm"
              />
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
            <p className="mt-2 text-lg font-bold text-blue-600">${product.price.toFixed(2)}</p>
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
