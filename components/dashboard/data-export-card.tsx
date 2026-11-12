/**
 * Data export card (Section 14, Chunk 7) — settings page.
 *
 * Downloads the signed-in user's own data as one JSON file
 * (GET /api/v1/data/export): wishlists + items, price alerts,
 * buy list, savings ledger, recent searches, referral link.
 * The file is generated in the browser from the API response —
 * nothing is emailed or stored anywhere. Sections with no rows
 * (or a table that is not set up yet) simply come back empty.
 */
'use client';

import { useRegion } from '@/components/region/region-provider';
import { tFor } from '@/lib/i18n';
import { useState } from 'react';
import { Download } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  exportFileName,
  exportNonEmptySections,
  exportTotalRows,
  type UserDataExport,
} from '@/lib/data-export';

export function DataExportCard() {
  const { language } = useRegion();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function handleDownload() {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const res = await fetch('/api/v1/data/export');
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success || !json?.data) {
        setMessage(
          res.status === 429
            ? 'Too many exports — you can export again in an hour.'
            : 'Could not build your export. Please try again.'
        );
        return;
      }
      const doc = json.data as UserDataExport;
      const total = exportTotalRows(doc);
      const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = exportFileName(new Date(doc.exportedAt));
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      const sections = exportNonEmptySections(doc);
      setMessage(
        total === 0
          ? 'Your export downloaded — it is empty because this account has no saved data yet.'
          : `Your export downloaded — ${total} row${total === 1 ? '' : 's'} across ${sections.join(', ')}.`
      );
    } catch {
      setMessage('Could not build your export. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Download className="h-5 w-5" /> {tFor(language, 'dashDownloadData')}
        </CardTitle>
        <CardDescription>
          Get a copy of your SmartBuy data as a JSON file: your wishlists, price alerts, buy
          list, savings ledger, recent searches and referral link. No passwords, API keys or
          push subscriptions are included. Limited to 5 exports per hour.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Button onClick={() => void handleDownload()} disabled={busy}>
          {busy ? 'Building export…' : 'Download my data (JSON)'}
        </Button>
        {message && <p className="text-sm text-muted-foreground">{message}</p>}
      </CardContent>
    </Card>
  );
}
