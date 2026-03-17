# Bug: orchestrator child processes inherit stale GH_TOKEN, causing 401 errors

## Metadata
issueNumber: `213`
adwId: `4kk6lc-bug-orchestrator-chi`
issueJson: `{"number":213,"title":"Bug: orchestrator child processes inherit stale GH_TOKEN, causing 401 errors","body":"## Description\n\nWhen the cron or webhook trigger spawns an orchestrator workflow (e.g., `adwPlanBuild.tsx`, `adwSdlc.tsx`) as a detached child process, the child inherits `process.env.GH_TOKEN` — a GitHub App installation token that expires after **1 hour**.\n\nThe child process **never calls `activateGitHubAppAuth()`** to generate its own fresh token. If the inherited token expires mid-workflow, all `gh` CLI calls fail with:\n\n```\nHTTP 401: Bad credentials (https://api.github.com/graphql)\nTry authenticating with:  gh auth login\n```\n\nThis also affects `moveIssueToStatus()` calls which fail silently (caught by try/catch in `projectBoardApi.ts`), causing project board status transitions to be skipped.\n\n### Root cause\n\n`activateGitHubAppAuth()` is only called in triggers:\n- `trigger_cron.ts:34`\n- `trigger_webhook.ts:237`\n\nNo orchestrator or workflow initializer calls it. The parent trigger refreshes its own token periodically (`refreshTokenIfNeeded()`), but child processes don't share `process.env` after `spawn()`.\n\n### Fix\n\nCall `activateGitHubAppAuth()` at the start of both workflow initializers so each child process generates its own fresh 1-hour token:\n\n1. **`adws/phases/workflowInit.ts`** — in `initializeWorkflow()`, call `activateGitHubAppAuth(owner, repo)` early (before any `gh` CLI calls), using the resolved repo owner/repo.\n\n2. **`adws/phases/prReviewPhase.ts`** — in `initializePRReviewWorkflow()`, call `activateGitHubAppAuth(owner, repo)` early.\n\nThis ensures that even when spawned by a trigger with a stale inherited token, the orchestrator immediately replaces it with a fresh one. If GitHub App env vars are not configured, `activateGitHubAppAuth()` returns `false` and falls back to `gh auth login` credentials — no behavior change for non-App setups.\n\n## Acceptance Criteria\n\n- [ ] `initializeWorkflow()` calls `activateGitHubAppAuth()` before any `gh` CLI operations\n- [ ] `initializePRReviewWorkflow()` calls `activateGitHubAppAuth()` before any `gh` CLI operations\n- [ ] When GitHub App is configured, child processes generate their own fresh token instead of relying on the inherited `GH_TOKEN`\n- [ ] When GitHub App is not configured, behavior is unchanged (falls back to `gh auth login`)\n- [ ] Type-checks pass (`bunx tsc --noEmit --project adws/tsconfig.json`)","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-17T11:26:07Z","comments":[],"actionableComment":null}`

## Bug Description
When the cron or webhook trigger spawns an orchestrator workflow (e.g., `adwPlanBuild.tsx`, `adwSdlc.tsx`) as a detached child process, the child inherits `process.env.GH_TOKEN` — a GitHub App installation token that expires after 1 hour. The child process never calls `activateGitHubAppAuth()` to generate its own fresh token. If the inherited token expires mid-workflow, all `gh` CLI calls fail with HTTP 401 errors. This also causes `moveIssueToStatus()` calls to fail silently, skipping project board status transitions.

**Expected:** Each orchestrator child process generates its own fresh GitHub App installation token on startup, independent of the parent trigger's token.

**Actual:** Child processes rely on the inherited (potentially stale) `GH_TOKEN` from the parent trigger, which expires after 1 hour and is never refreshed.

## Problem Statement
`activateGitHubAppAuth()` is only called at trigger startup (`trigger_cron.ts:34`, `trigger_webhook.ts:237`). The two workflow initializers — `initializeWorkflow()` and `initializePRReviewWorkflow()` — never call it. Since child processes spawned via `spawn()` inherit `process.env` as a snapshot at fork time, the parent trigger's periodic `refreshTokenIfNeeded()` calls do not propagate to child processes.

## Solution Statement
Add an `activateGitHubAppAuth(owner, repo)` call at the start of both `initializeWorkflow()` and `initializePRReviewWorkflow()`, before any `gh` CLI operations occur. Both functions already resolve the repo owner/repo early, so the owner/repo values are available. `activateGitHubAppAuth()` returns `false` gracefully when GitHub App env vars are not configured, so non-App setups remain unaffected.

## Steps to Reproduce
1. Configure GitHub App authentication (set `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY_PATH`)
2. Start the cron trigger (`bunx tsx adws/triggers/trigger_cron.ts`)
3. Let the trigger spawn an orchestrator workflow for an issue
4. Wait > 1 hour for the inherited `GH_TOKEN` to expire
5. Observe 401 errors in the child process's `gh` CLI calls

## Root Cause Analysis
`activateGitHubAppAuth()` generates a fresh GitHub App installation token and sets it as `process.env.GH_TOKEN`. This function is only called in:
- `adws/triggers/trigger_cron.ts:34` — at module level (cron startup)
- `adws/triggers/trigger_webhook.ts:237` — at webhook startup

When these triggers spawn orchestrator child processes, the child inherits the parent's `process.env` including `GH_TOKEN`. However, `process.env` is copied at `spawn()` time — subsequent refreshes by the parent (`refreshTokenIfNeeded()`) do not propagate to children. Neither `initializeWorkflow()` (in `workflowInit.ts`) nor `initializePRReviewWorkflow()` (in `prReviewPhase.ts`) calls `activateGitHubAppAuth()`, so the child never generates its own token. After the inherited token's 1-hour lifetime, all GitHub API calls fail.

## Relevant Files
Use these files to fix the bug:

- `adws/phases/workflowInit.ts` — Contains `initializeWorkflow()`, the primary workflow initializer. Needs `activateGitHubAppAuth()` call before `fetchGitHubIssue()` (the first `gh` CLI operation). Owner/repo is resolved at lines 96-98 from `targetRepo` or `getRepoInfo()`.
- `adws/phases/prReviewPhase.ts` — Contains `initializePRReviewWorkflow()`, the PR review workflow initializer. Needs `activateGitHubAppAuth()` call before `fetchPRDetails()` (the first `gh` CLI operation). Owner/repo is resolved at line 46 via `resolvedRepoInfo`.
- `adws/github/githubAppAuth.ts` — Contains `activateGitHubAppAuth()`, `refreshTokenIfNeeded()`, and `isGitHubAppConfigured()`. Already exported from `adws/github/index.ts`. No changes needed in this file.
- `adws/triggers/trigger_cron.ts` — Current call site for `activateGitHubAppAuth()` at line 34. Reference only, no changes needed.
- `adws/triggers/trigger_webhook.ts` — Current call site for `activateGitHubAppAuth()` at line 237. Reference only, no changes needed.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Add `activateGitHubAppAuth()` call to `initializeWorkflow()` in `workflowInit.ts`

- Import `activateGitHubAppAuth` from `'../github'` (it is already exported from `adws/github/index.ts`)
- Add the import to the existing `import { ... } from '../github'` block at line 27
- After the `repoInfo` resolution (line 96-98) and before the `fetchGitHubIssue()` call (line 102), add:
  ```ts
  // Activate GitHub App auth to generate a fresh token for this process.
  // Ensures child processes spawned by triggers don't rely on stale inherited GH_TOKEN.
  const resolvedRepoForAuth = repoInfo ?? getRepoInfo();
  activateGitHubAppAuth(resolvedRepoForAuth.owner, resolvedRepoForAuth.repo);
  ```
- Note: `activateGitHubAppAuth()` returns `false` gracefully when GitHub App is not configured, so no conditional check is needed. The return value can be ignored.

### 2. Add `activateGitHubAppAuth()` call to `initializePRReviewWorkflow()` in `prReviewPhase.ts`

- Import `activateGitHubAppAuth` from `'../github'` — add it to the existing `import { ... } from '../github'` block at line 8
- After the `resolvedRepoInfo` resolution (line 46) and before the `fetchPRDetails()` call (line 47), add:
  ```ts
  // Activate GitHub App auth to generate a fresh token for this process.
  // Ensures child processes spawned by triggers don't rely on stale inherited GH_TOKEN.
  activateGitHubAppAuth(resolvedRepoInfo.owner, resolvedRepoInfo.repo);
  ```

### 3. Run validation commands to confirm the fix compiles and passes all checks

- Run the validation commands listed below to ensure the fix is correct and introduces no regressions.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bunx tsc --noEmit` — Root-level TypeScript type check
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type check
- `bun run lint` — Lint check for code quality
- `bun run build` — Build verification

## Notes
- The `guidelines/coding_guidelines.md` has been reviewed and the fix adheres to all guidelines. The change is minimal, isolated to the boundary (system entry points), and follows the existing pattern used in triggers.
- No new libraries are needed.
- This is not a UI-affecting bug, so no E2E tests are needed.
- `activateGitHubAppAuth()` is idempotent — if a valid token already exists in the cache, `getInstallationToken()` returns it without making API calls (see `githubAppAuth.ts:149-151`). Calling it in workflow initializers when the token is still valid (e.g., when running orchestrators manually without a trigger) adds negligible overhead.
- The fix ensures that even when the parent trigger has already activated auth, each child process independently generates its own fresh token, decoupling child process lifetimes from the parent's token refresh cycle.
