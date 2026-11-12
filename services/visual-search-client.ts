/**
 * Client-safe visual-search helpers — NO Node-only or server-only imports.
 *
 * `app/scan/page.tsx` is a 'use client' component: anything it imports
 * gets bundled for the browser, and webpack cannot bundle `node:*`
 * imports (node:dns/promises, node:net) from services/visual-search.ts.
 * This module holds exactly the pure helpers the scan page needs, with
 * zero imports, so the client bundle never touches a `node:` import.
 *
 * Single source of truth: services/visual-search.ts re-exports these,
 * so server importers and tests keep importing them from
 * '@/services/visual-search' unchanged. Do NOT add anything here that
 * needs Node, env vars, or server-only modules — that belongs in
 * services/visual-search.ts.
 */

export const MAX_SCAN_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB

/** Client-side validation for an uploaded/captured image. Null = OK. */
export function validateScanImage(file: { type: string; size: number }): string | null {
  if (!file.type.startsWith('image/')) return 'Please choose an image file (JPG, PNG, or WebP).';
  if (file.size > MAX_SCAN_IMAGE_BYTES) return 'That image is over 8 MB. Please choose a smaller photo.';
  return null;
}
