'use client';

import { useState, useEffect, useCallback } from 'react';
import { Archive, Trash2, Plus, Receipt } from 'lucide-react';
import Image from 'next/image';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { useToast } from '@/hooks/use-toast';
import { warrantyStatus } from '@/services/vault';
import { nextReorderDate } from '@/lib/vault-reorder';

interface VaultItem {
  id: string;
  title: string;
  store: string | null;
  purchase_date: string;
  amount: number | null;
  currency: string;
  warranty_months: number;
  receipt_file_name: string | null;
  receipt_file_type: string | null;
  receipt_file_size: number | null;
  receipt_url: string | null;
  extracted_text: string | null;
  // Section 6, Item 3: reorder fields (migration 033). Null until
  // the owner runs it — the page treats missing fields as "not set".
  is_consumable: boolean | null;
  reorder_interval_days: number | null;
  reorder_reminder: boolean | null;
}

/**
 * Smart Warranty & Receipt Vault (Option 8, Feature 3).
 * HONESTY: no storage bucket is configured, so a chosen receipt file is
 * NEVER uploaded — only its metadata (name, type, size) is saved, plus an
 * optional user-pasted receipt URL. Automatic OCR is NOT available:
 * extracted_text is user-entered text only. Warranty "expiring soon"
 * badges are computed on view; no background/email warranty alerts exist.
 */
