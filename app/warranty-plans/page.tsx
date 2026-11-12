/**
 * Warranty Plans — public list page (Section 6, item 12).
 *
 * Admin-recorded third-party warranty/insurance plans only
 * (migration 033). A category filter narrows the list to plans
 * recorded for that category. No plan is ever recommended and no
 * price or coverage is ever invented — an empty list is the honest
 * "No recorded warranty plans for this category yet." state.
 *
 * Client page: fetches GET /api/v1/warranty-plans. A failed fetch
 * shows an honest empty state, never fabricated plans.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { SiteHeader } from '@/components/layout/site-header';
import { PageJsonLd } from '@/components/seo/page-json-ld';
import { SiteFooter } from '@/components/layout/site-footer';
import { WarrantyPlansTable } from '@/components/products/warranty-plans-table';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { WarrantyPlan } from '@/lib/warranty-plans';

interface WarrantyPlansResponse {
  plans: WarrantyPlan[];
  warrantyEnabled: boolean;
}

export default function WarrantyPlansPage() {
  const [plans, setPlans] = useState<WarrantyPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [warrantyEnabled, setWarrantyEnabled] = useState(true);
  const [category, setCategory] = useState('');
  const [appliedCategory, setAppliedCategory] = useState('');

  const load = useCallback(async (cat: string) => {
    setLoading(true);
    setFailed(false);
    try {
      const params = new URLSearchParams();
      if (cat.trim() !== '') params.set('category', cat.trim());
      const res = await fetch(`/api/v1/warranty-plans?${params.toString()}`);
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success && Array.isArray(json.data)) {
        setPlans(json.data as WarrantyPlan[]);
        setWarrantyEnabled(json.meta?.warrantyEnabled !== false);
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(appliedCategory);
  }, [appliedCategory, load]);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      {/* Section 16, item 14: page-level JSON-LD (WebPage + BreadcrumbList). */}
      <PageJsonLd
        name="Warranty & insurance plans"
        description="Third-party warranty and insurance plans recorded by an admin from each provider’s own published page. Plans are listed, never recommended."
        path="/warranty-plans"
        crumbs={[ { name: "Home", path: "/" }, { name: "Warranty & insurance plans" } ]}
      />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <h1 className="text-2xl font-bold">Warranty &amp; insurance plans</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Third-party warranty and insurance plans recorded by an admin from
          each provider&apos;s own published page. Plans are listed, never
          recommended — compare the recorded coverage, duration and price
          yourself, and confirm the terms on the provider&apos;s page before
          buying. The manufacturer warranty is shown separately and is not
          part of any third-party plan.
        </p>

        {!warrantyEnabled && (
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            Warranty plans are not live yet — the owner still needs to run
            migration 033 once. Until then, no plans can be listed.
          </p>
        )}

        <form
          className="mt-6 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setAppliedCategory(category);
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="wpCategory">Product category</Label>
            <Input
              id="wpCategory"
              placeholder="e.g. Laptops"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={loading}>
            Filter
          </Button>
          {appliedCategory !== '' && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setCategory('');
                setAppliedCategory('');
              }}
            >
              Clear filter
            </Button>
          )}
        </form>

        <div className="mt-6">
          {loading ? (
            <LoadingSpinner />
          ) : failed ? (
            <EmptyState
              title="Warranty plans could not be loaded"
              description="Try again later. No plans are shown rather than guessed ones."
            />
          ) : plans.length === 0 ? (
            <EmptyState
              title="No recorded warranty plans for this category yet."
              description="No admin has recorded a third-party plan for this category from a provider's published page. Check back later — plans are never invented."
            />
          ) : (
            <WarrantyPlansTable plans={plans} manufacturerWarranty={null} />
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
