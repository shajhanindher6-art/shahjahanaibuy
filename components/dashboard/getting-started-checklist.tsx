/**
 * First-visit checklist — Section 13, Chunk F, item 47.
 *
 * "Set your first alert / Save a product / Try Budget Finder".
 * Done-states come only from fetches the dashboard already makes:
 * an alert exists (tracking alerts) and a product is saved
 * (tracking items). Budget Finder has no done-state in any
 * dashboard fetch, so it renders as an action link with no
 * checkmark — never a fake "done" or a guessed progress bar.
 * No tour, no fake progress.
 */

'use client';

import { useRegion } from '@/components/region/region-provider';
import { tFor } from '@/lib/i18n';
import Link from 'next/link';
import { CheckCircle2, Circle, Bell, Heart, Calculator } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export interface ChecklistState {
  hasSavedProduct: boolean;
  hasAlert: boolean;
}

/** Pure derivation: which checklist items are done. */
export function deriveChecklistDone(state: ChecklistState): {
  saveProduct: boolean;
  setAlert: boolean;
  doneCount: number;
  total: number;
} {
  return {
    saveProduct: state.hasSavedProduct,
    setAlert: state.hasAlert,
    doneCount: (state.hasSavedProduct ? 1 : 0) + (state.hasAlert ? 1 : 0),
    total: 2,
  };
}

export function GettingStartedChecklist({ hasSavedProduct, hasAlert }: ChecklistState) {
  const { language } = useRegion();
  const done = deriveChecklistDone({ hasSavedProduct, hasAlert });

  const items = [
    {
      key: 'save',
      label: 'Save a product',
      description: 'Add any product to a wishlist to watch its price.',
      href: '/search',
      done: done.saveProduct,
    },
    {
      key: 'alert',
      label: 'Set your first alert',
      description: 'Get notified when a watched product drops to your target.',
      href: '/dashboard/tracking',
      done: done.setAlert,
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
          Getting started
        </CardTitle>
        <CardDescription>
          {done.doneCount === done.total
            ? 'You are all set — here is one more tool to try.'
            : `${done.doneCount} of ${done.total} done — a couple of quick steps unlock price tracking.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.key}>
              <Link
                href={item.href}
                className="flex items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-accent"
              >
                {item.done ? (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" aria-hidden="true" />
                ) : (
                  <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                )}
                <span>
                  <span className="block text-sm font-medium">{item.label}</span>
                  <span className="block text-xs text-muted-foreground">{item.description}</span>
                </span>
              </Link>
            </li>
          ))}
          <li>
            <Link
              href="/tools/budget-finder"
              className="flex items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-accent"
            >
              <Calculator className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span>
                <span className="block text-sm font-medium">Try Budget Finder</span>
                <span className="block text-xs text-muted-foreground">
                  Find the best product under your budget — no sign-up needed to try it.
                </span>
              </span>
            </Link>
          </li>
        </ul>
        <p className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Heart className="h-3.5 w-3.5" aria-hidden="true" /> {tFor(language, 'commonSave')}
          </span>
          <span className="flex items-center gap-1">
            <Bell className="h-3.5 w-3.5" aria-hidden="true" /> Alert
          </span>
          <span className="flex items-center gap-1">
            <Calculator className="h-3.5 w-3.5" aria-hidden="true" /> Budget Finder
          </span>
        </p>
      </CardContent>
    </Card>
  );
}
