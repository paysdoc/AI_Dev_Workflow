/**
 * The upload half of the proof pipeline, shared by the review phase (issue comment) and publishPrProof (PR comment): it
 * uploads the images it is given, which the proof assembler selected, and reads no directory. The pure formatting and the
 * GitHub comment live elsewhere.
 */

import * as fs from 'fs';
import * as path from 'path';
import { log } from '../core/logger';
import { CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } from '../core/environment';
import { uploadToR2 } from '../r2/uploadService';
import type { PerIssueImage, UploadedArtifact, UploaderFn, UploadProofDeps } from './types';

const CONTENT_TYPE_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

function contentTypeForExt(ext: string): string {
  return CONTENT_TYPE_MAP[ext.toLowerCase()] ?? 'image/png';
}

export function isR2Configured(): boolean {
  return Boolean(CLOUDFLARE_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY);
}

let installedUploader: UploaderFn | null = null;

/**
 * Test-only seam: an installed uploader replaces R2 for every call that injects none, and counts
 * as configured, so BDD steps can record uploads without R2 credentials. Pass `null` to restore R2.
 */
export function setProofUploaderForTesting(uploader: UploaderFn | null): void {
  installedUploader = uploader;
}

/** Whether a call that injects no uploader has one to use: R2 with credentials, or an installed uploader. */
export function isProofUploadConfigured(): boolean {
  return isR2Configured() || installedUploader !== null;
}

// Only the real R2 client depends on credentials; a replacement uploader is always usable.
function resolveUploader(injected: UploaderFn | undefined): UploaderFn | null {
  const replacement = injected ?? installedUploader;
  if (replacement) return replacement;
  return isR2Configured() ? uploadToR2 : null;
}

async function uploadOne(
  image: PerIssueImage,
  deps: UploadProofDeps,
  uploader: UploaderFn,
): Promise<UploadedArtifact | null> {
  const { repoInfo, adwId } = deps;
  try {
    const result = await uploader({
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      key: `proof/${adwId}/${image.relPath}`,
      body: fs.readFileSync(image.absPath),
      contentType: contentTypeForExt(path.extname(image.absPath)),
    });
    return {
      scenario: image.scenario,
      url: result.url,
      fileName: path.basename(image.relPath),
    };
  } catch (err) {
    log(`uploadProofArtifacts: failed to upload ${image.relPath} — ${err}`, 'warn');
    return null;
  }
}

/**
 * Non-fatal — never throws; returns the images that uploaded, in the order given.
 * Uploads run one at a time: `uploadToR2` creates the bucket lazily, and parallel first uploads would race it.
 */
export async function uploadProofArtifacts(deps: UploadProofDeps): Promise<UploadedArtifact[]> {
  const uploader = resolveUploader(deps.uploader);
  if (!uploader) return [];

  const uploaded: UploadedArtifact[] = [];
  for (const image of deps.images) {
    const result = await uploadOne(image, deps, uploader);
    if (result) uploaded.push(result);
  }
  return uploaded;
}
