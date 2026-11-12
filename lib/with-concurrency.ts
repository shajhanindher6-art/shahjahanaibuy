/**
 * Section 18, item 37 — bounded-concurrency mapper.
 *
 * `Promise.all(items.map(fn))` would fire every item at once — up
 * to ~1,000 concurrent DB writes in the refresh chain, which the
 * free-tier Supabase pool cannot absorb. This runs at most `limit`
 * items at a time (default 5) and preserves input order in the
 * returned array, so callers can aggregate per-item outcomes
 * exactly as they did with a sequential loop.
 *
 * The `next++` claim is synchronous between awaits, so workers
 * never claim the same index (single-threaded JS — no race).
 * A rejection from `fn` rejects the whole call, like Promise.all;
 * callers that must isolate per-item failures should catch inside
 * `fn` and return a per-item outcome instead.
 */
export async function mapWithConcurrencyLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const workerCount = Math.max(1, Math.min(limit, items.length));
  let next = 0;
  const workers = Array.from({ length: workerCount }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}
