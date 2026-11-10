'use client';

import Link from 'next/link';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { useRegion } from '@/components/region/region-provider';
import type { Language } from '@/lib/region';
import { getAllPosts } from '@/lib/blog/posts';

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
 * belong to other workstreams. Article content itself is English.
 * The empty state is kept and honest: it renders only if the post
 * list is ever empty.
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
  // Added 2026-11-10 (i18n 8→20): machine translations, not
  // professionally reviewed — same scope as the 8 above.
  ar: {
    title: 'المدونة',
    empty:
      'لا توجد مقالات بعد. هنا ستظهر أدلة التسوق وشروحات العروض وتحديثات المنتجات. عُد قريبًا.',
  },
  zh: {
    title: '博客',
    empty: '暂无文章。这里将发布购物指南、优惠解析和产品更新。敬请期待。',
  },
  ja: {
    title: 'ブログ',
    empty:
      'まだ記事がありません。ここにはショッピングガイド、お得情報の解説、製品アップデートが掲載されます。またお越しください。',
  },
  ko: {
    title: '블로그',
    empty:
      '아직 게시물이 없습니다. 쇼핑 가이드, 특가 설명, 제품 업데이트가 이곳에 표시됩니다. 곧 다시 확인해 주세요.',
  },
  hi: {
    title: 'ब्लॉग',
    empty:
      'अभी कोई पोस्ट नहीं है। यहाँ शॉपिंग गाइड, डील एक्सप्लेनर और प्रोडक्ट अपडेट दिखेंगे। जल्द फिर देखें।',
  },
  bn: {
    title: 'ব্লগ',
    empty:
      'এখনও কোনো পোস্ট নেই। এখানে শপিং গাইড, ডিল ব্যাখ্যা এবং পণ্যের আপডেট আসবে। শীঘ্রই আবার দেখুন।',
  },
  nl: {
    title: 'Blog',
    empty:
      'Nog geen berichten. Hier verschijnen binnenkort koopgidsen, uitleg over aanbiedingen en productupdates. Kom binnenkort terug.',
  },
  sv: {
    title: 'Blogg',
    empty:
      'Inga inlägg ännu. Här kommer köpguider, förklaringar av erbjudanden och produktuppdateringar att visas. Kom tillbaka snart.',
  },
  pl: {
    title: 'Blog',
    empty:
      'Nie ma jeszcze wpisów. Tutaj pojawią się przewodniki zakupowe, wyjaśnienia ofert i aktualizacje produktów. Zajrzyj wkrótce ponownie.',
  },
  ru: {
    title: 'Блог',
    empty:
      'Пока нет публикаций. Здесь появятся руководства по покупкам, объяснения предложений и новости о товарах. Загляните позже.',
  },
  id: {
    title: 'Blog',
    empty:
      'Belum ada postingan. Di sinilah panduan belanja, penjelasan penawaran, dan pembaruan produk akan muncul. Silakan kembali lagi.',
  },
  vi: {
    title: 'Blog',
    empty:
      'Chưa có bài viết nào. Đây là nơi sẽ xuất hiện hướng dẫn mua sắm, giải thích ưu đãi và cập nhật sản phẩm. Hãy quay lại sau.',
  },
};

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default function BlogPage() {
  const { language } = useRegion();
  const copy = BLOG_COPY[language] ?? BLOG_COPY.en;
  const posts = getAllPosts();

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="text-3xl font-bold">{copy.title}</h1>
          <p className="mt-2 text-muted-foreground">
            Shopping guides, deal explainers, and product updates — written
            from SmartBuy&apos;s real features and data.
          </p>

          {posts.length === 0 ? (
            <p className="mt-8 text-muted-foreground">{copy.empty}</p>
          ) : (
            <div className="mt-8 space-y-8">
              {posts.map((post) => (
                <article key={post.slug} className="border-b pb-8 last:border-b-0">
                  <h2 className="text-2xl font-semibold leading-snug">
                    <Link
                      href={`/blog/${post.slug}`}
                      className="hover:text-primary hover:underline"
                    >
                      {post.title}
                    </Link>
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {formatDate(post.datePublished)} · {post.readMinutes} min read · By{' '}
                    {post.author?.name ?? 'SmartBuy Editorial Team'}
                    {post.lastUpdated && post.lastUpdated !== post.datePublished
                      ? ` · Updated ${formatDate(post.lastUpdated)}`
                      : ''}
                  </p>
                  <p className="mt-3 leading-relaxed text-foreground/90">
                    {post.excerpt}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {post.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                  <Link
                    href={`/blog/${post.slug}`}
                    className="mt-4 inline-block text-sm font-medium text-primary hover:underline"
                  >
                    Read article →
                  </Link>
                </article>
              ))}
            </div>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
