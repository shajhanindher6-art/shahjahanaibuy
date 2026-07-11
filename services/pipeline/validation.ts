/**
 * Zod validation schemas for the data pipeline.
 * Validates RawProductData from providers before ingestion.
 */

import { z } from 'zod';

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
  gtin: z.string().max(50).optional().nullable(),
  images: z.array(z.string().url()).max(20).optional(),
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
