'use client';

import { createContext, useContext } from 'react';

/**
 * The per-request CSP nonce, threaded from the root layout (server
 * component) through Providers. Client components that render a
 * <script> tag — the product page's JSON-LD — read it here and set
 * nonce={...} on the tag.
 *
 * A nonce is a per-request unpredictable value. It is fine for it to
 * appear in the rendered page: an attacker cannot predict the nonce
 * of a victim's request, which is the whole point of the nonce.
 */
const NonceContext = createContext<string | null>(null);

export function NonceProvider({
  nonce,
  children,
}: {
  nonce: string | null;
  children: React.ReactNode;
}) {
  return <NonceContext.Provider value={nonce}>{children}</NonceContext.Provider>;
}

export function useNonce(): string | null {
  return useContext(NonceContext);
}
