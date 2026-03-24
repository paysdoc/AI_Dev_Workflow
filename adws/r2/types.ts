/**
 * TypeScript types and interfaces for the R2 upload module.
 */

/** Configuration required to connect to Cloudflare R2 via S3-compatible API. */
export interface R2Config {
  readonly accountId: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Base URL for public object access (e.g. https://screenshots.paysdoc.nl). */
  readonly publicBaseUrl: string;
}

/** Options for uploading a file to R2. */
export interface UploadOptions {
  /** GitHub owner / organisation name (used to derive the bucket name). */
  readonly owner: string;
  /** GitHub repository name (used to derive the bucket name and public URL path). */
  readonly repo: string;
  /** Object key within the bucket (e.g. `review/abc123.png`). */
  readonly key: string;
  /** File content to upload. */
  readonly body: Buffer | Uint8Array | ReadableStream;
  /** MIME type of the uploaded file (default: `image/png`). */
  readonly contentType?: string;
}

/** Result returned after a successful upload. */
export interface UploadResult {
  /** Fully-qualified public URL for the uploaded object. */
  readonly url: string;
  /** R2 bucket name the object was written to. */
  readonly bucket: string;
  /** Object key within the bucket. */
  readonly key: string;
}

/** Metadata for an R2 bucket discovered via the S3 API. */
export interface BucketInfo {
  readonly name: string;
  readonly createdAt: Date | undefined;
}
