/**
 * GitHub App Authentication — shim adapter (issue #700).
 *
 * The token mint (`getInstallationToken`, `isGitHubAppConfigured`) has been
 * absorbed into the structurally-exempt `adws/gitContext/appAuth.ts`. This file
 * re-exports those symbols at the stable import path so all 7 existing consumers
 * keep working without a ~7-site blast radius.
 *
 * `activateGitHubAppAuth` and `refreshTokenIfNeeded` remain here — they write the
 * transitional `process.env.GH_TOKEN`/`GIT_*` vars for subprocess consumers that
 * haven't migrated to per-command auth yet (tracked separately in the PRD). Their
 * `git remote get-url origin` probe is now routed through `readLocalRepoInfo` from
 * the package, so zero raw git/gh strings remain in this file.
 */

import { log } from '../core/utils';
import {
  isGitHubAppConfigured,
  getInstallationToken,
  readLocalRepoInfo,
} from '../gitContext';

// Re-export at the stable path for the 7 consumers
export { isGitHubAppConfigured, getInstallationToken };

// ---------------------------------------------------------------------------
// Transitional process.env provisioning (removed once all callers use per-command auth)
// ---------------------------------------------------------------------------

/**
 * Activates GitHub App auth for a repo, setting `GH_TOKEN` and git identity
 * in `process.env` for subprocess consumers. Transitional — the token-source
 * *read* path in `resolveContextToken` never uses this global; only the
 * subprocess env provisioning writes it.
 *
 * Owner/repo defaults to the local git remote via `readLocalRepoInfo` when
 * not provided.
 */
export function activateGitHubAppAuth(owner?: string, repo?: string, cwd?: string): boolean {
  if (!isGitHubAppConfigured()) return false;

  if (!owner || !repo) {
    try {
      const info = readLocalRepoInfo(cwd);
      owner = info.owner;
      repo = info.repo;
    } catch { /* ignore */ }
  }

  if (!owner || !repo) {
    log('GitHub App auth: could not determine target repo', 'warn');
    return false;
  }

  try {
    const token = getInstallationToken(owner, repo);
    // Transitional: sets process.env.GH_TOKEN for not-yet-migrated subprocess consumers.
    process.env.GH_TOKEN = token;
    configureGitIdentity();
    log(`GitHub App authentication activated for ${owner}/${repo}`);
    return true;
  } catch (error) {
    log(`GitHub App authentication failed for ${owner}/${repo}: ${error}`, 'error');
    return false;
  }
}

/**
 * Refreshes the GitHub App token if near expiry.
 * Transitional: still writes process.env.GH_TOKEN for subprocess consumers.
 */
export function refreshTokenIfNeeded(owner?: string, repo?: string): void {
  if (!isGitHubAppConfigured()) return;
  if (!owner || !repo) return;
  try {
    const token = getInstallationToken(owner, repo);
    process.env.GH_TOKEN = token;
  } catch (error) {
    log(`GitHub App token refresh failed: ${error}`, 'error');
  }
}

// ---------------------------------------------------------------------------
// Git identity configuration for the transitional path
// ---------------------------------------------------------------------------

function configureGitIdentity(): void {
  const appId = process.env.GITHUB_APP_ID;
  const appSlug = process.env.GITHUB_APP_SLUG;
  if (!appId || !appSlug) return;

  const botName = `${appSlug}[bot]`;
  const botEmail = `${appId}+${appSlug}[bot]@users.noreply.github.com`;

  process.env.GIT_AUTHOR_NAME = botName;
  process.env.GIT_AUTHOR_EMAIL = botEmail;
  process.env.GIT_COMMITTER_NAME = botName;
  process.env.GIT_COMMITTER_EMAIL = botEmail;

  log(`Git identity: ${botName} <${botEmail}>`);
}
