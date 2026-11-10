'use client';

/**
 * Section 9 — Catalog intake UI (admin only; /admin layout enforces the
 * server-side admin guard for this page too).
 *
 * Flow: upload a CSV → preview/review step (valid / error / duplicate /
 * near-duplicate, with per-row errors) → explicit Approve inserts only
 * the valid rows. Nothing is inserted by the preview step.
 *
 * Prices entered here are MANUAL prices — typed in by an admin, not
 * fetched live. The page says so next to the upload and next to every
 * price, and the API records source 'manual-intake' in the audit log.
 */

import { useState } from 'react';
import { Upload, FileCheck, AlertTriangle, Copy, CheckCircle2, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { cn } from '@/lib/utils';
import type { IntakeReviewedRow, IntakeRowInput } from '@/services/catalog-intake';

const TEMPLATE_CSV = [
  'name,slug,brand,category,price,currency,merchant,description,gtin,sku',
  'Example Headphones,example-headphones,ExampleBrand,Audio,49.99,USD,amazon,Noise-cancelling over-ear headphones,,EX-001',
].join('\n');

interface IntakeReviewPayload {
  source: string;
  priceNote: string;
  headerErrors: Array<{ row: number; field: string; reason: string }>;
  review: {
    rows: IntakeReviewedRow[];
    summary: { total: number; valid: number; errors: number; duplicates: number; nearDuplicates: number };
  };
  rows: IntakeRowInput[];
}

interface ApproveResult {
  inserted: string[];
  skipped: Array<{ row: number; reason: string }>;
  summary: { total: number; valid: number; errors: number; duplicates: number; nearDuplicates: number };
}

function statusBadge(status: IntakeReviewedRow['status']) {
  switch (status) {
    case 'valid':
      return <Badge className="bg-green-600">Valid</Badge>;
    case 'error':
      return <Badge variant="destructive">Error</Badge>;
    case 'duplicate':
      return <Badge variant="secondary">Duplicate slug</Badge>;
    case 'near-duplicate':
      return <Badge className="bg-amber-500">Near-duplicate</Badge>;
  }
}

export default function CatalogIntakePage() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<IntakeReviewPayload | null>(null);
  const [includeRows, setIncludeRows] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApproveResult | null>(null);

  const downloadTemplate = () => {
    const blob = new Blob([TEMPLATE_CSV], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'catalog-intake-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFile = async (file: File) => {
    setError(null);
    setResult(null);
    setPreview(null);
    setIncludeRows(new Set());
    setFileName(file.name);
    setLoading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/v1/admin/intake', { method: 'POST', body: form });
      const json = await res.json();
      if (!json.success) {
        const details = json.error?.details;
        const headerErrors = (details?.headerErrors as Array<{ reason: string }> | undefined) ?? [];
        setError(
          headerErrors.length > 0
            ? `${json.error.message}: ${headerErrors.map((e) => e.reason).join('; ')}`
            : (json.error?.message ?? 'Preview failed'),
        );
        return;
      }
      setPreview(json.data as IntakeReviewPayload);
    } catch {
      setError('Could not upload the file. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const toggleInclude = (rowNumber: number) => {
    setIncludeRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowNumber)) next.delete(rowNumber);
      else next.add(rowNumber);
      return next;
    });
  };

  const handleApprove = async () => {
    if (!preview) return;
    setError(null);
    setApproving(true);
    try {
      const res = await fetch('/api/v1/admin/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'approve',
          rows: preview.rows,
          includeRowNumbers: Array.from(includeRows),
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error?.message ?? 'Approve failed');
        return;
      }
      setResult(json.data as ApproveResult);
      setPreview(null);
      setIncludeRows(new Set());
    } catch {
      setError('Approve failed. Please try again.');
    } finally {
      setApproving(false);
    }
  };

  const summary = preview?.review.summary;
  const insertableCount =
    (summary?.valid ?? 0) +
    (preview?.review.rows.filter(
      (r) => r.status === 'near-duplicate' && includeRows.has(r.rowNumber),
    ).length ?? 0);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
      <div className="container mx-auto max-w-7xl px-4 py-8">
        <div className="mb-8">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Upload className="h-8 w-8 text-blue-600" />
            Catalog Intake
          </h1>
          <p className="mt-2 text-muted-foreground">
            Upload a CSV of products, review every row, then approve to insert. Nothing is
            added to the catalog until you approve.
          </p>
          <p className="mt-2 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <strong>Manual prices:</strong> prices in the CSV are entered by hand by an
              admin. They are <strong>not live prices</strong> and are recorded as
              manual-intake prices — never present them as live merchant prices.
            </span>
          </p>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">1. Upload CSV</CardTitle>
            <CardDescription>
              Required columns: name, slug, brand, category, price, currency, merchant.
              Optional: description, image_url, gtin, sku. The merchant must already exist
              (merchants are never auto-created) and the currency code must already exist.
              Max 1,000 rows / 2 MB.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                <Upload className="h-4 w-4" />
                Choose CSV file
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleFile(file);
                    e.target.value = '';
                  }}
                />
              </label>
              <Button variant="outline" onClick={downloadTemplate}>
                Download template
              </Button>
              {fileName && <span className="text-sm text-muted-foreground">{fileName}</span>}
              {loading && <LoadingSpinner />}
            </div>
            {error && (
              <p className="mt-4 flex items-start gap-2 text-sm text-red-600">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
              </p>
            )}
          </CardContent>
        </Card>

        {preview && summary && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileCheck className="h-5 w-5" /> 2. Review — {summary.total} rows
              </CardTitle>
              <CardDescription>
                Only valid rows are inserted on approve. Duplicates are never inserted.
                Near-duplicates (same name + brand as an existing product) are held for
                review — tick “Include anyway” only if you have checked it is a genuinely
                different product.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-4 flex flex-wrap gap-2">
                <Badge className="bg-green-600">{summary.valid} valid</Badge>
                <Badge variant="destructive">{summary.errors} errors</Badge>
                <Badge variant="secondary">{summary.duplicates} duplicates</Badge>
                <Badge className="bg-amber-500">{summary.nearDuplicates} near-duplicates</Badge>
              </div>

              {preview.headerErrors.length > 0 && (
                <div className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
                  {preview.headerErrors.map((e, i) => (
                    <p key={i}>Header: {e.reason}</p>
                  ))}
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-700">
                      <th className="p-2 text-left font-medium">Row</th>
                      <th className="p-2 text-left font-medium">Name</th>
                      <th className="p-2 text-left font-medium">Slug</th>
                      <th className="p-2 text-left font-medium">Brand / Category</th>
                      <th className="p-2 text-left font-medium">Price (manual)</th>
                      <th className="p-2 text-left font-medium">Merchant</th>
                      <th className="p-2 text-left font-medium">Status</th>
                      <th className="p-2 text-left font-medium">Issues / review</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.review.rows.map((r) => {
                      const input = preview.rows.find((x) => x.rowNumber === r.rowNumber);
                      return (
                        <tr
                          key={r.rowNumber}
                          className={cn(
                            'border-b border-slate-100 dark:border-slate-800',
                            r.status === 'error' && 'bg-red-50/60 dark:bg-red-950/30',
                            r.status === 'near-duplicate' && 'bg-amber-50/60 dark:bg-amber-950/30',
                          )}
                        >
                          <td className="p-2">{r.rowNumber}</td>
                          <td className="p-2 font-medium">{input?.name || '—'}</td>
                          <td className="p-2 font-mono text-xs">{input?.slug || '—'}</td>
                          <td className="p-2">
                            {input?.brand || '—'} / {input?.category || '—'}
                          </td>
                          <td className="p-2">
                            {input?.price ? `${input.price} ${input.currency || ''}` : '—'}
                          </td>
                          <td className="p-2">{input?.merchant || '—'}</td>
                          <td className="p-2">{statusBadge(r.status)}</td>
                          <td className="p-2">
                            {r.errors.length > 0 && (
                              <ul className="space-y-0.5 text-xs text-red-700 dark:text-red-300">
                                {r.errors.map((e, i) => (
                                  <li key={i}>
                                    <strong>{e.field}:</strong> {e.reason}
                                  </li>
                                ))}
                              </ul>
                            )}
                            {r.status === 'duplicate' && (
                              <p className="text-xs text-muted-foreground">
                                Slug already exists in the catalog — will not be inserted.
                              </p>
                            )}
                            {r.status === 'near-duplicate' && (
                              <label className="flex cursor-pointer items-start gap-2 text-xs">
                                <input
                                  type="checkbox"
                                  checked={includeRows.has(r.rowNumber)}
                                  onChange={() => toggleInclude(r.rowNumber)}
                                  className="mt-0.5"
                                />
                                <span>
                                  Same name + brand as “{r.nearDuplicateOf}”. Include anyway
                                  (I checked it is a different product).
                                </span>
                              </label>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <Button
                  onClick={() => void handleApprove()}
                  disabled={insertableCount === 0 || approving}
                >
                  {approving ? 'Inserting…' : `3. Approve & insert ${insertableCount} product${insertableCount === 1 ? '' : 's'}`}
                </Button>
                <span className="text-sm text-muted-foreground">
                  {insertableCount === 0
                    ? 'No valid rows to insert.'
                    : 'This is the only step that writes to the catalog.'}
                </span>
              </div>
            </CardContent>
          </Card>
        )}

        {result && (
          <Card className="border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-950">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CheckCircle2 className="h-5 w-5 text-green-600" /> Intake complete
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm">
                Inserted {result.inserted.length} product{result.inserted.length === 1 ? '' : 's'}
                {result.inserted.length > 0 ? `: ${result.inserted.join(', ')}` : '.'} Prices
                recorded as manual-intake prices (source: manual-intake).
              </p>
              {result.skipped.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm text-amber-800 dark:text-amber-200">
                  {result.skipped.map((s, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <Copy className="mt-0.5 h-4 w-4 shrink-0" /> Row {s.row}: {s.reason}
                    </li>
                  ))}
                </ul>
              )}
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => {
                  setResult(null);
                  setFileName(null);
                }}
              >
                Upload another file
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
