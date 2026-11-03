'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';

/**
 * WhatsApp & Telegram Alert Webhooks Hub (settings card).
 *
 * HONESTY RULES:
 * - "Check status" only READS configuration — it never sends a message.
 * - A channel can only deliver when BOTH sides are ready: the user
 *   enabled it + saved a destination here, AND the owner configured
 *   the provider credentials on the server. Until then the card says
 *   "not configured" in plain words — delivery is never claimed.
 * - WhatsApp needs the owner's Meta Business app + an approved
 *   template; Telegram needs the owner's bot token from BotFather.
 *   Those are owner steps, documented here, not hidden.
 * - If the migration (supabase/add-alert-webhooks.sql) has not been
 *   run yet, saving reports that honestly instead of failing the
 *   whole settings page.
 */

interface ChannelStatus {
  enabled: boolean;
  destinationSet: boolean;
  ownerConfigured: boolean;
  /** 'ready' | 'not_configured' | 'migration_not_run' */
  state: string;
}

interface WebhookStatusResponse {
  migrationApplied: boolean;
  whatsapp: ChannelStatus;
  telegram: ChannelStatus;
}

export function WebhookChannelsCard() {
  const { toast } = useToast();
  const [status, setStatus] = useState<WebhookStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [whatsappEnabled, setWhatsappEnabled] = useState(false);
  const [whatsappPhone, setWhatsappPhone] = useState('');
  const [telegramEnabled, setTelegramEnabled] = useState(false);
  const [telegramChatId, setTelegramChatId] = useState('');

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/settings/webhooks');
      if (!res.ok) throw new Error('status failed');
      const data = await res.json();
      const s = data.data as WebhookStatusResponse;
      setStatus(s);
      setWhatsappEnabled(s.whatsapp.enabled);
      setTelegramEnabled(s.telegram.enabled);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  async function handleSave() {
    // The status API returns only booleans, never the saved phone/chat
    // ID back — so a blank input here does NOT mean "no destination":
    // it may mean "a destination is already saved, just hidden".
    // Saving a blank over it would silently WIPE it (POST nulls an
    // empty field). Refuse instead and ask the user to re-enter it,
    // so a toggle-only save can never destroy a saved destination.
    // (A proper fix is for the status API to return the destination
    // for prefill; until then this guard prevents the data loss.)
    if (status?.whatsapp.destinationSet && whatsappPhone.trim() === '') {
      toast({
        title: 'WhatsApp destination not re-entered',
        description:
          'A WhatsApp number is already saved but is not shown here. Re-enter it above before saving, or nothing will be changed.',
        variant: 'destructive',
      });
      return;
    }
    if (status?.telegram.destinationSet && telegramChatId.trim() === '') {
      toast({
        title: 'Telegram destination not re-entered',
        description:
          'A Telegram chat ID is already saved but is not shown here. Re-enter it above before saving, or nothing will be changed.',
        variant: 'destructive',
      });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/v1/settings/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          whatsappEnabled,
          whatsappPhone: whatsappPhone.trim() || null,
          telegramEnabled,
          telegramChatId: telegramChatId.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        toast({
          title: 'Webhook settings not saved',
          description:
            data?.error?.message ??
            'Community webhook columns are not live yet — the owner still needs to run supabase/add-alert-webhooks.sql.',
          variant: 'destructive',
        });
        return;
      }
      toast({ title: 'Webhook settings saved' });
      await loadStatus();
    } catch {
      toast({
        title: 'Webhook settings not saved',
        description: 'Could not reach the server. Try again later.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleCheckStatus() {
    setChecking(true);
    await loadStatus();
    setChecking(false);
    toast({
      title: 'Status checked — no message sent',
      description:
        'This check only reads configuration. A channel delivers only when you enabled it, saved a destination, and the owner configured the provider.',
    });
  }

  function channelLine(label: string, ch: ChannelStatus): string {
    if (ch.state === 'migration_not_run') return `${label}: setup not live yet (owner migration pending)`;
    if (ch.state === 'ready') return `${label}: ready — enabled and provider configured`;
    const missing: string[] = [];
    if (!ch.enabled) missing.push('not enabled');
    if (!ch.destinationSet) missing.push('no destination saved');
    if (!ch.ownerConfigured) missing.push('owner credentials not configured');
    return `${label}: not configured (${missing.join(', ')})`;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>WhatsApp &amp; Telegram alerts</CardTitle>
        <CardDescription>
          Get price-drop alerts on WhatsApp or Telegram. Delivery needs both your settings
          below and the owner&apos;s provider setup (Meta Business app + approved template
          for WhatsApp; a bot token from BotFather for Telegram). Until both are ready, no
          message can arrive — and this card will say so.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading webhook status…</p>
        ) : status ? (
          <>
            {status.migrationApplied === false && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                Webhook settings are not live yet — the owner still needs to run
                supabase/add-alert-webhooks.sql once. Until then, saving here will report
                that honestly instead of pretending to work.
              </p>
            )}
            <div className="space-y-2 text-sm">
              <p>{channelLine('WhatsApp', status.whatsapp)}</p>
              <p>{channelLine('Telegram', status.telegram)}</p>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="waEnabled">WhatsApp alerts</Label>
                <p className="text-sm text-muted-foreground">
                  Send price-drop alerts to your WhatsApp number
                </p>
              </div>
              <Switch
                id="waEnabled"
                checked={whatsappEnabled}
                onCheckedChange={setWhatsappEnabled}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="waPhone">WhatsApp phone number (with country code)</Label>
              {status.whatsapp.destinationSet && (
                <p className="text-xs text-muted-foreground">
                  A number is already saved (not shown here). Re-enter it if you save anything
                  on this card, otherwise the save is refused to protect it.
                </p>
              )}
              <Input
                id="waPhone"
                placeholder="e.g. 923001234567"
                value={whatsappPhone}
                onChange={(e) => setWhatsappPhone(e.target.value)}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="tgEnabled">Telegram alerts</Label>
                <p className="text-sm text-muted-foreground">
                  Send price-drop alerts to your Telegram chat
                </p>
              </div>
              <Switch
                id="tgEnabled"
                checked={telegramEnabled}
                onCheckedChange={setTelegramEnabled}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tgChatId">Telegram chat ID</Label>
              {status.telegram.destinationSet && (
                <p className="text-xs text-muted-foreground">
                  A chat ID is already saved (not shown here). Re-enter it if you save anything
                  on this card, otherwise the save is refused to protect it.
                </p>
              )}
              <Input
                id="tgChatId"
                placeholder="e.g. 123456789 (message @userinfobot to find yours)"
                value={telegramChatId}
                onChange={(e) => setTelegramChatId(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save webhook settings'}
              </Button>
              <Button variant="outline" onClick={handleCheckStatus} disabled={checking}>
                {checking ? 'Checking…' : 'Check status (sends nothing)'}
              </Button>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Webhook status could not be loaded. Sign in and try again.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
