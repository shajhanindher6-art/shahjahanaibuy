/**
 * Storage abstraction layer.
 *
 * Consumers should import from this barrel rather than reaching into
 * individual provider modules. The active backend is selected by the
 * registry based on environment configuration.
 *
 * @example
 * import { getStorageProvider } from '@/lib/storage';
 *
 * const storage = getStorageProvider();
 * const obj = await storage.upload('avatars/123.png', buffer, {
 *   contentType: 'image/png',
 * });
 */

export type { StorageObject, UploadOptions, StorageProvider } from './types';
export { R2StorageProvider } from './r2-provider';
export { S3StorageProvider } from './s3-provider';
export { LocalStorageProvider } from './local-provider';
export {
  getStorageProvider,
  resetStorageProvider,
  listStorageProviders,
} from './registry';
