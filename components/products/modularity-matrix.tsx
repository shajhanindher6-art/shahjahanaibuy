import { Wrench } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  modularityResult,
  type HardwareEnduranceData,
} from '@/services/hardware-endurance';
import { cn } from '@/lib/utils';

/**
 * Modularity Matrix (Option 17).
 *
 * RAM / storage upgradeability from the RECORDED booleans
 * (is_ram_modular, is_storage_modular). Both null → honest "Not
 * recorded yet" state, never a guessed label.
 *
 * Server-safe: pure render, no client state.
 */

export function ModularityMatrix({
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
  const result = modularityResult(data);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Wrench className="h-5 w-5 text-slate-500" />
          Modularity{title ? ` — ${title}` : ''}
        </CardTitle>
        <CardDescription>Can the RAM and storage be upgraded later?</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {result.label === 'Not recorded' ? (
          <p className="text-sm text-muted-foreground">
            Modularity not recorded for this product yet — it is not known
            whether the RAM or storage can be upgraded. Nothing here is
            assumed.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <span className="text-lg font-bold">{result.label}</span>
              <Badge
                className={cn(
                  'text-white',
                  result.label === 'Fully modular' && 'bg-emerald-600',
                  result.label === 'Partially modular' && 'bg-blue-600',
                  result.label === 'Sealed — not upgradeable' && 'bg-slate-600'
                )}
              >
                {result.label}
              </Badge>
            </div>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">RAM</dt>
                <dd className="font-medium">{result.ram}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Storage</dt>
                <dd className="font-medium">{result.storage}</dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">
              Modular parts can be replaced or upgraded instead of replacing
              the whole device.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
