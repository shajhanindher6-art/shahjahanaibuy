'use client';

import { useMemo, useState } from 'react';
import { Plane, Scale, ShieldAlert } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { REGIONS } from '@/lib/region';
import { estimateLandingPrice, standardRateForCountry } from '@/services/tax-estimator';
import { deMinimisForCountry } from '@/services/duty-optimizer';

/**
 * Cross-Border P2P Traveler Luggage Matcher — SIMULATION ONLY (Option 10,
 * Feature 3). No real travelers are matched, no luggage transport is
 * arranged, and no real person is contacted. No traveler profiles, names,
 * ratings, or availability are shown at all — only matching criteria and
 * a process outline. The form collects NO contact, payment, or handoff
 * details and submits NOTHING to a server: both cost scenarios are
 * computed client-side from the existing tax/duty math. Traveler-carried
 * goods are still subject to customs declaration — the comparison is
 * about the carriage fee, never about avoiding duty.
 */
export function TravelerMatcher() {
  const [fromCode, setFromCode] = useState('');
  const [toCode, setToCode] = useState('');
  const [valueUsd, setValueUsd] = useState(500);
  const [standardShipping, setStandardShipping] = useState(60);
  const [travelerFee, setTravelerFee] = useState(25);
  const [dutyPct, setDutyPct] = useState(10);

  const result = useMemo(() => {
    if (!fromCode || !toCode) return null;
    const vatEntry = standardRateForCountry(toCode);
    const vatPct = vatEntry ? vatEntry.ratePct : 0;
    const standard = estimateLandingPrice({
      priceUsd: valueUsd,
      dutyPct,
      vatPct,
      shippingUsd: standardShipping,
    });
    const traveler = estimateLandingPrice({
      priceUsd: valueUsd,
      dutyPct,
      vatPct,
      shippingUsd: travelerFee,
    });
    return {
      vatPct,
      vatUnknown: vatEntry === null,
      threshold: deMinimisForCountry(toCode),
      standard,
      traveler,
      saving: Math.round((standard.totalUsd - traveler.totalUsd) * 100) / 100,
    };
  }, [fromCode, toCode, valueUsd, standardShipping, travelerFee, dutyPct]);

  const fromName = REGIONS.find((r) => r.code === fromCode)?.name ?? fromCode;
  const toName = REGIONS.find((r) => r.code === toCode)?.name ?? toCode;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Plane className="h-5 w-5 text-sky-600" /> Traveler luggage matcher — simulation only
          </CardTitle>
          <CardDescription>
            An educational simulation of how traveler-assisted delivery matching would work. No
            real travelers are matched, no transport is arranged, and no real person is contacted.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="p2p-from">Traveling from</Label>
              <Select value={fromCode} onValueChange={setFromCode}>
                <SelectTrigger id="p2p-from">
                  <SelectValue placeholder="Select country" />
                </SelectTrigger>
                <SelectContent>
                  {REGIONS.map((r) => (
                    <SelectItem key={r.code} value={r.code}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="p2p-to">Delivering to</Label>
              <Select value={toCode} onValueChange={setToCode}>
                <SelectTrigger id="p2p-to">
                  <SelectValue placeholder="Select country" />
                </SelectTrigger>
                <SelectContent>
                  {REGIONS.map((r) => (
                    <SelectItem key={r.code} value={r.code}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="p2p-value">Item value (USD)</Label>
              <Input
                id="p2p-value"
                type="number"
                min={0}
                step={0.01}
                value={valueUsd}
                onChange={(e) => setValueUsd(Number(e.target.value) || 0)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="p2p-duty">Import duty % (estimate)</Label>
              <Input
                id="p2p-duty"
                type="number"
                min={0}
                step={0.1}
                value={dutyPct}
                onChange={(e) => setDutyPct(Number(e.target.value) || 0)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="p2p-ship">Standard international shipping (USD)</Label>
              <Input
                id="p2p-ship"
                type="number"
                min={0}
                step={0.01}
                value={standardShipping}
                onChange={(e) => setStandardShipping(Number(e.target.value) || 0)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="p2p-fee">Simulated traveler fee (USD)</Label>
              <Input
                id="p2p-fee"
                type="number"
                min={0}
                step={0.01}
                value={travelerFee}
                onChange={(e) => setTravelerFee(Number(e.target.value) || 0)}
              />
              <p className="text-xs text-muted-foreground">
                Your own assumption for comparison — no traveler fee is quoted or charged here.
              </p>
            </div>
          </div>

          {!result && (
            <p className="text-sm text-muted-foreground">
              Select a route (from and to country) to see the simulated cost comparison.
            </p>
          )}
          {result && (
            <div className="space-y-3">
              <p className="flex items-start gap-2 text-sm">
                <Scale className="mt-0.5 h-4 w-4 flex-shrink-0" />
                Simulated comparison for {fromName} → {toName} on a ${valueUsd.toFixed(2)} item
                (duty {dutyPct}%, VAT{' '}
                {result.vatUnknown ? 'unknown — treated as 0% in this estimate' : `${result.vatPct}%`}
                {result.threshold !== null
                  ? `, de minimis threshold $${result.threshold}`
                  : ', no known de minimis threshold — no threshold benefit assumed'}).
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border p-3">
                  <p className="font-medium">Standard shipping (estimate)</p>
                  <p className="text-sm text-muted-foreground">
                    Item ${result.standard.priceUsd.toFixed(2)} + duty $
                    {result.standard.dutyUsd.toFixed(2)} + shipping $
                    {result.standard.shippingUsd.toFixed(2)} + VAT $
                    {result.standard.vatUsd.toFixed(2)}
                  </p>
                  <p className="mt-1 text-lg font-bold">${result.standard.totalUsd.toFixed(2)}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="font-medium">Traveler-assisted (simulated estimate)</p>
                  <p className="text-sm text-muted-foreground">
                    Item ${result.traveler.priceUsd.toFixed(2)} + duty $
                    {result.traveler.dutyUsd.toFixed(2)} + traveler fee $
                    {result.traveler.shippingUsd.toFixed(2)} + VAT $
                    {result.traveler.vatUsd.toFixed(2)}
                  </p>
                  <p className="mt-1 text-lg font-bold">${result.traveler.totalUsd.toFixed(2)}</p>
                </div>
              </div>
              <p className="text-sm">
                Simulated difference:{' '}
                <strong>
                  {result.saving >= 0 ? 'traveler-assisted lower by ' : 'standard lower by '}$
                  {Math.abs(result.saving).toFixed(2)}
                </strong>{' '}
                — an estimate from your own inputs, not a quoted price or a guaranteed saving.
                Traveler-carried goods must still be declared at customs; this comparison never
                avoids duty.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">How a real match would work (process outline)</CardTitle>
          <CardDescription>
            Criteria only — no travelers are listed here, and none can be contacted from this page.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>Route overlap: the traveler&apos;s flight route matches the sender&apos;s from/to countries.</li>
            <li>Date overlap: travel dates cover the sender&apos;s required delivery window.</li>
            <li>Baggage allowance: the item fits the traveler&apos;s free allowance and airline size/weight rules.</li>
            <li>Item eligibility: the item is not prohibited by either airline or either country.</li>
            <li>Customs declaration: the traveler declares the goods and the sender pays any duty/VAT due.</li>
            <li>Handoff in a public place with proof of delivery — arranged outside SmartBuy, which arranges nothing.</li>
          </ol>
        </CardContent>
      </Card>

      <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm dark:border-red-800 dark:bg-red-950/50">
        <ShieldAlert className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600" />
        <div className="space-y-1">
          <p>
            <strong>Legal compliance:</strong> travelers and senders must declare goods at customs,
            comply with airline baggage policies and prohibited-items rules, and obey both
            countries&apos; import laws. Undeclared transport can lead to fines, seizure, or a travel
            ban. SmartBuy arranges no transport, handles no payment, and assumes no liability for
            any traveler arrangement.
          </p>
          <p className="text-muted-foreground">
            This page collects no contact, payment, or handoff details and submits nothing to a
            server — it is an educational simulation and cost-comparison tool only.
          </p>
        </div>
      </div>
    </div>
  );
}
