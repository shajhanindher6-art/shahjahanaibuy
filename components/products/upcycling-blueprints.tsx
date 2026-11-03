'use client';

import { Recycle, AlertTriangle, Leaf } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { blueprintsForCategory } from '@/services/upcycling';

/**
 * Zero-waste & upcycling blueprint ideas (Option 10, Feature 1).
 * Template ideas from the product's REAL category only. Every idea is
 * labeled "Idea — not a tested/verified guide"; nothing here was tested,
 * verified, or endorsed. Battery-containing categories carry a prominent
 * lithium-battery warning, and e-waste recycling is the stated default
 * when reuse is not suitable.
 */
export function UpcyclingBlueprints({
  category,
  productName,
}: {
  category: string | null;
  productName: string;
}) {
  const set = blueprintsForCategory(category);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Leaf className="h-5 w-5 text-emerald-600" /> Zero-waste & upcycling ideas
        </CardTitle>
        <CardDescription>
          Home DIY reuse ideas for {productName} at end of life — ideas only, not tested guides.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!set ? (
          <p className="text-sm text-muted-foreground">
            No upcycling template exists for this category. When reuse is not suitable, please use
            a responsible e-waste recycler instead of landfill.
          </p>
        ) : (
          <>
            {set.batteryRisk && (
              <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/50">
                <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
                <p>
                  <strong>Battery safety warning:</strong> this product type typically contains a
                  lithium battery. Never puncture, bend, open, or incinerate a battery. Disconnect
                  power before any work, and if you are unsure, take the device to a professional
                  recycler instead of opening it.
                </p>
              </div>
            )}
            <ul className="space-y-3">
              {set.ideas.map((idea) => (
                <li key={idea.title} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{idea.title}</span>
                    <Badge variant="secondary">{idea.difficulty}</Badge>
                    <Badge variant="outline">Idea — not a tested/verified guide</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{idea.description}</p>
                </li>
              ))}
            </ul>
            <p className="flex gap-2 text-xs text-muted-foreground">
              <Recycle className="h-4 w-4 flex-shrink-0" />
              When reuse is not suitable, responsible e-waste recycling is the safe default. Never
              put electronics or batteries in regular waste.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
