/**
 * AI Warranty Claim Helper — /tools/warranty-claims (Section 7, item 9).
 *
 * Client page: fetches GET /api/v1/tools/warranty-claims. Each Receipt
 * Vault item shows its claim checklist (documents, retailer/brand
 * contact, steps) and its derived warranty expiry + reminder. A claim
 * tracked here is a user record only — SmartBuy never files the claim
 * with the retailer, and no refund, repair or replacement is promised.
 * Retailer contact is shown only when recorded in the store
 * directory (a website URL); otherwise the page says "retailer ki
 * website par warranty section dekhein".
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
import type {
  ClaimStatus,
  VaultClaimItem,
  WarrantyClaimView,
} from '@/lib/warranty-claim-helper';

interface WarrantyClaimsResponse {
  claims: WarrantyClaimView[];
  vaultItems: VaultClaimItem[];
  claimsEnabled?: boolean;
  vaultEnabled?: boolean;
}

const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  submitted: 'Submitted',
  resolved: 'Resolved',
  denied: 'Denied',
};

export default function WarrantyClaimsPage() {
  const [claims, setClaims] = useState<WarrantyClaimView[]>([]);
  const [vaultItems, setVaultItems] = useState<VaultClaimItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [unauthorized, setUnauthorized] = useState(false);
  const [claimsEnabled, setClaimsEnabled] = useState(true);
  const [vaultEnabled, setVaultEnabled] = useState(true);
  const [selectedVaultId, setSelectedVaultId] = useState('');
  const [status, setStatus] = useState<ClaimStatus>('not_started');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    setUnauthorized(false);
    try {
      const res = await fetch('/api/v1/tools/warranty-claims');
      const json = await res.json().catch(() => null);
      if (res.status === 401) {
        setUnauthorized(true);
      } else if (res.ok && json?.success) {
        const data = json.data as WarrantyClaimsResponse;
        setClaims(Array.isArray(data.claims) ? data.claims : []);
        setVaultItems(Array.isArray(data.vaultItems) ? data.vaultItems : []);
        setClaimsEnabled(json.meta?.claimsEnabled !== false);
        setVaultEnabled(json.meta?.vaultEnabled !== false);
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

  async function trackClaim(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedVaultId) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/v1/tools/warranty-claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vaultItemId: selectedVaultId, claimStatus: status, notes }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) {
        setMessage(
          json.data?.deduped
            ? 'Claim updated — the existing claim for this item was updated, not duplicated.'
            : 'Claim tracked.'
        );
        setNotes('');
        await load();
      } else {
        setMessage(json?.error?.message ?? 'Could not track the claim. Try again later.');
      }
    } catch {
      setMessage('Could not track the claim. Try again later.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <h1 className="text-2xl font-bold">AI Warranty Claim Helper</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your Receipt Vault items, each with a claim checklist — the
          documents to gather, the retailer or brand contact, and the
          steps — plus a reminder before the warranty expires. Tracking a
          claim here only records it for you: SmartBuy never files the
          claim with the retailer, and no refund, repair or replacement
          is promised.
        </p>

        {!claimsEnabled && (
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            Warranty claims are not live yet — the owner still needs to run
            the Section 7 migration (warranty_claims table) once.
          </p>
        )}
        {!vaultEnabled && (
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            The Receipt Vault is not set up yet, so there are no purchases
            to build a checklist from.
          </p>
        )}

        {loading ? (
          <div className="mt-6">
            <LoadingSpinner />
          </div>
        ) : unauthorized ? (
          <div className="mt-6">
            <EmptyState
              title="Sign in to use the warranty claim helper"
              description="Your vault items and claims are private to your account."
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
              title="Warranty claims could not be loaded"
              description="Try again later. Nothing is shown rather than guessed checklists."
            />
          </div>
        ) : (
          <>
            {claims.length > 0 && (
              <section className="mt-6">
                <h2 className="text-lg font-semibold">Tracked claims</h2>
                <div className="mt-3 space-y-3">
                  {claims.map((claim) => (
                    <article key={claim.id} className="rounded-lg border p-4">
                      <p className="font-medium">
                        {claim.vaultTitle ?? claim.product_slug ?? 'Claim'}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Status: {CLAIM_STATUS_LABELS[(claim.claim_status as ClaimStatus) ?? 'not_started'] ?? claim.claim_status}
                        {claim.retailer ? ` · Retailer: ${claim.retailer}` : ''}
                        {claim.purchaseDate ? ` · Purchased ${claim.purchaseDate.slice(0, 10)}` : ''}
                      </p>
                      {claim.notes ? <p className="mt-1 text-sm">{claim.notes}</p> : null}
                    </article>
                  ))}
                </div>
              </section>
            )}

            <section className="mt-8">
              <h2 className="text-lg font-semibold">Your purchases — claim checklists</h2>
              {vaultItems.length === 0 ? (
                <div className="mt-3">
                  <EmptyState
                    title="No vault purchases yet"
                    description="Add a purchase to the Receipt Vault first — the claim checklist is built from its recorded purchase date and warranty months."
                  />
                </div>
              ) : (
                <div className="mt-3 space-y-4">
                  {vaultItems.map((item) => (
                    <article key={item.id} className="rounded-lg border p-4">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <h3 className="font-medium">{item.title}</h3>
                        <span className="text-sm text-muted-foreground">
                          {item.checklist.warrantyState === 'no_warranty'
                            ? 'No warranty recorded'
                            : item.checklist.expiryDate
                              ? `Warranty until ${item.checklist.expiryDate} (${item.checklist.daysUntilExpiry} days)`
                              : ''}
                        </span>
                      </div>
                      {item.checklist.reminder ? (
                        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                          {item.checklist.reminder}
                        </p>
                      ) : null}
                      <h4 className="mt-3 text-sm font-semibold">Documents</h4>
                      <ul className="mt-1 space-y-1 text-sm">
                        {item.checklist.documents.map((doc) => (
                          <li key={doc.key}>
                            {doc.present ? '✓' : '○'} <span className="font-medium">{doc.label}:</span>{' '}
                            <span className="text-muted-foreground">{doc.detail}</span>
                          </li>
                        ))}
                      </ul>
                      <h4 className="mt-3 text-sm font-semibold">Steps</h4>
                      <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                        {item.checklist.steps.map((step, i) => (
                          <li key={i}>
                            {step}
                            {step.startsWith('Contact ') && item.checklist.retailerContact ? (
                              <>
                                {' '}
                                <a
                                  href={item.checklist.retailerContact.websiteUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="underline"
                                >
                                  {item.checklist.retailerContact.websiteUrl}
                                </a>
                              </>
                            ) : null}
                          </li>
                        ))}
                      </ol>
                      {!item.checklist.retailerContact && item.store ? (
                        <p className="mt-2 text-sm text-muted-foreground">
                          Retailer ki website par warranty section dekhein —
                          SmartBuy ke paas is retailer ka recorded contact
                          nahi hai.
                        </p>
                      ) : null}
                    </article>
                  ))}
                </div>
              )}
            </section>

            {vaultItems.length > 0 && (
              <section className="mt-8 rounded-lg border p-4">
                <h2 className="text-lg font-semibold">Track a claim</h2>
                <form className="mt-4 space-y-3" onSubmit={trackClaim}>
                  <div className="space-y-2">
                    <Label htmlFor="wcVaultItem">Purchase</Label>
                    <select
                      id="wcVaultItem"
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                      value={selectedVaultId}
                      onChange={(e) => setSelectedVaultId(e.target.value)}
                      required
                    >
                      <option value="">Choose a purchase…</option>
                      {vaultItems.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.title} — {item.purchase_date.slice(0, 10)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="wcStatus">Claim status</Label>
                    <select
                      id="wcStatus"
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                      value={status}
                      onChange={(e) => setStatus(e.target.value as ClaimStatus)}
                    >
                      {(Object.keys(CLAIM_STATUS_LABELS) as ClaimStatus[]).map((s) => (
                        <option key={s} value={s}>
                          {CLAIM_STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="wcNotes">Notes (optional)</Label>
                    <Input
                      id="wcNotes"
                      placeholder="e.g. Claim reference number from the retailer"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                    />
                  </div>
                  <Button type="submit" disabled={saving || !selectedVaultId}>
                    {saving ? 'Saving…' : 'Track claim'}
                  </Button>
                  {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
                </form>
              </section>
            )}
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
