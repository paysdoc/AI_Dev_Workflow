/**
 * Pure proof artifact harvester.
 *
 * Recursively walks a proof directory and returns all image files found,
 * with their paths relative to the harvest root. No I/O side effects beyond
 * the directory read; no uploads, no logging.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ProofArtifact } from './types';

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];

/**
 * Recursively harvests image artifacts from a proof directory.
 *
 * @param dir - Absolute path to the proof directory (ADW_PROOF_DIR).
 * @returns Sorted list of image artifacts found, or [] when dir is absent/empty.
 */
export function harvestProofArtifacts(dir: string): ProofArtifact[] {
  if (!fs.existsSync(dir)) return [];

  const results: ProofArtifact[] = [];
  const stack: string[] = [dir];

  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const absPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (IMAGE_EXTENSIONS.includes(ext)) {
          const relPath = path.relative(dir, absPath).split(path.sep).join('/');
          results.push({ absPath, relPath });
        }
      }
    }
  }

  results.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return results;
}
