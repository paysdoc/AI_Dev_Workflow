/**
 * Bootstrap identity resolution — absorbed into the gitContext package (issue #700).
 *
 * Pre-context git reads: the one legitimate permanent exception for raw git
 * before a GitContext exists. Lives inside the structurally-exempt package so
 * the guard skips it by directory, not by allowlist.
 *
 * Generic **git** reads only (issue #793) — no forge vocabulary. GitHub
 * remote-URL parsing, App bot-identity derivation, and the `gh` CLI
 * credential read all live in the GitHub forge adapter
 * (`adws/providers/github/`), which composes these readers rather than
 * re-implementing them.
 *
 * No ADW-global imports. All I/O is behind injectable seams for hermetic testing.
 */

import { execSync } from 'child_process';
import type { GitIdentity } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GitConfigIdentityDeps {
  exec?: (cmd: string, opts: { encoding: 'utf-8'; cwd?: string; stdio?: unknown }) => string;
  env?: NodeJS.ProcessEnv;
}

// ---------------------------------------------------------------------------
// readOriginRemoteUrl
// ---------------------------------------------------------------------------

/**
 * Reads the local git remote URL, trimmed. Throws with the raw git failure —
 * parsing (and the forge-specific error wrapping around it) is the adapter's
 * job, not the core's.
 */
export function readOriginRemoteUrl(cwd?: string): string {
  return execSync('git remote get-url origin', { encoding: 'utf-8', cwd }).trim();
}

// ---------------------------------------------------------------------------
// readEnvGitIdentity / readGitConfigIdentity
// ---------------------------------------------------------------------------

/**
 * `GIT_AUTHOR_*` / `GIT_COMMITTER_*` env reads. Pure. Returns a complete
 * identity, or null when the author fields are incomplete — the core
 * supplies no fallback of its own (issue #793: no forge address may
 * originate here).
 */
export function readEnvGitIdentity(env: NodeJS.ProcessEnv): GitIdentity | null {
  const authorName = env['GIT_AUTHOR_NAME'];
  const authorEmail = env['GIT_AUTHOR_EMAIL'];
  const committerName = env['GIT_COMMITTER_NAME'] || authorName;
  const committerEmail = env['GIT_COMMITTER_EMAIL'] || authorEmail;

  if (authorName && authorEmail && committerName && committerEmail) {
    return { authorName, authorEmail, committerName, committerEmail };
  }
  return null;
}

/**
 * `git config user.name` / `user.email`. Returns a complete identity, or
 * null on any git failure or incomplete config — the core supplies no
 * fallback of its own.
 */
export function readGitConfigIdentity(deps: GitConfigIdentityDeps = {}): GitIdentity | null {
  const exec = deps.exec ?? ((cmd, opts) => execSync(cmd, opts as Parameters<typeof execSync>[1]) as string);
  try {
    const name = exec('git config user.name', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const email = exec('git config user.email', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    if (name && email) {
      return { authorName: name, authorEmail: email, committerName: name, committerEmail: email };
    }
  } catch { /* git config not available */ }
  return null;
}
