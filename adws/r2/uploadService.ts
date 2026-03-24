/**
 * File upload service for Cloudflare R2.
 *
 * Orchestrates bucket creation (via bucketManager) and object upload,
 * returning a stable public URL for the uploaded object.
 */

import { PutObjectCommand } from '@aws-sdk/client-s3';
import { CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } from '../core/environment.ts';
import { log } from '../core/logger.ts';
import { ensureBucket } from './bucketManager.ts';
import { createR2Client } from './r2Client.ts';
import type { R2Config, UploadOptions, UploadResult } from './types.ts';

/** Public base URL for all screenshots hosted via the Screenshot Router Worker. */
const PUBLIC_BASE_URL = 'https://screenshots.paysdoc.nl';

/**
 * Builds an R2Config from the current process environment.
 * Throws a descriptive error if any required variable is missing.
 */
function buildR2Config(): R2Config {
  const accountId = CLOUDFLARE_ACCOUNT_ID;
  const accessKeyId = R2_ACCESS_KEY_ID;
  const secretAccessKey = R2_SECRET_ACCESS_KEY;

  if (!accountId) throw new Error('Missing required environment variable: CLOUDFLARE_ACCOUNT_ID');
  if (!accessKeyId) throw new Error('Missing required environment variable: R2_ACCESS_KEY_ID');
  if (!secretAccessKey)
    throw new Error('Missing required environment variable: R2_SECRET_ACCESS_KEY');

  return { accountId, accessKeyId, secretAccessKey, publicBaseUrl: PUBLIC_BASE_URL };
}

/**
 * Uploads a file to Cloudflare R2 and returns a stable public URL.
 *
 * Bucket creation is lazy — the bucket is created on first upload for the
 * given owner/repo pair with a 30-day object lifecycle rule.
 *
 * @param options - Upload parameters (owner, repo, key, body, contentType).
 * @returns An UploadResult containing the public URL, bucket name, and key.
 */
export async function uploadToR2(options: UploadOptions): Promise<UploadResult> {
  const { owner, repo, key, body, contentType = 'image/png' } = options;

  const config = buildR2Config();
  const client = createR2Client(config);

  const bucket = await ensureBucket(client, owner, repo);

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );

  const url = `${config.publicBaseUrl}/${repo}/${key}`;
  log(`R2 upload complete: ${url}`, 'success');

  return { url, bucket, key };
}
