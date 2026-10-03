/**
 * Harvest → upload half of the proof pipeline, shared by the review phase (issue comment) and
 * publishPrProof (PR comment). The pure formatting and the GitHub comment live elsewhere.
 */

import * as fs from 'fs';
import * as path from 'path';
import { log } from '../core/logger';
import { CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } from '../core/environment';
import { uploadToR2 } from '../r2/uploadService';
import { harvestProofArtifacts } from './proofArtifactHarvester';
import type { ProofArtifact, UploadedArtifact, UploaderFn, UploadProofDeps } from './types';

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

function leadingSegment(relPath: string): string {
  const parts = relPath.split('/');
  return parts.length > 1 ? parts[0] : 'Screenshots';
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

// Only the real R2 client depends on credentials; a replacement uploader is always usable.
function resolveUploader(injected: UploaderFn | undefined): UploaderFn | null {
  const replacement = injected ?? installedUploader;
  if (replacement) return replacement;
  return isR2Configured() ? uploadToR2 : null;
}

function harvestOrNothing(artifactsDir: string): ProofArtifact[] {
  try {
    return harvestProofArtifacts(artifactsDir);
  } catch (err) {
    log(`uploadProofArtifacts: could not read ${artifactsDir} — ${err}`, 'warn');
    return [];
  }
}

async function uploadOne(
  artifact: ProofArtifact,
  deps: UploadProofDeps,
  uploader: UploaderFn,
): Promise<UploadedArtifact | null> {
  const { repoInfo, adwId } = deps;
  try {
    const result = await uploader({
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      key: `proof/${adwId}/${artifact.relPath}`,
      body: fs.readFileSync(artifact.absPath),
      contentType: contentTypeForExt(path.extname(artifact.absPath)),
    });
    return {
      scenario: leadingSegment(artifact.relPath),
      url: result.url,
      fileName: path.basename(artifact.relPath),
    };
  } catch (err) {
    log(`uploadProofArtifacts: failed to upload ${artifact.relPath} — ${err}`, 'warn');
    return null;
  }
}

/**
 * Non-fatal — never throws; returns the artifacts that uploaded, in harvest order.
 * Uploads run one at a time: `uploadToR2` creates the bucket lazily, and parallel first uploads would race it.
 */
export async function uploadProofArtifacts(deps: UploadProofDeps): Promise<UploadedArtifact[]> {
  const uploader = resolveUploader(deps.uploader);
  if (!uploader) return [];

  const uploaded: UploadedArtifact[] = [];
  for (const artifact of harvestOrNothing(deps.artifactsDir)) {
    const result = await uploadOne(artifact, deps, uploader);
    if (result) uploaded.push(result);
  }
  return uploaded;
}
