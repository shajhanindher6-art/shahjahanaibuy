/**
 * Saved Searches (Section 15, C2).
 *
 * The search page already URL-syncs everything, so saving a search
 * is persisting its query string + a name. This component:
 *  - lists the signed-in user's saved searches (GET
 *    /api/v1/saved-searches), each a re-run link to /search?<query>
 *    with a delete button;
 *  - when `currentQueryString` is non-empty (the search page passes
 *    the live URL query string), offers a name + "Save search"
 *    form for the current search.
 *
 * On the dashboard it renders list-only (no current search to
 * save). Guests see a "sign in to save searches" note on the
 * search page and nothing on the dashboard (the fetch 401s, and
 * an empty list is not a section worth showing). A failed fetch
 * hides the list; an empty list shows the honest empty state —
 * never an invented saved search.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Bookmark, Search, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { buildSavedSearchUrl } from '@/services/saved-searches';

export interface SavedSearchView {
  id: string;
  name: string;
  query: string;
  createdAt: string;
}

interface SavedSearchesProps {
  /**
   * The current search's query string (e.g. "q=laptop&sort=price-asc").
   * When provided and non-empty, the save form renders. Omit on the
   * dashboard, where there is no current search to save.
   */
  currentQueryString?: string;
}

export function SavedSearches({ currentQueryString }: SavedSearchesProps) {
  const [saved, setSaved] = useState<SavedSearchView[]>([]);
  const [loading, setLoading] = useState(true);
  /** null = signed in (or unknown yet); 'guest' = the API said 401;
      'unavailable' = the API said 503 (migration 039 unapplied);
      'failed' = any other failure. */
  const [status, setStatus] = useState<'ok' | 'guest' | 'unavailable' | 'failed'>('ok');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveDone, setSaveDone] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/saved-searches');
      if (res.status === 401) {
        setStatus('guest');
        setSaved([]);
      } else if (res.status === 503) {
        setStatus('unavailable');
        setSaved([]);
      } else if (!res.ok) {
        setStatus('failed');
        setSaved([]);
      } else {
        const data = await res.json();
        setStatus('ok');
        setSaved(Array.isArray(data?.data) ? (data.data as SavedSearchView[]) : []);
      }
    } catch {
      setStatus('failed');
      setSaved([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // A new search resets the "Saved" confirmation for the save form.
  useEffect(() => {
    setSaveDone(false);
    setSaveError(null);
  }, [currentQueryString]);

  const canSave = Boolean(currentQueryString && currentQueryString.trim() !== '');

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave || saving) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      setSaveError('Give this search a name first.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    setSaveDone(false);
    try {
      const res = await fetch('/api/v1/saved-searches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName, query: currentQueryString }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (res.status === 401) {
          setSaveError('Sign in to save searches.');
        } else if (res.status === 503) {
          setSaveError('Saved searches are not available yet.');
        } else if (res.status === 409) {
          setSaveError(
            typeof data?.error === 'string' && data.error
              ? data.error
              : 'A saved search with this name already exists.'
          );
        } else {
          setSaveError('Could not save this search. Try again.');
        }
        return;
      }
      setName('');
      setSaveDone(true);
      await load();
    } catch {
      setSaveError('Could not save this search. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (deletingId) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/v1/saved-searches?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setSaved((prev) => prev.filter((s) => s.id !== id));
      }
    } catch {
      // The row stays listed; the next load re-reads the truth.
    } finally {
      setDeletingId(null);
    }
  };

  // Guests on the dashboard: no section at all. Guests on the
  // search page: the save hint below (canSave) still explains
  // that saving needs a sign-in.
  if (status === 'guest' && !canSave) return null;
  // A failed fetch hides the section rather than showing a
  // misleading empty state.
  if (status === 'failed') return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Bookmark className="h-4 w-4" /> Saved searches
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {canSave && (
          <form onSubmit={handleSave} className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name this search (e.g. Laptops under $1000)"
                aria-label="Name for this saved search"
                maxLength={100}
                className="min-w-[200px] flex-1"
              />
              <Button type="submit" disabled={saving || !name.trim()} className="min-h-[44px]">
                {saving ? <LoadingSpinner size="sm" /> : 'Save search'}
              </Button>
            </div>
            {status === 'guest' && (
              <p className="text-sm text-muted-foreground">
                <Link href="/sign-in" className="font-medium underline">
                  Sign in
                </Link>{' '}
                to save this search and find it again from your dashboard.
              </p>
            )}
            {status === 'unavailable' && (
              <p className="text-sm text-muted-foreground">
                Saved searches are not available yet — this search is not saved.
              </p>
            )}
            {saveError && <p className="text-sm text-red-600 dark:text-red-400">{saveError}</p>}
            {saveDone && (
              <p className="text-sm text-emerald-600 dark:text-emerald-400">
                Saved — it now appears below and on your dashboard.
              </p>
            )}
          </form>
        )}

        {loading ? (
          <div className="flex justify-center py-4">
            <LoadingSpinner size="sm" />
          </div>
        ) : saved.length > 0 ? (
          <ul className="space-y-2">
            {saved.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800"
              >
                <Link
                  href={buildSavedSearchUrl(s.query)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium hover:underline"
                >
                  <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{s.name}</span>
                </Link>
                <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                  {new Date(s.createdAt).toLocaleDateString()}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => void handleDelete(s.id)}
                  disabled={deletingId === s.id}
                  aria-label={`Delete saved search ${s.name}`}
                >
                  {deletingId === s.id ? (
                    <LoadingSpinner size="sm" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          status === 'ok' && (
            <EmptyState
              icon={Bookmark}
              title="No saved searches yet"
              description={
                canSave
                  ? 'Name this search above to save it and re-run it later from here or your dashboard.'
                  : 'Searches you save will appear here, ready to re-run in one tap.'
              }
              action={
                canSave ? undefined : (
                  <Button asChild size="sm">
                    <Link href="/search">
                      <Search className="mr-2 h-4 w-4" /> Search products
                    </Link>
                  </Button>
                )
              }
            />
          )
        )}
      </CardContent>
    </Card>
  );
}
