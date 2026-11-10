'use client';

/**
 * Product Scanner page: /scan
 *
 * Upload a photo (or capture one with the camera) and find the
 * product in SmartBuy's catalog. Honest modes — see
 * services/visual-search.ts:
 * - Your photo NEVER leaves this browser and is NEVER stored: it is
 *   only a preview/reference. The search runs on the keywords you
 *   confirm, through the same catalog ai-search as a text search.
 * - Real visual identification ("Visual match") happens only when
 *   the site has a visual-search key configured AND you paste a
 *   public image URL (SerpAPI Lens fetches that URL). While no key
 *   is configured — the expected state — results are labelled
 *   "Keyword-assisted search from your photo" and nothing is ever
 *   presented as identified from your photo without a real result.
 * - Camera permission denied/unavailable degrades gracefully to the
 *   file-upload input; nothing crashes.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Camera, ImagePlus, Search, ScanLine, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { Price } from '@/components/region/price';
import { validateScanImage } from '@/services/visual-search';

interface CatalogHit {
  product?: { name?: string; slug?: string };
  currentPrice?: number | null;
  stores?: string[];
  aiExplanation?: string;
}

interface VisualHit {
  title: string;
  source: string | null;
  link: string | null;
  thumbnail: string | null;
}

type ScanResult = { mode: string; note: string; catalog: CatalogHit[]; visual: VisualHit[] };

export default function ScanPage() {
  const [preview, setPreview] = useState<string | null>(null);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  const [keywords, setKeywords] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  // Mirror of `preview` for the unmount cleanup: the old effect
  // closed over the initial (null) preview, so a preview that was
  // still showing on unmount was never revoked (object-URL leak).
  const previewRef = useRef<string | null>(null);
  previewRef.current = preview;

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    };
  }, []);

  function handleFile(file: File | undefined) {
    if (!file) return;
    const problem = validateScanImage(file);
    if (problem) {
      setPhotoNote(problem);
      return;
    }
    setPhotoNote(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(file));
  }

  async function startCamera() {
    setCameraError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('unsupported');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOn(true);
      requestAnimationFrame(() => {
        if (videoRef.current) videoRef.current.srcObject = stream;
      });
    } catch {
      setCameraError(
        'Camera is not available or permission was denied. Use the photo upload above instead — nothing is lost, the search works the same way.'
      );
      setCameraOn(false);
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
  }

  function capturePhoto() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], 'scan-photo.jpg', { type: 'image/jpeg' });
      handleFile(file);
      stopCamera();
    }, 'image/jpeg');
  }

  async function runScan() {
    setError(null);
    setResult(null);
    if (!keywords.trim() && !imageUrl.trim()) {
      setError('Enter the product name or keywords (or a public image URL) to search.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/v1/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords: keywords.trim(), imageUrl: imageUrl.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? 'Scan failed. Please try again.');
        return;
      }
      const mode = data?.meta?.mode ?? 'keyword-assisted';
      setResult({
        mode,
        note: data?.meta?.note ?? '',
        catalog: mode === 'visual' ? [] : Array.isArray(data.data) ? data.data : [],
        visual: mode === 'visual' ? (Array.isArray(data.data) ? data.data : []) : [],
      });
    } catch {
      setError('Scan failed. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl space-y-6">
          <div>
            <h1 className="flex items-center gap-2 text-3xl font-bold">
              <ScanLine className="h-7 w-7 text-blue-600" /> Scan a Product
            </h1>
            <p className="mt-2 text-muted-foreground">
              Take or upload a photo, confirm what it shows, and find it in SmartBuy&apos;s catalog
              with real store prices. Your photo never leaves this browser and is never stored —
              it is only a reference while you search.
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">1. Your photo (reference only)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => fileRef.current?.click()}>
                  <ImagePlus className="mr-2 h-4 w-4" /> Upload a photo
                </Button>
                {!cameraOn ? (
                  <Button variant="outline" onClick={startCamera}>
                    <Camera className="mr-2 h-4 w-4" /> Use camera
                  </Button>
                ) : (
                  <>
                    <Button onClick={capturePhoto}>
                      <Camera className="mr-2 h-4 w-4" /> Capture
                    </Button>
                    <Button variant="outline" onClick={stopCamera}>
                      <X className="mr-2 h-4 w-4" /> Close camera
                    </Button>
                  </>
                )}
              </div>
              {cameraError && <p className="text-sm text-amber-700">{cameraError}</p>}
              {cameraOn && (
                <video ref={videoRef} autoPlay playsInline muted className="w-full rounded-lg bg-black" />
              )}
              {preview && (
                <Image src={preview} alt="Your scanned product preview" width={800} height={600} unoptimized className="max-h-64 w-auto rounded-lg object-contain" />
              )}
              {photoNote && <p className="text-sm text-red-600">{photoNote}</p>}
              <p className="text-xs text-muted-foreground">
                Photos are previewed locally only (max 8 MB). Nothing is uploaded or saved.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">2. What is it?</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                placeholder="e.g. MacBook Air 13, Sony WH-1000XM5…"
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
              />
              <Input
                placeholder="Optional: public image URL for real visual matching (needs a configured visual-search key)"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Without a visual-search key on this site, the search below runs on your keywords —
                the photo helps you, it does not identify the product by itself.
              </p>
              <Button onClick={runScan} disabled={loading} className="w-full">
                <Search className="mr-2 h-4 w-4" /> {loading ? 'Searching…' : 'Search with these keywords'}
              </Button>
              {loading && <LoadingSpinner />}
              {error && <p className="text-sm text-red-600">{error}</p>}
            </CardContent>
          </Card>

          {result && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Results{' '}
                  <Badge variant="secondary" className="ml-1">
                    {result.mode === 'visual' ? 'Visual match' : 'Keyword-assisted search from your photo'}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {result.note && <p className="text-sm text-muted-foreground">{result.note}</p>}
                {result.visual.length === 0 && result.catalog.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No matches found. Try different keywords, or browse the{' '}
                    <Link className="text-blue-600 underline" href="/search">
                      search page
                    </Link>
                    .
                  </p>
                )}
                {result.visual.map((m, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-lg border p-3">
                    {m.thumbnail && <Image src={m.thumbnail} alt="" width={48} height={48} unoptimized className="h-12 w-12 rounded object-cover" />}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{m.title}</p>
                      {m.source && <p className="text-xs text-muted-foreground">{m.source}</p>}
                    </div>
                    {m.link && (
                      <a className="text-sm text-blue-600 underline" href={m.link} target="_blank" rel="noopener noreferrer">
                        View
                      </a>
                    )}
                  </div>
                ))}
                {result.catalog.map((r, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-lg border p-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{r.product?.name ?? 'Unnamed product'}</p>
                      <p className="text-xs text-muted-foreground">
                        {(r.stores ?? []).join(', ') || 'No store listing yet'}
                        {r.aiExplanation ? ` · ${r.aiExplanation}` : ''}
                      </p>
                    </div>
                    {r.currentPrice !== null && r.currentPrice !== undefined && (
                      <Price usd={r.currentPrice} className="font-bold text-blue-600" />
                    )}
                    {r.product?.slug && (
                      <Link className="text-sm text-blue-600 underline" href={`/products/${r.product.slug}`}>
                        View
                      </Link>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
