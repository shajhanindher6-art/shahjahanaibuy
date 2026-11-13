/**
 * Buying Considerations — Section 19, §12 #18.
 *
 * The consolidated "Before you buy" section on the product detail
 * page. Every line comes from `buildBuyingConsiderations`
 * (services/buying-considerations.ts) over signals the page already
 * holds — price freshness, discount validation, price position and
 * recorded trust signals. Nothing is invented: when the builder
 * returns no considerations (no priced merchant, no recorded check
 * date, no reviews) this renders the honest "not enough data" line
 * instead of a made-up checklist.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  buildBuyingConsiderations,
  type BuyingConsiderationInput,
} from '@/services/buying-considerations';

const TONE_STYLES: Record<string, string> = {
  ok: 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950',
  caution:
    'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950',
  info: 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900',
};

export function BuyingConsiderations(props: BuyingConsiderationInput) {
  const items = buildBuyingConsiderations(props);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Before you buy</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-muted-foreground">
            Not enough recorded data to list buying considerations for
            this product yet — no priced retailer, no recorded
            price-check date and no reviews.
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((item, i) => (
              <li
                key={i}
                className={`rounded-lg border p-3 text-sm ${TONE_STYLES[item.tone] ?? TONE_STYLES.info}`}
              >
                {item.text}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Built only from recorded prices, check dates and reviews —
          always check the retailer&rsquo;s page before buying.
        </p>
      </CardContent>
    </Card>
  );
}
