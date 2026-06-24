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
import { execSync } from 'child_process';

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

/**
 * Reads the stored framework hash from the target repo's remote default branch
 * using `git show origin/<defaultBranch>:.adw-version`.
 *
 * This is the authoritative read for the upgrade gate: it is immune to stale
 * local worktrees, since it reads directly from the remote ref rather than any
 * local file. A stale reused worktree cannot spoof an old version.
 *
 * Returns null when the file is absent on the remote (treating "never
 * initialized" the same as "out of date"), or when the content is empty.
 * Any non-404 git error propagates as-is.
 *
 * @param defaultBranch - The remote default branch name (e.g. "main", "dev").
 * @param workspacePath - Absolute path to the target repo clone (the main checkout,
 *   not a feature worktree). Used as cwd for the git command so that `origin`
 *   resolves to the target remote.
 */
export function readRemoteAdwVersion(defaultBranch: string, workspacePath: string): string | null {
  try {
    const raw = execSync(
      `git show "origin/${defaultBranch}:${ADW_VERSION_FILENAME}"`,
      { cwd: workspacePath, stdio: 'pipe' },
    ).toString();
    const content = raw.trim();
    return content.length > 0 ? content : null;
  } catch {
    // File absent on remote branch → treat as "never initialized"
    return null;
  }
}
