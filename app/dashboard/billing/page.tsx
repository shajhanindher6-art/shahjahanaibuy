'use client';

import { useState, useEffect, useCallback } from 'react';
import { Check, Crown, Sparkles, CreditCard, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface Subscription {
  id: string;
  plan: string;
  status: string;
  stripeCustomerId: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

const PLANS = [
  {
    key: 'free',
    name: 'Free',
    price: 0,
    icon: Sparkles,
    features: [
      'AI product search',
      'Basic price alerts (3 max)',
      'Single wishlist',
      'Product details with AI summary',
      '30-day price history',
    ],
    cta: 'Current Plan',
    color: 'border-slate-300',
  },
  {
    key: 'pro',
    name: 'Pro',
    price: 9.99,
    icon: Crown,
    features: [
      'Everything in Free',
      'Unlimited price alerts',
      'Multiple wishlists with sharing',
      'AI chat assistant',
      'Price drop predictions',
      '1-year price history',
      'Weekly deal digest',
      'Priority support',
    ],
    cta: 'Upgrade to Pro',
    color: 'border-blue-500 ring-2 ring-blue-500/20',
    popular: true,
  },
];

export default function BillingPage() {
  const { toast } = useToast();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState(false);

  const fetchSubscription = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/subscriptions');
      const data = await res.json();
      if (data.success && data.data) {
        setSubscription(data.data as Subscription);
      }
    } catch {
      // No subscription yet
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSubscription();
  }, [fetchSubscription]);

  const handleUpgrade = async (planKey: string) => {
    if (planKey === 'free') return;
    if (subscription?.plan === planKey) return;

    setUpgrading(true);
    try {
      const res = await fetch('/api/v1/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan: planKey,
          currentPeriodStart: new Date().toISOString(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSubscription(data.data as Subscription);
        toast({ title: `Upgraded to ${planKey === 'pro' ? 'Pro' : planKey}!` });
      } else {
        toast({ title: 'Upgrade failed', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Upgrade failed', variant: 'destructive' });
    } finally {
      setUpgrading(false);
    }
  };

  const handleCancel = async () => {
    try {
      const res = await fetch('/api/v1/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan: 'free',
          cancelAtPeriodEnd: true,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSubscription(data.data as Subscription);
        toast({ title: 'Subscription cancelled' });
      }
    } catch {
      toast({ title: 'Failed to cancel', variant: 'destructive' });
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
    );
  }

  const currentPlan = subscription?.plan ?? 'free';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <CreditCard className="h-7 w-7 text-blue-600" />
          Billing & Subscription
        </h1>
        <p className="mt-1 text-muted-foreground">Manage your subscription and billing preferences</p>
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
                  {subscription.plan === 'pro' ? 'Pro Plan' : subscription.plan} — {subscription.status}
                </CardDescription>
              </div>
              <Badge className="bg-blue-600 capitalize">{subscription.plan}</Badge>
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
            {!subscription.cancelAtPeriodEnd && subscription.plan !== 'free' && (
              <Button variant="outline" size="sm" className="mt-4" onClick={handleCancel}>
                <XCircle className="mr-2 h-4 w-4" /> Cancel Subscription
              </Button>
            )}
            {subscription.cancelAtPeriodEnd && (
              <Badge variant="destructive" className="mt-4">Cancels at period end</Badge>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {PLANS.map((plan) => {
          const isCurrent = currentPlan === plan.key;
          const Icon = plan.icon;
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
                    plan.key === 'pro' ? 'bg-blue-600' : 'bg-slate-200 dark:bg-slate-700'
                  )}>
                    <Icon className={cn('h-5 w-5', plan.key === 'pro' ? 'text-white' : 'text-muted-foreground')} />
                  </div>
                  <div>
                    <CardTitle className="text-xl">{plan.name}</CardTitle>
                    <p className="text-2xl font-bold">
                      ${plan.price}
                      <span className="text-sm font-normal text-muted-foreground">/month</span>
                    </p>
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
                  disabled={isCurrent || upgrading}
                  onClick={() => handleUpgrade(plan.key)}
                >
                  {isCurrent ? 'Current Plan' : upgrading ? <LoadingSpinner size="sm" /> : plan.cta}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payment Method</CardTitle>
          <CardDescription>Stripe integration ready — add your Stripe API key to enable live payments</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 rounded-lg border border-dashed border-slate-300 p-4 dark:border-slate-700">
            <CreditCard className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">No payment method</p>
              <p className="text-xs text-muted-foreground">Stripe is not yet configured. Add your Stripe secret key to enable secure credit card payments.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
