import { appConfig } from '@/lib/config/app';

export default function robots() {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/dashboard/', '/admin/', '/owner/', '/auth/'],
    },
    // Single combined sitemap (S2#13 + S4#16, 2026-11-10): the
    // three-file the multi-file sitemap API split prerendered as 404 on Next
    // 13.5.9 (see app/sitemap.ts) and was reverted the same day.
    // robots.txt lists this one URL and the owner submits it in
    // Search Console (docs/search-console.md).
    sitemap: `${appConfig.url}/sitemap.xml`,
  };
}
