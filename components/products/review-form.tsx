/**
 * Review submission form for a product page.
 *
 * The reviews API (POST /api/v1/products/[slug]/reviews) already
 * existed, but the product page had no way to use it — visitors
 * could only read reviews, never write one. This form closes that
 * gap: star rating (1–5, required), title and written review.
 *
 * Photo reviews (Section 3 #12): an optional photo may be attached
 * ONLY when the reviewer ticks the explicit consent checkbox. Without
 * consent the file is never sent to the server at all — the review is
 * submitted as plain JSON, exactly as before. With consent the form
 * submits multipart/form-data; the API stores the photo only in the
 * `review-photos` bucket and reports honestly when storage is not
 * configured (the review is still saved, the photo is not claimed
 * to be stored).
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

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

interface ReviewFormProps {
  slug: string;
  onReviewAdded: () => void;
}

export function ReviewForm({ slug, onReviewAdded }: ReviewFormProps) {
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoConsent, setPhotoConsent] = useState(false);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function onPhotoChange(file: File | null) {
    setPhotoNote(null);
    if (!file) {
      setPhoto(null);
      return;
    }
    if (!file.type.startsWith('image/')) {
      setPhoto(null);
      setPhotoNote('Only image files can be attached as a review photo.');
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setPhoto(null);
      setPhotoNote('Photos must be 5 MB or smaller.');
      return;
    }
    setPhoto(file);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (rating < 1 || rating > 5) {
      setError('Please select a star rating from 1 to 5.');
      return;
    }
    setError(null);
    setSuccess(false);
    setPhotoNote(null);
    setSubmitting(true);
    try {
      // With a consented photo the submission is multipart/form-data;
      // without one it is the same JSON shape as before — and a photo
      // WITHOUT consent is never sent at all.
      let res: Response;
      if (photo && photoConsent) {
        const form = new FormData();
        form.append('rating', String(rating));
        if (title.trim()) form.append('title', title.trim());
        if (content.trim()) form.append('content', content.trim());
        form.append('photo', photo);
        form.append('photoConsent', 'true');
        res = await fetch(`/api/v1/products/${slug}/reviews`, {
          method: 'POST',
          body: form,
        });
      } else {
        res = await fetch(`/api/v1/products/${slug}/reviews`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rating,
            title: title.trim() || undefined,
            content: content.trim() || undefined,
          }),
        });
      }
      if (res.status === 401) {
        setError('Please sign in to write a review.');
        return;
      }
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setError('Failed to submit your review. Please try again.');
        return;
      }
      // The API reports the photo outcome honestly: 'stored' only
      // when the file really was stored; anything else carries a
      // plain-language message (e.g. storage not configured yet).
      if (data.data?.photoStatus === 'stored') {
        setPhotoNote('Your photo was stored with your review.');
      } else if (typeof data.data?.photoMessage === 'string') {
        setPhotoNote(data.data.photoMessage);
      }
      setRating(0);
      setTitle('');
      setContent('');
      setPhoto(null);
      setPhotoConsent(false);
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

          <div>
            <label htmlFor="review-photo" className="mb-1.5 block text-sm font-medium">
              Photo (optional)
            </label>
            <Input
              id="review-photo"
              type="file"
              accept="image/*"
              onChange={(e) => onPhotoChange(e.target.files?.[0] ?? null)}
            />
            {photo && (
              <p className="mt-1 text-xs text-muted-foreground">
                Selected: {photo.name} ({(photo.size / 1024).toFixed(0)} KB)
              </p>
            )}
            <label className="mt-2 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={photoConsent}
                onChange={(e) => setPhotoConsent(e.target.checked)}
                disabled={!photo}
                className="mt-0.5"
              />
              <span>
                I allow SmartBuy to store this photo with my review and show it publicly next to
                it. Without this tick, the photo is never uploaded or stored.
              </span>
            </label>
            {photo && !photoConsent && (
              <p className="mt-1 text-xs text-muted-foreground">
                Tick the consent box above to attach the photo — otherwise your review is
                submitted without it.
              </p>
            )}
            {photoNote && <p className="mt-1 text-xs text-muted-foreground">{photoNote}</p>}
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
