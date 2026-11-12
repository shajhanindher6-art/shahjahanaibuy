/**
 * AI Product Q&A Assistant — /tools/ai-qa (Section 7 item 5).
 *
 * Ask a question about a product; the answer comes from RECORDED
 * specs + reviews only (deterministic keyword matching, no LLM).
 * Every answer is labeled "AI answer" with its source — never an
 * admin answer. Nothing is stored.
 */

'use client';

import { useRegion } from '@/components/region/region-provider';
import { tFor } from '@/lib/i18n';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MessageCircleQuestion, Sparkles } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';

interface ProductOption {
  slug: string;
  name: string;
}

interface AiAnswer {
  status: 'answered' | 'unknown';
  answer: string;
  source: string | null;
  sourceLabel: string | null;
  label: string;
  matchedTopics: string[];
  reviewCount: number;
  sentiment: string | null;
  disclaimer: string;
}

export default function AiQaPage() {
  const { language } = useRegion();
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [slug, setSlug] = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<AiAnswer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadProducts() {
      try {
        const res = await fetch('/api/v1/products?page=1&pageSize=100');
        if (!res.ok) return;
        const data = await res.json();
        const list = (data?.data?.products ?? []) as ProductOption[];
        if (!cancelled) {
          setProducts(list);
          if (list.length > 0) setSlug(list[0].slug);
        }
      } catch {
        // Product picker stays empty; the user can still type a slug via the API.
      }
    }
    loadProducts();
    return () => {
      cancelled = true;
    };
  }, []);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setAnswer(null);
    if (!slug || question.trim().length < 3) {
      setError('Please pick a product and ask a question of at least 3 characters.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/v1/tools/ai-qa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, question: question.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? 'Could not answer the question.');
        return;
      }
      setAnswer(data.data as AiAnswer);
    } catch {
      setError('Could not answer the question. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <MessageCircleQuestion className="h-7 w-7 text-blue-600" /> {tFor(language, 'toolHeadingProductQa')}
          </h1>
          <p className="mt-2 text-muted-foreground">
            Ask a question about a product — the answer comes from its
            recorded specs and reviews only. No LLM, nothing guessed:
            if the specs or reviews don&apos;t cover it, the answer says
            so honestly.
          </p>

          <form onSubmit={ask} className="mt-8 space-y-4">
            <div>
              <label htmlFor="ai-qa-product" className="text-sm font-medium">
                Product
              </label>
              <select
                id="ai-qa-product"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                {products.length === 0 ? (
                  <option value="">Loading products…</option>
                ) : (
                  products.map((p) => (
                    <option key={p.slug} value={p.slug}>
                      {p.name}
                    </option>
                  ))
                )}
              </select>
            </div>
            <div>
              <label htmlFor="ai-qa-question" className="text-sm font-medium">
                Your question
              </label>
              <input
                id="ai-qa-question"
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="e.g. Is the battery good for a full day?"
                maxLength={1000}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Try battery, display, camera, performance, storage, weight or price.
              </p>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {loading ? 'Answering…' : 'Ask'}
            </button>
          </form>

          {error ? (
            <p role="alert" className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              {error}
            </p>
          ) : null}

          {answer ? (
            <div className="mt-6 rounded-lg border p-6">
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 font-medium text-violet-800">
                  <Sparkles className="h-3.5 w-3.5" /> {answer.label}
                </span>
                {answer.sourceLabel ? (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">
                    Source: {answer.sourceLabel}
                  </span>
                ) : null}
                {answer.sentiment ? (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">
                    Review sentiment: {answer.sentiment}
                  </span>
                ) : null}
              </p>
              <p className="mt-3">{answer.answer}</p>
              {answer.reviewCount > 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  Based on {answer.reviewCount} matching review
                  {answer.reviewCount === 1 ? '' : 's'}.
                </p>
              ) : null}
              <p className="mt-3 text-xs text-muted-foreground">{answer.disclaimer}</p>
              {slug ? (
                <p className="mt-2 text-sm">
                  <Link href={`/products/${slug}`} className="underline">
                    View the product page →
                  </Link>{' '}
                  (specs, reviews and the official Q&amp;A with the SmartBuy team are there)
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
