'use client';

/**
 * Public shared-wishlist page: /wishlists/[id]
 *
 * This is the page the dashboard's Share button copies a link to.
 * No login is required — anyone with the link can view the wishlist
 * in a clean product grid. The page only ever shows public lists:
 * the API returns 404 for private or missing lists, and this page
 * shows the same "not available" state for both, so private lists
 * cannot be probed.
 *
 * View-only: no editing, no owner information, no private notes.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Check, Gift, Heart, Link2, Vote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { ProductCard } from '@/components/products/product-card';
import { ShareButtons } from '@/components/products/share-buttons';
import { dealScoreForDisplay } from '@/lib/deal-score';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';

interface SharedItem {
  product: {
    id: string;
    name: string;
    slug: string;
    brand: string | null;
    category: string | null;
    imageUrl: string | null;
    /** Recorded `products.data_freshness` (Section 16, item 9). */
    dataFreshness: string | null;
    /** Latest recorded price (Section 16, item 9). */
    price: number | null;
  };
  targetPrice: number | null;
  addedAt: string;
}

interface SharedWishlist {
  id: string;
  name: string;
  description: string | null;
  itemCount: number;
  createdAt: string;
  items: SharedItem[];
  /** S3#11: link to the gift recommender, from the API. */
  giftFinderUrl: string | null;
}

// Section 6, Item 13 — polls on a shared wishlist. Options are real
// catalog products; vote counts are real rows from
// wishlist_poll_votes. One vote per user per poll.
interface PollOption {
  optionId: string;
  productId: string;
  productName: string | null;
  productSlug: string | null;
  votes: number;
  share: number;
}

interface WishlistPollView {
  id: string;
  question: string;
  status: 'open' | 'closed';
  options: PollOption[];
  totalVotes: number;
  userVotedOptionId: string | null;
}

