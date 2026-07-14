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

interface PriceAlertDialogProps {
  productId: string;
  productName: string;
  currentPrice?: number | null;
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

export function PriceAlertDialog({ productId, productName, currentPrice }: PriceAlertDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(false);
  const [targetPrice, setTargetPrice] = useState('');
  const [alertType, setAlertType] = useState('price_drop');
  const [channel, setChannel] = useState('email');

  useEffect(() => {
    if (currentPrice) {
      setTargetPrice((currentPrice * 0.9).toFixed(2));
    }
  }, [currentPrice]);

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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Bell className="mr-2 h-4 w-4" /> Set Alert
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
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <BellRing className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Sign in to create price alerts and get notified when prices drop.
            </p>
            <Button asChild>
              <a href="/sign-in">Sign In</a>
            </Button>
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
      </DialogContent>
    </Dialog>
  );
}
