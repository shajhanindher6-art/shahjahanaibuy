/**
 * Zod validation schemas for the data pipeline.
 * Validates RawProductData from providers before ingestion.
 */

import { z } from 'zod';
import { validateGtin } from '@/lib/gtin';
import { validateImageUrl } from '@/lib/image-url';

export const availabilitySchema = z.enum([
  'in_stock',
  'out_of_stock',
  'limited',
  'preorder',
  'unknown',
]);

export const rawProductDataSchema = z.object({
  externalId: z.string().min(1, 'externalId is required'),
  retailerSlug: z.string().min(1, 'retailerSlug is required'),
  name: z.string().min(1, 'name is required').max(500),
  description: z.string().max(5000).optional().nullable(),
  brand: z.string().max(200).optional().nullable(),
  category: z.string().max(300).optional().nullable(),
  // Section 20, §12 #31 — a GTIN is a GS1 identifier, not a
  // free-text field: length alone let any 50-char string through.
  // Empty/absent stays optional; a present value must pass the
  // GS1 check-digit test (lib/gtin.ts). Normalization strips
  // spaces/hyphens before the check, so '978-0-2013-7962-4'
  // validates exactly like its digits-only form.
  gtin: z
    .string()
    .max(50)
    .optional()
    .nullable()
    .refine(
      (v) => v == null || v.trim() === '' || validateGtin(v).valid,
      { message: 'gtin is not a valid GS1 GTIN (wrong check digit or unsupported length)' }
    ),
  // Section 20, §12 #94 — images must be valid http(s) image
  // URLs (zod .url() alone accepted data: / javascript: /
  // credential-bearing URLs, which must never be stored).
  images: z
    .array(z.string().url())
    .max(20)
    .optional()
    .refine((arr) => !arr || arr.every((u) => validateImageUrl(u).valid), {
      message: 'images must be valid http(s) image URLs',
    }),
  // Price stays min(0) here BY DESIGN (Section 20, §12 #16):
  // validation answers "is this well-formed", and the
  // minimum-confidence / price->0 gate lives in ingestProduct
  // (services/pipeline/ingestion.ts), which is the only place
  // that can reject a product from being CREATED. A price-0
  // update to an already-catalogued product is not an insertion
  // and is not gated here.
  price: z.number().min(0, 'price must be non-negative'),
  currency: z.string().length(3, 'currency must be a 3-letter ISO code'),
  availability: availabilitySchema,
  url: z.string().url().optional().nullable(),
  raw: z.record(z.unknown()).optional(),
});

export type ValidatedRawProduct = z.infer<typeof rawProductDataSchema>;

export function validateRawProduct(data: unknown):
  | { success: true; data: ValidatedRawProduct }
  | { success: false; errors: Record<string, string[]> } {
  const result = rawProductDataSchema.safeParse(data);
  if (result.success) return { success: true, data: result.data };
  const errors: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join('.') || '_';
    if (!errors[path]) errors[path] = [];
    errors[path].push(issue.message);
  }
  return { success: false, errors };
}
