/**
 * Dashboard AI chat panel — AI Glass redesign.
 *
 * A compact embedded chat that calls the SAME public endpoint as the
 * floating AI Deal Finder widget (POST /api/v1/deal-finder with
 * {message, country}) — no second AI, no new backend, no invented
 * answers. The floating widget stays as it is; this panel is the
 * dashboard's always-visible AI, per the approved concept.
 *
 * Messages render the assistant's text plus product chips (real
 * recommendations from the endpoint, linked to their product
 * pages). Failures fall back to the same honest error line as the
 * floating widget — never a fabricated recommendation.
 */

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Send, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRegion } from '@/components/region/region-provider';
import { requestDealFinder } from '@/lib/deal-finder-stream';

interface ChatProduct {
  id: string;
  name: string;
  slug: string;
  brand: string | null;
  imageUrl: string | null;
  price: number | null;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  products?: ChatProduct[];
}

const SUGGESTIONS = ['Best laptop under $1000', 'Cheapest headphones', 'Show me deals'];

export function AIChatPanel() {
  const { region } = useRegion();
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content:
        'Hi! Ask me for a deal — a product, a budget, or a category — and I will find real matches from the catalog.',
    },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  // Patch the last (assistant placeholder) message in place.
  const updateLastAssistant = (patch: (m: ChatMessage) => ChatMessage) => {
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last && last.role === 'assistant') {
        next[next.length - 1] = patch(last);
      }
      return next;
    });
  };

  // "Thinking" only until the first streamed chunk arrives — the
  // placeholder is empty until then, and grows after that.
  const lastMessage = messages[messages.length - 1];
  const awaitingFirstChunk =
    sending && lastMessage?.role === 'assistant' && lastMessage.content === '';

  async function send(text: string) {
    const message = text.trim();
    if (!message || sending) return;
    setMessages((prev) => [...prev, { role: 'user', content: message }]);
    setInput('');
    setSending(true);
    // Empty assistant placeholder: filled chunk by chunk as the
    // stream arrives, or all at once on the JSON fallback.
    setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);
    try {
      const result = await requestDealFinder(
        { message, country: region.code },
        (chunk) => {
          updateLastAssistant((m) => ({ ...m, content: m.content + chunk }));
        }
      );
      if (result) {
        updateLastAssistant(() => ({
          role: 'assistant',
          content: result.response,
          products: result.metadata?.products ?? [],
        }));
      } else {
        // A partial stream already rendered stays as-is (genuine
        // answer text); only an empty placeholder becomes the
        // honest error line.
        updateLastAssistant((m) =>
          m.content === ''
            ? { role: 'assistant', content: 'Sorry, I could not find deals right now. Please try again.' }
            : m
        );
      }
    } catch {
      updateLastAssistant((m) =>
        m.content === ''
          ? { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' }
          : m
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="glass-card flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-white/40 bg-gradient-to-r from-blue-600/90 to-violet-600/90 px-4 py-3 text-white">
        <Sparkles className="h-4 w-4" />
        <p className="text-sm font-semibold">AI Assistant</p>
      </div>
      <div className="flex max-h-80 min-h-48 flex-col gap-2 overflow-y-auto p-3">
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'ml-6 text-right' : 'mr-6'}>
            <p
              className={`inline-block rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                m.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white/70 text-slate-800 dark:bg-slate-800/70 dark:text-slate-100'
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
          <button
            key={s}
            type="button"
            onClick={() => send(s)}
            className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700 transition-colors hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200"
          >
            {s}
          </button>
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
          maxLength={500}
          className="min-w-0 flex-1 rounded-full border border-slate-200 bg-white/80 px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900/80"
        />
        <Button type="submit" size="icon" disabled={sending || input.trim() === ''} className="shrink-0 rounded-full">
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
