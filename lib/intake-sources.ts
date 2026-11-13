/**
 * Intake source identifiers — zero-import leaf module.
 *
 * Section 20 build fix: `services/price-verification.ts` is imported by
 * client components (`components/products/product-card.tsx`), so it must
 * never import the server-only intake modules
 * (`services/catalog-intake.ts`, `services/ebay-intake.ts`) — those pull
 * in the CSV provider and the visual-search SSRF guard (`node:dns` /
 * `node:net`), which webpack cannot bundle for the browser and fails
 * the production build (`UnhandledSchemeError: node:net`). The
 * constants live here instead; the intake modules re-export them for
 * backwards compatibility. This file must stay import-free.
 */
export const INTAKE_SOURCE = 'manual-intake' as const;
export const EBAY_INTAKE_SOURCE = 'ebay-browse-api' as const;
