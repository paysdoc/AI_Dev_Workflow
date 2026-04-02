/**
 * Lazy bucket creation and lifecycle management for Cloudflare R2.
 *
 * Buckets are created on demand with the naming convention `adw-{owner}-{repo}`.
 * A 30-day expiration lifecycle rule is applied at creation time.
 * A module-level cache prevents redundant HeadBucket checks within a process lifetime.
 */

import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketLifecycleConfigurationCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { log } from '../core/logger.ts';

/** Maximum S3 bucket name length. */
const MAX_BUCKET_NAME_LENGTH = 63;

/** In-process cache of confirmed-existing bucket names. */
const knownBuckets = new Set<string>();

/**
 * Normalises an owner or repo segment for use in an S3 bucket name.
 *
 * S3 bucket names must be lowercase, 3–63 characters, contain only
 * letters, numbers, and hyphens, and must not start or end with a hyphen.
 */
function normaliseSegment(segment: string): string {
  return segment
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

/**
 * Derives the canonical R2 bucket name for an owner/repo pair.
 *
 * Format: `adw-{owner}-{repo}` (truncated to 63 characters if necessary).
 */
export function toBucketName(owner: string, repo: string): string {
  const name = `adw-${normaliseSegment(owner)}-${normaliseSegment(repo)}`;
  return name.slice(0, MAX_BUCKET_NAME_LENGTH);
}

/**
 * Applies a 30-day expiration lifecycle rule to the given bucket.
 */
async function applyLifecycleRule(client: S3Client, bucket: string): Promise<void> {
  await client.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket: bucket,
      LifecycleConfiguration: {
        Rules: [
          {
            ID: 'expire-after-30-days',
            Status: 'Enabled',
            Filter: { Prefix: '' },
            Expiration: { Days: 30 },
          },
        ],
      },
    }),
  );
}

/**
 * Ensures the R2 bucket for the given owner/repo pair exists.
 *
 * - If the bucket already exists, this is a no-op (fast path via in-process cache).
 * - If the bucket does not exist, it is created and a 30-day lifecycle rule is applied.
 * - Concurrent creation races (BucketAlreadyExists / BucketAlreadyOwnedByYou) are handled gracefully.
 *
 * Returns the canonical bucket name.
 */
export async function ensureBucket(client: S3Client, owner: string, repo: string): Promise<string> {
  const bucket = toBucketName(owner, repo);

  if (knownBuckets.has(bucket)) {
    return bucket;
  }

  // Check whether the bucket already exists
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    knownBuckets.add(bucket);
    return bucket;
  } catch (err: unknown) {
    const isNotFound =
      err instanceof Error &&
      ('$metadata' in err
        ? (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404
        : err.message.includes('404') || err.message.includes('NoSuchBucket'));

    if (!isNotFound) {
      throw err;
    }
  }

  // Bucket does not exist — create it
  try {
    await client.send(new CreateBucketCommand({ Bucket: bucket, CreateBucketConfiguration: { LocationConstraint: 'eu' } }));
    log(`R2 bucket created: ${bucket}`, 'info');
  } catch (err: unknown) {
    const isAlreadyExists =
      err instanceof Error &&
      (err.name === 'BucketAlreadyExists' || err.name === 'BucketAlreadyOwnedByYou');

    if (!isAlreadyExists) {
      throw err;
    }
    // Another concurrent process created the bucket — that's fine
    log(`R2 bucket already exists (concurrent creation): ${bucket}`, 'info');
  }

  // Apply 30-day lifecycle rule (best-effort; log on failure but don't abort)
  try {
    await applyLifecycleRule(client, bucket);
    log(`R2 lifecycle rule applied to bucket: ${bucket}`, 'info');
  } catch (err: unknown) {
    log(
      `Failed to apply lifecycle rule to bucket ${bucket}: ${err instanceof Error ? err.message : String(err)}`,
      'warn',
    );
  }

  knownBuckets.add(bucket);
  return bucket;
}
