import { Leaf } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { CarbonLabel } from '@/lib/sustainability';

/**
 * Carbon label (Section 5, item 18).
 *
 * One number per product, with its source stated next to it:
 * - Recorded footprint first (migration 020 data).
 * - Estimate only when nothing is recorded — always labeled
 *   "Estimate only — not a certified lifecycle assessment".
 * - No number at all when neither exists.
 * Recorded and estimated values are never mixed on one card.
 */
export function CarbonLabelCard({ carbon, productName }: { carbon: CarbonLabel; productName: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Leaf className="h-5 w-5 text-emerald-600" /> Carbon label
        </CardTitle>
        <CardDescription>Carbon footprint for {productName}.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {carbon.kind === 'unknown' ? (
          <p className="text-sm text-muted-foreground">{carbon.sourceNote}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-2xl font-bold">{carbon.kgCO2e} kg CO₂e</span>
              {carbon.band && <Badge variant="secondary">Band {carbon.band}</Badge>}
              <Badge variant={carbon.kind === 'recorded' ? 'default' : 'outline'}>
                {carbon.kind === 'recorded' ? 'Recorded' : 'Estimate'}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">{carbon.sourceNote}</p>
            {carbon.categoryBaseKg !== null && (
              <p className="text-xs text-muted-foreground">
                Category baseline: {carbon.categoryBaseKg} kg CO₂e. The band ranks this product
                against its own category baseline — it is a relative ranking, not an eco-label.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
