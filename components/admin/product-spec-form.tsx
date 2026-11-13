'use client';

/**
 * Admin spec verify/correct form (Section 21–25, Stage C — K12).
 *
 * One row per template key for the product's category: the stored
 * value (when one exists) in an editable input, the stored source
 * + verified stamp next to it, and an empty input for keys that
 * are still unknown. An empty input is never submitted as a value
 * — an unknown spec stays unknown. The admin can also tick a
 * stored spec for removal. Saving PATCHes
 * /api/v1/admin/products/[id]/specs with the changed entries,
 * the delete keys, and the source the values came from.
 */

import { useState } from 'react';

export interface SpecFormRow {
  key: string;
  label: string;
  value: string;
  unit: string | null;
  source: string | null;
  verifiedAt: string | null;
  verifiedBy: string | null;
}

export function ProductSpecForm({
  productId,
  rows,
  templateKeys,
}: {
  productId: string;
  rows: SpecFormRow[];
  templateKeys: string[];
}) {
  const storedByKey = new Map(rows.map((r) => [r.key, r]));
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.key, r.value]))
  );
  const [deleteKeys, setDeleteKeys] = useState<Set<string>>(new Set());
  const [source, setSource] = useState('manual-intake');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allKeys = [...new Set([...templateKeys, ...rows.map((r) => r.key)])];

  function setValue(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function toggleDelete(key: string) {
    setDeleteKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    setError(null);
    const entries = allKeys
      .filter((key) => !deleteKeys.has(key))
      .map((key) => {
        const stored = storedByKey.get(key);
        const value = (values[key] ?? '').trim();
        if (value === '') return null;
        if (stored && stored.value === value) return null;
        return { key, value, ...(stored?.unit ? { unit: stored.unit } : {}) };
      })
      .filter((entry): entry is { key: string; value: string; unit?: string } => entry !== null);
    try {
      const res = await fetch(`/api/v1/admin/products/${productId}/specs`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entries,
          deleteKeys: [...deleteKeys],
          source: source.trim() === '' ? undefined : source.trim(),
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        success?: boolean;
        error?: string;
        data?: { replacedKeys?: string[]; removedKeys?: string[] };
      } | null;
      if (!res.ok || !data?.success) {
        setError(data?.error ?? 'The specs could not be saved.');
        return;
      }
      const replaced = data.data?.replacedKeys ?? [];
      const removed = data.data?.removedKeys ?? [];
      setMessage(
        `Saved. Replaced: ${replaced.length > 0 ? replaced.join(', ') : 'none'}. Removed: ${removed.length > 0 ? removed.join(', ') : 'none'}.`
      );
      setDeleteKeys(new Set());
    } catch {
      setError('The specs could not be saved (network error).');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-6">
      <label className="block text-sm font-medium" htmlFor="spec-source">
        Source of these values
      </label>
      <input
        id="spec-source"
        className="mt-1 w-full max-w-md rounded border px-3 py-2 text-sm"
        value={source}
        onChange={(e) => setSource(e.target.value)}
        placeholder="manual-intake"
      />
      <p className="mt-1 text-sm text-muted-foreground">
        Where the values came from — e.g. manual-intake, or a
        manufacturer / retailer name. A named source stamps the
        spec verified; &apos;unknown&apos; never does.
      </p>

      {allKeys.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          This product&apos;s category has no spec template, so no spec
          keys can be validated. Specs cannot be recorded for it
          until a template exists for its category.
        </p>
      ) : (
        <ul className="mt-6 space-y-4">
          {allKeys.map((key) => {
            const stored = storedByKey.get(key);
            return (
              <li key={key} className="rounded-lg border p-4">
                <div className="flex items-center justify-between gap-4">
                  <label className="text-sm font-medium" htmlFor={`spec-${key}`}>
                    {key}
                    {stored?.unit ? ` (${stored.unit})` : ''}
                  </label>
                  {stored ? (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={deleteKeys.has(key)}
                        onChange={() => toggleDelete(key)}
                      />
                      Remove
                    </label>
                  ) : null}
                </div>
                <input
                  id={`spec-${key}`}
                  className="mt-2 w-full rounded border px-3 py-2 text-sm"
                  value={values[key] ?? ''}
                  disabled={deleteKeys.has(key)}
                  onChange={(e) => setValue(key, e.target.value)}
                  placeholder="Unknown — leave empty unless you have the real value"
                />
                {stored ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Stored from {stored.source ?? 'unattributed'}
                    {stored.verifiedAt ? ` · verified ${stored.verifiedAt}` : ' · never verified'}
                    {stored.verifiedBy ? ` by ${stored.verifiedBy}` : ''}
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">No value stored yet.</p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="mt-6 rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save spec changes'}
      </button>
      {message ? <p className="mt-3 text-sm text-green-700">{message}</p> : null}
      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
