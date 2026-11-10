/**
 * Agent memory settings (S5#1 — personal AI shopping agent).
 *
 * Permission-gated: memory exists ONLY when the user turns it on.
 * The toggle, the preferences, and the delete button are the whole
 * contract — nothing is inferred, and turning memory off deletes
 * the stored record (server row, or the device copy for guests).
 *
 * Signed-in users use /api/v1/agent/memory; guests use the
 * device-only localStorage copy (lib/agent-memory.ts) with an
 * honest "this device only" note on every render.
 *
 * Wiring into the dashboard / settings page is wave 2 — this
 * component is ready to mount there.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AGENT_CATEGORIES,
  applyPreferencesUpdate,
  clearGuestMemory,
  loadGuestMemory,
  saveGuestMemory,
  validatePreferences,
  type AgentMemory,
  type GuestMemory,
} from '@/lib/agent-memory';

interface MemoryResponse {
  success: boolean;
  data?: { memory: AgentMemory | null; setupRequired?: boolean };
  error?: { message?: string };
}

async function fetchMemory(): Promise<MemoryResponse> {
  const res = await fetch('/api/v1/agent/memory');
  return (await res.json().catch(() => null)) as MemoryResponse;
}

export function AgentMemorySettings({ signedIn }: { signedIn: boolean }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [memory, setMemory] = useState<AgentMemory | GuestMemory | null>(null);
  const [budget, setBudget] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [brands, setBrands] = useState('');
  const [lightweightOnly, setLightweightOnly] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const memoryOn = memory !== null && memory.consentGrantedAt !== null;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!signedIn) {
      setMemory(loadGuestMemory());
      setLoading(false);
      return;
    }
    try {
      const result = await fetchMemory();
      if (!result.success) {
        setError(result.error?.message ?? 'Could not load agent memory.');
        setLoading(false);
        return;
      }
      setSetupRequired(result.data?.setupRequired === true);
      setMemory(result.data?.memory ?? null);
    } catch {
      setError('Could not load agent memory.');
    } finally {
      setLoading(false);
    }
  }, [signedIn]);

  useEffect(() => {
    void load();
  }, [load]);

  // Keep the form in sync with the loaded memory.
  useEffect(() => {
    if (!memory) {
      setBudget('');
      setCategories([]);
      setBrands('');
      setLightweightOnly(false);
      return;
    }
    setBudget(
      memory.preferences.maxBudgetUsd !== undefined && memory.preferences.maxBudgetUsd !== null
        ? String(memory.preferences.maxBudgetUsd)
        : ''
    );
    setCategories(memory.preferences.categories ?? []);
    setBrands((memory.preferences.preferredBrands ?? []).join(', '));
    setLightweightOnly(memory.preferences.lightweightOnly === true);
  }, [memory]);

  async function save(next: { consent: boolean }) {
    const prefs = applyPreferencesUpdate(memory?.preferences ?? {}, {
      maxBudgetUsd: budget.trim() === '' ? null : Number(budget),
      categories,
      preferredBrands: brands.split(',').map((b) => b.trim()).filter((b) => b !== ''),
      lightweightOnly,
    });
    const validation = validatePreferences(prefs);
    if (!validation.ok) {
      setError(validation.errors.join(' '));
      return;
    }
    setSaving(true);
    setError(null);
    if (!signedIn) {
      const guest: GuestMemory = {
        preferences: prefs,
        seenProductSlugs: memory?.seenProductSlugs ?? [],
        consentGrantedAt: next.consent ? (memory?.consentGrantedAt ?? new Date().toISOString()) : null,
      };
      if (!next.consent) {
        clearGuestMemory();
        setMemory(null);
      } else if (saveGuestMemory(guest)) {
        setMemory(guest);
      } else {
        setError('Could not save on this device — storage is unavailable.');
      }
      setSaving(false);
      return;
    }
    try {
      const res = await fetch('/api/v1/agent/memory', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consent: next.consent, preferences: prefs }),
      });
      const result = (await res.json().catch(() => null)) as MemoryResponse;
      if (!res.ok || !result.success) {
        setError(result.error?.message ?? 'Could not save agent memory.');
        return;
      }
      setMemory(result.data?.memory ?? null);
    } catch {
      setError('Could not save agent memory.');
    } finally {
      setSaving(false);
    }
  }

  async function turnOff() {
    setSaving(true);
    setError(null);
    if (!signedIn) {
      clearGuestMemory();
      setMemory(null);
      setSaving(false);
      return;
    }
    try {
      const res = await fetch('/api/v1/agent/memory', { method: 'DELETE' });
      const result = (await res.json().catch(() => null)) as MemoryResponse;
      if (!res.ok || !result.success) {
        setError(result.error?.message ?? 'Could not delete agent memory.');
        return;
      }
      setMemory(null);
    } catch {
      setError('Could not delete agent memory.');
    } finally {
      setSaving(false);
    }
  }

  async function clearSeen() {
    if (!memory) return;
    setSaving(true);
    setError(null);
    if (!signedIn) {
      const guest: GuestMemory = { ...memory, seenProductSlugs: [] };
      if (saveGuestMemory(guest)) setMemory(guest);
      setSaving(false);
      return;
    }
    try {
      const res = await fetch('/api/v1/agent/memory', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consent: true, clearSeen: true }),
      });
      const result = (await res.json().catch(() => null)) as MemoryResponse;
      if (!res.ok || !result.success) {
        setError(result.error?.message ?? 'Could not clear seen products.');
        return;
      }
      setMemory(result.data?.memory ?? null);
    } catch {
      setError('Could not clear seen products.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-slate-500">Loading agent memory…</p>;
  }

  return (
    <section aria-label="AI shopping agent memory" className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <div>
        <h3 className="text-base font-semibold">AI shopping agent — memory</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          When memory is on, the assistant remembers your budget and preferences so you do not
          have to repeat them — and it can watch prices for you. Memory is yours: turn it off
          any time, or delete it entirely.
        </p>
        {!signedIn && (
          <p className="mt-1 text-sm font-medium text-amber-700 dark:text-amber-400">
            You are not signed in — memory is saved on this device only, and it never syncs or
            sends notifications. Sign in to sync it and get email/push alerts.
          </p>
        )}
        {setupRequired && (
          <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
            Agent memory is not set up yet on the server — ask the site owner to run migration 027.
          </p>
        )}
      </div>

      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={memoryOn}
          disabled={saving}
          onChange={(e) => {
            if (e.target.checked) void save({ consent: true });
            else void turnOff();
          }}
        />
        Remember my shopping preferences
      </label>

      {memoryOn && (
        <>
          <label className="block text-sm">
            <span className="font-medium">Budget (USD) — optional</span>
            <input
              type="number"
              min="1"
              step="1"
              inputMode="decimal"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder="e.g. 800"
              className="mt-1 block w-full max-w-xs rounded-md border border-slate-300 px-2 py-1.5 dark:border-slate-600 dark:bg-slate-800"
            />
          </label>

          <fieldset>
            <legend className="text-sm font-medium">Categories you are interested in</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {AGENT_CATEGORIES.map((c) => (
                <label key={c} className="flex items-center gap-1 rounded-full border border-slate-300 px-2.5 py-1 text-xs dark:border-slate-600">
                  <input
                    type="checkbox"
                    checked={categories.includes(c)}
                    onChange={(e) =>
                      setCategories((prev) =>
                        e.target.checked ? [...prev, c] : prev.filter((x) => x !== c)
                      )
                    }
                  />
                  {c}
                </label>
              ))}
            </div>
          </fieldset>

          <label className="block text-sm">
            <span className="font-medium">Preferred brands — optional, comma separated</span>
            <input
              type="text"
              value={brands}
              onChange={(e) => setBrands(e.target.value)}
              placeholder="e.g. Apple, Samsung"
              className="mt-1 block w-full max-w-xs rounded-md border border-slate-300 px-2 py-1.5 dark:border-slate-600 dark:bg-slate-800"
            />
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={lightweightOnly}
              onChange={(e) => setLightweightOnly(e.target.checked)}
            />
            I prefer lightweight products
          </label>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void save({ consent: true })}
              disabled={saving}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save preferences'}
            </button>
            <button
              type="button"
              onClick={() => {
                if (confirmDelete) {
                  setConfirmDelete(false);
                  void turnOff();
                } else {
                  setConfirmDelete(true);
                }
              }}
              disabled={saving}
              className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:hover:bg-red-950"
            >
              {confirmDelete ? 'Click again to delete my memory' : 'Delete my memory'}
            </button>
          </div>

          <div>
            <h4 className="text-sm font-medium">
              Products you have viewed ({memory.seenProductSlugs.length})
            </h4>
            {memory.seenProductSlugs.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                No products viewed yet — products you open will appear here once memory is on.
              </p>
            ) : (
              <>
                <ul className="mt-1 space-y-1 text-sm">
                  {memory.seenProductSlugs.map((slug) => (
                    <li key={slug}>
                      <Link href={`/products/${slug}`} className="text-blue-600 hover:underline dark:text-blue-400">
                        {slug}
                      </Link>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => void clearSeen()}
                  disabled={saving}
                  className="mt-2 text-sm text-slate-500 underline hover:text-slate-700 disabled:opacity-50 dark:text-slate-400"
                >
                  Clear viewed products
                </button>
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}

export default AgentMemorySettings;
