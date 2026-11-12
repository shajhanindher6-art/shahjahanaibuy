'use client';

import { useState, useEffect } from 'react';
import { Bell, BellRing, Trash2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/features/auth';
import {
  listLocalAlertsForProduct,
  removeLocalAlert,
  saveLocalAlert,
  submitGuestEmailAlert,
  isValidEmail,
  type LocalPriceAlert,
} from '@/lib/local-alerts';
import {
  subscribeGuestPush,
  getGuestPushToken,
} from '@/lib/push-client';
import { PushOptInPrompt } from '@/components/home/push-opt-in-prompt';

interface PriceAlertDialogProps {
  productId: string;
  productName: string;
  currentPrice?: number | null;
  /**
   * Option 9: optional prefilled target price (e.g. from the price
   * negotiator). Additive only — existing callers pass nothing and
   * keep the old behavior (target defaults to 90% of current price).
   */
  initialTargetPrice?: number | null;
  /** Optional trigger button label (default "Set Alert"). */
  triggerLabel?: string;
}

interface Alert {
  id: string;
  productId: string;
  alertType: string;
  conditionValue: number | null;
  channel: string;
  active: boolean;
  triggerCount: number;
}

export function PriceAlertDialog({ productId, productName, currentPrice, initialTargetPrice, triggerLabel }: PriceAlertDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(false);
  const [targetPrice, setTargetPrice] = useState('');
  const [alertType, setAlertType] = useState('price_drop');
  const [channel, setChannel] = useState('email');
  // Option 15 Module 3 — guest (logged-out) alerts, stored on this
  // device only. The signed-in flow below is untouched.
  const [localAlerts, setLocalAlerts] = useState<LocalPriceAlert[]>([]);
  // S3#7/S3#8 — guest email opt-in + guest push, both optional.
  const [guestAlertType, setGuestAlertType] = useState<'price_drop' | 'back_in_stock'>('price_drop');
  const [guestEmail, setGuestEmail] = useState('');
  const [guestEmailState, setGuestEmailState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [guestEmailError, setGuestEmailError] = useState('');
  const [pushState, setPushState] = useState<'idle' | 'busy' | 'subscribed' | 'error'>('idle');
  const [pushMessage, setPushMessage] = useState('');

  const refreshLocalAlerts = () => {
    setLocalAlerts(listLocalAlertsForProduct(productId));
  };

  useEffect(() => {
    if (open && !user) refreshLocalAlerts();
  }, [open, user]);

  useEffect(() => {
    // Prefilled target (negotiator shortcut) wins over the 90% default.
    if (initialTargetPrice !== null && initialTargetPrice !== undefined && initialTargetPrice > 0) {
      setTargetPrice(initialTargetPrice.toFixed(2));
    } else if (currentPrice) {
      setTargetPrice((currentPrice * 0.9).toFixed(2));
    }
  }, [currentPrice, initialTargetPrice]);

  const fetchAlerts = async () => {
    if (!user) return;
    try {
      const res = await fetch('/api/v1/alerts');
      const data = await res.json();
      if (data.success) {
        const allAlerts: Alert[] = data.data ?? [];
        setAlerts(allAlerts.filter((a) => a.productId === productId));
      }
    } catch { setAlerts([]); }
  };

  useEffect(() => {
    if (open) fetchAlerts();
  }, [open]);

  const handleCreate = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId,
          alertType,
          conditionValue: alertType === 'price_drop' ? parseFloat(targetPrice) : undefined,
          channel,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: 'Price alert created!', description: `We'll notify you when ${productName} drops below $${targetPrice}.` });
        fetchAlerts();
      } else {
        toast({ title: 'Failed to create alert', description: data.error?.message ?? 'Please try again.', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Failed to create alert', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (alertId: string) => {
    try {
      await fetch(`/api/v1/alerts/${alertId}`, { method: 'DELETE' });
      setAlerts(alerts.filter((a) => a.id !== alertId));
      toast({ title: 'Alert removed' });
    } catch {
      toast({ title: 'Failed to remove alert', variant: 'destructive' });
    }
  };

  // Option 15 Module 3 — guest create/delete. Never calls /api/v1/alerts.
  // S3#7: when the guest also leaves an email, the same alert is
  // stored server-side (opt-in) so the scheduled price check can
  // actually email them — the local alert alone can never notify.
  const handleCreateLocal = async () => {
    const target = guestAlertType === 'price_drop' ? parseFloat(targetPrice) : null;
    const result = saveLocalAlert({
      productId,
      productName,
      targetPrice: target,
      alertType: guestAlertType,
    });
    if (!result.ok) {
      toast({ title: 'Could not save alert', description: result.error, variant: 'destructive' });
      return;
    }
    toast({
      title: 'Price alert saved on this device',
      description:
        guestAlertType === 'price_drop'
          ? `Target $${(target as number).toFixed(2)} for ${productName} — saved on this device only.`
          : `Back-in-stock alert for ${productName} — saved on this device only.`,
    });
    refreshLocalAlerts();

    if (guestEmail.trim() !== '') {
      if (!isValidEmail(guestEmail)) {
        setGuestEmailState('error');
        setGuestEmailError('Enter a valid email address.');
        return;
      }
      setGuestEmailState('saving');
      setGuestEmailError('');
      const emailResult = await submitGuestEmailAlert({
        email: guestEmail,
        productId,
        alertType: guestAlertType,
        targetPrice: target,
        guestToken: getGuestPushToken(),
      });
      if (emailResult.ok) {
        setGuestEmailState('saved');
        toast({
          title: 'Email alert saved',
          description: `We'll email ${guestEmail.trim()} when this triggers (sent when the scheduled price check runs, if email delivery is configured). Unsubscribe anytime from the email.`,
        });
      } else {
        setGuestEmailState('error');
        setGuestEmailError(emailResult.error);
      }
    }
  };

  // S3#8 — guest push subscribe (no account needed, token-based).
  const handleGuestPush = async () => {
    setPushState('busy');
    setPushMessage('');
    const result = await subscribeGuestPush();
    if (result.ok) {
      setPushState('subscribed');
      setPushMessage('Push notifications on — this browser will be notified when your alert triggers.');
    } else {
      setPushState('error');
      setPushMessage(
        result.reason === 'denied'
          ? 'Browser notifications are blocked for this site. Allow them in your browser settings and try again.'
          : result.reason === 'unsupported'
            ? 'This browser does not support push notifications.'
            : result.reason === 'no-key'
              ? 'Push notifications are not configured yet (VAPID public key missing).'
              : 'Push subscription could not be saved. Please try again.'
      );
    }
  };

  const handleDeleteLocal = (alertId: string) => {
    setLocalAlerts(removeLocalAlert(alertId));
    toast({ title: 'Alert removed' });
  };

  // First stored local target already met by the current price, if any.
  const reachedLocalAlert =
    currentPrice != null
      ? localAlerts.find(
          (a) =>
            a.alertType === 'price_drop' &&
            a.targetPrice !== null &&
            currentPrice <= a.targetPrice
        )
      : undefined;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Bell className="mr-2 h-4 w-4" /> {triggerLabel ?? 'Set Alert'}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BellRing className="h-5 w-5 text-blue-500" />
            Price Alert for {productName}
          </DialogTitle>
          <DialogDescription>
            Get notified when the price drops or a deal becomes available.
          </DialogDescription>
        </DialogHeader>

        {!user ? (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Saved on this device only — sign in to get email/push notifications and sync across devices.
            </p>

            <div>
              <Label className="mb-1.5 block text-sm">Alert Type</Label>
              <Select value={guestAlertType} onValueChange={(v) => setGuestAlertType(v as 'price_drop' | 'back_in_stock')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="price_drop">Price Drop</SelectItem>
                  <SelectItem value="back_in_stock">Back in Stock</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {guestAlertType === 'price_drop' && (
              <div>
                <Label className="mb-1.5 block text-sm">Target Price ($)</Label>
                <Input
                  type="number"
                  value={targetPrice}
                  onChange={(e) => setTargetPrice(e.target.value)}
                  placeholder="e.g. 199.99"
                />
                {currentPrice && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Current price: ${currentPrice.toFixed(2)}
                  </p>
                )}
              </div>
            )}

            {/* S3#7 — opt-in email: stored server-side with an
                unsubscribe token so the scheduled price check can
                actually notify this guest. Optional — leaving it
                blank keeps the alert device-only. */}
            <div>
              <Label className="mb-1.5 block text-sm">Email for notifications (optional)</Label>
              <Input
                type="email"
                value={guestEmail}
                onChange={(e) => {
                  setGuestEmail(e.target.value);
                  setGuestEmailState('idle');
                  setGuestEmailError('');
                }}
                placeholder="you@example.com"
              />
              {guestEmailState === 'saved' ? (
                <p className="mt-1 text-xs text-green-600">
                  Email alert saved — we&apos;ll email you when it triggers, if email delivery is configured. Unsubscribe anytime from the email.
                </p>
              ) : guestEmailState === 'error' && guestEmailError ? (
                <p className="mt-1 text-xs text-red-600">{guestEmailError}</p>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">
                  Only used for this alert. No account needed — delivery happens when the scheduled price check runs.
                </p>
              )}
            </div>

            {/* S3#8 — guest push on this browser (no account needed). */}
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleGuestPush}
                disabled={pushState === 'busy' || pushState === 'subscribed'}
              >
                <Bell className="mr-2 h-4 w-4" />
                {pushState === 'subscribed'
                  ? 'Push notifications on'
                  : pushState === 'busy'
                    ? 'Enabling push…'
                    : 'Notify me by push on this browser'}
              </Button>
              {pushMessage && (
                <p className={`mt-1 text-xs ${pushState === 'subscribed' ? 'text-green-600' : 'text-red-600'}`}>
                  {pushMessage}
                </p>
              )}
            </div>

            {reachedLocalAlert && currentPrice != null && reachedLocalAlert.targetPrice !== null && (
              <p className="text-sm font-medium text-green-600">
                Target reached — current price ${currentPrice.toFixed(2)} is at or below your ${reachedLocalAlert.targetPrice.toFixed(2)} target.
              </p>
            )}

            {localAlerts.length > 0 && (
              <div className="space-y-2">
                <Label className="text-sm">Saved on this device</Label>
                {localAlerts.map((alert) => (
                  <div key={alert.id} className="flex items-center justify-between rounded-lg border p-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-xs capitalize">
                        {alert.alertType === 'back_in_stock' ? 'Back in stock' : 'Price drop'}
                      </Badge>
                      {alert.targetPrice !== null && (
                        <span className="text-sm text-muted-foreground">
                          Below ${alert.targetPrice.toFixed(2)}
                        </span>
                      )}
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => handleDeleteLocal(alert.id)}>
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              <a href="/sign-in" className="underline">Sign in</a> to get email/push notifications and sync across devices.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <Label className="mb-1.5 block text-sm">Alert Type</Label>
              <Select value={alertType} onValueChange={setAlertType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="price_drop">Price Drop</SelectItem>
                  <SelectItem value="back_in_stock">Back in Stock</SelectItem>
                  <SelectItem value="deal">New Deal</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {alertType === 'price_drop' && (
              <div>
                <Label className="mb-1.5 block text-sm">Target Price ($)</Label>
                <Input
                  type="number"
                  value={targetPrice}
                  onChange={(e) => setTargetPrice(e.target.value)}
                  placeholder="e.g. 199.99"
                />
                {currentPrice && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Current price: ${currentPrice.toFixed(2)}
                  </p>
                )}
              </div>
            )}

            <div>
              <Label className="mb-1.5 block text-sm">Notification Channel</Label>
              <Select value={channel} onValueChange={setChannel}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="push">Push Notification</SelectItem>
                  <SelectItem value="both">Email & Push</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {alerts.length > 0 && (
              <div className="space-y-2">
                <Label className="text-sm">Active Alerts</Label>
                {alerts.map((alert) => (
                  <div key={alert.id} className="flex items-center justify-between rounded-lg border p-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-xs capitalize">
                        {alert.alertType.replace('_', ' ')}
                      </Badge>
                      {alert.conditionValue && (
                        <span className="text-sm text-muted-foreground">
                          Below ${alert.conditionValue.toFixed(2)}
                        </span>
                      )}
                      <Badge variant="outline" className="text-xs capitalize">{alert.channel}</Badge>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => handleDelete(alert.id)}>
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {/* Section 16, #35 — push opt-in, surfaced right after
                alert creation: once the user has an active alert
                (this list re-fetches after Create Alert), the prompt
                asks them to turn on push so the alert can actually
                reach them. The prompt itself stays honest — when
                VAPID keys are unconfigured it says so and disables
                the button instead of pretending push works. */}
            {alerts.length > 0 && (
              <PushOptInPrompt context="product" />
            )}
          </div>
        )}

        {user && (
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={loading || (alertType === 'price_drop' && !targetPrice)}>
              {loading ? 'Creating...' : 'Create Alert'}
            </Button>
          </DialogFooter>
        )}

        {!user && (
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              onClick={handleCreateLocal}
              disabled={
                guestEmailState === 'saving' ||
                (guestAlertType === 'price_drop' && !targetPrice)
              }
            >
              {guestEmailState === 'saving' ? 'Saving…' : 'Create Alert'}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
