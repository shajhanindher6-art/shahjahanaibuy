/**
 * Content Security Policy (nonce-based, Phase 2).
 *
 * One fresh nonce per request (generated in middleware.ts, carried
 * to the page render as the `x-nonce` request header and back to the
 * browser in the CSP response header). Next.js applies that nonce to
 * its own inline scripts; the two JSON-LD script tags get it
 * explicitly (root layout via headers(), product page via
 * NonceContext in components/csp-nonce-context.tsx).
 *
 * What changed vs the old static policy:
 * - script-src: NO 'unsafe-inline', NO 'unsafe-eval'. Only
 *   same-origin scripts and scripts carrying this request's nonce.
 *   (The eval('require') calls in lib/workers/queue.ts are
 *   server-side only — CSP does not apply to them.)
 * - style-src: KEEPS 'unsafe-inline'. React renders style={{...}}
 *   props as style ATTRIBUTES, and CSP has no nonce mechanism for
 *   style attributes — removing it would break inline styles (e.g.
 *   the dashboard's staggered animation delays). This matches the
 *   official Next.js strict-CSP example.
 */

export function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    'img-src \'self\' blob: data: https:',
    "font-src 'self' https://fonts.gstatic.com",
    'connect-src \'self\' https://*.supabase.co https://*.supabase.in',
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}
