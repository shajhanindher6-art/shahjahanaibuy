/**
 * Warranty Plans Table (Section 6, item 12).
 *
 * Props-driven, standalone: renders admin-recorded third-party
 * warranty/insurance plans. Only recorded fields are shown — any
 * unrecorded field reads "Not recorded". The manufacturer warranty
 * is a SEPARATE labelled column, never merged into a third-party
 * plan row: a plan's coverage and the manufacturer's own warranty
 * are different things and must not be confused.
 */
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import type { WarrantyPlan } from '@/lib/warranty-plans';

export interface WarrantyPlansTableProps {
  /** Admin-recorded plans (already filtered/sorted by the caller). */
  plans: WarrantyPlan[];
  /**
   * The product's recorded manufacturer warranty label (e.g. the
   * Global Readiness `globalWarrantyType`), or null when unrecorded.
   * Shown in its own column — never as a plan row.
   */
  manufacturerWarranty?: string | null;
}

function valueOrNotRecorded(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return 'Not recorded';
  if (typeof value === 'string') return value.trim() !== '' ? value : 'Not recorded';
  return String(value);
}

export function WarrantyPlansTable({ plans, manufacturerWarranty }: WarrantyPlansTableProps) {
  const manufacturerLabel =
    manufacturerWarranty && manufacturerWarranty.trim() !== ''
      ? manufacturerWarranty.trim()
      : 'Not recorded';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Warranty &amp; insurance plans</CardTitle>
        <CardDescription>
          Third-party plans recorded by an admin from the provider&apos;s own
          published page. No plan is recommended; coverage is shown only
          when recorded.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {plans.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No recorded warranty plans for this category yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Provider</th>
                  <th className="py-2 pr-3 font-medium">Plan</th>
                  <th className="py-2 pr-3 font-medium">Coverage</th>
                  <th className="py-2 pr-3 font-medium">Duration</th>
                  <th className="py-2 pr-3 font-medium">Price</th>
                  <th className="py-2 pr-3 font-medium">Deductible</th>
                  <th className="py-2 pr-3 font-medium">Manufacturer warranty</th>
                  <th className="py-2 font-medium">Source</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((plan) => (
                  <tr key={plan.id} className="border-b last:border-0 align-top">
                    <td className="py-2 pr-3 font-medium">{plan.providerName}</td>
                    <td className="py-2 pr-3">{plan.planName}</td>
                    <td className="py-2 pr-3">{valueOrNotRecorded(plan.coverageSummary)}</td>
                    <td className="py-2 pr-3">
                      {plan.durationMonths === null
                        ? 'Not recorded'
                        : `${plan.durationMonths} months`}
                    </td>
                    <td className="py-2 pr-3">
                      {plan.priceUsd === null
                        ? 'Not recorded'
                        : `$${plan.priceUsd.toFixed(2)} ${plan.currency}`}
                    </td>
                    <td className="py-2 pr-3">
                      {plan.deductibleUsd === null
                        ? 'Not recorded'
                        : `$${plan.deductibleUsd.toFixed(2)}`}
                    </td>
                    <td className="py-2 pr-3">{manufacturerLabel}</td>
                    <td className="py-2">
                      {plan.sourceUrl ? (
                        <a
                          href={plan.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 underline hover:text-blue-800"
                        >
                          Provider page
                        </a>
                      ) : (
                        'Not recorded'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
