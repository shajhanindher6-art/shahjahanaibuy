/**
 * Product Q&A section (Section 3 #12).
 *
 * Lists a product's questions and answers, and lets a signed-in
 * visitor ask a new one. Answers come from the SmartBuy team (admin)
 * — never auto-generated. With no questions it shows an honest empty
 * state ("No questions yet"), never seeded Q&A.
 *
 * Wiring note (wave 2): this component is NOT yet mounted in
 * product-detail-client.tsx — that wiring is a separate step.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { MessageCircleQuestion, BadgeCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { qaStatusLabel, type ProductQuestion } from '@/lib/product-qa';

interface QaSectionProps {
  slug: string;
}

export function QaSection({ slug }: QaSectionProps) {
  const [questions, setQuestions] = useState<ProductQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [question, setQuestion] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const fetchQuestions = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch(`/api/v1/products/${slug}/qa`);
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        setQuestions(data.data?.questions ?? []);
      } else {
        setLoadError(true);
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    fetchQuestions();
  }, [fetchQuestions]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (question.trim().length < 3) {
      setError('Please ask a question of at least 3 characters.');
      return;
    }
    setError(null);
    setSuccess(false);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/v1/products/${slug}/qa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: question.trim() }),
      });
      if (res.status === 401) {
        setError('Please sign in to ask a question.');
        return;
      }
      if (res.status === 409) {
        setError('You have already asked this exact question for this product.');
        return;
      }
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setError(
          data?.error?.message ?? 'Failed to submit your question. Please try again.'
        );
        return;
      }
      setQuestion('');
      setSuccess(true);
      await fetchQuestions();
    } catch {
      setError('Failed to submit your question. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageCircleQuestion className="h-5 w-5" />
          Questions &amp; answers
        </CardTitle>
        <CardDescription>
          Ask about this product. Answers come from the SmartBuy team — never auto-generated.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <LoadingSpinner />
        ) : loadError ? (
          <p className="text-sm text-muted-foreground">
            Questions could not be loaded right now. Please try again later.
          </p>
        ) : questions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No questions yet — be the first to ask about this product.
          </p>
        ) : (
          <ul className="space-y-4">
            {questions.map((q) => (
              <li key={q.id} className="border-b border-slate-100 pb-4 last:border-0 dark:border-slate-800">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">Q: {q.question}</p>
                  <Badge variant="secondary">{qaStatusLabel(q.status)}</Badge>
                </div>
                {q.answer ? (
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1 font-medium text-foreground">
                      <BadgeCheck className="h-4 w-4 text-green-600" />
                      SmartBuy team:
                    </span>{' '}
                    {q.answer}
                  </p>
                ) : (
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    Awaiting an answer from the SmartBuy team.
                  </p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  Asked {new Date(q.createdAt).toLocaleDateString()}
                </p>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={submit} className="space-y-3 border-t border-slate-100 pt-4 dark:border-slate-800">
          <label htmlFor="qa-question" className="block text-sm font-medium">
            Ask a question
          </label>
          <Textarea
            id="qa-question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. Does this laptop come with an international warranty?"
            rows={3}
            maxLength={1000}
          />
          {error && (
            <p className="text-sm text-red-600">
              {error}{' '}
              {error.includes('sign in') && (
                <Link href="/sign-in" className="underline">
                  Sign in
                </Link>
              )}
            </p>
          )}
          {success && (
            <p className="text-sm text-green-600">
              Thanks! Your question was submitted and is awaiting an answer.
            </p>
          )}
          <Button type="submit" disabled={submitting || question.trim().length < 3}>
            {submitting ? <LoadingSpinner size="sm" /> : 'Ask question'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