export default function SharedWishlistPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [wishlist, setWishlist] = useState<SharedWishlist | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [copied, setCopied] = useState(false);
  // Section 13, item 53 — is the visitor the owner of this list?
  // GET /api/v1/wishlists/[id] is owner-only (404 for everyone
  // else), so a 200 here proves ownership without leaking anything
  // about other users' lists. The owner sees a manage CTA and an
  // "add products" action on the empty state; everyone else sees
  // the plain shared view.
  const [isOwner, setIsOwner] = useState(false);

  useEffect(() => {
    if (!wishlist) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/v1/wishlists/${id}`);
        if (!cancelled) setIsOwner(res.ok);
      } catch {
        if (!cancelled) setIsOwner(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wishlist, id]);

  // Section 6, Item 13 — polls on this wishlist.
  const [polls, setPolls] = useState<WishlistPollView[] | null>(null);
  const [pollsEnabled, setPollsEnabled] = useState(true);
  const [votingOptionId, setVotingOptionId] = useState<string | null>(null);
  const [voteError, setVoteError] = useState<string | null>(null);

  const fetchPolls = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/wishlist-polls?wishlistId=${id}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        setPolls(data.data as WishlistPollView[]);
        setPollsEnabled(data.meta?.pollsEnabled !== false);
      }
    } catch {
      // Polls unavailable — the wishlist itself still renders.
    }
  }, [id]);

  useEffect(() => {
    if (!wishlist) return;
    fetchPolls();
  }, [wishlist, fetchPolls]);

  const vote = async (pollId: string, optionId: string) => {
    setVoteError(null);
    setVotingOptionId(optionId);
    try {
      const res = await fetch(`/api/v1/wishlist-polls/${pollId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ optionId }),
      });
      if (res.status === 401) {
        setVoteError('Sign in to vote on polls.');
        return;
      }
      const data = await res.json();
      if (!res.ok || !data.success || !data.data) {
        setVoteError(data?.error?.message ?? 'Could not save your vote.');
        return;
      }
      const updated = data.data as WishlistPollView;
      setPolls((prev) => (prev ?? []).map((p) => (p.id === pollId ? updated : p)));
    } catch {
      setVoteError('Could not save your vote.');
    } finally {
      setVotingOptionId(null);
    }
  };

  // Deal Scores per item (same pattern as /search S2#10): the
  // shared-wishlist API returns no prediction data, so scores are
  // fetched client-side per displayed item from
  // GET /api/v1/predictions/[productId] — the same prediction the
  // product page scores from (lib/deal-score.ts). Each product is
  // attempted at most once per page session; a failed or missing
  // prediction simply leaves that card without a badge — never a
  // synthesized score.
  const [dealScores, setDealScores] = useState<Record<string, number>>({});
  // Section 16, item 10: recorded point counts behind each score,
  // so a withheld score can say why (4 of 5 points).
  const [dealScorePoints, setDealScorePoints] = useState<Record<string, number>>({});
  const dealScoreAttemptedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!wishlist) return;
    const pending = wishlist.items.filter(
      (item) => !dealScoreAttemptedRef.current.has(item.product.id)
    );
    if (pending.length === 0) return;
    for (const item of pending) dealScoreAttemptedRef.current.add(item.product.id);
    void Promise.all(
      pending.map(async (item) => {
        try {
          const predRes = await fetch(`/api/v1/predictions/${item.product.id}`, {
            signal: AbortSignal.timeout(15000),
          });
          if (!predRes.ok) return;
          const predData = await predRes.json();
          if (!predData.success || !predData.data) return;
          // Section 16, item 10: keep the point count even when the
          // score is withheld — the card says "4 of 5 points".
          if (
            typeof predData.data.dataPoints === 'number' &&
            Number.isFinite(predData.data.dataPoints)
          ) {
            setDealScorePoints((prev) => ({
              ...prev,
              [item.product.id]: predData.data.dataPoints,
            }));
          }
          const score = dealScoreForDisplay(predData.data);
          if (score === null) return;
          setDealScores((prev) => ({ ...prev, [item.product.id]: score }));
        } catch {
          // No prediction for this card — no badge, no error.
        }
      })
    );
  }, [wishlist]);

  const fetchShared = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/shared-wishlists/${id}`);
      if (!res.ok) {
        setNotFound(true);
        return;
      }
      const data = await res.json();
      if (data.success && data.data) {
        setWishlist(data.data as SharedWishlist);
      } else {
        setNotFound(true);
      }
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchShared();
  }, [fetchShared]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (e.g. non-secure context): leave the
      // URL in the address bar for the user to copy manually.
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">
        {loading ? (
          <div className="flex justify-center py-12">
            <LoadingSpinner size="lg" />
          </div>
        ) : notFound || !wishlist ? (
          <Card>
            <CardContent className="pt-6">
              <EmptyState
                icon={Heart}
                title="This wishlist is not available"
                description="It may be private, or the link may be incorrect."
                action={<Button onClick={() => router.push('/search')}>Browse products</Button>}
              />
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="flex items-center gap-2 text-2xl font-bold">
                  <Heart className="h-7 w-7 text-red-500" /> {wishlist.name}
                </h1>
                {wishlist.description && (
                  <p className="mt-1 text-muted-foreground">{wishlist.description}</p>
                )}
                <p className="mt-1 text-sm text-muted-foreground">
                  {wishlist.itemCount} item{wishlist.itemCount !== 1 ? 's' : ''} · Shared wishlist · No login needed to view
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {/* S3#11: gift-finder link from the API — a visitor
                    viewing someone's wishlist can find a gift from it. */}
                {wishlist.giftFinderUrl && (
                  <Button variant="outline" asChild className="min-h-[44px]">
                    <a href={wishlist.giftFinderUrl}>
                      <Gift className="mr-2 h-4 w-4" /> Find a gift from this list
                    </a>
                  </Button>
                )}
                {/* Section 13, item 53 — the owner viewing their own
                    shared link gets a manage CTA (polls, items). */}
                {isOwner && (
                  <Button variant="outline" asChild className="min-h-[44px]">
                    <Link href={`/dashboard/wishlists/${id}`}>Manage this list</Link>
                  </Button>
                )}
                <Button variant="outline" onClick={copyLink} className="min-h-[44px]">
                  {copied ? (
                    <>
                      <Check className="mr-2 h-4 w-4" /> Copied!
                    </>
                  ) : (
                    <>
                      <Link2 className="mr-2 h-4 w-4" /> Copy link
                    </>
                  )}
                </Button>
                {/* Section 13, item 55 — share buttons on the public
                    shared-wishlist page. */}
                <ShareButtons title={`${wishlist.name} — shared wishlist on SmartBuy AI`} />
              </div>
            </div>

            {wishlist.items.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {wishlist.items.map((item) => (
                  <div key={item.product.id} className="space-y-1">
                    <ProductCard
                      product={{
                        id: item.product.id,
                        name: item.product.name,
                        slug: item.product.slug,
                        brand: item.product.brand,
                        category: item.product.category,
                        imageUrl: item.product.imageUrl,
                        dealScore: dealScores[item.product.id] ?? null,
                        // Section 16, items 9–10: recorded price +
                        // freshness for the stale badge, point count
                        // for the withheld-score note.
                        price: item.product.price ?? null,
                        dataFreshness: item.product.dataFreshness ?? null,
                        dealScoreDataPoints:
                          dealScorePoints[item.product.id] ?? null,
                      }}
                    />
                    {item.targetPrice !== null && (
                      <p className="px-1 text-xs text-muted-foreground">
                        Target price: ${item.targetPrice.toFixed(2)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="pt-6">
                  <EmptyState
                    icon={Heart}
                    title="This wishlist is empty"
                    description="The owner has not added any products to it yet."
                    action={
                      // Section 13, item 58 — the owner sees an
                      // "add products" action; visitors see none
                      // (the list is not theirs to fill).
                      isOwner ? (
                        <Button asChild>
                          <Link href="/search">Add products</Link>
                        </Button>
                      ) : undefined
                    }
                  />
                </CardContent>
              </Card>
            )}

            {/* Section 6, Item 13 — polls on this wishlist. */}
            {pollsEnabled && polls && polls.length > 0 && (
              <section aria-label="Wishlist polls" className="space-y-4">
                <h2 className="flex items-center gap-2 text-xl font-bold">
                  <Vote className="h-5 w-5" /> Polls
                </h2>
                {voteError && (
                  <p role="alert" className="text-sm text-red-600">
                    {voteError}
                  </p>
                )}
                {polls.map((poll) => (
                  <Card key={poll.id}>
                    <CardContent className="space-y-3 pt-6">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="font-semibold">{poll.question}</p>
                        {poll.status === 'closed' && (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                            Closed
                          </span>
                        )}
                      </div>
                      {poll.totalVotes === 0 ? (
                        <p className="text-sm text-muted-foreground">No votes yet</p>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          {poll.totalVotes} vote{poll.totalVotes !== 1 ? 's' : ''}
                        </p>
                      )}
                      <ul className="space-y-2">
                        {poll.options.map((option) => {
                          const isMine = poll.userVotedOptionId === option.optionId;
                          return (
                            <li key={option.optionId}>
                              <Button
                                variant={isMine ? 'default' : 'outline'}
                                className="flex min-h-[44px] w-full items-center justify-between gap-2"
                                disabled={poll.status !== 'open' || votingOptionId === option.optionId}
                                onClick={() => vote(poll.id, option.optionId)}
                                aria-pressed={isMine}
                              >
                                <span className="truncate text-left">
                                  {option.productSlug ? (
                                    <a
                                      href={`/products/${option.productSlug}`}
                                      onClick={(e) => e.stopPropagation()}
                                      className="underline-offset-2 hover:underline"
                                    >
                                      {option.productName ?? 'Product'}
                                    </a>
                                  ) : (
                                    option.productName ?? 'Product'
                                  )}
                                  {isMine && ' — Your vote'}
                                </span>
                                <span className="shrink-0 text-sm">
                                  {option.votes} ·{' '}
                                  {poll.totalVotes > 0
                                    ? `${Math.round(option.share * 100)}%`
                                    : '—'}
                                </span>
                              </Button>
                            </li>
                          );
                        })}
                      </ul>
                      <p className="text-xs text-muted-foreground">
                        One vote per person. Voting again moves your vote.
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </section>
            )}
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
