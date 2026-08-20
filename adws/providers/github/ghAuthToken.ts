/**
 * `gh auth token` — moved here from the git core by issue #793, resolving
 * the open question `feature-792.feature` flagged rather than pinned
 * ("A DIRECT `gh` SPAWN REMAINS IN THE CORE AFTER THIS SLICE… whichever way
 * the reviewer decides, it should be a decision rather than an oversight").
 *
 * Why this package: #792's guard contract is "only the git core may run
 * git; only the GitHub adapter may issue gh" — `gh auth token` is a `gh`
 * command, so the adapter is its only correct home.
 *
 * Why not the ADW boundary (`adws/github/`): that directory is
 * unprivileged under `adws/checkGitGhGuard.ts`'s `EXEMPT_PACKAGES` — the
 * ALLOWLIST is gone, and `(0 allowlisted)` is pinned by `@adw-700`.
 * `bun run lint:git-guard` would fail a shell-out placed there.
 *
 * Why not routed through `ghCommandRunner`: this function is the
 * pre-context read that *produces* the credential `ghCommandRunner`'s
 * TokenProvider needs — a credentialed executor would recurse through the
 * credential assembly it is being asked for. It stays a direct spawn inside
 * this guard-exempt adapter, the `gh`-side mirror of the core's
 * `readOriginRemoteUrl` pre-context `git` read.
 */

import { execSync } from 'child_process';

/**
 * Returns the `gh auth token` output, or an empty string if gh is not available.
 * Exposed for use by the token resolver in bootstrap contexts.
 */
export function ghAuthToken(): string {
  try {
    return execSync('gh auth token', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
}
