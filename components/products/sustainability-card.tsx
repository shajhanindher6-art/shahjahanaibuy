import { Leaf } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  recordedBandLabel,
  sustainabilityFromRecorded,
} from '@/services/hardware-endurance';

/**
 * Sustainability Card — RECORDED carbon footprint (Option 17).
 *
 * Shows the product's RECORDED carbon_footprint_kg ranked against its
 * category baseline — never the Option 8 eco ESTIMATE. When no carbon
 * value is recorded the card says so plainly and points at the Eco
 * estimate module (which stays the only place an estimate appears).
 * A recorded value is labeled "Recorded footprint", never "certified".
 *
 * Server-safe: pure render, no client state.
 */

export function SustainabilityCard({
  carbonFootprintKg,
  category,
  title,
}: {
  carbonFootprintKg: number | null | undefined;
  category: string | null | undefined;
  title?: string;
}) {
  const result = sustainabilityFromRecorded({ carbonFootprintKg, category });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Leaf className="h-5 w-5 text-emerald-600" />
          Sustainability{title ? ` — ${title}` : ''}
        </CardTitle>
        <CardDescription>Recorded carbon footprint (not an estimate)</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {result.status === 'unknown' ? (
          <p className="text-sm text-muted-foreground">
            No recorded carbon footprint for this product yet. The Eco
            module on the product page shows a category-based estimate
            instead — an estimate, not recorded data.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <span className="text-2xl font-bold">{result.kgCO2e} kg CO₂e</span>
              {result.band && <Badge variant="secondary">{result.band}</Badge>}
            </div>
            {result.band && (
              <p className="text-sm text-muted-foreground">{recordedBandLabel(result.band)}</p>
            )}
            {result.categoryBaseKg !== null ? (
              <p className="text-sm text-muted-foreground">
                Recorded footprint vs a {result.categoryBaseKg} kg category
                baseline (ratio {result.ratio?.toFixed(2)}). Recorded data
                only — not a certified lifecycle assessment.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Recorded footprint — no category baseline exists to rank it
                against. Recorded data only — not a certified lifecycle
                assessment.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
