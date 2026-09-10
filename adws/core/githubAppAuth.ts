/**
 * GitHub App Authentication — the sole environment-binding shim (issue #792;
 * originally a pure re-export shim from issue #701).
 *
 * The token mint (`getInstallationToken`, `isGitHubAppConfigured`) and all
 * auth primitives live in the GitHub forge adapter
 * (`adws/providers/github/appAuth.ts`), which reads no environment variable —
 * it takes a `GitHubAppConfig` parameter instead. THIS file is the one place
 * in the codebase that reads `GITHUB_APP_ID` / `GITHUB_APP_SLUG` /
 * `GITHUB_APP_PRIVATE_KEY_PATH` from `process.env`, read fresh on every call
 * (not captured once) so a process that exports these variables after module
 * load — as feature-780's steps and feature-776's spawned webhook server both
 * do — is still seen. It re-exports both functions at the stable import path
 * so all existing consumers keep working with unchanged signatures.
 *
 * No `process.env` writes remain here. The subprocess auth that previously
 * relied on `activateGitHubAppAuth` / `refreshTokenIfNeeded` is now sourced
 * per-command from the launch-boundary GitContext via `commandEnv()` overlays
 * in the agent chokepoints (claudeAgent.ts / commandAgent.ts) — the PRD
 * Auth-model contract.
 *
 * Moved verbatim from `adws/github/githubAppAuth.ts` (#820); that path — and
 * the `adws/github/` directory itself — no longer exist, deleted in #823
 * along with `gitContextFactory.ts`, their last importer.
 */

import {
  isGitHubAppConfigured as adapterIsConfigured,
  getInstallationToken as adapterGetInstallationToken,
} from '../providers/github/appAuth';
import type { GitHubAppConfig } from '../providers/github/appAuth';

function readAppConfig(): GitHubAppConfig {
  return {
    appId: process.env.GITHUB_APP_ID,
    appSlug: process.env.GITHUB_APP_SLUG,
    privateKeyPath: process.env.GITHUB_APP_PRIVATE_KEY_PATH,
  };
}

export function isGitHubAppConfigured(): boolean {
  return adapterIsConfigured(readAppConfig());
}

export function getInstallationToken(owner: string, repo: string): string {
  return adapterGetInstallationToken(readAppConfig(), owner, repo);
}
