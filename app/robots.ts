import { appConfig } from '@/lib/config/app';

export default function robots() {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/dashboard/', '/admin/', '/auth/'],
    },
    sitemap: `${appConfig.url}/sitemap.xml`,
  };
}
