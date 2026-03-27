/**
 * Screenshot Router — Cloudflare Worker
 *
 * Routes `screenshots.paysdoc.nl/{repo}/{...key}` requests to the correct
 * per-repo Cloudflare R2 bucket (`adw-paysdoc-{repo}`), using the S3-compatible
 * API with credentials injected as Worker secrets.
 *
 * Also exports a `scheduled` handler that runs daily (cron: `0 3 * * *`) to
 * garbage-collect empty `adw-*` R2 buckets via the Cloudflare API.
 */

import { DeleteBucketCommand, GetObjectCommand, ListBucketsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';

/** Minimal Cloudflare Workers ScheduledEvent shape (full type requires @cloudflare/workers-types). */
interface ScheduledEvent {
  readonly scheduledTime: number;
  readonly cron: string;
}

// ---------------------------------------------------------------------------
// Environment bindings (injected as Worker secrets)
// ---------------------------------------------------------------------------

interface Env {
  readonly CLOUDFLARE_ACCOUNT_ID: string;
  readonly R2_ACCESS_KEY_ID: string;
  readonly R2_SECRET_ACCESS_KEY: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OWNER = 'paysdoc';

/** Normalises a path segment for bucket name use (lowercase, hyphens only). */
function normaliseSegment(segment: string): string {
  return segment
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

/** Derives the R2 bucket name for a given repo. */
function toBucketName(repo: string): string {
  return `adw-${normaliseSegment(OWNER)}-${normaliseSegment(repo)}`.slice(0, 63);
}

/** Builds an S3Client pointed at Cloudflare R2 for the given account. */
function buildS3Client(env: Env): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });
}

/** Parses `/{repo}/{...key}` from a URL pathname. Returns null for invalid paths. */
function parsePath(pathname: string): { repo: string; key: string } | null {
  // Strip leading slash and split
  const stripped = pathname.replace(/^\//, '').replace(/\/$/, '');
  const slashIdx = stripped.indexOf('/');
  if (slashIdx === -1 || slashIdx === stripped.length - 1) return null;

  const repo = stripped.slice(0, slashIdx);
  const key = stripped.slice(slashIdx + 1);
  if (!repo || !key) return null;

  return { repo, key };
}

// ---------------------------------------------------------------------------
// fetch handler — request routing
// ---------------------------------------------------------------------------

async function handleFetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const parsed = parsePath(url.pathname);

  if (!parsed) {
    return new Response('Bad Request: expected /{repo}/{key}', { status: 400 });
  }

  const { repo, key } = parsed;
  const bucket = toBucketName(repo);
  const client = buildS3Client(env);

  let result;
  try {
    result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  } catch (err: unknown) {
    const is404 =
      err instanceof Error &&
      (err.name === 'NoSuchKey' ||
        err.name === 'NoSuchBucket' ||
        (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404);

    if (is404) {
      return new Response(`Not Found: ${repo}/${key}`, { status: 404 });
    }
    throw err;
  }

  const contentType = result.ContentType ?? 'application/octet-stream';
  const body = result.Body;

  if (!body) {
    return new Response('Not Found', { status: 404 });
  }

  // stream the R2 object body back to the client
  const responseBody = body instanceof ReadableStream
    ? body
    : (body as { transformToWebStream(): ReadableStream }).transformToWebStream();

  return new Response(responseBody, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400',
    },
  });
}

// ---------------------------------------------------------------------------
// scheduled handler — empty bucket garbage collection
// ---------------------------------------------------------------------------

async function handleScheduled(env: Env): Promise<void> {
  const client = buildS3Client(env);

  // List all buckets and filter to adw-* ones
  const listResult = await client.send(new ListBucketsCommand({}));
  const adwBuckets = (listResult.Buckets ?? []).filter(
    (b) => b.Name?.startsWith('adw-'),
  );

  for (const bucket of adwBuckets) {
    if (!bucket.Name) continue;

    try {
      const objects = await client.send(
        new ListObjectsV2Command({ Bucket: bucket.Name, MaxKeys: 1 }),
      );

      const isEmpty = (objects.KeyCount ?? 0) === 0;
      if (!isEmpty) continue;

      await client.send(new DeleteBucketCommand({ Bucket: bucket.Name }));
      console.log(`[screenshot-router] Deleted empty bucket: ${bucket.Name}`);
    } catch (err: unknown) {
      // Tolerate per-bucket errors (e.g. permission denied) so the loop continues
      console.error(
        `[screenshot-router] Error processing bucket ${bucket.Name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Worker export
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleFetch(request, env);
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await handleScheduled(env);
  },
};
