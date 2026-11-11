import { Cpu } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  computeEnduranceIndex,
  type HardwareEnduranceData,
} from '@/services/hardware-endurance';
import { cn } from '@/lib/utils';

/**
 * Hardware Endurance Card (Option 17).
 *
 * Endurance Index from RECORDED hardware data only (thermal factor,
 * SSD TBW, battery cycles). No recorded data → honest "Not recorded
 * yet" state, never a fake index. A partial index (some inputs
 * missing) is labeled as a lower bound.
 *
 * Server-safe: pure render, no client state.
 */

const BAND_LABEL: Record<string, string> = {
  excellent: 'Excellent endurance',
  good: 'Good endurance',
  fair: 'Fair endurance',
  poor: 'Poor endurance',
  unknown: 'Not recorded yet',
};

export function EnduranceCard({
  endurance,
  title,
}: {
  endurance: HardwareEnduranceData | null | undefined;
  title?: string;
}) {
  const data: HardwareEnduranceData = endurance ?? {
    thermalEfficiencyFactor: null,
    ssdTbwRating: null,
    batteryCycleCapacity: null,
    carbonFootprintKg: null,
    isRamModular: null,
    isStorageModular: null,
  };
  const result = computeEnduranceIndex(data);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Cpu className="h-5 w-5 text-muted-foreground" />
          Hardware Endurance{title ? ` — ${title}` : ''}
        </CardTitle>
        <CardDescription>
          Thermal efficiency, SSD endurance &amp; battery cycles (recorded data only)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {result.band === 'unknown' || result.index === null ? (
          <p className="text-sm text-muted-foreground">
            Hardware endurance not recorded for this product yet — no
            thermal, SSD or battery-cycle data has been added. Nothing
            here is estimated.
          </p>
        ) : (
          <>
            <div>
              <div className="flex items-center justify-between">
                <span className="text-2xl font-bold">{result.index}/100</span>
                <Badge
                  className={cn(
                    'text-white',
                    result.band === 'excellent' && 'bg-emerald-600',
                    result.band === 'good' && 'bg-blue-600',
                    result.band === 'fair' && 'bg-amber-600',
                    result.band === 'poor' && 'bg-red-600'
                  )}
                >
                  {BAND_LABEL[result.band]}
                </Badge>
              </div>
              <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    'h-full rounded-full',
                    result.band === 'excellent' && 'bg-emerald-500',
                    result.band === 'good' && 'bg-blue-500',
                    result.band === 'fair' && 'bg-amber-500',
                    result.band === 'poor' && 'bg-red-500'
                  )}
                  style={{ width: `${result.index}%` }}
                />
              </div>
            </div>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Thermal efficiency</dt>
                <dd className="font-medium">
                  {data.thermalEfficiencyFactor !== null
                    ? `${data.thermalEfficiencyFactor.toFixed(2)} (×40 = ${result.thermalPoints} pts)`
                    : 'Not recorded (0 pts)'}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">SSD endurance (TBW)</dt>
                <dd className="font-medium">
                  {data.ssdTbwRating !== null
                    ? `${data.ssdTbwRating} TBW (${result.tbwPoints} pts)`
                    : 'Not recorded (0 pts)'}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Battery cycles</dt>
                <dd className="font-medium">
                  {data.batteryCycleCapacity !== null
                    ? `${data.batteryCycleCapacity} cycles (${result.cyclePoints} pts)`
                    : 'Not recorded (0 pts)'}
                </dd>
              </div>
            </dl>
            {result.partial && (
              <p className="text-xs text-muted-foreground">
                Partial data — the index counts 0 for the missing inputs, so
                it is a lower bound until those values are recorded.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
