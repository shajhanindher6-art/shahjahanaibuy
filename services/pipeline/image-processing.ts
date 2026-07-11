/**
 * Image processing service — validates, deduplicates, and optionally uploads
 * product images to the storage provider.
 *
 * Phase 2: validates URLs, deduplicates within a product, and returns
 * processed image URLs. When a storage provider is available, images can
 * be uploaded to R2/S3 and the CDN URL returned.
 */

import { logger } from '@/lib/config/logger';

export interface ProcessedImage {
  url: string;
  isPrimary: boolean;
}

export interface ImageProcessingOptions {
  uploadToStorage?: boolean;
  maxImages?: number;
}

export async function processImages(
  images: string[],
  options: ImageProcessingOptions = {}
): Promise<ProcessedImage[]> {
  const maxImages = options.maxImages ?? 20;

  // Deduplicate URLs
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const url of images) {
    const normalized = url.trim();
    if (!seen.has(normalized) && normalized.startsWith('http')) {
      seen.add(normalized);
      unique.push(normalized);
    }
  }

  const limited = unique.slice(0, maxImages);

  if (options.uploadToStorage) {
    // Future: upload to storage provider and return CDN URLs
    logger.debug('Image processing: storage upload requested but not yet implemented');
  }

  return limited.map((url, i) => ({
    url,
    isPrimary: i === 0,
  }));
}
