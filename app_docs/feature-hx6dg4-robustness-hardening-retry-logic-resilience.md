# Robustness Hardening — Retry Logic, Pre-flight Checks, and Graceful Degradation

**ADW ID:** hx6dg4-robustness-hardening
**Date:** 2026-03-26
**Specification:** specs/issue-315-adw-gcisck-robustness-hardening-sdlc_planner-retry-logic-resilience.md

## Overview

This feature hardens the ADW workflow system against seven distinct classes of transient failures that were causing unnecessary workflow crashes. It introduces a centralized `execWithRetry` utility for `gh` CLI calls, upgrades the Claude CLI ENOENT retry to three attempts with per-attempt path re-resolution, adds a pre-flight Claude CLI validation at workflow startup, ensures worktrees are always created from clean remote refs, detects existing PRs before creating duplicates, adds graceful JSON parse degradation in resolution and validation agents, filters undefined review array elements, and writes skip-reason files on auto-merge early exits.

## What Was Built

- `execWithRetry` utility in `adws/core/utils.ts` — synchronous exponential-backoff retry wrapper for `gh` CLI calls (3 attempts, 500ms → 1s → 2s)
- Claude CLI ENOENT retry upgrade in `adws/agents/claudeAgent.ts` — 3 attempts with `clearClaudeCodePathCache()` + `resolveClaudeCodePath()` called on every attempt
- Pre-flight Claude CLI validation in `adws/phases/workflowInit.ts` — fails fast with a clear error if Claude CLI is missing or not executable
- Worktree creation from `origin/<defaultBranch>` in `adws/vcs/worktreeCreation.ts` — always fetches and uses remote ref, warns when local branch diverges
- Existing PR detection in `adws/providers/github/githubCodeHost.ts` — reuses found PR instead of crashing on duplicate `gh pr create`
- Graceful JSON parse fallback in `adws/agents/resolutionAgent.ts` — returns `{ resolved: false, decisions: [] }` with one retry before degrading
- Undefined array element guard in `adws/agents/reviewRetry.ts` — filters null/undefined entries from `reviewIssues` and `screenshots` arrays
- Skip-reason logging in `adws/triggers/autoMergeHandler.ts` and `adws/phases/autoMergePhase.ts` — writes `skip_reason.txt` on all early exits

## Technical Implementation

### Files Modified

- `adws/core/utils.ts`: Added `execWithRetry(command, options?)` with synchronous exponential backoff via `Atomics.wait`; exported from `adws/core/index.ts`
- `adws/github/issueApi.ts`: Replaced bare `execSync` calls with `execWithRetry` across 7 `gh issue` CLI functions
- `adws/github/prApi.ts`: Replaced bare `execSync` calls with `execWithRetry` across 7 `gh pr` CLI functions
- `adws/github/githubApi.ts`: Replaced `execSync` with `execWithRetry` for `gh api user` call only (local `git remote get-url` intentionally not retried)
- `adws/providers/github/githubCodeHost.ts`: Added `gh pr list --head <branch>` check before `gh pr create`; applied `execWithRetry` to both
- `adws/agents/claudeAgent.ts`: Upgraded single ENOENT retry to 3-attempt loop with backoff (500ms → 1s → 2s) and per-attempt path re-resolution; also exports `RateLimitError`
- `adws/phases/workflowInit.ts`: Added pre-flight `resolveClaudeCodePath()` + `accessSync(path, X_OK)` at start of `initializeWorkflow()`; also reads `completedPhases` from existing orchestrator state on resume
- `adws/vcs/worktreeCreation.ts`: Both `createWorktree()` and `createWorktreeForNewBranch()` now fetch `origin/<baseBranch>` and use it as the base ref; log warning when local diverges from remote
- `adws/agents/resolutionAgent.ts`: `parseResolutionResult()` returns graceful fallback instead of throwing; `runResolutionAgent()` retries once on non-JSON output
- `adws/agents/reviewRetry.ts`: Added `.filter((issue): issue is ReviewIssue => issue != null)` before `issueDescription` access; same guard for screenshots; added `continuationCount` to `ReviewRetryResult`
- `adws/triggers/autoMergeHandler.ts`: Moved `ensureLogsDirectory()` before PR state checks; writes `skip_reason.txt` on all early exits
- `adws/phases/autoMergePhase.ts`: Writes `skip_reason.txt` on missing PR URL and missing repo context exits

### Key Changes

- **`execWithRetry`** uses `Atomics.wait` for synchronous sleep (avoids converting callers to async) with the same `500 * Math.pow(2, attempt)` backoff math as the existing `exchangeRates.ts` pattern.
- **Claude CLI ENOENT retry** re-resolves the path on every attempt, which is the fix for the auto-update race condition where the symlink target changes between resolve and spawn.
- **Pre-flight check** calls `accessSync(path, fsConstants.X_OK)` — the only safe synchronous way to verify executable permissions before any async work starts.
- **Worktree base ref** uses `origin/<branch>` unconditionally after fetching; a failed fetch is silently ignored so existing local refs still work if offline.
- **Resolution agent graceful fallback**: mirrored the existing `validationAgent.ts` pattern — parse failure returns a typed sentinel rather than throwing, allowing the upstream retry loop to handle it.

## How to Use

These changes are transparent to callers — no API surface changes. The hardening applies automatically when workflows run:

1. **On workflow start** — if `claude` is not found or not executable, `initializeWorkflow()` throws a clear error immediately instead of failing mid-phase.
2. **On transient `gh` CLI failures** — any `gh` call in `issueApi.ts`, `prApi.ts`, `githubApi.ts`, or `githubCodeHost.ts` automatically retries up to 3 times.
3. **On Claude CLI ENOENT** — the agent runner retries 3 times with fresh path resolution, surviving auto-update windows.
4. **On workflow resume/re-run** — `gh pr create` no longer crashes if a PR already exists; it logs the existing PR URL and continues.
5. **On auto-merge skip** — check the `logs/<adwId>/skip_reason.txt` file to understand why an auto-merge was skipped.

## Configuration

No new configuration is required. The retry counts and backoff values are hardcoded to match the existing `exchangeRates.ts` pattern:
- Max attempts: 3
- Backoff: 500ms, 1000ms, 2000ms (exponential: `500 * Math.pow(2, attempt)`)

To override the number of attempts for a specific `execWithRetry` call, pass `{ maxAttempts: N }` in the options object.

## Testing

Validation commands (no unit tests — project has unit tests disabled per `.adw/project.md`):

```bash
bun run lint
bun run build
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json
```

BDD scenarios are in `features/retry_logic_resilience.feature` with step definitions at `features/step_definitions/retryLogicResilienceSteps.ts`.

## Notes

- `git remote get-url origin` in `githubApi.ts` intentionally does **not** use `execWithRetry` — it is a local git command, not a network call.
- `git fetch` and `git merge` in `autoMergeHandler.ts` have their own retry loop and are deliberately excluded from `execWithRetry`.
- The worktree fetch failure is non-fatal by design: if `git fetch` fails (e.g. offline), the command falls back to whatever local refs exist rather than blocking worktree creation.
- `validationAgent.ts` already had graceful JSON fallback before this feature; `resolutionAgent.ts` was the gap that this feature closes.
