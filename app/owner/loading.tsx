/**
 * Owner dashboard loading state (Section 17, Stage H item 19).
 */

import { Skeleton } from '@/components/ui/skeleton';

export default function OwnerLoading() {
  return (
    <div className="flex min-h-screen flex-col">
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-3xl space-y-6">
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-4 w-96" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </main>
    </div>
  );
}
