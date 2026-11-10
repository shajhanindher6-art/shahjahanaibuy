/**
 * Admin merchants page (Section 5 #15) — /admin/merchants.
 *
 * Record merchant policy facts and grant/remove Verified Merchant
 * status, via POST /api/v1/admin/merchants/[slug]/verify.
 *
 * Guard: /admin/layout.tsx already redirects non-admins
 * server-side; this page repeats the client-side role check like
 * the fact-check page (defense in depth).
 *
 * Honesty: every field starts EMPTY — an empty field means "not
 * recorded", never a default. The badge is granted only when the
 * recorded data meets ALL five public standards; the API returns
 * the exact unmet list otherwise. No merchant has the badge today
 * because no merchant has recorded data meeting all of them.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { Store, ShieldCheck, ShieldX } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { useAuth } from '@/features/auth';
import {
  VERIFIED_MERCHANT_MEANING,
  VERIFIED_MERCHANT_REMOVAL_POLICY,
  VERIFIED_MERCHANT_STANDARDS,
} from '@/lib/verified-merchants';

interface MerchantRow {
  id: string;
  name: string;
  slug: string;
  websiteUrl?: string | null;
  is_verified_merchant?: boolean | null;
  merchant_verified_until?: string | null;
  return_window_days?: number | null;
  warranty_months?: number | null;
  reputation_score?: number | null;
  return_policy_url?: string | null;
  warranty_policy_url?: string | null;
}

interface VerifyResult {
  merchant: MerchantRow;
  verified: boolean;
  unmet: string[];
  note?: string;
}

type FormState = {
  returnWindowDays: string;
  warrantyMonths: string;
  reputationScore: string;
  returnPolicyUrl: string;
  warrantyPolicyUrl: string;
};

const EMPTY_FORM: FormState = {
  returnWindowDays: '',
  warrantyMonths: '',
  reputationScore: '',
  returnPolicyUrl: '',
  warrantyPolicyUrl: '',
};

export default function AdminMerchantsPage() {
  const { role } = useAuth();
  const [merchants, setMerchants] = useState<MerchantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [forms, setForms] = useState<Record<string, FormState>>({});
  const [saved, setSaved] = useState<Record<string, MerchantRow>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, { kind: 'ok' | 'error'; text: string }>>({});
  const [unmet, setUnmet] = useState<Record<string, string[]>>({});

  const fetchMerchants = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/v1/merchants?pageSize=100');
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success || !Array.isArray(json.data)) {
        setLoadError('Could not load merchants.');
        setMerchants([]);
        return;
      }
      setMerchants(json.data as MerchantRow[]);
    } catch {
      setLoadError('Could not load merchants. Please try again.');
      setMerchants([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchMerchants();
  }, [fetchMerchants]);

  function setForm(slug: string, patch: Partial<FormState>) {
    setForms((prev) => ({ ...prev, [slug]: { ...(prev[slug] ?? EMPTY_FORM), ...patch } }));
  }

  function formValue(slug: string, field: keyof FormState): string {
    return forms[slug]?.[field] ?? '';
  }

  function parseBody(slug: string): Record<string, unknown> {
    const body: Record<string, unknown> = {};
    const rw = formValue(slug, 'returnWindowDays').trim();
    const wm = formValue(slug, 'warrantyMonths').trim();
    const rs = formValue(slug, 'reputationScore').trim();
    const rp = formValue(slug, 'returnPolicyUrl').trim();
    const wp = formValue(slug, 'warrantyPolicyUrl').trim();
    if (rw !== '') body.returnWindowDays = Number(rw);
    if (wm !== '') body.warrantyMonths = Number(wm);
    if (rs !== '') body.reputationScore = Number(rs);
    if (rp !== '') body.returnPolicyUrl = rp;
    if (wp !== '') body.warrantyPolicyUrl = wp;
    return body;
  }

  async function submit(slug: string, action: 'record' | 'verify' | 'revoke') {
    setBusy(`${slug}:${action}`);
    setMessages((prev) => {
      const next = { ...prev };
      delete next[slug];
      return next;
    });
    try {
      const res = await fetch(`/api/v1/admin/merchants/${encodeURIComponent(slug)}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...parseBody(slug) }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setMessages((prev) => ({
          ...prev,
          [slug]: {
            kind: 'error',
            text: json?.error?.message ?? 'Failed to update the merchant.',
          },
        }));
        return;
      }
      const result = json.data as VerifyResult;
      setSaved((prev) => ({ ...prev, [slug]: result.merchant }));
      setUnmet((prev) => ({ ...prev, [slug]: result.unmet ?? [] }));
      setMessages((prev) => ({
        ...prev,
        [slug]: {
          kind: result.verified || action === 'record' || action === 'revoke' ? 'ok' : 'error',
          text:
            result.note ??
            (result.verified
              ? 'Verified Merchant granted.'
              : action === 'revoke'
                ? 'Verified Merchant status removed.'
                : 'Saved.'),
        },
      }));
      if (action === 'verify' && result.verified) {
        setForms((prev) => ({ ...prev, [slug]: EMPTY_FORM }));
      }
    } catch {
      setMessages((prev) => ({
        ...prev,
        [slug]: { kind: 'error', text: 'Failed to update the merchant. Please try again.' },
      }));
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (role !== 'admin') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <h1 className="text-2xl font-bold">Access Denied</h1>
        <p className="text-muted-foreground">You need admin privileges to access this page.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
      <div className="container mx-auto max-w-7xl px-4 py-8">
        <div className="mb-8">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Store className="h-8 w-8 text-blue-600" />
            Verified Merchants
          </h1>
          <p className="mt-2 text-muted-foreground">
            Record a merchant&apos;s real policy facts, then grant the Verified Merchant badge only
            when the recorded data meets every public standard.
          </p>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">What &ldquo;Verified Merchant&rdquo; means (public text)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>{VERIFIED_MERCHANT_MEANING}</p>
            <p>{VERIFIED_MERCHANT_REMOVAL_POLICY}</p>
            <ul className="list-disc space-y-1 pl-5">
              {VERIFIED_MERCHANT_STANDARDS.map((s) => (
                <li key={s.key}>
                  <span className="font-medium text-foreground">{s.label} — </span>
                  {s.detail}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {loadError ? (
          <Card>
            <CardContent className="p-6">
              <p className="text-sm text-muted-foreground">{loadError}</p>
            </CardContent>
          </Card>
        ) : merchants.length === 0 ? (
          <Card>
            <CardContent className="p-6">
              <p className="text-sm text-muted-foreground">
                No merchants recorded yet. Merchants come from the catalog — nothing is invented
                here.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {merchants.map((merchant) => {
              const record = saved[merchant.slug] ?? merchant;
              const isVerified = record.is_verified_merchant === true;
              const msg = messages[merchant.slug];
              const unmetList = unmet[merchant.slug] ?? [];
              return (
                <Card key={merchant.slug}>
                  <CardHeader>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <CardTitle className="text-base">{merchant.name}</CardTitle>
                        <CardDescription>
                          {merchant.slug}
                          {merchant.websiteUrl ? ` · ${merchant.websiteUrl}` : ''}
                        </CardDescription>
                      </div>
                      {isVerified ? (
                        <span className="flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-3 py-1 text-xs font-medium text-green-700">
                          <ShieldCheck className="h-3 w-3" /> Verified
                          {record.merchant_verified_until
                            ? ` until ${new Date(record.merchant_verified_until).toLocaleDateString()}`
                            : ''}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground">
                          <ShieldX className="h-3 w-3" /> Not verified
                        </span>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Recorded:{' '}
                      {record.return_window_days != null
                        ? `${record.return_window_days} day return`
                        : 'return window not recorded'}
                      {' · '}
                      {record.warranty_months != null
                        ? `${record.warranty_months} month warranty`
                        : 'warranty not recorded'}
                      {' · '}
                      {record.reputation_score != null
                        ? `reputation ${record.reputation_score}/5`
                        : 'reputation not recorded'}
                      {' · '}
                      {record.return_policy_url || record.warranty_policy_url
                        ? 'policy URL on record'
                        : 'no policy URL on record'}
                      . Leave a field blank to keep what is already recorded (blank never
                      overwrites a recorded value).
                    </p>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                      <div className="space-y-2">
                        <label htmlFor={`rw-${merchant.slug}`} className="text-sm font-medium">
                          Return window (days)
                        </label>
                        <Input
                          id={`rw-${merchant.slug}`}
                          inputMode="numeric"
                          value={formValue(merchant.slug, 'returnWindowDays')}
                          onChange={(e) => setForm(merchant.slug, { returnWindowDays: e.target.value })}
                          placeholder="e.g. 30"
                        />
                      </div>
                      <div className="space-y-2">
                        <label htmlFor={`wm-${merchant.slug}`} className="text-sm font-medium">
                          Warranty (months)
                        </label>
                        <Input
                          id={`wm-${merchant.slug}`}
                          inputMode="numeric"
                          value={formValue(merchant.slug, 'warrantyMonths')}
                          onChange={(e) => setForm(merchant.slug, { warrantyMonths: e.target.value })}
                          placeholder="e.g. 12"
                        />
                      </div>
                      <div className="space-y-2">
                        <label htmlFor={`rs-${merchant.slug}`} className="text-sm font-medium">
                          Reputation (0–5)
                        </label>
                        <Input
                          id={`rs-${merchant.slug}`}
                          inputMode="decimal"
                          value={formValue(merchant.slug, 'reputationScore')}
                          onChange={(e) => setForm(merchant.slug, { reputationScore: e.target.value })}
                          placeholder="e.g. 4.5"
                        />
                      </div>
                      <div className="space-y-2">
                        <label htmlFor={`rp-${merchant.slug}`} className="text-sm font-medium">
                          Return policy URL
                        </label>
                        <Input
                          id={`rp-${merchant.slug}`}
                          inputMode="url"
                          value={formValue(merchant.slug, 'returnPolicyUrl')}
                          onChange={(e) => setForm(merchant.slug, { returnPolicyUrl: e.target.value })}
                          placeholder="https://…"
                        />
                      </div>
                      <div className="space-y-2">
                        <label htmlFor={`wp-${merchant.slug}`} className="text-sm font-medium">
                          Warranty policy URL
                        </label>
                        <Input
                          id={`wp-${merchant.slug}`}
                          inputMode="url"
                          value={formValue(merchant.slug, 'warrantyPolicyUrl')}
                          onChange={(e) => setForm(merchant.slug, { warrantyPolicyUrl: e.target.value })}
                          placeholder="https://…"
                        />
                      </div>
                    </div>
                    {msg && (
                      <p className={msg.kind === 'ok' ? 'text-sm text-green-700' : 'text-sm text-red-600'}>
                        {msg.text}
                      </p>
                    )}
                    {unmetList.length > 0 && (
                      <ul className="list-disc space-y-1 pl-5 text-sm text-red-600">
                        {unmetList.map((u) => (
                          <li key={u}>{u}</li>
                        ))}
                      </ul>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        className="min-h-[44px]"
                        disabled={busy !== null}
                        onClick={() => void submit(merchant.slug, 'record')}
                      >
                        {busy === `${merchant.slug}:record` ? 'Saving…' : 'Record facts'}
                      </Button>
                      <Button
                        className="min-h-[44px]"
                        disabled={busy !== null}
                        onClick={() => void submit(merchant.slug, 'verify')}
                      >
                        {busy === `${merchant.slug}:verify` ? 'Checking…' : 'Verify merchant'}
                      </Button>
                      {isVerified && (
                        <Button
                          variant="destructive"
                          className="min-h-[44px]"
                          disabled={busy !== null}
                          onClick={() => void submit(merchant.slug, 'revoke')}
                        >
                          {busy === `${merchant.slug}:revoke` ? 'Removing…' : 'Remove verification'}
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
