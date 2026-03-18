# Project Board PAT Fallback for App Token Failures

**ADW ID:** 9tknkw-project-board-fall-b
**Date:** 2026-03-18
**Specification:** specs/issue-235-adw-9tknkw-project-board-fall-b-sdlc_planner-project-board-pat-fallback.md

## Overview

`moveIssueToStatus()` silently failed when the GitHub App installation token could not access Projects V2 on user-owned repositories. This fix adds a PAT fallback in `projectBoardApi.ts`: when the app token returns no project, the function retries with `GITHUB_PAT`, keeping the app token active for all other operations. Log levels for silent-failure paths were also promoted from `info` to `warn`.

## What Was Built

- PAT fallback in `moveIssueToStatus()` — retries `findRepoProjectId()` (and all subsequent project board calls) with `GITHUB_PAT` when the app token returns `null`
- `GH_TOKEN` swap with guaranteed restoration via `finally` block
- Auth label logging: successful project board moves now report which auth method was used (`app token` or `GITHUB_PAT`)
- Log level upgrades from `info` to `warn` for all "skipping status update" paths
- New BDD scenarios covering PAT fallback behavior added to `features/project_board_pat_fallback.feature`

## Technical Implementation

### Files Modified

- `adws/github/projectBoardApi.ts`: Added `GITHUB_PAT` import, `isGitHubAppConfigured` import, inline PAT fallback logic in `moveIssueToStatus()`, `finally` block for token restoration, and `warn`-level log upgrades
- `features/project_board_pat_fallback.feature`: New BDD feature file with scenarios for PAT fallback behavior
- `features/step_definitions/projectBoardPatFallbackSteps.ts`: New step definitions for PAT fallback BDD scenarios
- `features/harden_project_board_status.feature`: Minor updates to existing project board scenarios
- `features/step_definitions/hardenProjectBoardStatusSteps.ts`: Additional step definitions

### Key Changes

- When `findRepoProjectId()` returns `null` and GitHub App auth is active (`isGitHubAppConfigured()`) and `GITHUB_PAT` differs from the current `GH_TOKEN`, the function swaps `process.env.GH_TOKEN = GITHUB_PAT` and retries the full operation
- The PAT remains active for all project board calls within the same `moveIssueToStatus()` invocation (`findIssueProjectItem`, `getStatusFieldOptions`, `updateProjectItemStatus`)
- The original `GH_TOKEN` is unconditionally restored in a `finally` block so all other `gh` CLI calls (issue comments, PR creation, etc.) continue using the app token
- "No project linked", "Issue not found in project", "No Status field found", and "Status not found in options" messages are now `warn` level for better observability
- Condition for PAT fallback: `!projectId && isGitHubAppConfigured() && GITHUB_PAT && GITHUB_PAT !== process.env.GH_TOKEN`

## How to Use

No configuration changes are required. The fallback is automatic when the following conditions are met:

1. `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, and `GITHUB_APP_PRIVATE_KEY_PATH` are set (GitHub App mode is active)
2. `GITHUB_PAT` is set in `.env` to a user PAT that has access to Projects V2
3. The workflow runs against a user-owned repository (e.g., `paysdoc/AI_Dev_Workflow`) where App tokens cannot access Projects V2

When the fallback activates, the log will show:
```
[info]  App token cannot access Projects V2, retrying with GITHUB_PAT
[success] Moved issue #235 to "In Progress" on project board (auth: GITHUB_PAT)
```

## Configuration

| Variable | Description |
|---|---|
| `GITHUB_PAT` | User PAT with `project` scope. Used as fallback when app token cannot access Projects V2. Already required for other operations; no new setup needed. |

## Testing

Run the PAT fallback BDD scenarios:

```bash
bunx cucumber-js --tags "@adw-wrzj5j-harden-project-board"
```

Run the full regression suite to verify no regressions:

```bash
bunx cucumber-js --tags "@regression"
```

## Notes

- This is a targeted fix to `projectBoardApi.ts` only. No changes to the provider layer (`types.ts`, `githubIssueTracker.ts`) were needed since the fallback is internal to the GraphQL calls.
- The PAT fallback only applies to project board GraphQL operations. All other `gh` CLI calls (comments, PRs, labels) continue using the app token.
- For org-owned repositories where the GitHub App has the "Projects" org permission enabled, the app token will succeed on the first attempt and the fallback is never triggered.
- Root cause: GitHub App tokens cannot access Projects V2 on user-owned accounts — the Projects V2 permission only exists at the org level.
