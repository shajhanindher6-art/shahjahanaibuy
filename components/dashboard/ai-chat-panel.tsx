/**
 * Dashboard AI chat panel — AI Glass redesign.
 *
 * A compact embedded chat that calls the SAME public endpoint as the
 * floating AI Deal Finder widget (POST /api/v1/deal-finder) through
 * the Vercel AI SDK's `useChat` hook — no second AI, no new
 * backend, no invented answers. The hook streams the route's
 * AI SDK data-stream response incrementally (smooth rendering as
 * the answer's own lines arrive); the floating widget stays as
 * it is; this panel is the dashboard's always-visible AI, per
 * the approved concept.
 *
 * Product chips: the server writes one `data` part per turn
 * carrying { products }; the hook collects those into its `data`
 * state, one entry per assistant turn. The welcome message is
 * assistant ordinal 0 and has no entry; the k-th assistant
 * message after it maps to data[k - 1]. The onError path appends
 * an entry even for failed turns, so the mapping never drifts.
 * Failures fall back to one plain-JSON retry — never a fabricated
 * recommendation. The engine is deterministic (no LLM): the
 * stream is transport, not token generation.
 */

'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useChat } from 'ai/react';
import type { JSONValue } from 'ai';
import { Send, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRegion } from '@/components/region/region-provider';
import { fetchDealFinderJson } from '@/lib/deal-finder-stream';

interface ChatProduct {
  id: string;
  name: string;
  slug: string;
  brand: string | null;
  imageUrl: string | null;
  price: number | null;
}

const WELCOME_TEXT =
  'Hi! Ask me for a deal — a product, a budget, or a category — and I will find real matches from the catalog.';

const SUGGESTIONS = ['Best laptop under $1000', 'Cheapest headphones', 'Show me deals'];

const ERROR_LINE = 'Sorry, I could not find deals right now. Please try again.';

function isChatProduct(value: unknown): value is ChatProduct {
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

function productsFromDataEntry(entry: unknown): ChatProduct[] {
  if (!entry || typeof entry !== 'object') return [];
  const products = (entry as { products?: unknown }).products;
  if (!Array.isArray(products)) return [];
  return products.filter(isChatProduct);
}

export function AIChatPanel() {
  const { region } = useRegion();
  const [input, setInput] = useState('');
  // The query behind the in-flight turn, for the JSON fallback in
  // onError (the hook's error callback does not receive it).
  const pendingMessageRef = useRef('');

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

  // Attach product chips to each assistant message from the `data`
  // entries (see the header comment for the mapping).
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

  // "Thinking" only until the first streamed chunk arrives — the
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
    <div className="glass-card flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-white/40 bg-gradient-to-r from-blue-600/90 to-violet-600/90 px-4 py-3 text-white">
        <Sparkles className="h-4 w-4" />
        <p className="text-sm font-semibold">AI Assistant</p>
      </div>
      <div className="flex max-h-80 min-h-48 flex-col gap-2 overflow-y-auto p-3">
        {view.map((m) => (
          <div key={m.id} className={m.role === 'user' ? 'ml-6 text-right' : 'mr-6'}>
            <p
              className={`inline-block rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                m.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-card/70 text-foreground dark:bg-muted/70 dark:text-foreground'
              }`}
            >
              {m.content}
            </p>
            {m.products && m.products.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {m.products.map((p) => (
                  <Link
                    key={p.id}
                    href={`/products/${p.slug}`}
                    className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300"
                  >
                    {p.name}
                  </Link>
                ))}
              </div>
            )}
          </div>
        ))}
        {awaitingFirstChunk && (
          <p className="text-xs text-muted-foreground">AI is thinking…</p>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5 border-t border-white/40 px-3 pt-2">
        {SUGGESTIONS.map((s) => (
          <Button
            key={s}
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => send(s)}
            className="h-auto rounded-full px-2.5 py-1 text-xs"
          >
            {s}
          </Button>
        ))}
      </div>
      <form
        className="flex gap-2 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask for a deal…"
          aria-label="Ask the AI assistant for a deal"
          maxLength={500}
          className="min-w-0 flex-1 rounded-full border border-slate-200 bg-card/80 px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-slate-700"
        />
        <Button type="submit" size="icon" disabled={sending || input.trim() === ''} className="shrink-0 rounded-full">
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
