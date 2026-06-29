/**
 * GitHub App Authentication — pure re-export shim (issue #701).
 *
 * The token mint (`getInstallationToken`, `isGitHubAppConfigured`) and all
 * auth primitives live in the structurally-exempt `adws/gitContext/appAuth.ts`.
 * This file re-exports those symbols at the stable import path so all existing
 * consumers keep working without a blast-radius refactor.
 *
 * No `process.env` writes remain here. The subprocess auth that previously
 * relied on `activateGitHubAppAuth` / `refreshTokenIfNeeded` is now sourced
 * per-command from the launch-boundary GitContext via `commandEnv()` overlays
 * in the agent chokepoints (claudeAgent.ts / commandAgent.ts) — the PRD
 * Auth-model contract.
 */

export {
  isGitHubAppConfigured,
  getInstallationToken,
} from '../gitContext';
