/**
 * withTimeout — bound how long we wait for a promise that has no
 * native AbortSignal support (Section 15, P1-3).
 *
 * fetch() calls take `signal: AbortSignal.timeout(ms)` directly (see
 * lib/fetch-timed.ts and the eBay adapter). The Resend SDK and
 * web-push expose no signal/fetch option, so their calls are wrapped
 * here instead: the race rejects with a DOMException named
 * "TimeoutError" after `ms`, exactly like AbortSignal.timeout does,
 * and the caller reports the failure honestly instead of hanging.
 *
 * This bounds the WAITER only — it cannot cancel work already
 * accepted by the provider (a Resend send that lands after the
 * timeout may still deliver). Callers must treat a timeout as a
 * failed send and let their normal retry/queue path decide what
 * happens next; they must never claim delivery on a timeout.
 */

export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          const err = new Error(`${label} timed out after ${ms}ms`);
          err.name = 'TimeoutError';
          reject(err);
        }, ms);
        // Do not keep the process alive for the timer alone.
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
