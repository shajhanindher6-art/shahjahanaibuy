/**
 * Public API key management (Section 4, item 18) — /dashboard/api-keys.
 *
 * Signed-in only: the API itself requires auth, and this page shows
 * the sign-in prompt when there is no session. Lists the caller's own
 * keys (redacted prefixes only — the server never returns a full key
 * except at creation), creates a key, and revokes one.
 *
 * SECURITY — the full key is shown exactly once, in the creation
 * response, and is kept only in this page's React state: it is never
 * written to localStorage, never logged, and disappears on reload or
 * navigation. Copy it now or lose it — the server stores only its
 * SHA-256 hash (see lib/api-keys.ts).
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/features/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { API_KEY_SCOPES, type ApiKeyScope } from '@/lib/api-keys-format';
import { KeyRound, Copy, Check, Trash2 } from 'lucide-react';

interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

interface CreatedKey extends ApiKeyRow {
  key: string;
  warning?: string;
}

export default function ApiKeysPage() {
  const { user } = useAuth();
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ApiKeyScope[]>([...API_KEY_SCOPES]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchKeys = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/v1/public/keys');
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setLoadError(json?.error?.message ?? 'Could not load your API keys.');
        setKeys([]);
        return;
      }
      setKeys(Array.isArray(json.data) ? (json.data as ApiKeyRow[]) : []);
    } catch {
      setLoadError('Could not load your API keys. Please try again.');
      setKeys([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) void fetchKeys();
    else setLoading(false);
  }, [user, fetchKeys]);

  function toggleScope(scope: ApiKeyScope) {
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    );
  }

  async function handleCreate() {
    if (!name.trim()) {
      setCreateError('Give the key a name first (e.g. "My blog widget").');
      return;
    }
    if (scopes.length === 0) {
      setCreateError('Pick at least one scope.');
      return;
    }
    setCreating(true);
    setCreateError(null);
    setCreated(null);
    try {
      const res = await fetch('/api/v1/public/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), scopes }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setCreateError(json?.error?.message ?? 'Failed to create the API key.');
        return;
      }
      // The ONLY time the full key exists client-side. It lives in
      // React state only — never persisted, never logged.
      setCreated(json.data as CreatedKey);
      setName('');
      await fetchKeys();
    } catch {
      setCreateError('Failed to create the API key. Please try again.');
    } finally {
      setCreating(false);
    }
  }

  async function handleCopy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.key);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked — the key is still visible on screen to copy manually.
    }
  }

  async function handleRevoke(id: string) {
    setRevoking(id);
    setActionError(null);
    try {
      const res = await fetch(`/api/v1/public/keys/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setActionError(json?.error?.message ?? 'Failed to revoke the API key.');
        return;
      }
      await fetchKeys();
    } catch {
      setActionError('Failed to revoke the API key. Please try again.');
    } finally {
      setRevoking(null);
    }
  }

  if (!user) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">API keys</h1>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              Sign in to create and manage public API keys.{' '}
              <Link href="/sign-in" className="font-medium text-primary underline">
                Sign in
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const activeKeys = keys.filter((k) => !k.revoked_at);
  const revokedKeys = keys.filter((k) => k.revoked_at);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <KeyRound className="h-6 w-6" /> Public API keys
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Keys for the public read-only API (products, prices, deals — see{' '}
          <Link href="/api-docs" className="underline">
            API docs
          </Link>
          ). A key raises your rate limit from 30 to 120 requests per minute. Only the key
          prefix is ever listed here; the full key is shown once, at creation.
        </p>
      </div>

      {created && (
        <Card className="border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950">
          <CardHeader>
            <CardTitle className="text-base">Your new key — copy it now</CardTitle>
            <CardDescription>
              {created.warning ??
                'Store this key now — it will never be shown again. Only its hash is stored.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="break-all rounded-md border bg-background p-3 font-mono text-sm">
              {created.key}
            </div>
            <div className="flex gap-2">
              <Button onClick={() => void handleCopy()} className="min-h-[44px]">
                {copied ? (
                  <>
                    <Check className="mr-2 h-4 w-4" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="mr-2 h-4 w-4" /> Copy key
                  </>
                )}
              </Button>
              <Button variant="outline" className="min-h-[44px]" onClick={() => setCreated(null)}>
                I&apos;ve saved it
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Create a key</CardTitle>
          <CardDescription>
            Keys are read-only and scoped to the public endpoints. No key can read your account
            data or write anything.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="api-key-name">Name</Label>
            <Input
              id="api-key-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder='e.g. "My blog widget"'
              maxLength={100}
            />
          </div>
          <fieldset>
            <legend className="text-sm font-medium">Scopes</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {API_KEY_SCOPES.map((scope) => (
                <Button
                  key={scope}
                  type="button"
                  variant={scopes.includes(scope) ? 'default' : 'outline'}
                  size="sm"
                  className="min-h-[44px]"
                  aria-pressed={scopes.includes(scope)}
                  onClick={() => toggleScope(scope)}
                >
                  {scope}
                </Button>
              ))}
            </div>
          </fieldset>
          {createError && <p className="text-sm text-destructive-text">{createError}</p>}
          <Button onClick={() => void handleCreate()} disabled={creating} className="min-h-[44px]">
            {creating ? <LoadingSpinner size="sm" /> : 'Create key'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your keys</CardTitle>
          <CardDescription>
            {activeKeys.length === 0
              ? 'No active keys yet.'
              : `${activeKeys.length} active key${activeKeys.length === 1 ? '' : 's'}.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div className="flex justify-center py-6">
              <LoadingSpinner />
            </div>
          ) : loadError ? (
            <p className="text-sm text-muted-foreground">{loadError}</p>
          ) : keys.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No API keys yet. Create one above — the full key is shown exactly once.
            </p>
          ) : (
            <>
              {activeKeys.map((key) => (
                <div
                  key={key.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
                >
                  <div className="min-w-0">
                    <p className="font-medium">{key.name}</p>
                    <p className="font-mono text-sm text-muted-foreground">
                      {key.key_prefix}…
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {key.scopes.join(', ')} · created{' '}
                      {new Date(key.created_at).toLocaleDateString()}
                      {key.last_used_at
                        ? ` · last used ${new Date(key.last_used_at).toLocaleDateString()}`
                        : ' · never used'}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-[44px]"
                    disabled={revoking === key.id}
                    onClick={() => void handleRevoke(key.id)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" /> Revoke
                  </Button>
                </div>
              ))}
              {revokedKeys.map((key) => (
                <div
                  key={key.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4 opacity-60"
                >
                  <div className="min-w-0">
                    <p className="font-medium">{key.name} (revoked)</p>
                    <p className="font-mono text-sm text-muted-foreground">
                      {key.key_prefix}…
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    Revoked {key.revoked_at ? new Date(key.revoked_at).toLocaleDateString() : ''}
                  </span>
                </div>
              ))}
            </>
          )}
          {actionError && <p className="text-sm text-destructive-text">{actionError}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
