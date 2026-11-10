/**
 * AI Smart Home Reorder Agent — /tools/smart-home (Section 7, item 19).
 *
 * Client page: fetches GET /api/v1/tools/smart-home. Create reorder
 * rules for IoT devices and see pending confirmations. The hard rule
 * is shown on the page: the agent NEVER places an order or charges
 * anything by itself — a device trigger only prepares a pending
 * confirmation, and every order needs explicit user confirmation on
 * the product page. The webhook setup (shared secret + signature)
 * is documented here for the owner's own devices.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { PendingConfirmation, SmartHomeRule } from '@/lib/smart-home-agent';

interface SmartHomeResponse {
  rules: SmartHomeRule[];
  pendingConfirmations: PendingConfirmation[];
  rulesEnabled?: boolean;
}

export default function SmartHomePage() {
  const [rules, setRules] = useState<SmartHomeRule[]>([]);
  const [pending, setPending] = useState<PendingConfirmation[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [unauthorized, setUnauthorized] = useState(false);
  const [rulesEnabled, setRulesEnabled] = useState(true);
  const [deviceLabel, setDeviceLabel] = useState('');
  const [productSlug, setProductSlug] = useState('');
  const [trigger, setTrigger] = useState('');
  const [autoOrder, setAutoOrder] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    setUnauthorized(false);
    try {
      const res = await fetch('/api/v1/tools/smart-home');
      const json = await res.json().catch(() => null);
      if (res.status === 401) {
        setUnauthorized(true);
      } else if (res.ok && json?.success) {
        const data = json.data as SmartHomeResponse;
        setRules(Array.isArray(data.rules) ? data.rules : []);
        setPending(Array.isArray(data.pendingConfirmations) ? data.pendingConfirmations : []);
        setRulesEnabled(json.meta?.rulesEnabled !== false);
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function createRule(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/v1/tools/smart-home', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceLabel, productSlug, trigger, autoOrder }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) {
        setMessage(
          json.data?.deduped
            ? 'A rule for this device and product already exists — it was kept, not duplicated.'
            : 'Rule created. Confirmation is always required before any order.'
        );
        setDeviceLabel('');
        setProductSlug('');
        setTrigger('');
        setAutoOrder(false);
        await load();
      } else {
        setMessage(json?.error?.message ?? 'Could not create the rule. Try again later.');
      }
    } catch {
      setMessage('Could not create the rule. Try again later.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <h1 className="text-2xl font-bold">AI Smart Home Reorder Agent</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          When an IoT device reports it is running low, the matching rule
          prepares a reorder — as a pending confirmation. The agent never
          places an order or charges anything by itself: every order needs
          your explicit confirmation, and the handoff is the product page
          with its retailer link.
        </p>

        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          No order is ever placed automatically — even with auto-order on,
          the agent only prepares the reorder and asks you to confirm.
          SmartBuy never executes a purchase.
        </p>

        {!rulesEnabled && (
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            Smart-home rules are not live yet — the owner still needs to
            run the Section 7 migration (smart_home_rules table) once.
          </p>
        )}

        {loading ? (
          <div className="mt-6">
            <LoadingSpinner />
          </div>
        ) : unauthorized ? (
          <div className="mt-6">
            <EmptyState
              title="Sign in to use the smart-home agent"
              description="Your devices and reorder rules are private to your account."
            />
            <p className="mt-4 text-sm">
              <Link href="/sign-in" className="underline">
                Sign in
              </Link>
            </p>
          </div>
        ) : failed ? (
          <div className="mt-6">
            <EmptyState
              title="Smart-home rules could not be loaded"
              description="Try again later. No rules are shown rather than guessed ones."
            />
          </div>
        ) : (
          <>
            <section className="mt-6">
              <h2 className="text-lg font-semibold">Pending confirmations</h2>
              {pending.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  No pending reorder confirmations. When a device triggers,
                  the confirmation appears here — and nothing is ordered
                  until you confirm it.
                </p>
              ) : (
                <div className="mt-3 space-y-3">
                  {pending.map((c) => (
                    <article key={c.id ?? `${c.deviceLabel}-${c.receivedAt}`} className="rounded-lg border p-4">
                      <p className="font-medium">
                        {c.deviceLabel} — trigger “{c.trigger}”
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">{c.note}</p>
                      <p className="mt-2 text-sm">
                        <Link href={c.productUrl} className="underline">
                          Review and confirm on the product page →
                        </Link>
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Received {new Date(c.receivedAt).toLocaleString()}
                        {c.persisted ? '' : ' · shown from the webhook response (not stored)'}
                      </p>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="mt-8">
              <h2 className="text-lg font-semibold">Your reorder rules</h2>
              {rules.length === 0 ? (
                <div className="mt-3">
                  <EmptyState
                    title="No reorder rules yet"
                    description="Add a rule below: a device, the product it should reorder, and the trigger it sends."
                  />
                </div>
              ) : (
                <div className="mt-3 space-y-3">
                  {rules.map((rule) => (
                    <article key={rule.id} className="rounded-lg border p-4">
                      <p className="font-medium">{rule.device_label}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Trigger: {rule.trigger} · Product:{' '}
                        <Link href={`/products/${rule.product_slug}`} className="underline">
                          {rule.product_slug}
                        </Link>
                        {' · '}Auto-order: {rule.auto_order ? 'on (prepares only)' : 'off'}
                        {' · '}Confirmation: always required
                        {' · '}Status: {rule.is_active ? 'active' : 'inactive'}
                      </p>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="mt-8 rounded-lg border p-4">
              <h2 className="text-lg font-semibold">Add a reorder rule</h2>
              <form className="mt-4 space-y-3" onSubmit={createRule}>
                <div className="space-y-2">
                  <Label htmlFor="shDevice">Device label</Label>
                  <Input
                    id="shDevice"
                    placeholder="e.g. Office Printer"
                    value={deviceLabel}
                    onChange={(e) => setDeviceLabel(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="shProduct">Product slug</Label>
                  <Input
                    id="shProduct"
                    placeholder="e.g. printer-ink-black"
                    value={productSlug}
                    onChange={(e) => setProductSlug(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="shTrigger">Trigger</Label>
                  <Input
                    id="shTrigger"
                    placeholder="e.g. ink_low"
                    value={trigger}
                    onChange={(e) => setTrigger(e.target.value)}
                    required
                  />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={autoOrder}
                    onChange={(e) => setAutoOrder(e.target.checked)}
                  />
                  Auto-order with my permission (prepares the reorder — confirmation is still always required)
                </label>
                <Button type="submit" disabled={saving}>
                  {saving ? 'Saving…' : 'Create rule'}
                </Button>
                {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
              </form>
            </section>

            <section className="mt-8 rounded-lg border p-4">
              <h2 className="text-lg font-semibold">Connect a device (webhook)</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Your device or hub POSTs to{' '}
                <code className="rounded bg-muted px-1">/api/v1/tools/smart-home/webhook</code>{' '}
                with a JSON body like{' '}
                <code className="rounded bg-muted px-1">
                  {`{"device_label": "Office Printer", "trigger": "ink_low"}`}
                </code>
                . The request must carry an{' '}
                <code className="rounded bg-muted px-1">x-smartbuy-signature</code> header:
                HMAC-SHA256 hex of the exact body, keyed by the SHA-256 hash
                of the shared secret — the same signing as the generic
                webhook channel. The owner sets the secret as the{' '}
                <code className="rounded bg-muted px-1">SMART_HOME_WEBHOOK_SECRET</code>{' '}
                env var (minimum 16 characters); until it is set, the
                receiver accepts nothing. Unsigned or wrongly signed
                requests are rejected, and a trigger that matches no active
                rule is ignored with an honest answer.
              </p>
            </section>
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
