/**
 * Floating AI Deal Finder widget.
 *
 * A chat bubble fixed to the bottom-right of every public page
 * (mounted in the root layout, hidden on /dashboard/* where the
 * full dashboard chat already lives). Visitors ask in plain words
 * — category, preference, budget — and get best deals / products
 * back from POST /api/v1/deal-finder, rendered as a text reply
 * plus clickable product cards.
 *
 * Streaming runs through the Vercel AI SDK's `useChat` hook
 * against the route's AI SDK data-stream response: the answer
 * renders incrementally as its own lines arrive. Product cards
 * come from the one `data` part per turn (see the mapping note
 * in the dashboard AIChatPanel — same shape here). If the
 * stream fails, one plain-JSON retry runs instead — never a
 * fabricated recommendation. The engine is deterministic
 * (no LLM): the stream is transport, not token generation.
 *
 * Stateless: no conversation is saved and no login is required,
 * so a logged-out visitor can use it immediately. Quick chips
 * cover the most common asks for visitors who do not know what
 * to type.
 */

'use client';

import { useState, useRef, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useChat } from 'ai/react';
import type { JSONValue } from 'ai';
import { MessageCircle, Send, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { cn } from '@/lib/utils';
import { formatPriceForRegion, formatUsd, type Region } from '@/lib/region';
import { useRegion } from '@/components/region/region-provider';
import { fetchDealFinderJson } from '@/lib/deal-finder-stream';

/**
 * Product-card price in the visitor's currency — the same
 * rendering as <Price/>: USD visitors see "$999.00", everyone
 * else sees "≈ Rs 279,720" plus the small USD value. Card prices
 * arrive from the server in USD, so this formats client-side
 * from the RegionProvider region (the reply text itself is
 * already region-formatted server-side from the `country` the
 * widget sends with each request).
 */
function CardPrice({ usd, region }: { usd: number; region: Region }) {
  const { display, approximate } = formatPriceForRegion(usd, region);
  if (!approximate) {
    return <span className="float-right font-semibold text-green-600">{display}</span>;
  }
  return (
    <span className="float-right font-semibold text-green-600">
      ≈ {display} <span className="text-xs font-normal text-muted-foreground">{formatUsd(usd)}</span>
    </span>
  );
}

interface WidgetProduct {
  id: string;
  name: string;
  slug: string;
  brand: string | null;
  imageUrl: string | null;
  price: number | null;
}

const QUICK_CHIPS = [
  'Best deals today',
  'Best laptop under $1000',
  'Noise cancelling headphones',
];

const WELCOME_TEXT =
  'Hi! I can help you shop smarter — tell me what you need, e.g. "best laptop under $1000", and I will find the best deals. Ask me to compare products, or open any product page to set a price alert or save it to your wishlist.';

const ERROR_LINE = 'Sorry, I could not find deals right now. Please try again.';

function isWidgetProduct(value: unknown): value is WidgetProduct {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.id === 'string' &&
    typeof p.name === 'string' &&
    typeof p.slug === 'string' &&
    (p.brand === null || typeof p.brand === 'string') &&
    (p.imageUrl === null || typeof p.imageUrl === 'string') &&
    (p.price === null || typeof p.price === 'number')
  );
}

function productsFromDataEntry(entry: unknown): WidgetProduct[] {
  if (!entry || typeof entry !== 'object') return [];
  const products = (entry as { products?: unknown }).products;
  if (!Array.isArray(products)) return [];
  return products.filter(isWidgetProduct);
}

