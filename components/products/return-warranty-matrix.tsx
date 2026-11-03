'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  POLICY_LAST_REVIEWED,
  matrixRowsForStores,
  policyForStore,
  type ReturnPolicyRow,
} from '@/services/return-policies';

/**
 * Return Policy & Warranty Matrix — general summaries, side by side.
 *
 * HONESTY, enforced in the UI:
 * - Header disclaimer on every render: "General policy summary —
 *   always verify at the retailer's site before purchase" plus the
 *   "last reviewed" stamp, so staleness is visible, not hidden.
 * - Marketplace rows (eBay, AliExpress) never get an invented window
 *   or fee — they read "Varies by seller — check the listing".
 * - Warranty is described as manufacturer-handled; no product
 *   warranty length is ever invented.
 * - No deep links to guessed help pages: only the retailer domain
 *   is shown as plain text.
 * - Stores with no policy entry are omitted; the footer names them
 *   as omitted rather than filling them with a guess.
 */
export function ReturnWarrantyMatrix({
  merchantNames,
  countryStoreNames,
}: {
  /** Priced merchant names for this product (cheapest first). */
  merchantNames: string[];
  /** Directory store names for the visitor's country (optional). */
  countryStoreNames?: string[];
}) {
  const pricedRows = matrixRowsForStores(merchantNames);
  const extraNames = (countryStoreNames ?? []).filter(
    (n) => !pricedRows.some((r) => r.store.toLowerCase() === n.trim().toLowerCase())
  );
  const extraRows = matrixRowsForStores(extraNames);
  const rows = [...pricedRows, ...extraRows];
  // Priced merchants without a policy entry: named as omitted, never guessed.
  const omitted = merchantNames.filter((n) => !policyForStore(n));

  if (rows.length === 0 && omitted.length === 0) {
    return null;
  }

  const cell = (value: string | null, marketplace: boolean): string => {
    if (value) return value;
    return marketplace
      ? 'Varies by seller — check the listing'
      : 'Varies — check the retailer site';
  };

  return (
    <Card className="mt-8">
      <CardHeader>
        <CardTitle className="text-base">Return policy &amp; warranty matrix</CardTitle>
        <CardDescription>
          General policy summary — always verify at the retailer&apos;s site before purchase. Last
          reviewed: {POLICY_LAST_REVIEWED}. Warranty terms are set by the manufacturer unless a
          store&apos;s optional protection plan is noted; no warranty length is shown for a product
          because stores do not set one.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Store</th>
              <th className="py-2 pr-3 font-medium">Return window</th>
              <th className="py-2 pr-3 font-medium">Restocking fee</th>
              <th className="py-2 pr-3 font-medium">Warranty handling</th>
              <th className="py-2 font-medium">Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row: ReturnPolicyRow) => (
              <tr key={row.store} className="border-b last:border-0">
                <td className="py-2 pr-3">
                  <span className="font-medium">{row.store}</span>
                  <span className="block text-xs text-muted-foreground">{row.domain}</span>
                  {row.marketplace && (
                    <Badge variant="secondary" className="mt-1 text-xs">
                      Marketplace
                    </Badge>
                  )}
                </td>
                <td className="py-2 pr-3">{cell(row.returnWindow, row.marketplace)}</td>
                <td className="py-2 pr-3">{cell(row.restockingFee, row.marketplace)}</td>
                <td className="py-2 pr-3">{row.warrantyHandling}</td>
                <td className="py-2 text-muted-foreground">{row.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {omitted.length > 0 && (
          <p className="text-xs text-muted-foreground">
            No general policy entry for: {omitted.join(', ')} — omitted rather than guessed. Check
            the retailer&apos;s site for its terms.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Policies change and vary by product category, membership, and seller. This matrix is a
          starting point for comparison, not the retailer&apos;s terms.
        </p>
      </CardContent>
    </Card>
  );
}
