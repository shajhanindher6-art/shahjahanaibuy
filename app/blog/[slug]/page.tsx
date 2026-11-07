import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { getAllPosts, getPostBySlug, type Block } from '@/lib/blog/posts';

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
  return {
    title: `${post.title} — SmartBuy AI Blog`,
    description: post.excerpt,
  };
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

  return (
    <div className="flex min-h-screen flex-col">
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
