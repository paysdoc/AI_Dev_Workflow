/**
 * GitHub App Authentication — the sole environment-binding shim (issue #840).
 *
 * The token mint (`getInstallationToken`, `isGitHubAppConfigured`) and all
 * auth primitives live in `@paysdoc/devplatform/providers`, which reads no
 * environment variable — it takes a `GitHubAppConfig` parameter instead.
 * THIS file is the one place in the codebase that reads `GITHUB_APP_ID` /
 * `GITHUB_APP_SLUG` / `GITHUB_APP_PRIVATE_KEY_PATH` from `process.env`, read
 * fresh on every call (not captured once) so a process that exports these
 * variables after module load — as feature-780's steps and feature-776's
 * spawned webhook server both do — is still seen. The launch boundary
 * (`launchGitContext.ts`) hands `readGitHubAppConfig()`'s result to the
 * library's `createForgeCredentials`; the library itself never reads the
 * host environment (PRD story 9).
 *
 * No `process.env` writes remain here. The subprocess auth that previously
 * relied on `activateGitHubAppAuth` / `refreshTokenIfNeeded` is now sourced
 * per-command from the launch-boundary GitContext via `commandEnv()` overlays
 * in the agent chokepoints (claudeAgent.ts / commandAgent.ts) — the PRD
 * Auth-model contract.
 */

import {
  isGitHubAppConfigured as adapterIsConfigured,
  getInstallationToken as adapterGetInstallationToken,
} from '@paysdoc/devplatform/providers';
import type { GitHubAppConfig } from '@paysdoc/devplatform/providers';

/** Reads the GitHub App configuration from the environment, fresh on every call. Any missing field means "not configured". */
export function readGitHubAppConfig(): GitHubAppConfig {
  return {
    appId: process.env.GITHUB_APP_ID,
    appSlug: process.env.GITHUB_APP_SLUG,
    privateKeyPath: process.env.GITHUB_APP_PRIVATE_KEY_PATH,
  };
}

export function isGitHubAppConfigured(): boolean {
  return adapterIsConfigured(readGitHubAppConfig());
}

export function getInstallationToken(owner: string, repo: string): string {
  return adapterGetInstallationToken(readGitHubAppConfig(), owner, repo);
}
