/**
 * Past weekly digests archive (Section 15, B12 — dashboard UI).
 *
 * Digests were write-only: generateWeeklyDigest inserts into
 * `weekly_digests` and nothing ever read them back. GET
 * /api/v1/digests (built by another Section 15 worker) is the
 * read side; this is the dashboard archive that reads from it —
 * newest week first, with the week's deal / drop / search counts
 * taken straight from the stored rows.
 *
 * Honest empty states, never invented digests:
 *  - no digests for the user → "No past digests yet" (this is
 *    also the state when migration 009 is unapplied: nothing
 *    could have written a digest row then either);
 *  - a failed fetch hides the card instead of showing a fake
 *    archive; guests see nothing (the API 401s).
 */

'use client';

import { useEffect, useState } from 'react';
import { Mail } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingSpinner } from '@/components/ui/loading-spinner';

interface PastDigestView {
  id: string;
  weekStart: string;
  weekEnd: string;
  topDeals: unknown[];
  priceDrops: unknown[];
  searchSummary: unknown[];
  sentAt: string | null;
  createdAt: string;
}

function formatWeek(weekStart: string, weekEnd: string): string {
  const start = new Date(weekStart);
  const end = new Date(weekEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return `${weekStart} – ${weekEnd}`;
  }
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
  return `${start.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString('en-US', opts)}`;
}

export function DigestArchive() {
  const [digests, setDigests] = useState<PastDigestView[]>([]);
  const [loading, setLoading] = useState(true);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/v1/digests?limit=20')
      .then((res) => {
        if (cancelled) return;
        // 401 (guest) or any failure hides the card — the archive
        // is a signed-in user's own history, not a public section.
        if (!res.ok) return;
        return res.json();
      })
      .then((json) => {
        if (cancelled || !json) return;
        if (json.success && Array.isArray(json.data)) {
          setDigests(json.data as PastDigestView[]);
          setVisible(true);
        }
      })
      .catch(() => {
        // Failed fetch hides the card; never a fake archive.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loading && !visible) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Mail className="h-4 w-4" /> Past weekly digests
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-4">
            <LoadingSpinner size="sm" />
          </div>
        ) : digests.length > 0 ? (
          <ul className="space-y-2">
            {digests.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800"
              >
                <div>
                  <p className="text-sm font-medium">
                    Week of {formatWeek(d.weekStart, d.weekEnd)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {d.sentAt
                      ? `Sent ${new Date(d.sentAt).toLocaleDateString()}`
                      : 'Generated, not sent'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">{d.topDeals.length} top deals</Badge>
                  <Badge variant="secondary">{d.priceDrops.length} price drops</Badge>
                  <Badge variant="secondary">{d.searchSummary.length} searches</Badge>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={Mail}
            title="No past digests yet"
            description="When a weekly digest is generated for you, it will be archived here — newest week first."
          />
        )}
      </CardContent>
    </Card>
  );
}
