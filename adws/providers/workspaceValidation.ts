/**
 * Workspace validation helpers for `createRepoContext` (moved verbatim from
 * `repoContext.ts` in #818 to keep that file under the 300-line cap; fs-only,
 * no identity construction, no framework imports).
 */

import { existsSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Validates that the working directory exists and contains a `.git` directory.
 */
export function validateWorkingDirectory(cwd: string): void {
  if (!existsSync(cwd)) {
    throw new Error(`Working directory does not exist: ${cwd}`);
  }

  const stat = statSync(cwd);
  if (!stat.isDirectory()) {
    throw new Error(`Working directory is not a directory: ${cwd}`);
  }

  if (!existsSync(join(cwd, '.git'))) {
    throw new Error(
      `Working directory is not a git repository (no .git found): ${cwd}`,
    );
  }
}

/**
 * Parses owner and repo from a git remote URL.
 * Supports HTTPS and SSH URLs for any host (GitHub, GitLab, Bitbucket, etc.).
 */
export function parseOwnerRepoFromUrl(
  remoteUrl: string,
): { owner: string; repo: string } | null {
  // HTTPS: https://hostname/owner/repo.git or https://hostname/owner/repo
  const httpsMatch = remoteUrl.match(/https?:\/\/[^/]+\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  // SSH: git@hostname:owner/repo.git or git@hostname:owner/repo
  const sshMatch = remoteUrl.match(/git@[^:]+:([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  const match = httpsMatch || sshMatch;
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}