export function AIDealFinderWidget() {
  const pathname = usePathname();
  // Visitor region (Country Switcher / IP detection) — sent with
  // every request so the assistant's reply prices match the
  // currency the visitor already sees across the site.
  const { region } = useRegion();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  // The query behind the in-flight turn, for the JSON fallback in
  // onError (the hook's error callback does not receive it).
  const pendingMessageRef = useRef('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const { messages, append, status, data, setMessages, setData } = useChat({
    api: '/api/v1/deal-finder',
    initialMessages: [{ id: 'welcome', role: 'assistant', content: WELCOME_TEXT }],
    // Keep the user message and any partial answer visible when the
    // stream fails, so the fallback can complete them in place.
    keepLastMessageOnError: true,
    onError: async () => {
      const query = pendingMessageRef.current;
      const result = query
        ? await fetchDealFinderJson({ message: query, country: region.code })
        : null;
      // One data entry per assistant turn keeps the products
      // mapping aligned, even when the turn failed. The products
      // are re-shaped into plain JSON values: the typed
      // DealFinderProduct interface has no index signature, so it
      // is not assignable to the hook's JSONValue data state.
      const productsEntry: JSONValue = {
        products: (result?.metadata?.products ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          slug: p.slug,
          brand: p.brand,
          imageUrl: p.imageUrl,
          price: p.price,
        })),
      };
      setData((prev) => [...(prev ?? []), productsEntry]);
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (!last || last.role !== 'assistant') return prev;
        if (result) {
          next[next.length - 1] = { ...last, content: result.response };
        } else if (last.content === '') {
          next[next.length - 1] = { ...last, content: ERROR_LINE };
        }
        // A partial stream already rendered stays as-is (genuine
        // answer text, just incomplete).
        return next;
      });
    },
  });

  const sending = status === 'submitted' || status === 'streaming';

  // Attach product cards to each assistant message from the `data`
  // entries (same mapping as the dashboard AIChatPanel: the welcome
  // message is assistant ordinal 0 with no entry; the k-th
  // assistant message after it maps to data[k - 1]).
  let assistantOrdinal = -1;
  const view = messages.map((m) => {
    if (m.role === 'assistant') assistantOrdinal += 1;
    return {
      id: m.id,
      role: m.role === 'user' ? 'user' : ('assistant' as const),
      content: m.content,
      products:
        m.role === 'assistant' && assistantOrdinal >= 1
          ? productsFromDataEntry(data?.[assistantOrdinal - 1])
          : [],
    };
  });

  // Recent searches from the search page's localStorage list, so
  // the assistant can pick up where the visitor left off — no
  // account needed, and nothing is sent anywhere until the
  // visitor taps a chip. Loaded when the panel opens, so a
  // search done in another tab still shows up.
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, sending, open]);

  useEffect(() => {
    if (!open) return;
    try {
      const raw = window.localStorage.getItem('smartbuy-recent-searches');
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      if (Array.isArray(parsed)) {
        setRecentSearches(parsed.filter((q): q is string => typeof q === 'string').slice(0, 4));
      }
    } catch {
      setRecentSearches([]);
    }
  }, [open]);

  // Follow-up chips after an assistant answer that listed
  // products: they re-send the question WITH the product names
  // included, so the (stateless) deal-finder engine's compare
  // intent can actually answer about those products instead of
  // getting a context-free "cheapest?" it cannot resolve.
  const lastAssistantProducts = [...view]
    .reverse()
    .find((m) => m.role === 'assistant' && m.products.length > 0)?.products;
  const followUpChips =
    lastAssistantProducts && lastAssistantProducts.length > 1
      ? [
          {
            label: 'Sab se sasta kaunsa hai?',
            message: `Compare ${lastAssistantProducts.map((p) => p.name).join(', ')} — which is the cheapest and the best value?`,
          },
          {
            label: 'In mein best kaunsa hai?',
            message: `Compare ${lastAssistantProducts.map((p) => p.name).join(' vs ')} and recommend the best one for most buyers.`,
          },
        ]
      : [];

  // Dashboard has its own full chat page; do not duplicate it there.
  if (pathname?.startsWith('/dashboard')) return null;

  // Spinner only until the first streamed chunk arrives — the
  // placeholder is empty until then, and grows after that.
  const lastMessage = view[view.length - 1];
  const awaitingFirstChunk =
    sending && lastMessage?.role === 'assistant' && lastMessage.content === '';

  async function send(text: string) {
    const message = text.trim();
    if (!message || sending) return;
    pendingMessageRef.current = message;
    setInput('');
    try {
      await append(
        { role: 'user', content: message },
        { body: { country: region.code } }
      );
    } catch {
      // Stream failures surface through onError (which runs the
      // JSON fallback); this only guards an unexpected throw.
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === 'assistant' && last.content === '') {
          next[next.length - 1] = { ...last, content: 'Sorry, something went wrong. Please try again.' };
        }
        return next;
      });
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-3">
      {open && (
        // (i) Height capped to the viewport: the old fixed 480px panel
        // plus the toggle button overflowed short viewports (e.g.
        // landscape phones), clipping the panel header off-screen and
        // over the page's buy area with no way to reach the close
        // button. Desktop keeps 480px; short screens shrink the panel
        // instead of overflowing. The panel is still a floating overlay
        // by design, so while open it covers the bottom-right content
        // beneath it — closing it (X or the bubble) restores the buy
        // buttons; fully reserving page space would need layout changes
        // outside this component (see report).
        <div className="flex h-[min(480px,calc(100dvh-6.5rem))] w-[calc(100vw-2rem)] max-w-sm flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between bg-blue-600 px-4 py-3 text-white">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="h-4 w-4" /> AI Deal Finder
            </p>
            <button onClick={() => setOpen(false)} aria-label="Close chat" className="rounded p-1 hover:bg-blue-700">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
            {view.map((m) => (
              <div key={m.id} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div
                  className={cn(
                    'max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed',
                    m.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100'
                  )}
                >
                  <p className="whitespace-pre-line">{m.content}</p>
                  {m.products && m.products.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {m.products.map((p) => (
                        <Link
                          key={p.id}
                          href={`/products/${p.slug}`}
                          className="block rounded-md bg-white px-2 py-1.5 text-slate-800 hover:bg-blue-50 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                        >
                          <span className="font-medium">{p.name}</span>
                          {p.brand && <span className="text-muted-foreground"> · {p.brand}</span>}
                          {p.price !== null && <CardPrice usd={p.price} region={region} />}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {awaitingFirstChunk && (
              <div className="flex justify-start">
                <div className="rounded-lg bg-slate-100 px-3 py-2 dark:bg-slate-800">
                  <LoadingSpinner size="sm" />
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5 border-t border-slate-100 px-3 pt-2 dark:border-slate-800">
            {QUICK_CHIPS.map((chip) => (
              <button
                key={chip}
                onClick={() => send(chip)}
                className="rounded-full bg-slate-100 px-2.5 py-1 text-xs hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700"
              >
                {chip}
              </button>
            ))}
            {followUpChips.map((chip) => (
              <button
                key={chip.label}
                onClick={() => send(chip.message)}
                className="rounded-full bg-blue-100 px-2.5 py-1 text-xs text-blue-800 hover:bg-blue-200 dark:bg-blue-950 dark:text-blue-200 dark:hover:bg-blue-900"
              >
                {chip.label}
              </button>
            ))}
            {recentSearches.map((recent) => (
              <button
                key={recent}
                onClick={() => send(recent)}
                className="rounded-full border border-dashed border-slate-300 px-2.5 py-1 text-xs text-muted-foreground hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
                title="Your recent search"
              >
                ↻ {recent}
              </button>
            ))}
          </div>

          <form
            className="flex gap-2 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="e.g. best laptop under $1000"
              maxLength={500}
              className="flex-1"
            />
            <Button type="submit" size="icon" disabled={sending || !input.trim()} aria-label="Send message">
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      )}

      <Button
        size="icon"
        className="h-12 w-12 rounded-full shadow-lg"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close AI Deal Finder' : 'Open AI Deal Finder'}
      >
        {open ? <X className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
      </Button>
    </div>
  );
}
