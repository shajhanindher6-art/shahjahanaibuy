import { POSTS } from '@/lib/blog/posts';
import { appConfig } from '@/lib/config/app';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * RSS 2.0 feed for the SmartBuy blog — every article in
 * lib/blog/posts.ts, newest first. Served at /rss.xml and linked
 * from the root layout metadata (alternates.types).
 */
export async function GET() {
  const items = [...POSTS]
    .sort((a, b) => b.datePublished.localeCompare(a.datePublished))
    .map(
      (post) => `
    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${appConfig.url}/blog/${escapeXml(post.slug)}</link>
      <guid>${appConfig.url}/blog/${escapeXml(post.slug)}</guid>
      <pubDate>${new Date(post.datePublished).toUTCString()}</pubDate>
      <description>${escapeXml(post.excerpt)}</description>
    </item>`
    )
    .join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(appConfig.name)} Blog</title>
    <link>${appConfig.url}/blog</link>
    <description>${escapeXml(appConfig.description)}</description>
    <language>en</language>${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
}
