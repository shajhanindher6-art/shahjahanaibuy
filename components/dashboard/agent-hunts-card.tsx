/**
 * Autonomous deal hunts card (Section 6, Item 2).
 *
 * Self-fetching (like DigestGrid): GET /api/v1/agent/hunts, hides
 * itself when the fetch fails. A hunt is a standing instruction —
 * category, max budget, preferred brands — that the agent runs
 * during the 6-hour price refresh for users who consented. There is
 * NO second scheduler and nothing is ever auto-ordered: a hunt only
 * records matches (deduped) for the user to review.
 *
 * Mount point: app/dashboard/page.tsx. When migration 033 has not
 * been run yet the card says so plainly instead of pretending the
 * feature is live.
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Bot, Pause, Play, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Price } from '@/components/region/price';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { AGENT_CATEGORIES } from '@/lib/agent-memory';
import type { AgentHunt, HuntMatch } from '@/lib/agent-hunt';

export function AgentHuntsCard() {
  const [hunts, setHunts] = useState<AgentHunt[] | null>(null);
  const [matches, setMatches] = useState<HuntMatch[]>([]);
  const [huntsEnabled, setHuntsEnabled] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [category, setCategory] = useState('');
  const [maxBudget, setMaxBudget] = useState('');
  const [brands, setBrands] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/agent/hunts');
      if (!res.ok) {
        setHunts(null);
        return;
      }
      const json = await res.json();
      if (json?.success && json.data) {
        setHunts(Array.isArray(json.data.hunts) ? json.data.hunts : []);
        setMatches(Array.isArray(json.data.matches) ? json.data.matches : []);
        setHuntsEnabled(json.data.huntsEnabled !== false);
      }
    } catch {
      setHunts(null);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function createHunt(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/agent/hunts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: category || null,
          maxBudgetUsd: maxBudget === '' ? null : Number(maxBudget),
          preferredBrands:
            brands.trim() === ''
              ? null
              : brands.split(',').map((b) => b.trim()).filter(Boolean),
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError((json?.error?.message as string) ?? 'Could not create hunt');
        return;
      }
      setShowForm(false);
      setCategory('');
      setMaxBudget('');
      setBrands('');
      load();
    } catch {
      setError('Could not create hunt');
    } finally {
      setSaving(false);
    }
  }

  async function toggleHunt(hunt: AgentHunt) {
    setHunts((list) =>
      (list ?? []).map((h) => (h.id === hunt.id ? { ...h, active: !h.active } : h))
    );
    await fetch(`/api/v1/agent/hunts/${hunt.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !hunt.active }),
    }).catch(() => null);
  }

  async function deleteHunt(id: string) {
    setHunts((list) => (list ?? []).filter((h) => h.id !== id));
    await fetch(`/api/v1/agent/hunts/${id}`, { method: 'DELETE' }).catch(() => null);
  }

  // Fetch failed (e.g. signed out) — hide, like the other dashboard sections.
  if (hunts === null) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Bot className="h-5 w-5 text-slate-500" /> Autonomous deal hunting
        </CardTitle>
        <CardDescription>
          Standing instructions the agent checks during the 6-hour price refresh. A hunt only
          records matches for you to review — nothing is ever ordered for you.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!huntsEnabled ? (
          <p className="text-sm text-muted-foreground">
            Agent hunts are not set up yet — the owner still needs to run migration 033 once.
          </p>
        ) : (
          <>
            {hunts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No hunts yet. Create one below — the agent will watch for deals in that category
                under your budget.
              </p>
            ) : (
              <ul className="space-y-2">
                {hunts.map((hunt) => (
                  <li key={hunt.id} className="flex items-center justify-between gap-2 rounded-md border p-3">
                    <div className="text-sm">
                      <span className="font-medium">{hunt.category ?? 'Any category'}</span>
                      {' · '}
                      {hunt.maxBudgetUsd !== null ? (
                        <Price usd={hunt.maxBudgetUsd} showOriginal={false} />
                      ) : (
                        'No budget cap'
                      )}
                      {hunt.preferredBrands && hunt.preferredBrands.length > 0 && (
                        <span className="text-muted-foreground"> · {hunt.preferredBrands.join(', ')}</span>
                      )}
                      <span className="block text-xs text-muted-foreground">
                        {hunt.active ? 'Active' : 'Paused'}
                        {hunt.lastRunAt ? ` · last run ${new Date(hunt.lastRunAt).toLocaleDateString()}` : ' · never run yet'}
                      </span>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button size="sm" variant="ghost" onClick={() => toggleHunt(hunt)} title={hunt.active ? 'Pause hunt' : 'Resume hunt'}>
                        {hunt.active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => deleteHunt(hunt.id)} title="Delete hunt">
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {matches.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-medium">Recent matches</h3>
                <ul className="space-y-1 text-sm">
                  {matches.slice(0, 5).map((match) => (
                    <li key={match.id} className="flex items-center justify-between gap-2">
                      {match.productSlug ? (
                        <Link href={`/products/${match.productSlug}`} className="truncate hover:underline">
                          {match.productName ?? match.productSlug}
                        </Link>
                      ) : (
                        <span className="truncate">{match.productName ?? 'Unknown product'}</span>
                      )}
                      <span className="shrink-0">
                        <Price usd={match.matchedPriceUsd} showOriginal={false} />
                        {' · '}
                        <span className="text-xs text-muted-foreground">
                          {new Date(match.matchedAt).toLocaleDateString()}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {showForm ? (
              <form onSubmit={createHunt} className="space-y-3 rounded-md border p-3">
                <div>
                  <Label className="mb-1.5 block">Category</Label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Any category (use my agent preferences)</option>
                    {AGENT_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label className="mb-1.5 block">Max budget (USD)</Label>
                  <Input
                    type="number"
                    min={1}
                    step="0.01"
                    value={maxBudget}
                    onChange={(e) => setMaxBudget(e.target.value)}
                    placeholder="Leave blank to use your agent budget"
                  />
                </div>
                <div>
                  <Label className="mb-1.5 block">Preferred brands (optional, comma-separated)</Label>
                  <Input
                    value={brands}
                    onChange={(e) => setBrands(e.target.value)}
                    placeholder="e.g. Apple, Samsung"
                  />
                </div>
                {error && <p className="text-xs text-red-600">{error}</p>}
                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={saving}>
                    {saving ? 'Creating…' : 'Create hunt'}
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => setShowForm(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setShowForm(true)}>
                New hunt
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
