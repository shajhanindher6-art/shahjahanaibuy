/**
 * JSON fallback client for POST /api/v1/deal-finder.
 *
 * The chat UIs now stream through the Vercel AI SDK (`useChat`
 * against the route's AI SDK data-stream response). This module is
 * kept ONLY as the fallback path: when the stream request fails
 * (network error, rate limit, or a collapsed stream), the UI
 * retries once with a plain-JSON request and renders that answer
 * instead — never a fabricated recommendation, never a silent
 * hang. The old hand-rolled SSE parser is gone: the route no
 * longer emits the legacy `data: {"type":"chunk"}` shape.
 */

export interface DealFinderProduct {
  id: string;
  name: string;
  slug: string;
  brand: string | null;
  imageUrl: string | null;
  price: number | null;
}

export interface DealFinderMetadata {
  products?: DealFinderProduct[];
  comparison?: string;
  budget?: number;
  intent?: string;
}

export interface DealFinderResult {
  response: string;
  metadata: DealFinderMetadata | null;
}

function parseJsonResult(data: unknown): DealFinderResult | null {
  if (
    data &&
    typeof data === 'object' &&
    (data as { success?: unknown }).success === true &&
    (data as { data?: unknown }).data &&
    typeof (data as { data: { response?: unknown } }).data.response === 'string'
  ) {
    const d = (data as { data: { response: string; metadata?: DealFinderMetadata | null } }).data;
    return { response: d.response, metadata: d.metadata ?? null };
  }
  return null;
}

/** One plain-JSON request (Accept: application/json). Null on any failure. */
export async function fetchDealFinderJson(args: {
  message: string;
  country: string;
}): Promise<DealFinderResult | null> {
  try {
    const res = await fetch('/api/v1/deal-finder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(args),
    });
    if (!res.ok) return null;
    return parseJsonResult(await res.json().catch(() => null));
  } catch {
    return null;
  }
}
