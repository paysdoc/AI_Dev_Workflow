/**
 * ADW-owned local repo identity reader (#844) — replaces `readLocalRepoInfo`
 * (`adws/providers/github/githubIdentity.ts`) so the only production import
 * into `adws/providers/github` left is the launch boundary itself. Composes
 * the git core's `readOriginRemoteUrl` with the host-neutral
 * `parseOwnerRepoFromUrl` (`adws/providers/workspaceValidation.ts`).
 *
 * `parseOwnerRepoFromUrl` is not a drop-in replacement for
 * `parseGitHubRemoteUrl`: its HTTPS branch requires `https?://` and its SSH
 * branch requires a colon right after the host, so an
 * `ssh://[user@]host/owner/repo` remote — which `readLocalRepoInfo` resolves
 * today — returns null under a plain composition. This reader normalises
 * that one shape to the SCP form (`user@host:owner/repo`) before parsing, so
 * every remote `readLocalRepoInfo` resolves today keeps resolving here.
 *
 * The resolved identity always carries `platform: Platform.GitHub` — ADW's
 * launch-identity convention, the same hard-coded value `buildRepoIdentifier`
 * and `resolveCronRepo`'s fallback use. Forge selection for a run comes from
 * `.adw/providers.md`, never from the remote's host.
 */

import { readOriginRemoteUrl } from '../gitContext';
import { parseOwnerRepoFromUrl } from '../providers/workspaceValidation';
import { Platform, type RepoIdentifier } from '../providers/types';

export interface LocalRepoIdentityDeps {
  /** Defaults to the git core's `readOriginRemoteUrl`. */
  readRemoteUrl?: (cwd?: string) => string;
}

/**
 * Rewrites an `ssh://[user@]host/owner/repo[.git]` remote to the SCP form
 * (`[user@]host:owner/repo[.git]`) so `parseOwnerRepoFromUrl`'s SSH branch —
 * which requires a colon after the host — can match it. Any other remote
 * shape (already SCP-style, HTTPS, garbage) is returned unchanged.
 */
function normalizeSshScheme(remoteUrl: string): string {
  const match = remoteUrl.match(/^ssh:\/\/([^/]+)\/(.+)$/);
  return match ? `${match[1]}:${match[2]}` : remoteUrl;
}

/**
 * Reads the local git remote URL and parses owner/repo from it —
 * host-neutral, unlike the GitHub-only `readLocalRepoInfo` it replaces. One
 * `try/catch` spans both the read and the parse, so a failure at either step
 * surfaces as `Failed to get repo info: …` — the same message
 * `readLocalRepoInfo` used, which `@adw-779`/`@adw-844` both assert on.
 */
export function readLocalRepoIdentity(cwd?: string, deps: LocalRepoIdentityDeps = {}): RepoIdentifier {
  const readRemoteUrl = deps.readRemoteUrl ?? readOriginRemoteUrl;
  try {
    const remoteUrl = readRemoteUrl(cwd);
    const parsed = parseOwnerRepoFromUrl(normalizeSshScheme(remoteUrl));
    if (!parsed) {
      throw new Error(`Could not parse owner/repo from remote URL: ${remoteUrl}`);
    }
    return { owner: parsed.owner, repo: parsed.repo, platform: Platform.GitHub };
  } catch (error) {
    throw new Error(`Failed to get repo info: ${error}`);
  }
}
