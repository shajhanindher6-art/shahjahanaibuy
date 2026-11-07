/**
 * Streaming client for POST /api/v1/deal-finder.
 *
 * Requests the Server-Sent Events shape (Accept:
 * text/event-stream) and calls `onChunk` for each text chunk as
 * it arrives, so the chat UI can render the answer
 * incrementally. The chunks are the answer's own lines, in
 * order — appending them reproduces the full answer exactly.
 *
 * Fallbacks (never a fake answer, never a silent hang):
 * - The server answers JSON instead of SSE (or a proxy
 *   collapses the stream) → the JSON body is parsed and the
 *   full answer returned at once, with no chunks fired.
 * - The SSE fetch fails at the network level, or the stream
 *   breaks before any chunk arrived → ONE plain-JSON retry
 *   (Accept: application/json). A second failure returns null
 *   and the caller shows its honest error line.
 * - The stream breaks mid-answer after chunks already
 *   rendered → the partial answer is returned as-is (genuine
 *   answer text, just incomplete) with metadata null, so the
 *   caller keeps what arrived instead of overwriting it with
 *   an error.
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

type SseEvent =
  | { type: 'chunk'; text: string }
  | { type: 'done'; metadata: DealFinderMetadata | null };

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

/** One plain-JSON request (Accept: application/json). */
async function fetchJsonOnce(args: {
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

export async function requestDealFinder(
  args: { message: string; country: string },
  onChunk: (text: string) => void
): Promise<DealFinderResult | null> {
  let res: Response;
  try {
    res = await fetch('/api/v1/deal-finder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(args),
    });
  } catch {
    // Network failure before any response: one plain-JSON retry.
    return fetchJsonOnce(args);
  }

  if (!res.ok) return null;

  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('text/event-stream') || !res.body) {
    // Server answered JSON: full answer at once, no chunks.
    return parseJsonResult(await res.json().catch(() => null));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let metadata: DealFinderMetadata | null = null;

  const handleBlock = (block: string) => {
    for (const line of block.split('\n')) {
      if (!line.startsWith('data:')) continue;
      let event: SseEvent;
      try {
        event = JSON.parse(line.slice(5).trim()) as SseEvent;
      } catch {
        continue;
      }
      if (event.type === 'chunk') {
        text += event.text;
        onChunk(event.text);
      } else if (event.type === 'done') {
        metadata = event.metadata;
      }
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        handleBlock(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');
      }
    }
    // A well-formed stream ends with "\n\n"; this only catches a
    // trailing partial block.
    buffer += decoder.decode();
    if (buffer.trim() !== '') handleBlock(buffer);
  } catch {
    if (text === '') {
      // Stream broke before any text arrived: one plain-JSON retry.
      return fetchJsonOnce(args);
    }
    // Partial answer already rendered — keep it, no products.
    return { response: text, metadata: null };
  }

  return { response: text, metadata };
}
