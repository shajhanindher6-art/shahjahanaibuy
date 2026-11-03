'use client';

import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { useRegion } from '@/components/region/region-provider';
import type { Language } from '@/lib/region';

/**
 * Blog index — page-level language only (A2 audit, 2026-11-03).
 *
 * DIAGNOSIS, not a provider bypass: every page, including /blog,
 * is wrapped by RegionProvider in the root layout, and the header
 * on /blog already follows the visitor's language. What was
 * English-only was this page's own body copy — the same
 * chrome-only translation scope the rest of the site states (only
 * header/hero/search chrome strings are translated; page bodies
 * stay English). This page therefore localises its own two strings
 * (heading + honest empty state) from the visitor's language,
 * without touching the provider or the shared dictionary, which
 * belong to other workstreams. The empty state itself is unchanged
 * and honest: there are no posts, so none are invented.
 * Translations are functional page strings, not professionally
 * reviewed copy.
 */
const BLOG_COPY: Record<Language, { title: string; empty: string }> = {
  en: {
    title: 'Blog',
    empty:
      'No posts yet. This is where shopping guides, deal explainers, and product updates will appear. Check back soon.',
  },
  ur: {
    title: 'Blog',
    empty:
      'Abhi koi post nahi hai. Yahan shopping guides, deal explainers aur product updates aayenge. Dobara zaroor check karein.',
  },
  de: {
    title: 'Blog',
    empty:
      'Noch keine Beiträge. Hier erscheinen künftig Einkaufsratgeber, Deal-Erklärungen und Produktneuigkeiten. Schau bald wieder vorbei.',
  },
  fr: {
    title: 'Blog',
    empty:
      'Aucun article pour le moment. C’est ici que paraîtront les guides d’achat, les explications d’offres et les actualités produits. Revenez bientôt.',
  },
  es: {
    title: 'Blog',
    empty:
      'Aún no hay entradas. Aquí aparecerán guías de compra, explicaciones de ofertas y novedades de productos. Vuelve pronto.',
  },
  it: {
    title: 'Blog',
    empty:
      'Ancora nessun articolo. Qui appariranno guide agli acquisti, spiegazioni delle offerte e aggiornamenti sui prodotti. Torna presto.',
  },
  pt: {
    title: 'Blog',
    empty:
      'Ainda não há publicações. É aqui que aparecerão guias de compra, explicações de ofertas e novidades de produtos. Volte em breve.',
  },
  tr: {
    title: 'Blog',
    empty:
      'Henüz yazı yok. Alışveriş rehberleri, fırsat açıklamaları ve ürün güncellemeleri burada yer alacak. Yakında tekrar uğrayın.',
  },
};

export default function BlogPage() {
  const { language } = useRegion();
  const copy = BLOG_COPY[language] ?? BLOG_COPY.en;
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="text-3xl font-bold">{copy.title}</h1>
          <p className="mt-4 text-muted-foreground">{copy.empty}</p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
