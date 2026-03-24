/**
 * R2 upload module — barrel export.
 *
 * Provides utilities for uploading files to Cloudflare R2 and managing
 * per-repository buckets with a consistent naming convention.
 */

export type { R2Config, UploadOptions, UploadResult, BucketInfo } from './types.ts';
export { createR2Client } from './r2Client.ts';
export { toBucketName, ensureBucket } from './bucketManager.ts';
export { uploadToR2 } from './uploadService.ts';
