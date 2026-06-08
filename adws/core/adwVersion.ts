/**
 * Deep module for reading and writing the `.adw-version` file at a target
 * repo's worktree root. The file stores the SHA256 content hash the repo was
 * last initialized with, in the format: plain hex SHA256 + single trailing
 * newline, no metadata.
 *
 * Per the parent PRD's "Hash storage on target repos" section
 * (`specs/prd/adw-init-hash-and-label-classification.md`), `.adw-version`
 * lives at the repo root (outside `.adw/`) so LLM regeneration of `.adw/`
 * cannot clobber it.
 *
 * Read rule: absent file or present-but-empty/whitespace-only → null.
 * Only absence maps to null; genuine I/O failures on an existing file propagate.
 */

import * as fs from 'fs';
import * as path from 'path';

export const ADW_VERSION_FILENAME = '.adw-version';

/**
 * Reads the stored framework hash from `<worktreePath>/.adw-version`.
 *
 * @param worktreePath - Absolute path to the target repo's worktree root.
 * @returns The trimmed hash string, or null if the file is absent or contains
 *   only whitespace (treating "never initialized" the same as "out of date").
 */
export function readAdwVersion(worktreePath: string): string | null {
  const filePath = path.join(worktreePath, ADW_VERSION_FILENAME);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const content = fs.readFileSync(filePath, 'utf-8').trim();
  return content.length > 0 ? content : null;
}

/**
 * Writes the framework hash to `<worktreePath>/.adw-version` in canonical
 * format: trimmed hash + single trailing newline. Overwrites any existing
 * content. Assumes `worktreePath` already exists.
 *
 * @param worktreePath - Absolute path to the target repo's worktree root.
 * @param hash - The SHA256 hash to store.
 */
export function writeAdwVersion(worktreePath: string, hash: string): void {
  const filePath = path.join(worktreePath, ADW_VERSION_FILENAME);
  fs.writeFileSync(filePath, `${hash.trim()}\n`, 'utf-8');
}
