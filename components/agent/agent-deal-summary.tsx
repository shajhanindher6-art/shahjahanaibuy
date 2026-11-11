/**
 * Agent deal summary (S5#1 — personal AI shopping agent).
 *
 * "Deal milne par tayyar summary": which watched products are at
 * or under their target prices, from the signed-in user's rules
 * and memory via GET /api/v1/agent/summary. Prices shown are the
 * lowest RECORDED in-stock merchant prices — the summary says so,
 * and a product with no recorded price shows "Not recorded"
 * instead of a guessed figure.
 *
 * Guests see their device-only rules with targets only (no prices
 * — device-only rules are never checked in the background, so
 * there is nothing honest to compare against) and a sign-in note.
 *
 * Wiring into the dashboard is wave 2 — this component is ready
 * to mount there.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { loadGuestRules, type AgentRule, type DealSummary } from '@/lib/agent-memory';
import { Button } from '@/components/ui/button';

interface SummaryResponse {
  success: boolean;
  data?: {
    summary: DealSummary;
    setupRequired?: boolean;
    generatedAt?: string;
    priceBasis?: string;
  };
  error?: { message?: string };
}

export function AgentDealSummary({ signedIn }: { signedIn: boolean }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<DealSummary | null>(null);
  const [priceBasis, setPriceBasis] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [guestRules, setGuestRules] = useState<AgentRule[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!signedIn) {
      setGuestRules(loadGuestRules());
      setLoading(false);
      return;
    }
    try {
      const res = await fetch('/api/v1/agent/summary');
      const result = (await res.json().catch(() => null)) as SummaryResponse;
      if (!res.ok || !result.success || !result.data) {
        setError(result.error?.message ?? 'Could not build the deal summary.');
        setLoading(false);
        return;
      }
      setSetupRequired(result.data.setupRequired === true);
      setSummary(result.data.summary);
      setPriceBasis(result.data.priceBasis ?? null);
      setGeneratedAt(result.data.generatedAt ?? null);
    } catch {
      setError('Could not build the deal summary.');
    } finally {
      setLoading(false);
    }
  }, [signedIn]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <p className="text-sm text-muted-foreground">Building your deal summary…</p>;
  }

  return (
    <section aria-label="Agent deal summary" className="space-y-3 rounded-xl border border-slate-200 bg-card p-4 dark:border-slate-700">
      <h3 className="text-base font-semibold">Your deal summary</h3>

      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {setupRequired && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          Agent memory is not set up yet on the server — ask the site owner to run migration 027.
        </p>
      )}

      {!signedIn ? (
        <>
          <p className="text-sm text-muted-foreground">
            Sign in to see your deal summary — device-only rules are not checked in the
            background, so there is no current price to compare them against.
          </p>
          {guestRules.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No rules on this device yet.
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {guestRules.map((rule) => (
                <li key={rule.id}>
                  <Link href={`/products/${rule.productSlug}`} className="font-medium text-blue-600 hover:underline dark:text-blue-400">
                    {rule.productName ?? rule.productSlug}
                  </Link>{' '}
                  <span className="text-muted-foreground">
                    — watching for under ${rule.targetPriceUsd} (device only, price not checked)
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        summary && (
          <>
            <p className="text-sm">{summary.text}</p>
            {summary.items.length > 0 && (
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-muted-foreground dark:border-slate-700 dark:text-muted-foreground">
                    <th scope="col" className="py-1 pr-2 font-medium">Product</th>
                    <th scope="col" className="py-1 pr-2 font-medium">Your target</th>
                    <th scope="col" className="py-1 pr-2 font-medium">Recorded price</th>
                    <th scope="col" className="py-1 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.items.map((item) => (
                    <tr key={item.slug} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                      <td className="py-1.5 pr-2">
                        <Link href={`/products/${item.slug}`} className="font-medium text-blue-600 hover:underline dark:text-blue-400">
                          {item.name}
                        </Link>
                      </td>
                      <td className="py-1.5 pr-2">
                        {item.targetPriceUsd !== null ? `$${item.targetPriceUsd}` : '—'}
                      </td>
                      <td className="py-1.5 pr-2">
                        {item.currentPriceUsd !== null ? `$${item.currentPriceUsd}` : 'Not recorded'}
                      </td>
                      <td className="py-1.5">
                        {item.targetMet ? (
                          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-950 dark:text-green-300">
                            Target met
                          </span>
                        ) : item.priceUnknown ? (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground dark:bg-muted dark:text-muted-foreground">
                            No price recorded
                          </span>
                        ) : (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                            Watching
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="space-y-0.5 text-xs text-muted-foreground">
              {priceBasis && <p>{priceBasis}</p>}
              {generatedAt && <p>Generated {new Date(generatedAt).toLocaleString()}.</p>}
            </div>
            <Button
              type="button"
              variant="link"
              onClick={() => void load()}
              className="h-auto p-0 text-sm"
            >
              Refresh summary
            </Button>
          </>
        )
      )}
    </section>
  );
}

export default AgentDealSummary;
