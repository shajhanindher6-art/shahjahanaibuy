/**
 * Agent rules manager (S5#1 — personal AI shopping agent).
 *
 * Autonomous rules ("alert me under $800"): the user states a
 * product and a target price, and the rule watches it. Signed-in
 * rules are linked to the EXISTING price-drop alert chain (the
 * response reports alertLinked — a rule whose alert could not be
 * created says so instead of pretending to notify). Guest rules
 * live on the device only and never notify.
 *
 * Wiring into the dashboard is wave 2 — this component is ready
 * to mount there.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  loadGuestRules,
  newGuestRule,
  saveGuestRules,
  validateRuleInput,
  type AgentRule,
} from '@/lib/agent-memory';

interface RulesResponse {
  success: boolean;
  data?: { rules: AgentRule[]; setupRequired?: boolean };
  error?: { message?: string };
}

interface RuleResponse {
  success: boolean;
  data?: { rule: AgentRule; alertLinked?: boolean; alertUpdated?: boolean; note?: string };
  error?: { message?: string };
}

async function parseJson(res: Response): Promise<RulesResponse & RuleResponse> {
  return (await res.json().catch(() => null)) as RulesResponse & RuleResponse;
}

export function AgentRulesManager({ signedIn }: { signedIn: boolean }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [rules, setRules] = useState<AgentRule[]>([]);
  const [productSlug, setProductSlug] = useState('');
  const [targetPrice, setTargetPrice] = useState('');
  const [channel, setChannel] = useState<'email' | 'push' | 'both'>('email');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!signedIn) {
      setRules(loadGuestRules());
      setLoading(false);
      return;
    }
    try {
      const res = await fetch('/api/v1/agent/rules');
      const result = await parseJson(res);
      if (!res.ok || !result.success) {
        setError(result.error?.message ?? 'Could not load agent rules.');
        setLoading(false);
        return;
      }
      setSetupRequired(result.data?.setupRequired === true);
      setRules(result.data?.rules ?? []);
    } catch {
      setError('Could not load agent rules.');
    } finally {
      setLoading(false);
    }
  }, [signedIn]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createRule() {
    const target = Number(targetPrice);
    const validation = validateRuleInput({
      productSlug: productSlug.trim(),
      targetPriceUsd: target,
      channel: signedIn ? channel : 'local',
    });
    if (!validation.ok) {
      setError(validation.errors.join(' '));
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);

    if (!signedIn) {
      const rule = newGuestRule({
        productSlug: productSlug.trim(),
        targetPriceUsd: target,
        channel: 'local',
      });
      if (!rule) {
        setError('Could not create the rule — check the product and target price.');
        setSaving(false);
        return;
      }
      const next = [rule, ...loadGuestRules()];
      if (saveGuestRules(next)) {
        setRules(next);
        setProductSlug('');
        setTargetPrice('');
        setNotice('Rule saved on this device only — it will not send email or push alerts. Sign in to get notified.');
      } else {
        setError('Could not save on this device — storage is unavailable.');
      }
      setSaving(false);
      return;
    }

    try {
      const res = await fetch('/api/v1/agent/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productSlug: productSlug.trim(), targetPriceUsd: target, channel }),
      });
      const result = await parseJson(res);
      if (!res.ok || !result.success || !result.data?.rule) {
        setError(result.error?.message ?? 'Could not create the rule.');
        return;
      }
      setRules((prev) => {
        const created = result.data?.rule as AgentRule;
        return [created, ...prev.filter((r) => r.id !== created.id)];
      });
      setProductSlug('');
      setTargetPrice('');
      setNotice(
        result.data.note ??
          (result.data.alertLinked
            ? 'Rule created — the existing alert chain will notify you when the price drops under your target.'
            : 'Rule saved, but the alert could not be linked — it will not notify you yet.')
      );
    } catch {
      setError('Could not create the rule.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleRule(rule: AgentRule) {
    setError(null);
    if (!signedIn) {
      const next = loadGuestRules().map((r) =>
        r.id === rule.id ? { ...r, active: !r.active, updatedAt: new Date().toISOString() } : r
      );
      if (saveGuestRules(next)) setRules(next);
      return;
    }
    try {
      const res = await fetch(`/api/v1/agent/rules/${rule.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !rule.active }),
      });
      const result = await parseJson(res);
      if (!res.ok || !result.success || !result.data?.rule) {
        setError(result.error?.message ?? 'Could not update the rule.');
        return;
      }
      const updated = result.data.rule as AgentRule;
      setRules((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      if (result.data.alertUpdated === false) {
        setNotice('Rule updated, but the linked price-drop alert could not be updated.');
      }
    } catch {
      setError('Could not update the rule.');
    }
  }

  async function deleteRule(rule: AgentRule) {
    setError(null);
    if (!signedIn) {
      const next = loadGuestRules().filter((r) => r.id !== rule.id);
      if (saveGuestRules(next)) setRules(next);
      return;
    }
    try {
      const res = await fetch(`/api/v1/agent/rules/${rule.id}`, { method: 'DELETE' });
      const result = await parseJson(res);
      if (!res.ok || !result.success) {
        setError(result.error?.message ?? 'Could not delete the rule.');
        return;
      }
      setRules((prev) => prev.filter((r) => r.id !== rule.id));
    } catch {
      setError('Could not delete the rule.');
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading agent rules…</p>;
  }

  return (
    <section aria-label="Autonomous price rules" className="space-y-4 rounded-xl border border-slate-200 bg-card p-4 dark:border-slate-700">
      <div>
        <h3 className="text-base font-semibold">Autonomous rules — &ldquo;alert me under $…&rdquo;</h3>
        <p className="text-sm text-muted-foreground">
          Set a target price for a product and the agent watches it for you. When the recorded
          price drops to your target, the existing price-alert chain notifies you.
        </p>
        {!signedIn && (
          <p className="mt-1 text-sm font-medium text-amber-700 dark:text-amber-400">
            You are not signed in — rules are saved on this device only and never send email or
            push alerts. Sign in to get notified.
          </p>
        )}
        {setupRequired && (
          <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
            Agent rules are not set up yet on the server — ask the site owner to run migration 027.
          </p>
        )}
      </div>

      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {notice && <p className="text-sm text-green-700 dark:text-green-400">{notice}</p>}

      <div className="flex flex-wrap items-end gap-2">
        <label className="block text-sm">
          <span className="font-medium">Product slug</span>
          <input
            type="text"
            value={productSlug}
            onChange={(e) => setProductSlug(e.target.value)}
            placeholder="e.g. macbook-air-13"
            className="mt-1 block w-56 rounded-md border border-slate-300 px-2 py-1.5 dark:border-slate-600 dark:bg-muted"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium">Target price (USD)</span>
          <input
            type="number"
            min="1"
            step="1"
            inputMode="decimal"
            value={targetPrice}
            onChange={(e) => setTargetPrice(e.target.value)}
            placeholder="e.g. 800"
            className="mt-1 block w-32 rounded-md border border-slate-300 px-2 py-1.5 dark:border-slate-600 dark:bg-muted"
          />
        </label>
        {signedIn && (
          <label className="block text-sm">
            <span className="font-medium">Notify me by</span>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value as 'email' | 'push' | 'both')}
              className="mt-1 block rounded-md border border-slate-300 px-2 py-1.5 dark:border-slate-600 dark:bg-muted"
            >
              <option value="email">Email</option>
              <option value="push">Push</option>
              <option value="both">Email + push</option>
            </select>
          </label>
        )}
        <Button
          type="button"
          size="sm"
          onClick={() => void createRule()}
          disabled={saving || productSlug.trim() === '' || targetPrice.trim() === ''}
        >
          {saving ? 'Saving…' : 'Add rule'}
        </Button>
      </div>

      {rules.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No rules yet — add your first target price above.
        </p>
      ) : (
        <ul className="space-y-2">
          {rules.map((rule) => (
            <li
              key={rule.id}
              className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-700"
            >
              <Link
                href={`/products/${rule.productSlug}`}
                className="font-medium text-blue-600 hover:underline dark:text-blue-400"
              >
                {rule.productName ?? rule.productSlug}
              </Link>
              <span className="text-muted-foreground">
                under ${rule.targetPriceUsd} · {rule.channel === 'local' ? 'device only' : rule.channel}
              </span>
              <span
                className={
                  rule.active
                    ? 'rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-950 dark:text-green-300'
                    : 'rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground dark:bg-muted dark:text-muted-foreground'
                }
              >
                {rule.active ? 'Watching' : 'Paused'}
              </span>
              {signedIn && rule.active && !rule.alertId && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                  Not linked to an alert — will not notify
                </span>
              )}
              <span className="ml-auto flex gap-2">
                <Button
                  type="button"
                  variant="link"
                  onClick={() => void toggleRule(rule)}
                  className="h-auto p-0 text-sm"
                >
                  {rule.active ? 'Pause' : 'Resume'}
                </Button>
                <Button
                  type="button"
                  variant="link"
                  onClick={() => void deleteRule(rule)}
                  className="h-auto p-0 text-sm text-red-600 hover:text-red-600 dark:text-red-400 dark:hover:text-red-400"
                >
                  Delete
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default AgentRulesManager;
