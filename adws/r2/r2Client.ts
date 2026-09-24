/**
 * Credentials are read from the R2Config provided by
 * the caller so this factory remains a pure function with no side-effects.
 */

import { S3Client } from '@aws-sdk/client-s3';
import type { R2Config } from './types.ts';

/**
 * The Cloudflare R2 endpoint format is:
 *   `https://<accountId>.r2.cloudflarestorage.com`
 *
 * The region must be set to `"auto"` per Cloudflare's S3 compatibility layer.
 */
export function createR2Client(config: R2Config): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}
