/**
 * Review submission form for a product page.
 *
 * The reviews API (POST /api/v1/products/[slug]/reviews) already
 * existed, but the product page had no way to use it — visitors
 * could only read reviews, never write one. This form closes that
 * gap: star rating (1–5, required), title and written review.
 *
 * Notes on trust:
 * - It never sets verifiedPurchase: that flag stays false for
 *   form submissions, so a reviewer cannot mark their own review
 *   as a verified purchase.
 * - On success it calls onReviewAdded, so the parent page refetches
 *   the review list AND the AI Review Summary — the new review is
 *   therefore picked up by the summarizer (whose server cache is
 *   also invalidated in the reviews POST route) instead of sitting
 *   invisible until the cache expires.
 * - Logged-out visitors get a sign-in prompt: the API requires
 *   auth, and a 401 here is shown as such rather than as a
 *   generic failure.
 */

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { cn } from '@/lib/utils';

interface ReviewFormProps {
  slug: string;
  onReviewAdded: () => void;
}

export function ReviewForm({ slug, onReviewAdded }: ReviewFormProps) {
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (rating < 1 || rating > 5) {
      setError('Please select a star rating from 1 to 5.');
      return;
    }
    setError(null);
    setSuccess(false);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/v1/products/${slug}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating,
          title: title.trim() || undefined,
          content: content.trim() || undefined,
        }),
      });
      if (res.status === 401) {
        setError('Please sign in to write a review.');
        return;
      }
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setError('Failed to submit your review. Please try again.');
        return;
      }
      setRating(0);
      setTitle('');
      setContent('');
      setSuccess(true);
      onReviewAdded();
    } catch {
      setError('Failed to submit your review. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle className="text-base">Write a review</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <p className="mb-1.5 text-sm font-medium">Your rating *</p>
            <div className="flex gap-1" role="radiogroup" aria-label="Star rating">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setRating(value)}
                  aria-label={`${value} star${value === 1 ? '' : 's'}`}
                  className="rounded p-0.5"
                >
                  <Star
                    className={cn(
                      'h-7 w-7',
                      value <= rating ? 'fill-yellow-400 text-yellow-400' : 'text-slate-300'
                    )}
                  />
                </button>
              ))}
              {rating > 0 && <span className="ml-2 self-center text-sm text-muted-foreground">{rating} / 5</span>}
            </div>
          </div>

          <div>
            <label htmlFor="review-title" className="mb-1.5 block text-sm font-medium">
              Title (optional)
            </label>
            <Input
              id="review-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Great battery life"
              maxLength={200}
            />
          </div>

          <div>
            <label htmlFor="review-content" className="mb-1.5 block text-sm font-medium">
              Your review (optional)
            </label>
            <Textarea
              id="review-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="What did you like or dislike about this product?"
              rows={4}
              maxLength={5000}
            />
          </div>

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
              Thanks! Your review was submitted and will now be included in the AI Review Summary.
            </p>
          )}

          <Button type="submit" disabled={submitting || rating === 0}>
            {submitting ? <LoadingSpinner size="sm" /> : 'Submit review'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
