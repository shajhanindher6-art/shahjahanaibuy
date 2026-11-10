import Link from 'next/link';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import type { Metadata } from 'next';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { AuthorByline } from '@/components/blog/author-byline';
import {
  getAllPosts,
  getPostBySlug,
  type Block,
  type Post,
} from '@/lib/blog/posts';
import { appConfig } from '@/lib/config/app';
import {
  buildArticleJsonLd,
  buildBreadcrumbJsonLd,
  toJsonLdGraph,
} from '@/lib/json-ld';

export function generateStaticParams() {
  return getAllPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const post = getPostBySlug(params.slug);
  if (!post) return { title: 'Blog — SmartBuy AI' };
  const url = `${appConfig.url}/blog/${post.slug}`;
  const author = optionalPostField(post, 'author');
  const lastUpdated = optionalPostField(post, 'lastUpdated');
  return {
    title: `${post.title} — SmartBuy AI Blog`,
    description: post.excerpt,
    alternates: { canonical: url },
    openGraph: {
      title: post.title,
      description: post.excerpt,
      url,
      type: 'article',
      locale: 'en_US',
      publishedTime: `${post.datePublished}T00:00:00Z`,
      ...(lastUpdated
        ? { modifiedTime: `${lastUpdated}T00:00:00Z` }
        : {}),
      ...(author ? { authors: [author] } : {}),
      // NOTE: no per-post OG image — no post images exist, so Next
      // falls back to the site-wide app/opengraph-image.tsx. Never
      // invent a post image here.
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description: post.excerpt,
      // NOTE: no `site` / `creator` — SmartBuy AI has no verified
      // X/Twitter handle on record (see docs/seo.md).
    },
  };
}

/**
 * Reads a Post field another worker may add (author / lastUpdated)
 * without assuming it exists: returns the string when present, null
 * otherwise. Never invents an author or an update date.
 */
function optionalPostField(
  post: Post,
  field: 'author' | 'lastUpdated'
): string | null {
  const value = (post as Partial<Record<typeof field, unknown>>)[field];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function renderBlock(block: Block, index: number) {
  switch (block.type) {
    case 'h2':
      return (
        <h2 key={index} className="mb-4 mt-10 text-2xl font-bold">
          {block.text}
        </h2>
      );
    case 'p':
      return (
        <p key={index} className="mb-4 leading-relaxed text-foreground/90">
          {block.text}
        </p>
      );
    case 'list':
      return (
        <ul key={index} className="mb-6 list-disc space-y-2 pl-6 leading-relaxed">
          {block.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      );
    case 'callout':
      return (
        <div key={index} className="mb-6 rounded-lg border bg-muted/40 p-4">
          {block.title ? (
            <p className="font-semibold">{block.title}</p>
          ) : null}
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {block.text}
          </p>
        </div>
      );
    case 'table':
      return (
        <div key={index} className="mb-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                {block.headers.map((header) => (
                  <th
                    key={header}
                    className="border-b py-2 pr-4 text-left font-semibold"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j} className="border-b py-2 pr-4 align-top">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export default function BlogArticlePage({
  params,
}: {
  params: { slug: string };
}) {
  const post = getPostBySlug(params.slug);
  if (!post) notFound();

  // S4#17 author + last-updated display (defensive: both fields are
  // added to the Post type by another worker and may not exist yet).
  // No bio paragraph is rendered — no author-bio text exists in the
  // data; inventing one would be fake content (see docs/seo.md).
  const author = optionalPostField(post, 'author');
  const lastUpdated = optionalPostField(post, 'lastUpdated');

  // CSP Phase 2 nonce (set per request by middleware.ts), same source
  // the root layout and product page use — the JSON-LD script tag
  // needs it or the strict script-src policy blocks it.
  const nonce = headers().get('x-nonce');
  const jsonLd = toJsonLdGraph(
    buildArticleJsonLd(appConfig.url, {
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      datePublished: post.datePublished,
      lastUpdated,
      authorName: author,
    }),
    buildBreadcrumbJsonLd(appConfig.url, [
      { name: 'Home', path: '/' },
      { name: 'Blog', path: '/blog' },
      { name: post.title },
    ])
  );

  return (
    <div className="flex min-h-screen flex-col">
      <script
        type="application/ld+json"
        nonce={nonce ?? undefined}
        dangerouslySetInnerHTML={{ __html: jsonLd }}
      />
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <Link
            href="/blog"
            className="text-sm font-medium text-primary hover:underline"
          >
            ← All posts
          </Link>
          <h1 className="mt-4 text-3xl font-bold leading-tight">{post.title}</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            {formatDate(post.datePublished)} · {post.readMinutes} min read
          </p>
          {/* Author byline (S4#17): the component renders the author
              (always the SmartBuy Editorial Team — no individual is
              named) plus the last-updated date when recorded. This
              REPLACES the inline "By …" / "Last updated …" lines
              that used to live here, so the byline is rendered
              exactly once. No bio paragraph is invented — the
              component shows only the recorded author fields. */}
          <AuthorByline post={post} />
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
          <div className="mt-8">{post.content.map(renderBlock)}</div>
          <div className="mt-10 border-t pt-6">
            <Link
              href="/blog"
              className="text-sm font-medium text-primary hover:underline"
            >
              ← Back to all posts
            </Link>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
