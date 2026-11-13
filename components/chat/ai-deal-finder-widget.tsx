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
 *
 * Multi-turn (S5#2 — conversational commerce): the hook posts the
 * full turn history, and every request also carries
 * `contextProducts` — the product names from the previous
 * assistant turn — so follow-ups ("aur sasta dikhao", "which is
 * the cheapest?") are resolved into self-contained queries by
 * resolveFollowUpQuery (client-side, and again in the route).
 * Compare turns (2–3 products) render an in-chat compare table
 * instead of stacked cards. Voice-first mode uses the browser's
 * Web Speech API only (see lib/voice-languages.ts): dictate to
 * send, and spoken replies when enabled — no audio ever leaves
 * the browser, and a failed or denied mic falls back to typing.
 */

'use client';

import { useState, useRef, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useChat } from 'ai/react';
import type { JSONValue } from 'ai';
import { MessageCircle, Mic, Send, Sparkles, Trash2, Volume2, VolumeX, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { cn } from '@/lib/utils';
import { formatPriceForRegion, formatUsd, type Region } from '@/lib/region';
import { useRegion } from '@/components/region/region-provider';
import { fetchDealFinderJson, resolveFollowUpQuery } from '@/lib/deal-finder-stream';
import {
  VOICE_LANGUAGES,
  createSpeechRecognition,
  isSpeechRecognitionSupported,
  isSpeechSynthesisSupported,
  speakText,
} from '@/lib/voice-languages';
import { InChatCompareTable } from '@/components/chat/in-chat-compare-table';

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

// ---------------------------------------------------------------------------
// Guest chat persistence (Section 14, Chunk 2, B11)
// ---------------------------------------------------------------------------
// Guest-only, device-local: the widget is stateless server-side, so a
// reload used to lose the conversation. Turns (and their product
// cards, via the hook's `data` entries) are now kept in localStorage
// — the same pattern as recently-viewed / guest wishlist. Nothing is
// sent anywhere; signed-in dashboard chat is separate (server-side)
// and untouched. A corrupt or oversized entry is dropped, never
// allowed to break the widget.
const CHAT_STORAGE_KEY = 'smartbuy-deal-finder-chat-v1';
const CHAT_STORAGE_MAX_MESSAGES = 30;

interface StoredChatTurn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface StoredChat {
  messages: StoredChatTurn[];
  data: JSONValue[];
}

function loadStoredChat(): StoredChat | null {
  try {
    const raw = window.localStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const { messages, data } = parsed as { messages?: unknown; data?: unknown };
    if (!Array.isArray(messages) || messages.length === 0) return null;
    const turns: StoredChatTurn[] = [];
    for (const m of messages) {
      if (!m || typeof m !== 'object') continue;
      const turn = m as Record<string, unknown>;
      if (
        typeof turn.id !== 'string' ||
        (turn.role !== 'user' && turn.role !== 'assistant') ||
        typeof turn.content !== 'string'
      ) {
        continue;
      }
      turns.push({ id: turn.id, role: turn.role, content: turn.content });
    }
    if (turns.length === 0) return null;
    return {
      messages: turns.slice(-CHAT_STORAGE_MAX_MESSAGES),
      data: Array.isArray(data) ? (data as JSONValue[]) : [],
    };
  } catch {
    return null;
  }
}

function saveStoredChat(messages: StoredChatTurn[], data: JSONValue[] | undefined): void {
  try {
    window.localStorage.setItem(
      CHAT_STORAGE_KEY,
      JSON.stringify({
        messages: messages.slice(-CHAT_STORAGE_MAX_MESSAGES),
        data: data ?? [],
        savedAt: Date.now(),
      })
    );
  } catch {
    // Storage full/blocked: the in-memory conversation still works.
  }
}

function clearStoredChat(): void {
  try {
    window.localStorage.removeItem(CHAT_STORAGE_KEY);
  } catch {
    // Ignore storage errors.
  }
}

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
  // Product names from the previous assistant turn at send time,
  // for the same fallback's follow-up resolution.
  const pendingContextRef = useRef<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Voice-first mode (S5#2): browser-native Web Speech only.
  const [voiceLang, setVoiceLang] = useState('en-US');
  const [voiceMode, setVoiceMode] = useState(false);
  const [voiceReplies, setVoiceReplies] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const recognitionRef = useRef<ReturnType<typeof createSpeechRecognition>>(null);
  // Last assistant message id already spoken, so a re-render never
  // repeats a reply.
  const lastSpokenIdRef = useRef('');

  const { messages, append, status, data, setMessages, setData } = useChat({
    api: '/api/v1/deal-finder',
    initialMessages: [{ id: 'welcome', role: 'assistant', content: WELCOME_TEXT }],
    // Keep the user message and any partial answer visible when the
    // stream fails, so the fallback can complete them in place.
    keepLastMessageOnError: true,
    onError: async () => {
      const query = pendingMessageRef.current;
      const result = query
        ? await fetchDealFinderJson({
            message: query,
            country: region.code,
            history: messages
              .filter((m) => m.role === 'user' || m.role === 'assistant')
              .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
            contextProducts: pendingContextRef.current,
          })
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

  // B11: restore the guest conversation on mount, and persist every
  // turn afterwards. `hydrated` gates the save effect: it flips only
  // after the restore ran, so the mount-time save can never
  // overwrite stored history with the bare welcome message.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    const stored = loadStoredChat();
    if (stored) {
      setMessages(stored.messages);
      if (stored.data.length > 0) setData(stored.data);
    }
    setHydrated(true);
    // setMessages / setData are the useChat state setters (stable
    // across renders), so listing them keeps this mount-only.
  }, [setMessages, setData]);

  useEffect(() => {
    if (!hydrated) return;
    saveStoredChat(
      messages.map((m) => ({
        id: m.id,
        role: m.role === 'user' ? 'user' : ('assistant' as const),
        content: m.content,
      })),
      data
    );
  }, [messages, data, hydrated]);

  function clearHistory() {
    clearStoredChat();
    setMessages([{ id: 'welcome', role: 'assistant', content: WELCOME_TEXT }]);
    setData([]);
  }

  // Attach product cards to each assistant message from the `data`
  // entries (same mapping as the dashboard AIChatPanel: the welcome
  // message is assistant ordinal 0 with no entry; the k-th
  // assistant message after it maps to data[k - 1]). `isCompareTurn`
  // marks answers to a compare question, which render the in-chat
  // compare table instead of stacked cards.
  let assistantOrdinal = -1;
  const view = messages.map((m, idx) => {
    if (m.role === 'assistant') assistantOrdinal += 1;
    const prevUser = [...messages.slice(0, idx)]
      .reverse()
      .find((p) => p.role === 'user');
    const prevText = (prevUser?.content ?? '').toLowerCase();
    return {
      id: m.id,
      role: m.role === 'user' ? 'user' : ('assistant' as const),
      content: m.content,
      products:
        m.role === 'assistant' && assistantOrdinal >= 1
          ? productsFromDataEntry(data?.[assistantOrdinal - 1])
          : [],
      isCompareTurn:
        m.role === 'assistant' &&
        (prevText.includes('compare') || prevText.includes(' vs ') || prevText.includes('versus')),
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
            message: `Compare ${lastAssistantProducts.map((p) => p.name).join(', ')} — which has the lowest price?`,
          },
          {
            label: 'In mein best kaunsa hai?',
            message: `Compare ${lastAssistantProducts.map((p) => p.name).join(' vs ')} and recommend the best one for most buyers.`,
          },
        ]
      : [];

  // Spinner only until the first streamed chunk arrives — the
  // placeholder is empty until then, and grows after that.
  const lastMessage = view[view.length - 1];
  const awaitingFirstChunk =
    sending && lastMessage?.role === 'assistant' && lastMessage.content === '';

  // Spoken replies (voice-first): when the stream finishes and the
  // latest message is a fresh assistant answer, speak it once in
  // the chosen voice language. Browser synthesis only — nothing
  // is sent anywhere.
  const speakRepliesOn = voiceMode || voiceReplies;
  useEffect(() => {
    if (!open || !speakRepliesOn || status !== 'ready') return;
    if (!isSpeechSynthesisSupported()) return;
    const last = view[view.length - 1];
    if (!last || last.role !== 'assistant' || !last.content.trim()) return;
    if (last.id === lastSpokenIdRef.current) return;
    lastSpokenIdRef.current = last.id;
    speakText(last.content, voiceLang);
    // `view` is deliberately NOT listed: it is a fresh array built
    // from `messages` on every render, so listing it would re-run
    // this effect on every render; `messages` (already a dep) fully
    // determines it, and lastSpokenIdRef makes re-runs idempotent
    // — each answer is spoken once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, messages, open, speakRepliesOn, voiceLang]);

  // Stop any in-progress recognition when the panel closes.
  useEffect(() => {
    if (!open) {
      try {
        recognitionRef.current?.stop();
      } catch {
        // Already stopped — nothing to do.
      }
      setListening(false);
    }
  }, [open ]);

  /**
   * One-shot dictation into the input box. In voice-first mode the
   * final transcript is sent automatically; otherwise it just fills
   * the input for the user to send (or edit) themselves. The
   * transcript comes only from a real recognition result — never
   * fabricated, and a denied/unavailable mic falls back to typing
   * with an honest note.
   */
  function startDictation() {
    setVoiceError(null);
    if (!isSpeechRecognitionSupported()) {
      setVoiceError('Voice input is not available in this browser — please type instead.');
      return;
    }
    const recognition = createSpeechRecognition();
    if (!recognition) {
      setVoiceError('Voice input is not available in this browser — please type instead.');
      return;
    }
    recognitionRef.current = recognition;
    recognition.lang = voiceLang;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = (event: unknown) => {
      const results = (event as { results?: ArrayLike<{ 0?: { transcript?: string }; isFinal?: boolean }> })
        .results;
      if (!results) return;
      let interim = '';
      let finalText = '';
      for (let i = 0; i < results.length; i += 1) {
        const result = results[i];
        const transcript = result?.[0]?.transcript ?? '';
        if (result?.isFinal) finalText += transcript;
        else interim += transcript;
      }
      const text = (finalText || interim).trim();
      if (text) setInput(text);
      if (finalText.trim()) {
        setListening(false);
        if (voiceMode) {
          // Voice-first: speak, then send. Resolve the follow-up
          // against the previous turn's products first, so "aur
          // sasta dikhao" works hands-free too.
          const resolved = resolveFollowUpQuery(
            finalText.trim(),
            lastAssistantProducts?.map((p) => p.name) ?? []
          );
          void send(resolved);
        }
      }
    };
    recognition.onerror = (event: unknown) => {
      const error = (event as { error?: string }).error;
      setListening(false);
      setVoiceError(
        error === 'not-allowed'
          ? 'Microphone access was denied — please type instead, or allow the microphone and try again.'
          : 'Voice input did not work — please type instead.'
      );
    };
    recognition.onend = () => setListening(false);
    try {
      setListening(true);
      recognition.start();
    } catch {
      setListening(false);
      setVoiceError('Voice input did not start — please type instead.');
    }
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || sending) return;
    pendingMessageRef.current = message;
    // Product names from the previous assistant turn, so the route
    // can resolve follow-ups ("which is the cheapest?") even when
    // the client-side resolution is bypassed.
    pendingContextRef.current = lastAssistantProducts?.map((p) => p.name) ?? [];
    setInput('');
    try {
      await append(
        { role: 'user', content: message },
        { body: { country: region.code, contextProducts: pendingContextRef.current } }
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

  // Dashboard has its own full chat page; do not duplicate it there.
  // (Kept after all hooks — hooks must run unconditionally.)
  if (pathname?.startsWith('/dashboard')) return null;

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
        <div className="flex h-[min(480px,calc(100dvh-6.5rem))] w-[calc(100vw-2rem)] max-w-sm flex-col overflow-hidden rounded-xl border border-slate-200 bg-card shadow-xl dark:border-slate-700">
          <div className="flex items-center justify-between bg-blue-600 px-4 py-3 text-white">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="h-4 w-4" /> AI Deal Finder
            </p>
            <div className="flex items-center gap-1">
              {/* Section 10 (2026-11-11): design-system Button, not raw
                  <button> — ghost + icon size (44px), with overrides
                  so the blue header keeps its white-on-blue look. */}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => {
                  setVoiceMode((v) => !v);
                  setVoiceError(null);
                }}
                aria-label={voiceMode ? 'Turn off voice-first mode' : 'Turn on voice-first mode'}
                title={
                  voiceMode
                    ? 'Voice-first mode on: speak to send, replies are spoken'
                    : 'Voice-first mode: speak to send, replies are spoken'
                }
                className={cn('text-white hover:bg-blue-700 hover:text-white', voiceMode && 'bg-blue-700 ring-1 ring-white')}
              >
                <Mic className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setVoiceReplies((v) => !v)}
                aria-label={speakRepliesOn ? 'Turn off spoken replies' : 'Turn on spoken replies'}
                title={speakRepliesOn ? 'Spoken replies on' : 'Spoken replies off'}
                className="text-white hover:bg-blue-700 hover:text-white"
              >
                {speakRepliesOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              </Button>
              {/* B11: clear the device-local guest history (the
                  conversation is stored on this device only — see
                  the persistence note above). */}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={clearHistory}
                aria-label="Clear chat history"
                title="Clear chat history (stored on this device only)"
                className="text-white hover:bg-blue-700 hover:text-white"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setOpen(false)}
                aria-label="Close chat"
                className="text-white hover:bg-blue-700 hover:text-white"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
            {view.map((m) => (
              <div key={m.id} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div
                  className={cn(
                    'max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed',
                    m.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : 'bg-muted text-foreground dark:bg-muted dark:text-foreground'
                  )}
                >
                  <p className="whitespace-pre-line">{m.content}</p>
                  {m.products && m.products.length > 0 && m.isCompareTurn && m.products.length <= 3 ? (
                    <InChatCompareTable products={m.products} region={region} />
                  ) : (
                    m.products &&
                    m.products.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {m.products.map((p) => (
                          <Link
                            key={p.id}
                            href={`/products/${p.slug}`}
                            className="block rounded-md bg-card px-2 py-1.5 text-foreground hover:bg-blue-50 dark:hover:bg-muted"
                          >
                            <span className="font-medium">{p.name}</span>
                            {p.brand && <span className="text-muted-foreground"> · {p.brand}</span>}
                            {p.price !== null && <CardPrice usd={p.price} region={region} />}
                          </Link>
                        ))}
                      </div>
                    )
                  )}
                </div>
              </div>
            ))}
            {awaitingFirstChunk && (
              <div className="flex justify-start">
                <div className="rounded-lg bg-muted px-3 py-2 dark:bg-muted">
                  <LoadingSpinner size="sm" />
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5 border-t border-slate-100 px-3 pt-2 dark:border-slate-800">
            {/* Section 10 (2026-11-11): design-system Buttons, not raw
                <button>s. variant="secondary" is the token for the
                old bg-muted/dark:bg-muted chip; h-auto keeps
                the compact chip height (44px would wreck the
                wrapping chip row). */}
            {QUICK_CHIPS.map((chip) => (
              <Button
                key={chip}
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => send(chip)}
                className="h-auto rounded-full px-2.5 py-1 text-xs"
              >
                {chip}
              </Button>
            ))}
            {followUpChips.map((chip) => (
              <Button
                key={chip.label}
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => send(chip.message)}
                className="h-auto rounded-full bg-blue-100 px-2.5 py-1 text-xs text-blue-800 hover:bg-blue-200 dark:bg-blue-950 dark:text-blue-200 dark:hover:bg-blue-900"
              >
                {chip.label}
              </Button>
            ))}
            {recentSearches.map((recent) => (
              <Button
                key={recent}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => send(recent)}
                className="h-auto rounded-full border-dashed px-2.5 py-1 text-xs hover:bg-muted"
                title="Your recent search"
              >
                ↻ {recent}
              </Button>
            ))}
          </div>

          <form
            className="flex gap-2 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <select
              value={voiceLang}
              onChange={(e) => setVoiceLang(e.target.value)}
              aria-label="Voice language"
              title="Voice language (speech recognition and spoken replies)"
              className="w-24 shrink-0 rounded-md border border-slate-200 bg-card px-1 text-xs dark:border-slate-700"
            >
              {VOICE_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={listening ? 'Listening…' : 'e.g. best laptop under $1000'}
              maxLength={500}
              aria-label="Ask the AI Deal Finder"
              className="flex-1"
            />
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={startDictation}
              disabled={sending || listening}
              aria-label={listening ? 'Listening' : 'Dictate with your voice'}
              title="Dictate with your voice (browser speech recognition — audio never leaves your device)"
              className={cn(listening && 'animate-pulse border-red-400 text-red-500')}
            >
              <Mic className="h-4 w-4" />
            </Button>
            <Button type="submit" size="icon" disabled={sending || !input.trim()} aria-label="Send message">
              <Send className="h-4 w-4" />
            </Button>
          </form>
          {voiceError && (
            <p className="px-3 pb-2 text-xs text-amber-700 dark:text-amber-400">{voiceError}</p>
          )}
          {voiceMode && (
            <p className="px-3 pb-2 text-xs text-muted-foreground">
              Voice-first mode is on: tap the mic and speak — your words are sent automatically and
              replies are spoken aloud. Recognition runs in your browser only.
            </p>
          )}
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

// Default export for the root layout's plain dynamic() import (see the
// crash-fix note in app/layout.tsx): a Server Component may not use a
// `.then(m => m.X)` selector on a client module. Named export kept for
// any other importer.
export default AIDealFinderWidget;
