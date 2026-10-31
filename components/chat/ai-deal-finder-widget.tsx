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
 * Stateless: no conversation is saved and no login is required,
 * so a logged-out visitor can use it immediately. Quick chips
 * cover the most common asks for visitors who do not know what
 * to type.
 */

'use client';

import { useState, useRef, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { MessageCircle, Send, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { cn } from '@/lib/utils';

interface WidgetProduct {
  id: string;
  name: string;
  slug: string;
  brand: string | null;
  imageUrl: string | null;
  price: number | null;
}

interface WidgetMessage {
  role: 'user' | 'assistant';
  content: string;
  products?: WidgetProduct[];
}

const QUICK_CHIPS = [
  'Best deals today',
  'Best laptop under $1000',
  'Noise cancelling headphones',
];

const WELCOME: WidgetMessage = {
  role: 'assistant',
  content:
    'Hi! Tell me what you are looking for — a category, a preference, or a budget, e.g. "best laptop under $1000" — and I will find the best deals for you.',
};

export function AIDealFinderWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<WidgetMessage[]>([WELCOME]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, sending, open]);

  // Dashboard has its own full chat page; do not duplicate it there.
  if (pathname?.startsWith('/dashboard')) return null;

  async function send(text: string) {
    const message = text.trim();
    if (!message || sending) return;
    setMessages((prev) => [...prev, { role: 'user', content: message }]);
    setInput('');
    setSending(true);
    try {
      const res = await fetch('/api/v1/deal-finder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      const data = await res.json();
      if (data.success && data.data) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: data.data.response as string,
            products: (data.data.metadata?.products ?? []) as WidgetProduct[],
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: 'Sorry, I could not find deals right now. Please try again.' },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' },
      ]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-3">
      {open && (
        <div className="flex h-[480px] w-[calc(100vw-2rem)] max-w-sm flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between bg-blue-600 px-4 py-3 text-white">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="h-4 w-4" /> AI Deal Finder
            </p>
            <button onClick={() => setOpen(false)} aria-label="Close chat" className="rounded p-1 hover:bg-blue-700">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.map((m, i) => (
              <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
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
                          {p.price !== null && (
                            <span className="float-right font-semibold text-green-600">${p.price.toFixed(2)}</span>
                          )}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {sending && (
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
