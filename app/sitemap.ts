import { appConfig } from '@/lib/config/app';
import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/config/env';

export default async function sitemap() {
  const baseUrl = appConfig.url;
  const lastModified = new Date();

  const staticPages = [
    { url: '', priority: 1.0, changeFrequency: 'daily' as const },
    { url: '/search', priority: 0.9, changeFrequency: 'daily' as const },
    { url: '/compare', priority: 0.8, changeFrequency: 'weekly' as const },
    { url: '/deals', priority: 0.9, changeFrequency: 'daily' as const },
    { url: '/sign-in', priority: 0.5, changeFrequency: 'monthly' as const },
    { url: '/sign-up', priority: 0.6, changeFrequency: 'monthly' as const },
  ];

  const staticEntries = staticPages.map((page) => ({
    url: `${baseUrl}${page.url}`,
    lastModified,
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }));

  // Dynamically fetch product slugs for sitemap inclusion
  const productEntries: Array<{
    url: string;
    lastModified: Date;
    changeFrequency: 'weekly';
    priority: number;
  }> = [];

  try {
    const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { persistSession: false },
    });

    const { data: products } = await supabase
      .from('products')
      .select('slug, updated_at')
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(500);

    if (products) {
      for (const product of products as Array<{ slug: string; updated_at: string | null }>) {
        productEntries.push({
          url: `${baseUrl}/products/${product.slug}`,
          lastModified: product.updated_at ? new Date(product.updated_at) : lastModified,
          changeFrequency: 'weekly',
          priority: 0.7,
        });
      }
    }
  } catch {
    // If DB is unavailable, return static-only sitemap
  }

  return [...staticEntries, ...productEntries];
}
