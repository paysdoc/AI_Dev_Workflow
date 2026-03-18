# Bug: Project board falls back to GITHUB_PAT when app token cannot access Projects V2

## Metadata
issueNumber: `235`
adwId: `9tknkw-project-board-fall-b`
issueJson: `{"number":235,"title":"Project board: fall back to GITHUB_PAT when app token cannot access Projects V2","body":"## Problem\n\n`moveIssueToStatus()` in `projectBoardApi.ts` silently fails when the GitHub App installation token cannot see Projects V2. This happens because:\n\n1. **User-owned projects** (e.g., `paysdoc/AI_Dev_Workflow`) are not accessible via GitHub App tokens — the Projects V2 org permission does not apply to user accounts\n2. The `findRepoProjectId()` GraphQL query returns `nodes: []` with the app token but correctly returns the project with a user PAT\n3. The failure is logged at `info` level (\"No project linked to...\") and returns `false` — callers ignore the return value\n\nThis causes issues to remain stuck in \"Todo\" despite completing workflow phases.\n\n## Proposed Solution\n\nIn `projectBoardApi.ts`, when `GH_TOKEN` is set (app token) and `findRepoProjectId` returns null, temporarily swap to `GITHUB_PAT` for the project board GraphQL calls and retry. This keeps the app token as primary auth for all other operations while ensuring project board updates work for user-owned projects.\n\nAdditionally:\n- Promote \"No project linked\" and \"status not found\" log messages from `info` to `warn`\n- Log which auth method was used for project board operations to aid debugging\n\n## Files to Change\n\n- `adws/github/projectBoardApi.ts` — add PAT fallback in `moveIssueToStatus`, upgrade log levels\n- `adws/core/config.ts` — ensure `GITHUB_PAT` is accessible for fallback\n\n## Context\n\n- Confirmed via direct test: app token returns `{\"nodes\":[]}` for `repository.projectsV2`, user token returns the project\n- `paysdoc` is a User account (not an Org), so the \"Projects\" V2 org permission cannot help here\n- For org-owned repos like `vestmatic`, the app's \"Projects\" org permission can be enabled separately\n- Related to issue #233 where the plan phase completed but the issue stayed in \"Todo\"","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-18T13:39:38Z","comments":[],"actionableComment":null}`

## Bug Description
`moveIssueToStatus()` in `projectBoardApi.ts` silently fails when the GitHub App installation token (`GH_TOKEN`) cannot see Projects V2. The `findRepoProjectId()` GraphQL query returns `nodes: []` with the app token but correctly returns the project with a user PAT (`GITHUB_PAT`). The failure is logged at `info` level ("No project linked to...") and returns `false`, so callers silently skip the update. This causes issues to remain stuck in "Todo" despite completing workflow phases.

**Expected behavior**: Issue moves to the correct project board column (e.g., "In Progress", "Building", "Review") as the workflow progresses.

**Actual behavior**: Issue stays in "Todo" because the app token cannot access user-owned Projects V2, and no fallback to `GITHUB_PAT` is attempted.

## Problem Statement
GitHub App installation tokens cannot access Projects V2 on user-owned accounts (the Projects V2 org permission does not apply to user accounts). When `GH_TOKEN` is set (app token mode), `findRepoProjectId()` returns `null` for user-owned repos like `paysdoc/AI_Dev_Workflow`, and `moveIssueToStatus` logs at `info` level and returns `false` without attempting `GITHUB_PAT` as a fallback.

## Solution Statement
In `moveIssueToStatus()`, when `GH_TOKEN` is set (app token) and `findRepoProjectId()` returns `null`, temporarily swap `GH_TOKEN` to the value of `GITHUB_PAT` for the project board GraphQL calls and retry. If the PAT succeeds, continue using it for the remaining project board operations within that call. Restore the original `GH_TOKEN` after the operation completes. Additionally, promote "No project linked" and "status not found" log messages from `info` to `warn`, and log which auth method was used.

## Steps to Reproduce
1. Configure a GitHub App with `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY_PATH`
2. Set `GITHUB_PAT` in `.env` to a user PAT that can access the Projects V2
3. Run a workflow on a user-owned repo (e.g., `paysdoc/AI_Dev_Workflow`)
4. Observe that `moveIssueToStatus` logs "No project linked to paysdoc/AI_Dev_Workflow" at `info` level
5. The issue remains in "Todo" on the project board

## Root Cause Analysis
The `gh` CLI uses `GH_TOKEN` from `process.env` for authentication. When GitHub App auth is active, `GH_TOKEN` is set to the app's installation token (see `githubAppAuth.ts:196`). This token can perform most GitHub API operations, but GitHub App tokens cannot access Projects V2 on user-owned accounts — only org-level "Projects" permissions exist. The `findRepoProjectId()` GraphQL query returns `{nodes:[]}` with the app token, causing `moveIssueToStatus` to early-return `false` with an `info`-level log. No fallback to `GITHUB_PAT` is attempted.

## Relevant Files
Use these files to fix the bug:

- `adws/github/projectBoardApi.ts` — Main file to modify. Contains `moveIssueToStatus()` and all helper functions (`findRepoProjectId`, `findIssueProjectItem`, `getStatusFieldOptions`, `updateProjectItemStatus`). The PAT fallback logic goes here.
- `adws/core/config.ts` — Already exports `GITHUB_PAT` (line 58). Import it in `projectBoardApi.ts` for fallback auth.
- `adws/github/githubAppAuth.ts` — Contains `isGitHubAppConfigured()` which we'll use to detect app token mode. Already imported `refreshTokenIfNeeded` but need `isGitHubAppConfigured`.
- `features/harden_project_board_status.feature` — Existing BDD feature file for project board status. Add new scenarios for PAT fallback behavior.
- `features/step_definitions/hardenProjectBoardStatusSteps.ts` — Existing step definitions. Add new steps for PAT fallback scenarios.
- `app_docs/feature-wrzj5j-harden-project-board-status.md` — Existing docs on project board hardening for context.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add PAT fallback logic to `projectBoardApi.ts`

- Import `GITHUB_PAT` from `../core/config` at the top of the file
- Import `isGitHubAppConfigured` from `./githubAppAuth` (add to existing import)
- Create a helper function `withPatFallback<T>(fn: () => T): T` that:
  - Calls `fn()` first with the current `GH_TOKEN`
  - If the result is `null` (project not found), and `process.env.GH_TOKEN` is set (app token mode), and `GITHUB_PAT` is available and differs from `process.env.GH_TOKEN`:
    - Save the current `GH_TOKEN`
    - Set `process.env.GH_TOKEN = GITHUB_PAT`
    - Log that we're retrying with PAT: `log('App token cannot access Projects V2, retrying with GITHUB_PAT', 'info')`
    - Call `fn()` again
    - Restore the original `GH_TOKEN` in a `finally` block (critical — other `gh` CLI calls must keep the app token)
    - Return the result
  - If PAT is not available, return the original `null` result
- In `moveIssueToStatus()`, wrap the `findRepoProjectId()` call with `withPatFallback`:
  - Replace `const projectId = findRepoProjectId(owner, repo);` with `const projectId = withPatFallback(() => findRepoProjectId(owner, repo));`
  - If the PAT fallback succeeded (i.e., projectId is not null after retry), save the original `GH_TOKEN` and set `process.env.GH_TOKEN = GITHUB_PAT` for the remaining calls in this function (`findIssueProjectItem`, `getStatusFieldOptions`, `updateProjectItemStatus`), and restore in a `finally` block
- Simplification: Instead of the generic `withPatFallback` approach, use a simpler inline pattern in `moveIssueToStatus`:
  - After `findRepoProjectId` returns `null`, check if PAT fallback is possible
  - If yes, swap `GH_TOKEN`, retry, and keep PAT active for the rest of the function
  - Restore original `GH_TOKEN` in the outer `finally` block
- Log which auth method was used for the successful project board update: `log(\`Moved issue #\${issueNumber} to "\${matchedOption.name}" on project board (auth: \${authLabel})\`, 'success')`

### Step 2: Upgrade log levels from `info` to `warn`

In `moveIssueToStatus()`:
- Change `log(\`No project linked to \${owner}/\${repo}, skipping status update\`, 'info')` → `'warn'`
- Change `log(\`Issue #\${issueNumber} not found in project, skipping status update\`, 'info')` → `'warn'`
- Change `log(\`No Status field found in project, skipping status update\`, 'info')` → `'warn'`
- Change `log(\`Status "\${targetStatus}" not found in project options, skipping\`, 'info')` → `'warn'`
- Keep the "already in status" messages at `info` level (these are informational, not warning-worthy)

### Step 3: Add BDD scenarios for PAT fallback

In `features/harden_project_board_status.feature`, add new scenarios under a PAT fallback section:

- Scenario: `projectBoardApi.ts imports GITHUB_PAT from core config`
  - Given "adws/github/projectBoardApi.ts" is read
  - Then the file contains "GITHUB_PAT"
- Scenario: `projectBoardApi.ts imports isGitHubAppConfigured from githubAppAuth`
  - Given "adws/github/projectBoardApi.ts" is read
  - Then the file contains "isGitHubAppConfigured"
- Scenario: `moveIssueToStatus logs warn level when no project is found`
  - Given "adws/github/projectBoardApi.ts" is read
  - Then the "No project linked" log in moveIssueToStatus uses warn level
- Scenario: `moveIssueToStatus attempts PAT fallback when app token fails`
  - Given "adws/github/projectBoardApi.ts" is read
  - Then the file contains "retrying with GITHUB_PAT"

Add corresponding step definitions in `features/step_definitions/hardenProjectBoardStatusSteps.ts` for any new steps not covered by existing generic steps (like "the file contains").

### Step 4: Run validation commands

- Run `bun run lint` — verify no lint errors
- Run `bunx tsc --noEmit` — verify root TypeScript compiles
- Run `bunx tsc --noEmit -p adws/tsconfig.json` — verify adws TypeScript compiles
- Run `bunx cucumber-js --tags "@adw-wrzj5j-harden-project-board"` — verify existing + new BDD scenarios pass
- Run `bunx cucumber-js --tags "@regression"` — verify no regressions

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Root TypeScript type-check
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW TypeScript type-check
- `bunx cucumber-js --tags "@adw-wrzj5j-harden-project-board"` — Run existing + new project board BDD scenarios
- `bunx cucumber-js --tags "@regression"` — Run all regression scenarios to verify no regressions

## Notes
- `GITHUB_PAT` is already exported from `adws/core/config.ts` (line 58) — no changes needed there.
- The `GH_TOKEN` swap must be wrapped in a `try/finally` to guarantee restoration, since all other `gh` CLI calls (issue comments, PR creation, etc.) must continue using the app token.
- The PAT fallback is only attempted when both conditions are true: (1) `GH_TOKEN` is set (app token mode), and (2) `GITHUB_PAT` is available and different from `GH_TOKEN`. If `GITHUB_PAT` is not set or equals the current `GH_TOKEN`, the fallback is skipped.
- This is a targeted fix to `projectBoardApi.ts` only — no changes needed to the provider layer (`types.ts`, `githubIssueTracker.ts`) since the fallback is internal to the GraphQL calls.
- Strictly adhere to the coding guidelines in `guidelines/coding_guidelines.md`.
