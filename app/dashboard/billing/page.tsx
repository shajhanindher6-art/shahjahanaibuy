'use client';

import { useState, useEffect, useCallback } from 'react';
import { Check, Crown, Sparkles, CreditCard, XCircle, ExternalLink, FileText, Zap } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
// Section 15 P2-1/P2-2/P2-5/P2-8: plan keys are TierIds
// ('premium' is canonical; legacy 'pro' rows normalize to it),
// and prices come from lib/tiers.ts — never a hardcoded dollar
// figure in this file. The Premium price label is the planned
// price until launch; the test-mode banner and the Premium price
// note derive from the subscriptions API meta (paymentsLive —
// live key AND STRIPE_LIVE_LAUNCHED=true), so they flip
// automatically when the owner launches instead of claiming
// test mode forever.
import { getTier, normalizeTierId } from '@/lib/tiers';

interface Subscription {
  id: string;
  plan: string;
  status: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

interface BillingRecord {
  id: string;
  stripe_invoice_id: string | null;
  amount_paid: number;
  currency: string;
  status: string;
  invoice_url: string | null;
  created_at: string;
}

const PLANS = [
  {
    key: 'free',
    name: 'Free',
    // Price label from the canonical tier definition (lib/tiers.ts).
    priceLabel: getTier('free')?.priceLabel ?? 'Price to be announced',
    priceSuffix: 'forever',
    priceNote: null as string | null,
    icon: Sparkles,
    features: [
      'AI product search',
      // Section 12: lib/tiers.ts is canonical — Free allows 5 alerts,
      // not the smaller cap this page used to show. The old value
      // here was the outlier.
      'Up to 5 price alerts',
      'Single wishlist',
      'Product details with AI summary',
      '30-day price history',
    ],
    cta: 'Current Plan',
    color: 'border-slate-300',
  },
  {
    // Section 15 P2-2: the key is 'premium' now (canonical
    // TierId). Stored 'pro' rows normalize to 'premium' via
    // normalizeTierId below, so legacy subscriptions still match
    // this card. Section 15 P2-8: no hardcoded price — the label
    // comes from lib/tiers.ts, where it is the PLANNED price,
    // not a live charge.
    key: 'premium',
    name: 'Premium',
    priceLabel: getTier('premium')?.priceLabel ?? 'Price to be announced',
    priceSuffix: 'per month',
    priceNote: 'Planned price — payments are not live yet, so nothing is charged.',
    icon: Crown,
    features: [
      'Everything in Free',
      'Unlimited price alerts',
      'Multiple wishlists with sharing',
      'AI chat assistant',
      'Price drop predictions',
      // Section 12: recorded history maxes at 30 days — the old
      // one-year claim was never true.
      'Full recorded price history (currently up to 30 days)',
      'Weekly deal digest',
      'Priority support',
    ],
    cta: 'Upgrade to Premium',
    color: 'border-blue-500 ring-2 ring-blue-500/20',
    popular: true,
  },
];

export default function BillingPage() {
  const { toast } = useToast();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [billingHistory, setBillingHistory] = useState<BillingRecord[]>([]);
  const [stripeConfigured, setStripeConfigured] = useState(false);
  const [paymentsLive, setPaymentsLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [subRes, histRes] = await Promise.all([
        fetch('/api/v1/subscriptions'),
        fetch('/api/v1/subscriptions/history').catch(() => null),
      ]);
      const subData = await subRes.json();
      if (subData.success) {
        // Section 15 P2-5: Stripe live state comes from the
        // subscriptions API meta (server-derived), never from a
        // hardcoded banner. Read it even when the user has no
        // subscription row yet (data null) — the meta is about
        // server config, not the row. Falls back to the
        // stored-customer-ID heuristic only when the meta is
        // absent (older deploy).
        setPaymentsLive(Boolean(subData.meta?.paymentsLive));
        setStripeConfigured(
          subData.meta?.stripeConfigured ??
            Boolean((subData.data as Subscription | null)?.stripeCustomerId)
        );
      }
      if (subData.success && subData.data) {
        setSubscription(subData.data as Subscription);
      }
      if (histRes && histRes.ok) {
        const histData = await histRes.json();
        if (histData.success) {
          setBillingHistory(histData.data ?? []);
        }
      }
    } catch {
      // No subscription yet
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleUpgrade = async (planKey: string) => {
    if (planKey === 'free') return;
    if (subscription?.plan === planKey) return;

    setActionLoading(true);
    try {
      const res = await fetch('/api/v1/subscriptions/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planKey }),
      });
      const data = await res.json();

      if (data.success && data.data?.url) {
        window.location.href = data.data.url;
      } else {
        toast({ title: data.error?.message ?? 'Upgrade failed', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Upgrade failed', variant: 'destructive' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleManage = async () => {
    setActionLoading(true);
    try {
      const res = await fetch('/api/v1/subscriptions/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();

      if (data.success && data.data?.url) {
        window.location.href = data.data.url;
      } else {
        toast({ title: data.error?.message ?? 'Failed to open portal', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Failed to open billing portal', variant: 'destructive' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancel = async () => {
    setActionLoading(true);
    try {
      const res = await fetch('/api/v1/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: 'free', cancelAtPeriodEnd: true }),
      });
      const data = await res.json();
      if (data.success) {
        setSubscription(data.data as Subscription);
        toast({ title: 'Subscription canceled' });
      } else {
        toast({ title: 'Failed to cancel', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Failed to cancel', variant: 'destructive' });
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
    );
  }

  // Section 15 P2-2: normalize the stored plan key — legacy 'pro'
  // rows read as 'premium', so they match the Premium card.
  const currentPlan = normalizeTierId(subscription?.plan ?? 'free');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <CreditCard className="h-7 w-7 text-blue-600" />
          Billing & Subscription
        </h1>
        <p className="mt-1 text-muted-foreground">Manage your subscription and billing preferences</p>
        {/* Section 15 P2-5: the payments banner derives from the
            subscriptions API meta (paymentsLive), never a hardcoded
            claim — it flips automatically when the owner launches. */}
        {paymentsLive ? (
          <p className="mt-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
            Payments are live: Stripe live payments are enabled, so upgrading takes a real payment.
          </p>
        ) : (
          <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            {stripeConfigured
              ? 'Payments are in test mode: Stripe is not live yet, so upgrading does not take a real payment. No card is charged while this note is shown.'
              : 'Stripe is not configured yet, so upgrading is not available today. No card is charged while this note is shown.'}
          </p>
        )}
      </div>

      {subscription && subscription.plan !== 'free' && (
        <Card className="border-blue-200 bg-gradient-to-r from-blue-50 to-cyan-50 dark:border-blue-800 dark:from-blue-950 dark:to-cyan-950">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Crown className="h-5 w-5 text-yellow-500" />
                  Current Subscription
                </CardTitle>
                <CardDescription className="mt-1">
                  {currentPlan === 'premium' ? 'Premium Plan' : currentPlan} — {subscription.status}
                </CardDescription>
              </div>
              {/* Display name mapping: the stored plan key normalizes
                  to a TierId (legacy 'pro' → 'premium'); the tier
                  name shown is 'Premium'. */}
              <Badge className="bg-blue-600 capitalize">{currentPlan === 'premium' ? 'Premium' : currentPlan}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              {subscription.currentPeriodStart && (
                <div>
                  <p className="text-xs text-muted-foreground">Current Period Start</p>
                  <p className="text-sm font-medium">{new Date(subscription.currentPeriodStart).toLocaleDateString()}</p>
                </div>
              )}
              {subscription.currentPeriodEnd && (
                <div>
                  <p className="text-xs text-muted-foreground">Current Period End</p>
                  <p className="text-sm font-medium">{new Date(subscription.currentPeriodEnd).toLocaleDateString()}</p>
                </div>
              )}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {stripeConfigured && subscription.stripeCustomerId && (
                <Button variant="outline" size="sm" onClick={handleManage} disabled={actionLoading}>
                  <ExternalLink className="mr-2 h-4 w-4" /> Manage in Stripe Portal
                </Button>
              )}
              {!subscription.cancelAtPeriodEnd && subscription.plan !== 'free' && (
                <Button variant="outline" size="sm" onClick={handleCancel} disabled={actionLoading}>
                  <XCircle className="mr-2 h-4 w-4" /> Cancel Subscription
                </Button>
              )}
              {subscription.cancelAtPeriodEnd && (
                <Badge variant="destructive">Cancels at period end</Badge>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {PLANS.map((plan) => {
          const isCurrent = currentPlan === plan.key;
          const Icon = plan.icon;
          // Section 15 P2-5: the Premium "planned price" note only
          // applies while payments are not live. Once the owner
          // launches, the price below is the live price and the
          // note must not claim otherwise.
          const priceNote =
            plan.key === 'premium' && paymentsLive ? null : plan.priceNote;
          return (
            <Card key={plan.key} className={cn('relative', plan.color)}>
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge className="bg-blue-600">Most Popular</Badge>
                </div>
              )}
              <CardHeader>
                <div className="flex items-center gap-2">
                  <div className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-lg',
                    plan.key === 'premium' ? 'bg-blue-600' : 'bg-muted dark:bg-accent'
                  )}>
                    <Icon className={cn('h-5 w-5', plan.key === 'premium' ? 'text-white' : 'text-muted-foreground')} />
                  </div>
                  <div>
                    <CardTitle className="text-xl">{plan.name}</CardTitle>
                    <p className="text-2xl font-bold">
                      {plan.priceLabel}
                      <span className="text-sm font-normal text-muted-foreground">/{plan.priceSuffix}</span>
                    </p>
                    {priceNote ? (
                      <p className="text-xs font-normal text-muted-foreground">{priceNote}</p>
                    ) : null}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {plan.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-500" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <Button
                  className="mt-6 w-full"
                  variant={isCurrent ? 'outline' : 'default'}
                  disabled={isCurrent || actionLoading}
                  onClick={() => handleUpgrade(plan.key)}
                >
                  {isCurrent ? 'Current Plan' : actionLoading ? <LoadingSpinner size="sm" /> : (
                    <>
                      <Zap className="mr-2 h-4 w-4" /> {plan.cta}
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {billingHistory.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-5 w-5 text-muted-foreground" />
              Billing History
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {billingHistory.map((record) => (
                <div key={record.id} className="flex items-center justify-between border-b border-slate-100 pb-3 last:border-0 dark:border-slate-800">
                  <div>
                    <p className="text-sm font-medium">
                      ${(record.amount_paid / 100).toFixed(2)} {record.currency.toUpperCase()}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(record.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={record.status === 'paid' ? 'default' : 'outline'} className="capitalize">
                      {record.status}
                    </Badge>
                    {record.invoice_url && (
                      <a
                        href={record.invoice_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`View invoice from ${new Date(record.created_at).toLocaleDateString()}`}
                      >
                        <Button variant="ghost" size="sm">
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payment Method</CardTitle>
          <CardDescription>
            {stripeConfigured
              ? 'Payments are securely processed by Stripe.'
              : 'Payment methods are managed through Stripe once a subscription exists.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {stripeConfigured ? (
            <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950">
              <CreditCard className="h-8 w-8 text-green-600" />
              <div>
                <p className="text-sm font-medium">Stripe payments active</p>
                <p className="text-xs text-muted-foreground">Your payment details are handled securely by Stripe.</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-lg border border-dashed border-slate-300 p-4 dark:border-slate-700">
              <CreditCard className="h-8 w-8 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">No payment method on file</p>
                <p className="text-xs text-muted-foreground">No Stripe customer record exists for this account yet. Payment methods are managed through Stripe checkout and the customer portal once you upgrade.</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
