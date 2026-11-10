'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/features/auth';
import { getUserSettings, updateUserSettings, type UpdateSettingsInput } from '@/services/settings';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { useToast } from '@/hooks/use-toast';
import { subscribePush, unsubscribePush } from '@/lib/push-client';
import {
  subscribeGuestPush,
  unsubscribeGuestPush,
  isGuestPushSubscribed,
} from '@/lib/push-client';
import { WebhookChannelsCard } from '@/components/dashboard/webhook-channels-card';
import { LANGUAGES, REGIONS } from '@/lib/region';
import { AgentMemorySettings } from '@/components/agent/agent-memory-settings';
import { AgentRulesManager } from '@/components/agent/agent-rules-manager';
import { AgentDealSummary } from '@/components/agent/agent-deal-summary';
import Link from 'next/link';
import { Save, KeyRound } from 'lucide-react';
import type { UserSettings } from '@/types';

// Currency options come from the region registry (lib/region.ts):
// every distinct currency of the 60 supported regions, in
// first-appearance order — no second hardcoded copy to drift out
// of sync. The old 6-currency list omitted most regions'
// currencies (e.g. PKR, INR, AED), so a user from Pakistan or
// India could not even pick their own currency. CNY/UAH exist in
// the CurrencyCode union but no region uses them, so they are
// correctly absent here.
const currencies = [...new Set(REGIONS.map((r) => r.currency))];
// Language options must match the languages the site actually
// supports (lib/region SUPPORTED_LANGUAGES, used by the header
// Language Switcher). The old hardcoded list offered ja/zh — which
// the site cannot render — and omitted ur/it/pt/tr. Saving an
// unsupported code would leave the header switcher unable to show
// the user's choice.
const languages = LANGUAGES;
const timezones = ['UTC', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Europe/London', 'Europe/Paris', 'Asia/Tokyo'];

export default function SettingsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // S3#8 — guest (no-account) push on this browser, separate from
  // the signed-in push toggle above. Status is read from the
  // browser's actual subscription, never assumed from a flag.
  const [guestPushOn, setGuestPushOn] = useState<boolean | null>(null);
  const [guestPushBusy, setGuestPushBusy] = useState(false);
  const [guestPushMessage, setGuestPushMessage] = useState('');

  const fetchSettings = useCallback(async () => {
    // Without this, a render with no user yet left `loading` true
    // forever (infinite spinner) instead of reaching the error state.
    if (!user) {
      setLoading(false);
      return;
    }
    const { getSupabaseBrowserClient } = await import('@/lib/supabase/client');
    try {
      const data = await getUserSettings(getSupabaseBrowserClient(), user.id);
      setSettings(data);
    } catch {
      setSettings(null);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    let cancelled = false;
    void isGuestPushSubscribed().then((on) => {
      if (!cancelled) setGuestPushOn(on);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * S3#8 — guest push toggle for this browser. No account needed:
   * the subscription is stored under this browser's random token
   * (guest_push_subscriptions). Turning it off removes the browser
   * subscription and the server-side row.
   */
  async function handleGuestPushToggle(enabled: boolean) {
    setGuestPushBusy(true);
    setGuestPushMessage('');
    if (!enabled) {
      await unsubscribeGuestPush();
      setGuestPushOn(false);
      setGuestPushMessage('Push notifications turned off on this browser.');
      setGuestPushBusy(false);
      return;
    }
    const result = await subscribeGuestPush();
    if (result.ok) {
      setGuestPushOn(true);
      setGuestPushMessage('Push notifications on — this browser will be notified when your alerts trigger.');
    } else {
      setGuestPushOn(false);
      const description =
        result.reason === 'denied'
          ? 'Browser notifications are blocked for this site. Allow them in your browser settings and try again.'
          : result.reason === 'unsupported'
            ? 'This browser does not support push notifications.'
            : result.reason === 'no-key'
              ? 'Push notifications are not configured yet (VAPID public key missing). Ask the site owner to set it, then try again.'
              : 'Push subscription could not be saved. Please try again.';
      setGuestPushMessage(description);
      toast({ title: 'Push notifications unavailable', description, variant: 'destructive' });
    }
    setGuestPushBusy(false);
  }

  /**
   * Push toggle wiring: the preference flag alone never subscribed the
   * browser, so push alerts could never arrive. Turning the toggle ON
   * now actually subscribes (permission + service worker + server
   * save); if that fails the toggle reverts and the reason is shown.
   * Turning it OFF unsubscribes. The flag itself is still persisted
   * by handleSave, as before.
   */
  async function handlePushToggle(enabled: boolean) {
    setSettings((prev) => (prev ? { ...prev, pushNotifications: enabled } : prev));
    if (!enabled) {
      await unsubscribePush();
      return;
    }
    const result = await subscribePush();
    if (!result.ok) {
      setSettings((prev) => (prev ? { ...prev, pushNotifications: false } : prev));
      const description =
        result.reason === 'denied'
          ? 'Browser notifications are blocked for this site. Allow them in your browser settings and try again.'
          : result.reason === 'unsupported'
            ? 'This browser does not support push notifications.'
            : result.reason === 'no-key'
              ? 'Push notifications are not configured yet (VAPID public key missing). Ask the site owner to set it, then try again.'
              : 'Push subscription could not be saved. Please try again.';
      toast({ title: 'Push notifications unavailable', description, variant: 'destructive' });
    }
  }

  async function handleSave() {
    if (!user || !settings) return;
    setSaving(true);
    const { getSupabaseBrowserClient } = await import('@/lib/supabase/client');
    const input: UpdateSettingsInput = {
      currency: settings.currency,
      language: settings.language,
      timezone: settings.timezone,
      emailNotifications: settings.emailNotifications,
      pushNotifications: settings.pushNotifications,
      priceAlerts: settings.priceAlerts,
    };
    try {
      await updateUserSettings(getSupabaseBrowserClient(), user.id, input);
      toast({ title: 'Settings saved', description: 'Your preferences have been updated.' });
    } catch {
      toast({ title: 'Error', description: 'Failed to save settings.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!settings) {
    // The account settings themselves could not be loaded (guest
    // visitor, or the settings read failed) — but the agent section
    // below works without an account (device-only mode), so it still
    // renders instead of replacing the whole page with an error.
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Settings</h1>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              Unable to load settings. Sign in to manage your account preferences.
            </p>
          </CardContent>
        </Card>
        <AgentDealSummary signedIn={!!user} />
        <AgentMemorySettings signedIn={!!user} />
        <AgentRulesManager signedIn={!!user} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Settings</h1>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <LoadingSpinner size="sm" /> : <Save className="mr-2 h-4 w-4" />}
          Save Changes
        </Button>
      </div>

      {/* Preferences */}
      <Card>
        <CardHeader>
          <CardTitle>Preferences</CardTitle>
          <CardDescription>Customize your regional and display preferences.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="currency">Currency</Label>
              <Select
                value={settings.currency}
                onValueChange={(v) => setSettings({ ...settings, currency: v })}
              >
                <SelectTrigger id="currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {currencies.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="language">Language</Label>
              <Select
                value={settings.language}
                onValueChange={(v) => setSettings({ ...settings, language: v })}
              >
                <SelectTrigger id="language">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {languages.map((l) => (
                    <SelectItem key={l.code} value={l.code}>
                      {l.nativeName} ({l.code})
                      {/* S5#12: machine-translated dictionaries are
                          labelled, never presented as reviewed copy. */}
                      {l.autoTranslated ? ' — auto-translated' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="timezone">Timezone</Label>
            <Select
              value={settings.timezone}
              onValueChange={(v) => setSettings({ ...settings, timezone: v })}
            >
              <SelectTrigger id="timezone">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {timezones.map((tz) => (
                  <SelectItem key={tz} value={tz}>
                    {tz}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
          <CardDescription>Manage how you receive alerts and updates.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="emailNotif">Email Notifications</Label>
              <p className="text-sm text-muted-foreground">
                Receive updates and alerts via email
              </p>
            </div>
            <Switch
              id="emailNotif"
              checked={settings.emailNotifications}
              onCheckedChange={(v) => setSettings({ ...settings, emailNotifications: v })}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="pushNotif">Push Notifications</Label>
              <p className="text-sm text-muted-foreground">
                Get push notifications in your browser
              </p>
            </div>
            <Switch
              id="pushNotif"
              checked={settings.pushNotifications}
              onCheckedChange={(v) => void handlePushToggle(v)}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="priceAlerts">Price Alerts</Label>
              <p className="text-sm text-muted-foreground">
                Get notified when tracked products drop in price
              </p>
            </div>
            <Switch
              id="priceAlerts"
              checked={settings.priceAlerts}
              onCheckedChange={(v) => setSettings({ ...settings, priceAlerts: v })}
            />
          </div>
        </CardContent>
      </Card>

      {/* S3#8 — guest push preferences for this browser. Works
          without an account (token-based); signed-in push above is
          separate and unchanged. */}
      <Card>
        <CardHeader>
          <CardTitle>Push on this browser (no account needed)</CardTitle>
          <CardDescription>
            Get price-drop and back-in-stock push notifications on this browser, even
            without signing in. The subscription is tied to this browser only.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="guestPushNotif">Browser push notifications</Label>
              <p className="text-sm text-muted-foreground">
                {guestPushOn === null
                  ? 'Checking this browser…'
                  : guestPushOn
                    ? 'On — this browser is subscribed to push alerts.'
                    : 'Off — turn on to get push alerts on this browser.'}
              </p>
              {guestPushMessage && (
                <p className="mt-1 text-sm text-muted-foreground">{guestPushMessage}</p>
              )}
            </div>
            <Switch
              id="guestPushNotif"
              checked={guestPushOn === true}
              disabled={guestPushBusy || guestPushOn === null}
              onCheckedChange={(v) => void handleGuestPushToggle(v)}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Push delivery needs the site owner&apos;s VAPID keys configured. Turning this off
            removes the subscription from this browser and our server.
          </p>
        </CardContent>
      </Card>

      {/* Option 7: WhatsApp & Telegram alert webhooks hub. Its own card
          with its own save/status actions, so a missing webhook
          migration can never break the main settings save above. */}
      <WebhookChannelsCard />

      {/* S5#1 — personal AI shopping agent. signedIn is the real
          auth state: guests get device-only memory/rules (the
          components say so), signed-in users get the server-backed
          versions. */}
      <AgentDealSummary signedIn={!!user} />
      <AgentMemorySettings signedIn={!!user} />
      <AgentRulesManager signedIn={!!user} />

      {/* S4#18 — public API keys. The full key is shown exactly once
          at creation, on the keys page itself; this is only a link. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" /> Public API keys
          </CardTitle>
          <CardDescription>
            Keys for the public read-only API (products, prices, deals). Create a key to raise
            your rate limit from 30 to 120 requests per minute. The full key is shown exactly
            once when you create it — store it then, it can never be shown again.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/dashboard/api-keys">Manage API keys</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
