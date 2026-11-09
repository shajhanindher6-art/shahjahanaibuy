/**
 * fetch() with a hard timeout (P0 fix, 2026-11-09 audit).
 *
 * The compare Decision/Spec Matrix fetches had no timeout at all, so
 * one slow or hanging API kept the page on "Loading…" forever (seen
 * live once: both sections stuck ~10s with no error). The product page
 * already had its own local fetchTimed helper; this is the shared
 * version for every other client fetch that must never hang.
 *
 * On timeout the promise rejects with the DOMException named
 * "TimeoutError" (AbortSignal.timeout), so callers keep their existing
 * catch → honest fallback path (matrix renders "—" cells with a note,
 * attributes fetch returns ok:false and hides its section).
 */

export async function fetchTimed(
  input: string,
  ms = 15000,
  init: RequestInit = {}
): Promise<Response> {
  const res = await fetch(input, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(ms),
  });
  return res;
}
