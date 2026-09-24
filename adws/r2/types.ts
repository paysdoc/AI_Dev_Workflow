export interface R2Config {
  readonly accountId: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Base URL for public object access (e.g. https://screenshots.paysdoc.nl). */
  readonly publicBaseUrl: string;
}

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

export interface UploadResult {
  readonly url: string;
  readonly bucket: string;
  readonly key: string;
}

export interface BucketInfo {
  readonly name: string;
  readonly createdAt: Date | undefined;
}
