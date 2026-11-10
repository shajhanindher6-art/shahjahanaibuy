/**
 * Product detail page — server shell (P0 fix, 2026-11-09 audit).
 *
 * This page used to be a 1,600-line 'use client' component: every
 * product shared one generic <title>, and the h1, description and
 * JSON-LD only existed after JavaScript ran and ~20 API calls
 * answered — a no-JS view of the MacBook page showed nothing but the
 * generic title, so Google saw no product at all.
 *
 * Now the shell is a Server Component:
 * - generateMetadata gives every product its own title, description,
 *   canonical URL and OG/Twitter tags (lib/product-seo.ts).
 * - The Product JSON-LD is rendered here, with the request's CSP
 *   nonce, from recorded data only (lib/product-seo-server.ts).
 * - The interactive page lives in
 *   components/products/product-detail-client.tsx and receives the
 *   product row as initial data, so the hero renders on first paint
 *   instead of behind a full-page spinner.
 *
 * Unknown slugs 404 properly (app/not-found.tsx) instead of
 * rendering a client "Product not found" behind a spinner.
 */

import type { Metadata } from 'next';
import { Suspense } from 'react';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { appConfig } from '@/lib/config/app';
import { SUPPORTED_LANGUAGES } from '@/lib/region';
import {
  ProductHeroSkeleton,
  WhereToBuySkeleton,
} from '@/components/ui/skeleton';
import {
  buildProductJsonLd,
  buildProductMetadata,
  toInitialProduct,
} from '@/lib/product-seo';
import { getProductSeo } from '@/lib/product-seo-server';
import ProductDetailClient from '@/components/products/product-detail-client';

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const seo = await getProductSeo(params.slug);
  if (!seo) {
    return { title: 'Product not found' };
  }
  const meta = buildProductMetadata(seo, appConfig.url);
  // Per-product hreflang (Section 2 item 13): x-default + one
  // alternate per supported UI language. There are NO localized
  // routes — language is chosen client-side — so every alternate
  // points at the same product URL rather than inventing /de/,
  // /ur/ … paths that do not exist (same pattern as the root
  // layout). The canonical URL is unchanged.
  const url = `${appConfig.url}/products/${seo.slug}`;
  const languages: Record<string, string> = { 'x-default': url };
  for (const lang of SUPPORTED_LANGUAGES) {
    languages[lang] = url;
  }
  return {
    ...meta,
    alternates: { canonical: url, languages },
  };
}

export default async function ProductPage({
  params,
}: {
  params: { slug: string };
}) {
  const seo = await getProductSeo(params.slug);
  if (!seo) {
    notFound();
  }

  // CSP Phase 2 nonce (set per request by middleware.ts), same source
  // the root layout uses — the JSON-LD script tag needs it or the
  // strict script-src policy blocks it.
  const nonce = headers().get('x-nonce');

  return (
    <>
      <script
        type="application/ld+json"
        nonce={nonce ?? undefined}
        dangerouslySetInnerHTML={{
          __html: buildProductJsonLd(seo, appConfig.url),
        }}
      />
      {/* Section skeletons (Section 4, item 2): the hero renders from
          server-provided initial data, so this fallback is a safety
          net for a slow client boundary — never a blank area or a
          full-page spinner. */}
      <Suspense
        fallback={
          <div className="container mx-auto max-w-6xl px-4 py-8">
            <ProductHeroSkeleton />
            <div className="mt-8">
              <WhereToBuySkeleton />
            </div>
          </div>
        }
      >
        <ProductDetailClient
          slug={params.slug}
          initialProduct={toInitialProduct(seo)}
        />
      </Suspense>
    </>
  );
}
