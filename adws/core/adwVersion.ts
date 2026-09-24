/**
 * The file stores the SHA256 content hash the repo was last initialized
 * with, in the format: plain hex SHA256 + single trailing newline, no
 * metadata. `.adw-version` lives at the repo root (outside `.adw/`) so LLM
 * regeneration of `.adw/` cannot clobber it.
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
 * Canonical format: trimmed hash + single trailing newline. Assumes
 * `worktreePath` already exists.
 */
export function writeAdwVersion(worktreePath: string, hash: string): void {
  const filePath = path.join(worktreePath, ADW_VERSION_FILENAME);
  fs.writeFileSync(filePath, `${hash.trim()}\n`, 'utf-8');
}

/**
 * Reads the stored framework hash from the target repo's remote default branch.
 *
 * Routes through an injected `show` function (GitContext-backed at the call site)
 * so this module contains no direct git shell-outs. The read is authoritative and
 * immune to stale local worktrees because it resolves `origin/<defaultBranch>`,
 * not any local file. `workspacePath` must be the target clone root so that
 * `origin` resolves to the target remote.
 *
 * Returns null when the file is absent on the remote, when content is empty or
 * whitespace-only, or when `show` throws (e.g. the branch does not exist).
 *
 * @param workspacePath - Absolute path to the target repo clone (the main checkout,
 *   not a feature worktree).
 */
export function readRemoteAdwVersion(
  show: (ref: string, filePath: string, cwd: string) => string,
  defaultBranch: string,
  workspacePath: string,
): string | null {
  try {
    const content = show(`origin/${defaultBranch}`, ADW_VERSION_FILENAME, workspacePath).trim();
    return content.length > 0 ? content : null;
  } catch {
    return null;
  }
}
