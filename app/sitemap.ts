import { appConfig } from '@/lib/config/app';

export default function sitemap() {
  const baseUrl = appConfig.url;
  const lastModified = new Date();

  const staticPages = [
    { url: '', priority: 1.0, changeFrequency: 'daily' },
    { url: '/search', priority: 0.9, changeFrequency: 'daily' },
    { url: '/compare', priority: 0.8, changeFrequency: 'weekly' },
    { url: '/deals', priority: 0.9, changeFrequency: 'daily' },
    { url: '/sign-in', priority: 0.5, changeFrequency: 'monthly' },
    { url: '/sign-up', priority: 0.6, changeFrequency: 'monthly' },
  ];

  return staticPages.map((page) => ({
    url: `${baseUrl}${page.url}`,
    lastModified,
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }));
}
