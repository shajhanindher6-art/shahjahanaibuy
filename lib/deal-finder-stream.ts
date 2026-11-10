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

/** One turn of the chat history, as the widget sends it. */
export interface ChatHistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

// ---------------------------------------------------------------------------
// Multi-turn follow-up resolution (S5#2 — conversational commerce)
// ---------------------------------------------------------------------------
//
// The deterministic engine is stateless: it answers one message at a
// time. A follow-up like "aur sasta dikhao" or "is se halka kaun sa
// hai?" only makes sense against the products the previous turn
// listed, so the client (and the route, as a safety net) rewrites
// such messages into self-contained queries BEFORE the engine sees
// them — using only the product names from the previous turn, never
// invented data. A message that is not a follow-up, or a follow-up
// with no product context, passes through unchanged and the engine
// answers (or honestly asks for clarification) as before.

type FollowUpKind = 'cheaper' | 'lighter' | 'best' | 'compare';

const FOLLOW_UP_PATTERNS: Array<{ kind: FollowUpKind; re: RegExp }> = [
  // Cheaper / lowest price.
  { kind: 'cheaper', re: /\b(cheaper|cheapest|lowest price|low price|sasta|sasti|sastay|sastye|kam price|kam qeemat)\b/i },
  { kind: 'cheaper', re: /\b(aur sasta|aur sastay|aur kam|is se sasta|is se kam)\b/i },
  // Lighter / lightest.
  { kind: 'lighter', re: /\b(lighter|lightest|halka|halki|halkay|light weight|lightweight)\b/i },
  { kind: 'lighter', re: /\b(is se halka|is se halki|aur halka)\b/i },
  // Best / which one.
  { kind: 'best', re: /\b(best one|best kaunsa|best kaun sa|which one|which is the best|in mein se best|in me se best|sab se acha|sab se accha)\b/i },
  { kind: 'best', re: /\b(that one|is ka|is ko|yeh wala|ye wala|us ka)\b/i },
  // Compare them.
  { kind: 'compare', re: /\b(compare them|compare karo|in ka compare|in ko compare|compare these|in mein farq|in me farq)\b/i },
];

function detectFollowUpKind(message: string): FollowUpKind | null {
  const text = message.trim();
  // A follow-up is short and refers back ("them", "that one", "is
  // se", "aur ...") — a long self-contained question is not one.
  if (text.length > 120) return null;
  for (const { kind, re } of FOLLOW_UP_PATTERNS) {
    if (re.test(text)) return kind;
  }
  return null;
}

/**
 * Rewrite a follow-up into a self-contained query using the product
 * names from the previous turn. Returns the original message when
 * it is not a follow-up or when there is no product context.
 */
export function resolveFollowUpQuery(message: string, contextProductNames: string[]): string {
  const kind = detectFollowUpKind(message);
  if (!kind) return message;
  const names = contextProductNames
    .map((n) => n.trim())
    .filter((n) => n !== '')
    .slice(0, 3);
  if (names.length === 0) return message;

  if (names.length >= 2) {
    const joined = names.join(', ');
    switch (kind) {
      case 'cheaper':
        return `Compare ${joined} — which is the cheapest and the best value?`;
      case 'lighter':
        return `Compare ${joined} — which is the lightest?`;
      case 'best':
        return `Compare ${joined} and recommend the best one for most buyers.`;
      case 'compare':
        return `Compare ${joined} — full comparison.`;
    }
  }

  // Single product in context: ask for an alternative / more detail.
  const [name] = names;
  switch (kind) {
    case 'cheaper':
      return `Find a cheaper alternative to ${name}.`;
    case 'lighter':
      return `Find a lighter alternative to ${name}.`;
    case 'best':
      return `Tell me more about ${name} — is it the best choice?`;
    case 'compare':
      return `Compare ${name} with similar products.`;
  }
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

/**
 * One plain-JSON request (Accept: application/json). Null on any failure.
 *
 * Multi-turn (S5#2): callers may pass `history` (earlier turns) and
 * `contextProducts` (product names from the previous assistant turn).
 * Follow-ups are resolved client-side into self-contained queries
 * before sending, so the stateless engine can answer them; the raw
 * history is also sent so the route can resolve again as a safety
 * net and future engine versions can use it.
 */
export async function fetchDealFinderJson(args: {
  message: string;
  country: string;
  history?: ChatHistoryTurn[];
  contextProducts?: string[];
}): Promise<DealFinderResult | null> {
  try {
    const message = resolveFollowUpQuery(args.message, args.contextProducts ?? []);
    const res = await fetch('/api/v1/deal-finder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        message,
        country: args.country,
        history: args.history ?? [],
        contextProducts: args.contextProducts ?? [],
      }),
    });
    if (!res.ok) return null;
    return parseJsonResult(await res.json().catch(() => null));
  } catch {
    return null;
  }
}
