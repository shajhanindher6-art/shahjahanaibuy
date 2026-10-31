import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';

export default function BlogPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="text-3xl font-bold">Blog</h1>
          <p className="mt-4 text-muted-foreground">
            No posts yet. This is where shopping guides, deal explainers, and product
            updates will appear. Check back soon.
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