export default function VaultPage() {
  const { toast } = useToast();
  const [items, setItems] = useState<VaultItem[] | null>(null);
  const [vaultEnabled, setVaultEnabled] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState('');
  const [store, setStore] = useState('');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [warrantyMonths, setWarrantyMonths] = useState(12);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [receiptUrl, setReceiptUrl] = useState('');
  const [extractedText, setExtractedText] = useState('');
  // Section 6, Item 3: reorder fields for the add form.
  const [isConsumable, setIsConsumable] = useState(false);
  const [reorderIntervalDays, setReorderIntervalDays] = useState('');
  const [reorderReminder, setReorderReminder] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/vault');
      const data = await res.json();
      setItems(Array.isArray(data?.data) ? data.data : []);
      setVaultEnabled(data?.meta?.vaultEnabled !== false);
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, []);

  const onFileChange = (f: File | null) => {
    setReceiptFile(f);
    if (receiptPreview) URL.revokeObjectURL(receiptPreview);
    setReceiptPreview(f && f.type.startsWith('image/') ? URL.createObjectURL(f) : null);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/v1/vault', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          store,
          purchaseDate,
          amount: amount === '' ? null : Number(amount),
          currency,
          warrantyMonths,
          isConsumable,
          reorderIntervalDays:
            isConsumable && reorderIntervalDays !== '' ? Number(reorderIntervalDays) : null,
          reorderReminder,
          receiptFileName: receiptFile ? receiptFile.name : null,
          receiptFileType: receiptFile ? receiptFile.type : null,
          receiptFileSize: receiptFile ? receiptFile.size : null,
          receiptUrl,
          extractedText,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: (data?.error?.message as string) ?? 'Could not save item', variant: 'destructive' });
      } else {
        toast({ title: 'Vault item saved' });
        setShowForm(false);
        setTitle(''); setStore(''); setPurchaseDate(''); setAmount('');
        setWarrantyMonths(12); onFileChange(null); setReceiptUrl(''); setExtractedText('');
        setIsConsumable(false); setReorderIntervalDays(''); setReorderReminder(false);
        load();
      }
    } catch {
      toast({ title: 'Could not save item', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    const res = await fetch(`/api/v1/vault/${id}`, { method: 'DELETE' });
    if (res.ok) load();
  };

  if (!vaultEnabled) {
    return (
      <div className="space-y-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Archive className="h-7 w-7" /> Receipt Vault
        </h1>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              The Receipt Vault is not live yet — the owner still needs to run
              supabase/add-receipt-vault.sql.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Archive className="h-7 w-7" /> Receipt Vault
          </h1>
          <p className="mt-1 text-muted-foreground">
            Save purchases, track warranty expiry, and keep receipt details in one place.
          </p>
        </div>
        <Button onClick={() => setShowForm(!showForm)}>
          <Plus className="mr-2 h-4 w-4" /> Add item
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add a purchase</CardTitle>
            <CardDescription>
              Receipt files are not uploaded: no storage bucket is configured, so only the file
              name, type, and size are saved (plus an optional receipt link you paste). Automatic
              OCR is not available — the extracted-text field below is text you enter yourself.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={save} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label className="mb-1.5 block">Title *</Label>
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. MacBook Air 13" required />
                </div>
                <div>
                  <Label className="mb-1.5 block">Store</Label>
                  <Input value={store} onChange={(e) => setStore(e.target.value)} placeholder="e.g. Amazon" />
                </div>
                <div>
                  <Label className="mb-1.5 block">Purchase date *</Label>
                  <Input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} required />
                </div>
                <div>
                  <Label className="mb-1.5 block">Warranty (months)</Label>
                  <Input type="number" min={0} value={warrantyMonths} onChange={(e) => setWarrantyMonths(Number(e.target.value))} />
                </div>
                <div>
                  <Label className="mb-1.5 block">Amount</Label>
                  <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 999.00" />
                </div>
                <div>
                  <Label className="mb-1.5 block">Currency</Label>
                  <Input value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="USD" />
                </div>
              </div>
              <div className="rounded-md border p-3">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={isConsumable} onChange={(e) => setIsConsumable(e.target.checked)} />
                  Consumable — I reorder this regularly
                </label>
                {isConsumable && (
                  <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label className="mb-1.5 block">Reorder every (days)</Label>
                      <Input
                        type="number"
                        min={1}
                        max={3650}
                        value={reorderIntervalDays}
                        onChange={(e) => setReorderIntervalDays(e.target.value)}
                        placeholder="e.g. 30"
                      />
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={reorderReminder} onChange={(e) => setReorderReminder(e.target.checked)} />
                      Remind me when a reorder is due
                    </label>
                  </div>
                )}
                <p className="mt-2 text-xs text-muted-foreground">
                  SmartBuy never orders anything for you — this only shows the next reorder date,
                  derived from the purchase date plus the interval you enter.
                </p>
              </div>
              <div>
                <Label className="mb-1.5 block">Receipt file (metadata only — not uploaded)</Label>
                <Input
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
                />
                {receiptFile && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {receiptFile.name} · {receiptFile.type || 'unknown type'} ·{' '}
                    {(receiptFile.size / 1024).toFixed(1)} KB — metadata saved only, file not uploaded.
                  </p>
                )}
                {receiptPreview && (
<Image src={receiptPreview} alt="Receipt preview" width={640} height={480} unoptimized className="mt-2 max-h-48 w-auto rounded border" />
                )}
              </div>
              <div>
                <Label className="mb-1.5 block">Receipt link (optional)</Label>
                <Input value={receiptUrl} onChange={(e) => setReceiptUrl(e.target.value)} placeholder="https://…" />
              </div>
              <div>
                <Label className="mb-1.5 block">Receipt text (paste it yourself — no automatic OCR)</Label>
                <textarea
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  rows={3}
                  aria-label="Receipt text"
                  value={extractedText}
                  onChange={(e) => setExtractedText(e.target.value)}
                  placeholder="Paste receipt text here if you want it stored with this item."
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={saving}>{saving ? <LoadingSpinner size="sm" /> : 'Save item'}</Button>
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {items === null ? (
        <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              No vault items yet. Add your first purchase above — warranty expiry is computed from
              the purchase date plus the warranty months you enter.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => {
            const w = warrantyStatus(item.purchase_date, item.warranty_months);
            // Section 6, Item 3: next reorder derived on view — never stored.
            const reorder = nextReorderDate(
              item.purchase_date,
              item.reorder_interval_days,
              item.is_consumable
            );
            return (
              <Card key={item.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{item.title}</CardTitle>
                    <Badge
                      variant={
                        w.status === 'expired'
                          ? 'destructive'
                          : w.status === 'expiring-soon'
                            ? 'default'
                            : 'secondary'
                      }
                    >
                      {w.status === 'expired'
                        ? 'Warranty expired'
                        : w.status === 'expiring-soon'
                          ? `Expiring soon (${w.daysLeft} days left)`
                          : w.status === 'active'
                            ? `${w.daysLeft} days left`
                            : 'Warranty unknown'}
                    </Badge>
                  </div>
                  <CardDescription>
                    {item.store ? `${item.store} · ` : ''}Purchased {item.purchase_date}
                    {item.amount !== null && ` · ${item.currency} ${Number(item.amount).toFixed(2)}`}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-muted-foreground">
                  <p>
                    Warranty: {item.warranty_months} months
                    {w.expiry ? ` · expires ${w.expiry.toISOString().slice(0, 10)}` : ''}
                  </p>
                  {reorder ? (
                    <p>
                      Next reorder: {reorder.date}
                      {reorder.daysUntil === 0
                        ? ' — due today'
                        : ` — in ${reorder.daysUntil} day${reorder.daysUntil === 1 ? '' : 's'}`}
                      {item.reorder_reminder ? ' · reminder on' : ''}
                    </p>
                  ) : item.is_consumable ? (
                    <p>Consumable — set a reorder interval to track the next reorder.</p>
                  ) : null}
                  {item.receipt_file_name && (
                    <p className="flex items-center gap-1">
                      <Receipt className="h-4 w-4" /> {item.receipt_file_name} (metadata only)
                    </p>
                  )}
                  {item.receipt_url && (
                    <p>
                      <a href={item.receipt_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                        Receipt link
                      </a>
                    </p>
                  )}
                  <VaultReorderEditor item={item} onSaved={load} />
                  <Button size="sm" variant="ghost" onClick={() => remove(item.id)}>
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Note: expiring-soon badges are computed when you open this page. No background or email
        warranty alerts are sent — that is future work.
      </p>
    </div>
  );
}

/**
 * Inline reorder settings for one vault item (Section 6, Item 3).
 * PATCHes /api/v1/vault/[id] — nothing is auto-ordered; the fields
 * only drive the derived next-reorder date above.
 */
function VaultReorderEditor({ item, onSaved }: { item: VaultItem; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [isConsumable, setIsConsumable] = useState(item.is_consumable ?? false);
  const [intervalDays, setIntervalDays] = useState(
    item.reorder_interval_days ? String(item.reorder_interval_days) : ''
  );
  const [reminder, setReminder] = useState(item.reorder_reminder ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/vault/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isConsumable,
          reorderIntervalDays: isConsumable && intervalDays !== '' ? Number(intervalDays) : null,
          reorderReminder: reminder,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError((data?.error?.message as string) ?? 'Could not save reorder settings');
        return;
      }
      setOpen(false);
      onSaved();
    } catch {
      setError('Could not save reorder settings');
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Reorder settings
      </Button>
    );
  }

  return (
    <div className="space-y-2 rounded-md border p-3">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={isConsumable}
          onChange={(e) => setIsConsumable(e.target.checked)}
        />
        Consumable — I reorder this regularly
      </label>
      {isConsumable && (
        <>
          <div>
            <Label className="mb-1.5 block">Reorder every (days)</Label>
            <Input
              type="number"
              min={1}
              max={3650}
              value={intervalDays}
              onChange={(e) => setIntervalDays(e.target.value)}
              placeholder="e.g. 30"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={reminder} onChange={(e) => setReminder(e.target.checked)} />
            Remind me when a reorder is due
          </label>
        </>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
