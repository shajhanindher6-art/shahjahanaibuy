import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { tradeoffRows, type SpecTier } from '@/lib/analytics/specTradeoffs';
import type { ProductAttribute } from '@/types/catalog';

/**
 * Zero-Jargon Spec Table (Option 16, Step 3).
 *
 * Translates RECORDED specs into plain-language benefits ("what this
 * means for you"). Only rows with a translation rule are shown; the
 * raw spec still lives in the Specs tab. No recorded specs — or no
 * rule for the recorded ones — renders an honest empty state, never
 * invented specs.
 *
 * Server-safe: pure render, no client state.
 */

const TIER_LABEL: Record<SpecTier, string> = {
  basic: 'Basic',
  balanced: 'Balanced',
  pro: 'Pro',
};

export function SpecTradeoffTable({
  attributes,
}: {
  attributes: ProductAttribute[] | null | undefined;
}) {
  const rows = tradeoffRows(attributes);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Specs, In Plain Words</CardTitle>
        <CardDescription>
          What the recorded specs actually mean for you — no jargon, no measured test claims
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No recorded specs to translate yet for this product. Add real
            specifications and their plain-language meanings will appear here.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Spec</th>
                  <th className="py-2 pr-4 font-medium">What it means for you</th>
                  <th className="py-2 font-medium">Level</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.key}-${row.displayValue}`} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-medium">
                      {row.key}
                      <span className="block text-xs font-normal text-muted-foreground">
                        {row.displayValue}
                      </span>
                    </td>
                    <td className="py-2 pr-4">{row.benefit}</td>
                    <td className="py-2">
                      <Badge variant="secondary">{TIER_LABEL[row.tier]}</Badge>
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
