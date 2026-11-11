import { Skeleton } from '@/components/ui/skeleton';

/**
 * Root loading state (Section 10, chunk 2). Mirrors the homepage
 * shape — hero, stats bar, feature cards, deal strip — using the
 * same Skeleton primitives as the product page's Suspense fallback
 * (components/ui/skeleton.tsx). Decorative only: aria-hidden
 * skeletons inside a role="status" wrapper with a screen-reader
 * "Loading…" label, matching the SkeletonShell pattern.
 */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading…" className="flex min-h-screen flex-col">
      <span className="sr-only">Loading…</span>
      <div aria-hidden="true">
        <main>
          {/* Hero */}
          <section className="relative overflow-hidden">
            <div className="container relative mx-auto px-4 py-20 md:py-28">
              <div className="mx-auto max-w-3xl space-y-4 text-center">
                <Skeleton className="mx-auto h-10 w-3/4" />
                <Skeleton className="mx-auto h-5 w-1/2" />
                <Skeleton className="mx-auto h-12 w-full max-w-md" />
              </div>
            </div>
          </section>

          {/* Stats bar */}
          <div className="container mx-auto px-4">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="space-y-2 rounded-lg border p-4">
                  <Skeleton className="h-8 w-16" />
                  <Skeleton className="h-3 w-24" />
                </div>
              ))}
            </div>
          </div>

          {/* Feature cards */}
          <section className="py-20 md:py-28">
            <div className="container mx-auto px-4">
              <div className="mx-auto grid max-w-5xl gap-4 md:grid-cols-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="space-y-3 rounded-lg border p-6">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <Skeleton className="h-5 w-2/3" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-5/6" />
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Deal strip */}
          <section className="border-t py-20 md:py-28">
            <div className="container mx-auto px-4">
              <Skeleton className="h-7 w-48" />
              <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="space-y-3 rounded-lg border p-4">
                    <Skeleton className="aspect-[4/3] w-full" />
                    <Skeleton className="h-5 w-3/4" />
                    <Skeleton className="h-4 w-1/2" />
                  </div>
                ))}
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
