'use client';

/**
 * Section 15, P3-3 — eBay intake UI (admin only; /admin layout
 * enforces the server-side admin guard for this page too).
 *
 * Flow: search eBay live listings → annotate each listing with the
 * brand / category / slug eBay does not carry → "Send to review"
 * (preview route, inserts nothing) → review table → Approve, which
 * reuses the EXISTING catalog-intake approve
 * (POST /api/v1/admin/intake, action 'approve', source
 * 'ebay-browse-api'). Nothing is added to the catalog until approve.
 *
 * HONEST LABELLING: the listings below are LIVE eBay asking prices
 * — snapshots of ephemeral single-seller listings, checked just now.
 * Approving one creates a product + one eBay merchant listing
 * labelled "Live eBay asking price, checked <timestamp>". No price
 * history, no Deal Score, no "lowest ever" and no price-drop alert
 * is ever created from an eBay listing, and a listing that later
 * vanishes never triggers an alert.
 *
 * Every search spends one call from the shared eBay daily budget
 * (cap 4,500/day); the remaining budget is shown next to the search
 * box. At the cap the preview refuses and the page says so.
 */

import { useState } from 'react';
import { Search, FileCheck, AlertTriangle, CheckCircle2, XCircle, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { cn } from '@/lib/utils';
import type { EbayListing } from '@/services/ebay-browse';
import type { IntakeReviewedRow, IntakeRowInput } from '@/services/catalog-intake';

interface EbayBudget {
  remaining: number | null;
  used: number | null;
  limit: number;
}

interface SearchPayload {
  source: string;
  configured: boolean;
  listings: EbayListing[];
  budget: EbayBudget;
  fetchedAt?: string;
  priceNote?: string;
}

interface ReviewPayload extends SearchPayload {
  review: {
    rows: IntakeReviewedRow[];
    summary: { total: number; valid: number; errors: number; duplicates: number; nearDuplicates: number };
  };
  rows: IntakeRowInput[];
  ebayDuplicates: number;
  skippedItems: string[];
  unmatchedItems: string[];
}

interface ApproveResult {
  inserted: string[];
  skipped: Array<{ row: number; reason: string }>;
  summary: { total: number; valid: number; errors: number; duplicates: number; nearDuplicates: number };
  priceNote?: string;
}

interface EditableFields {
  brand: string;
  category: string;
  slug: string;
}

function statusBadge(status: IntakeReviewedRow['status']) {
  switch (status) {
    case 'valid':
      return <Badge className="bg-green-600">Valid</Badge>;
    case 'error':
      return <Badge variant="destructive">Error</Badge>;
    case 'duplicate':
      return <Badge variant="secondary">Duplicate</Badge>;
    case 'near-duplicate':
      return <Badge className="bg-amber-500">Near-duplicate</Badge>;
  }
}

export default function EbayIntakePage() {
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(5);
  const [condition, setCondition] = useState('');
  const [searchResult, setSearchResult] = useState<SearchPayload | null>(null);
  const [fields, setFields] = useState<Record<string, EditableFields>>({});
  const [review, setReview] = useState<ReviewPayload | null>(null);
  const [includeRows, setIncludeRows] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApproveResult | null>(null);

  const setField = (itemId: string, key: keyof EditableFields, value: string) => {
    setFields((prev) => {
      const prevFields = prev[itemId];
      const next: EditableFields = {
        brand: prevFields?.brand ?? '',
        category: prevFields?.category ?? '',
        slug: prevFields?.slug ?? '',
      };
      next[key] = value;
      return { ...prev, [itemId]: next };
    });
  };

  const handleSearch = async () => {
    setError(null);
    setResult(null);
    setReview(null);
    setIncludeRows(new Set());
    setFields({});
    if (!query.trim()) {
      setError('Enter a search query first.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/v1/admin/ebay/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query.trim(), limit, ...(condition ? { condition } : {}) }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error?.message ?? 'Search failed');
        return;
      }
      setSearchResult(json.data as SearchPayload);
    } catch {
      setError('Could not reach the eBay preview API. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleReview = async () => {
    if (!searchResult) return;
    setError(null);
    setReviewing(true);
    try {
      const items = searchResult.listings.map((l) => ({
        itemId: l.itemId,
        ...(fields[l.itemId] ?? { brand: '', category: '', slug: '' }),
      }));
      const res = await fetch('/api/v1/admin/ebay/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query.trim(), limit, ...(condition ? { condition } : {}), items }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error?.message ?? 'Review failed');
        return;
      }
      setReview(json.data as ReviewPayload);
    } catch {
      setError('Could not review the listings. Please try again.');
    } finally {
      setReviewing(false);
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
    if (!review) return;
    setError(null);
    setApproving(true);
    try {
      const res = await fetch('/api/v1/admin/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'approve',
          rows: review.rows,
          includeRowNumbers: Array.from(includeRows),
          source: 'ebay-browse-api',
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error?.message ?? 'Approve failed');
        return;
      }
      setResult(json.data as ApproveResult);
      setReview(null);
      setSearchResult(null);
      setFields({});
      setIncludeRows(new Set());
    } catch {
      setError('Approve failed. Please try again.');
    } finally {
      setApproving(false);
    }
  };

  const budget = review?.budget ?? searchResult?.budget;
  const summary = review?.review.summary;
  const insertableCount =
    (summary?.valid ?? 0) +
    (review?.review.rows.filter(
      (r) => r.status === 'near-duplicate' && includeRows.has(r.rowNumber),
    ).length ?? 0);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
      <div className="container mx-auto max-w-7xl px-4 py-8">
        <div className="mb-8">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Search className="h-8 w-8 text-blue-600" />
            eBay Intake
          </h1>
          <p className="mt-2 text-muted-foreground">
            Search live eBay listings, annotate them with the brand, category and slug eBay
            does not carry, review every row, then approve to insert. Nothing is added to
            the catalog until you approve.
          </p>
          <p className="mt-2 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <strong>Live eBay asking prices:</strong> these are snapshots of ephemeral
              single-seller listings, checked just now. They create <strong>no price
              history, no Deal Score and no alerts</strong> — the product page labels
              them “Live eBay asking price, checked &lt;timestamp&gt;”.
            </span>
          </p>
          {budget && (
            <p className="mt-2 text-sm text-muted-foreground">
              eBay daily budget: {budget.remaining === null ? 'unknown' : `${budget.remaining.toLocaleString()} of ${budget.limit.toLocaleString()} calls left today`}
              {budget.used !== null && ` (${budget.used.toLocaleString()} used)`}. Public
              search, admin preview and the price refresh share this budget.
            </p>
          )}
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">1. Search eBay</CardTitle>
            <CardDescription>
              One search spends one call from the shared daily budget. The merchant is
              always eBay — it must already exist in the merchants table (merchants are
              never auto-created); if it does not, every row reports “Unknown merchant”.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="text"
                value={query}
                aria-label="Search eBay listings"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleSearch();
                }}
                placeholder="e.g. MacBook Air 13"
                className="min-w-64 flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
              />
              <select
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                aria-label="Results per search"
              >
                <option value={5}>5 results</option>
                <option value={10}>10 results</option>
              </select>
              <select
                value={condition}
                onChange={(e) => setCondition(e.target.value)}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                aria-label="Condition filter"
              >
                <option value="">Any condition</option>
                <option value="NEW">New</option>
                <option value="USED">Used</option>
                <option value="LIKE_NEW">Like new</option>
                <option value="CERTIFIED_REFURBISHED">Certified refurbished</option>
                <option value="SELLER_REFURBISHED">Seller refurbished</option>
                <option value="FOR_PARTS_OR_NOT_WORKING">For parts</option>
              </select>
              <Button onClick={() => void handleSearch()} disabled={loading}>
                {loading ? 'Searching…' : 'Search eBay'}
              </Button>
              {loading && <LoadingSpinner />}
            </div>
            {error && (
              <p className="mt-4 flex items-start gap-2 text-sm text-red-600">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
              </p>
            )}
            {searchResult && !searchResult.configured && (
              <p className="mt-4 rounded-lg border border-slate-300 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-900">
                eBay live search is not configured (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET are
                not set in the hosting dashboard). Ask the owner to add the keys — no
                listings can be previewed until then.
              </p>
            )}
          </CardContent>
        </Card>

        {searchResult && searchResult.configured && searchResult.listings.length === 0 && (
          <Card className="mb-6">
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">
                No live eBay listings found for “{query}”. Try a different query — the
                catalog and store search links still work.
              </p>
            </CardContent>
          </Card>
        )}

        {searchResult && searchResult.configured && searchResult.listings.length > 0 && !review && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-base">
                2. Annotate — {searchResult.listings.length} listing{searchResult.listings.length === 1 ? '' : 's'}
              </CardTitle>
              <CardDescription>
                eBay titles are keyword-stuffed, so the title is only a starting point for
                the product name — edit it after approve if needed. Brand, category and
                slug are required: the slug is yours (never auto-derived from the eBay
                item id), and must be lowercase letters, numbers and hyphens only.
                {searchResult.fetchedAt && (
                  <> Checked at {new Date(searchResult.fetchedAt).toLocaleString()}.</>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-700">
                      <th className="p-2 text-left font-medium">Listing</th>
                      <th className="p-2 text-left font-medium">Price (live asking)</th>
                      <th className="p-2 text-left font-medium">Brand</th>
                      <th className="p-2 text-left font-medium">Category</th>
                      <th className="p-2 text-left font-medium">Slug</th>
                    </tr>
                  </thead>
                  <tbody>
                    {searchResult.listings.map((l) => {
                      const f = fields[l.itemId] ?? { brand: '', category: '', slug: '' };
                      return (
                        <tr key={l.itemId} className="border-b border-slate-100 align-top dark:border-slate-800">
                          <td className="p-2">
                            <div className="flex items-start gap-2">
                              {l.imageUrl && (
                                // alt="" is deliberate — decorative thumbnail; the listing title beside it names the product.
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={l.imageUrl} alt="" className="h-12 w-12 shrink-0 rounded object-cover" />
                              )}
                              <div>
                                <p className="font-medium">{l.title}</p>
                                <p className="text-xs text-muted-foreground">
                                  {l.condition ?? 'Condition unknown'} · eBay item {l.itemId}
                                </p>
                                <a
                                  href={l.itemWebUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                                >
                                  View live listing <ExternalLink className="h-3 w-3" />
                                </a>
                              </div>
                            </div>
                          </td>
                          <td className="p-2 whitespace-nowrap">
                            {l.price === null ? 'No price' : `${l.price} ${l.currency ?? ''}`}
                          </td>
                          <td className="p-2">
                            <input
                              type="text"
                              value={f.brand}
                              aria-label={`Brand for ${l.title}`}
                              onChange={(e) => setField(l.itemId, 'brand', e.target.value)}
                              placeholder="Brand"
                              className="w-28 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="text"
                              value={f.category}
                              aria-label={`Category for ${l.title}`}
                              onChange={(e) => setField(l.itemId, 'category', e.target.value)}
                              placeholder="Category"
                              className="w-28 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="text"
                              value={f.slug}
                              aria-label={`Product slug for ${l.title}`}
                              onChange={(e) => setField(l.itemId, 'slug', e.target.value)}
                              placeholder="product-slug"
                              className="w-36 rounded-md border border-slate-300 bg-white px-2 py-1 font-mono text-xs dark:border-slate-700 dark:bg-slate-900"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-6">
                <Button onClick={() => void handleReview()} disabled={reviewing}>
                  {reviewing ? 'Reviewing…' : 'Send to review'}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {review && summary && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileCheck className="h-5 w-5" /> 3. Review — {summary.total} rows
              </CardTitle>
              <CardDescription>
                Only valid rows are inserted on approve. Duplicates (including an eBay item
                already in the catalog — {review.ebayDuplicates} here) are never inserted.
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

              {review.unmatchedItems.length > 0 && (
                <p className="mb-4 text-sm text-amber-800 dark:text-amber-200">
                  {review.unmatchedItems.length} annotated item{review.unmatchedItems.length === 1 ? '' : 's'} no
                  longer matched the fresh search results and {review.unmatchedItems.length === 1 ? 'was' : 'were'} skipped — search again if you need {review.unmatchedItems.length === 1 ? 'it' : 'them'}.
                </p>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-700">
                      <th className="p-2 text-left font-medium">Row</th>
                      <th className="p-2 text-left font-medium">Name</th>
                      <th className="p-2 text-left font-medium">Slug</th>
                      <th className="p-2 text-left font-medium">Brand / Category</th>
                      <th className="p-2 text-left font-medium">Price (live asking)</th>
                      <th className="p-2 text-left font-medium">Status</th>
                      <th className="p-2 text-left font-medium">Issues / review</th>
                    </tr>
                  </thead>
                  <tbody>
                    {review.review.rows.map((r) => {
                      const input = review.rows.find((x) => x.rowNumber === r.rowNumber);
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
                              <p className="text-xs text-muted-foreground">{r.duplicateOf ?? 'Already in the catalog — will not be inserted.'}</p>
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
                  {approving ? 'Inserting…' : `Approve & insert ${insertableCount} product${insertableCount === 1 ? '' : 's'}`}
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
                {result.inserted.length > 0 ? `: ${result.inserted.join(', ')}` : '.'}
              </p>
              {result.priceNote && <p className="mt-2 text-sm text-muted-foreground">{result.priceNote}</p>}
              {result.skipped.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm text-amber-800 dark:text-amber-200">
                  {result.skipped.map((s, i) => (
                    <li key={i}>Row {s.row}: {s.reason}</li>
                  ))}
                </ul>
              )}
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => {
                  setResult(null);
                  setQuery('');
                }}
              >
                Search another query
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
