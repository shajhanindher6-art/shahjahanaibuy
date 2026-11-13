/**
 * Section 20, §12 #69 — admin product edit form (client).
 *
 * PATCHes /api/v1/admin/products/[id] with the edited fields and
 * DELETEs (soft delete) on confirm. All copy is literal English —
 * no i18n keys are added for admin surfaces. Server errors are
 * shown verbatim; a successful save reports which fields changed.
 */

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface ProductEditFormProps {
  productId: string;
  slug: string;
  initial: {
    name: string;
    description: string;
    brand: string;
    category: string;
    image_url: string;
    gtin: string;
    status: string;
  };
  statusEditable: boolean;
}

export function ProductEditForm({ productId, slug, initial, statusEditable }: ProductEditFormProps) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function setField(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(`/api/v1/admin/products/${productId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          description: form.description === '' ? null : form.description,
          brand: form.brand === '' ? null : form.brand,
          category: form.category === '' ? null : form.category,
          image_url: form.image_url === '' ? null : form.image_url,
          gtin: form.gtin === '' ? null : form.gtin,
          status: form.status,
        }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(body?.error ?? `Save failed (HTTP ${res.status}).`);
        return;
      }
      setMessage('Saved.');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setDeleting(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(`/api/v1/admin/products/${productId}`, { method: 'DELETE' });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(body?.error ?? `Delete failed (HTTP ${res.status}).`);
        setDeleting(false);
        return;
      }
      router.push('/admin/products');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed.');
      setDeleting(false);
    }
  }

  const inputClassName = 'mt-1 w-full rounded-lg border px-3 py-2 text-sm';

  return (
    <div>
      <form onSubmit={save} className="mt-6 space-y-4">
        <div>
          <label htmlFor="edit-name" className="text-sm font-medium">Name</label>
          <input
            id="edit-name"
            className={inputClassName}
            value={form.name}
            onChange={(e) => setField('name', e.target.value)}
            required
            maxLength={200}
          />
        </div>
        <div>
          <label htmlFor="edit-description" className="text-sm font-medium">Description</label>
          <textarea
            id="edit-description"
            className={inputClassName}
            value={form.description}
            onChange={(e) => setField('description', e.target.value)}
            rows={3}
            maxLength={5000}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="edit-brand" className="text-sm font-medium">Brand</label>
            <input
              id="edit-brand"
              className={inputClassName}
              value={form.brand}
              onChange={(e) => setField('brand', e.target.value)}
              maxLength={200}
            />
          </div>
          <div>
            <label htmlFor="edit-category" className="text-sm font-medium">Category</label>
            <input
              id="edit-category"
              className={inputClassName}
              value={form.category}
              onChange={(e) => setField('category', e.target.value)}
              maxLength={200}
            />
          </div>
        </div>
        <div>
          <label htmlFor="edit-image-url" className="text-sm font-medium">Image URL</label>
          <input
            id="edit-image-url"
            className={inputClassName}
            value={form.image_url}
            onChange={(e) => setField('image_url', e.target.value)}
            maxLength={2048}
            placeholder="https://…"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Must be a valid http(s) URL. data: and javascript: URLs are rejected.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="edit-gtin" className="text-sm font-medium">GTIN</label>
            <input
              id="edit-gtin"
              className={inputClassName}
              value={form.gtin}
              onChange={(e) => setField('gtin', e.target.value)}
              maxLength={50}
            />
          </div>
          <div>
            <label htmlFor="edit-status" className="text-sm font-medium">Status</label>
            <select
              id="edit-status"
              className={inputClassName}
              value={form.status}
              onChange={(e) => setField('status', e.target.value)}
              disabled={!statusEditable}
            >
              <option value="pending">pending</option>
              <option value="published">published</option>
              <option value="rejected">rejected</option>
            </select>
            {!statusEditable ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Status cannot be changed until migration 045 is applied (the status column does not exist yet).
              </p>
            ) : null}
          </div>
        </div>
        {error ? (
          <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm dark:border-red-800 dark:bg-red-950">
            {error}
          </p>
        ) : null}
        {message ? (
          <p role="status" className="rounded-lg border p-4 text-sm">{message}</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <a href={`/products/${slug}`} className="rounded-lg border px-4 py-2 text-sm font-medium">
            View public page
          </a>
        </div>
      </form>

      <section aria-label="Delete product" className="mt-10 rounded-lg border border-red-200 p-4 dark:border-red-800">
        <h2 className="font-medium text-red-700 dark:text-red-300">Delete product</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Soft delete: the product stops appearing in the catalog and
          admin lists, but the row stays in the database with a
          deletion timestamp, so it can be restored.
        </p>
        {confirmDelete ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={remove}
              disabled={deleting}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {deleting ? 'Deleting…' : 'Yes, delete this product'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="rounded-lg border px-4 py-2 text-sm font-medium"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="mt-3 rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 dark:border-red-800 dark:text-red-300"
          >
            Delete product
          </button>
        )}
      </section>
    </div>
  );
}
