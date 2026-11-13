'use client';

/**
 * Product gallery (Section 14, chunk 5).
 *
 * Shows every recorded `product_images` row for the product, primary
 * first, with thumbnail buttons to switch the main image. The rows
 * come from the existing GET /api/v1/products/[slug] response
 * (`getProductImages` in services/products.ts) — no new API, no new
 * table, no invented images.
 *
 * Honest empty state: the seed files contain NO product_images rows
 * (and the live count cannot be verified from this repo), so when a
 * product has no recorded gallery rows the component renders exactly
 * what the page showed before — the single product image (or the
 * Package placeholder when there is none) — with no thumbnails and
 * no "gallery" claim. A dead image URL falls back to the same
 * placeholder instead of a broken-image icon.
 *
 * Raw <img>, not next/image: product images come from arbitrary
 * merchant hosts outside next.config.js remotePatterns (same reason
 * as the hero image it replaces and ProductCard).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Package } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface GalleryImage {
  id: string;
  url: string;
  altText: string | null;
  isPrimary: boolean;
}

interface ProductGalleryProps {
  images: GalleryImage[];
  fallbackImageUrl: string | null;
  productName: string;
}

export function ProductGallery({ images, fallbackImageUrl, productName }: ProductGalleryProps) {
  // Primary first, then the recorded sort order (the API already
  // orders by sort_order, so this only promotes the primary).
  const ordered = useMemo(() => {
    const rows = (images ?? []).filter((img) => typeof img.url === 'string' && img.url.length > 0);
    return [...rows].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
  }, [images]);

  const [selected, setSelected] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);

  // A new product (or a newly loaded gallery) restarts at the first
  // image instead of keeping a stale index past the end.
  useEffect(() => {
    setSelected(0);
    setImageFailed(false);
  }, [ordered.length, productName]);

  const selectedImage = ordered[selected] ?? null;
  const mainUrl = selectedImage ? selectedImage.url : fallbackImageUrl;
  const mainAlt = selectedImage?.altText ?? productName;

  return (
    <div>
      <div className="flex h-80 items-center justify-center bg-slate-100 dark:bg-slate-800">
        {mainUrl && !imageFailed ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote merchant image (possibly null); next/image remotePatterns allows only Unsplash + Pexels
          <img
            src={mainUrl}
            alt={mainAlt}
            // Section 16, #47: intrinsic size for the layout — the
            // rendered box is fluid width (the lg:grid-cols-2 column,
            // ~550px on desktop) × fixed h-80 (320px); CSS
            // h-full w-full object-cover still governs display, the
            // attributes only give the browser the aspect ratio.
            width={550}
            height={320}
            loading="lazy"
            decoding="async"
            onError={() => setImageFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <Package className="h-24 w-24 text-muted-foreground" />
        )}
      </div>
      {ordered.length > 1 && (
        <div className="flex items-center gap-2 border-t p-3">
          <span className="mr-1 text-xs text-muted-foreground">
            Photo {Math.min(selected + 1, ordered.length)} of {ordered.length}
          </span>
          {ordered.map((img, index) => (
            <button
              key={img.id}
              type="button"
              onClick={() => {
                setSelected(index);
                setImageFailed(false);
              }}
              aria-label={`Show photo ${index + 1} of ${ordered.length}`}
              aria-pressed={index === selected}
              className={cn(
                'h-14 w-14 shrink-0 overflow-hidden rounded-md border-2 bg-slate-100 dark:bg-slate-800',
                index === selected
                  ? 'border-blue-600'
                  : 'border-transparent opacity-70 hover:opacity-100'
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- remote merchant image; next/image remotePatterns allows only Unsplash + Pexels */}
              <img
                src={img.url}
                alt={img.altText ?? `${productName} photo ${index + 1}`}
                // Section 16, #47: the thumbnail button is exactly
                // h-14 w-14 (56px), so the attributes match the
                // rendered box 1:1.
                width={56}
                height={56}
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
