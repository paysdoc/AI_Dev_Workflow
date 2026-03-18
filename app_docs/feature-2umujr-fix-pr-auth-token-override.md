# Fix: PR Auth Token Override in pull_request Slash Command

**ADW ID:** 2umujr-prs-created-by-paysd
**Date:** 2026-03-18
**Specification:** specs/issue-236-adw-2umujr-prs-created-by-paysd-sdlc_planner-fix-pr-auth-token-override.md

## Overview

PRs created by ADW were authored by the `paysdoc` personal user instead of the `paysdoc-adw[bot]` GitHub App. The root cause was a single instruction in the `/pull_request` slash command that told the AI model to overwrite `GH_TOKEN` with `GITHUB_PAT` before running `gh pr create`, discarding the app installation token correctly set by the orchestrator.

## What Was Built

- Removed the `GITHUB_PAT` override instruction from the `/pull_request` slash command's `## Run` section (step 5)
- Added a BDD feature file (`features/pr_auth_token_override.feature`) with `@adw-236` tagged scenarios covering the fix
- Added corresponding Cucumber step definitions (`features/step_definitions/prAuthTokenOverrideSteps.ts`)

## Technical Implementation

### Files Modified

- `.claude/commands/pull_request.md`: Removed "Set GH_TOKEN environment variable from GITHUB_PAT if available" from step 5; now simply runs `gh pr create` directly

### Key Changes

- **Root fix**: Step 5 of the `/pull_request` slash command changed from `Set GH_TOKEN environment variable from GITHUB_PAT if available, then run gh pr create ...` to `Run gh pr create ...` — one line, no auth manipulation
- **Auth flow preserved**: The orchestrator's `activateGitHubAppAuth()` (in `workflowInit.ts:104`) correctly sets `GH_TOKEN` to the app installation token; the subprocess inherits it via `getSafeSubprocessEnv()` in `config.ts`; the slash command now no longer overrides it
- **GITHUB_PAT stays in allowlist**: The personal access token remains in `SAFE_ENV_VARS` so it is still available as a fallback when GitHub App auth is not configured; it is simply no longer injected into `GH_TOKEN` by the slash command

## How to Use

No configuration change is required. After this fix:

1. Ensure GitHub App credentials are set (`GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY_PATH`)
2. Run any ADW orchestrator that creates a PR (e.g., `bunx tsx adws/adwPlanBuild.tsx <issueNumber>`)
3. The resulting PR will be authored by `paysdoc-adw[bot]` instead of `paysdoc`

## Configuration

No new configuration. Existing env vars relevant to this fix:

| Variable | Purpose |
|---|---|
| `GITHUB_APP_ID` | GitHub App identifier — enables app auth |
| `GITHUB_APP_PRIVATE_KEY_PATH` | Path to the app private key |
| `GITHUB_APP_SLUG` | App slug used to identify the installation |
| `GH_TOKEN` | Set by orchestrator to the app installation token; no longer overridden by the slash command |
| `GITHUB_PAT` | Personal access token; remains in subprocess env as fallback but is no longer written to `GH_TOKEN` |

## Testing

```sh
# Verify GITHUB_PAT reference removed from slash command
grep -n "GITHUB_PAT" .claude/commands/pull_request.md  # should return no matches

# Verify no GH_TOKEN override remains
grep -n "GH_TOKEN" .claude/commands/pull_request.md    # should return no matches

# Run tagged BDD scenarios
bunx cucumber-js --tags "@adw-236"
```

## Notes

- This is a prompt-only fix — no TypeScript code was changed.
- When GitHub App auth is not configured, `gh` CLI falls back to its default auth (`gh auth login`), which is the correct behavior.
- This fix resolves the `paysdoc` vs `paysdoc-adw[bot]` authorship problem that affected all ADW-created PRs when both `GH_TOKEN` (app token) and `GITHUB_PAT` were present in the environment.
