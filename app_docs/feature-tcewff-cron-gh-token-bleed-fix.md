# Fix: Cron GH_TOKEN Bleed via Pause-Queue Resume

**ADW ID:** tcewff-cron-gh-token-bleed
**Date:** 2026-06-12
**Specification:** specs/issue-565-adw-tcewff-cron-gh-token-bleed-sdlc_planner-fix-pause-queue-gh-token-bleed.md

## Overview

The cron poller's pause-queue resume path was resolving the target repo from the process working directory (always `paysdoc/AI_Dev_Workflow`) instead of from the paused entry's persisted `--target-repo`. This caused `activateGitHubAppAuth` to pin the process-global `GH_TOKEN` to the framework repo, blinding the poller to its actual target repo until the process was restarted. Confirmed incident: `vestmatic/vestmatic` issue #143 reached `awaiting_merge` but was never auto-merged (2026-06-11).

## What Was Built

- `resolveEntryRepoInfo(entry)` helper in `pauseQueueScanner.ts` — resolves the correct target repo from a paused entry's `extraArgs`, with a safe fallback to `getRepoInfo()` for framework self-hosting workflows
- Primary fix: `resumeWorkflow` and the `scanPauseQueue` error branch now use `resolveEntryRepoInfo` instead of bare `getRepoInfo()`
- Defense-in-depth: `trigger_cron.ts` re-asserts the cron's target-repo auth via `ensureAppAuthForRepo` before each `fetchOpenIssues()` call, so a stray activation can never persist across ticks
- Regression tests covering the target-repo auth activation path and the framework fallback path
- Per-issue BDD scenario (`features/per-issue/feature-565.feature`) documenting the contract

## Technical Implementation

### Files Modified

- `adws/triggers/pauseQueueScanner.ts`: Added `resolveEntryRepoInfo(entry)` helper; replaced two `getRepoInfo()` calls in `resumeWorkflow` and `scanPauseQueue` error branch; extended imports to include `parseTargetRepoArgs` and `RepoInfo`
- `adws/triggers/trigger_cron.ts`: Added `ensureAppAuthForRepo(cronRepoInfo.owner, cronRepoInfo.repo)` call before `fetchOpenIssues()` in `checkAndTrigger()`; extended `../github` import
- `adws/triggers/__tests__/pauseQueueScanner.test.ts`: Added `parseTargetRepoArgs` to core mock; added `activateGitHubAppAuth` assertions; updated `acquireIssueSpawnLock` expectation to target repo; added regression tests and fallback test
- `adws/triggers/__tests__/trigger_cron.test.ts`: Added `ensureAppAuthForRepo: vi.fn()` to the github mock
- `features/per-issue/feature-565.feature`: BDD scenario (`@adw-565`) asserting auth is activated for target repo, not framework repo
- `features/regression/vocabulary.md`: Added vocabulary for cron-auth-bleed scenarios

### Key Changes

- **Root cause fix:** `resolveEntryRepoInfo` reads `entry.extraArgs` for `--target-repo owner/repo`, parsed via the existing pure `parseTargetRepoArgs` (called on a copy to avoid mutation). Falls back to `getRepoInfo()` only for framework workflows that carry no `--target-repo`.
- **Defense-in-depth:** `ensureAppAuthForRepo` is cheap (a cache-hit refresh when already correct, one API call only on drift) and is called every ~20s tick before polling — structurally prevents a stale wrong-repo auth from persisting.
- **No structural refactor:** the process-global `GH_TOKEN` / `activeRepo` singleton in `githubAppAuth.ts` is untouched; eliminating it is a separate follow-up (issue's third suggestion, out of scope).
- **Fallback safety:** `workflowCompletion.ts` only writes `--target-repo` for target-repo workflows; framework workflows carry no `extraArgs`, so `resolveEntryRepoInfo` correctly falls back to `getRepoInfo()` for them.
- **Tell-tale signature eliminated:** `Failed to post resumed comment … Remote owner "X" !== declared owner "Y"` → `Could not resolve to a Repository` → sustained `POLL: 0 open`.

## How to Use

This is an internal fix; no operator action is required. The cron poller will now correctly maintain its target-repo auth identity across pause-queue resume cycles.

To verify the fix is in effect, monitor cron logs after a pause-queue resume:
1. `GitHub App authentication activated for <owner>/<target-repo>` should name the **target** repo, not `paysdoc/AI_Dev_Workflow`.
2. No `Remote owner "X" !== declared owner "Y"` errors.
3. Subsequent ticks should log normal `POLL: N open` (not `0 open`).

## Configuration

No configuration changes required. The fix is active whenever the GitHub App is configured (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` env vars). On the local-`gh`-auth dev path (no app configured), `ensureAppAuthForRepo` is a no-op and `resolveEntryRepoInfo` still correctly resolves the repo (it just calls `getRepoInfo()` as before for framework workflows).

## Testing

```sh
# Targeted regression — asserts auth is activated for target repo, not cwd repo
bunx vitest run adws/triggers/__tests__/pauseQueueScanner.test.ts

# Confirm trigger_cron imports cleanly with new ensureAppAuthForRepo dependency
bunx vitest run adws/triggers/__tests__/trigger_cron.test.ts

# Full unit suite — no regressions
bun run test:unit

# Type and lint checks
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json
bun run lint

# BDD regression suite
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"

# Per-issue scenario
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-565"
```

## Notes

- The process-global `GH_TOKEN` / `activeRepo` elimination (issue's third suggestion) is intentionally out of scope; it is a broad cross-cutting refactor across all `gh`/GraphQL call sites.
- `resolveEntryRepoInfo` passes a spread copy of `entry.extraArgs` to `parseTargetRepoArgs` because that function splices its argument array.
- The `ensureAppAuthForRepo` call in `trigger_cron.ts` is a no-op when `activeRepo` already matches the target (just refreshes cached token), so there is no per-tick overhead on the happy path.
- Shared `agents/paused_queue.json` can contain entries from multiple repos/workflows; deriving each resume's repo from its own entry (not from the cron's `cronRepoInfo`) is strictly more correct than assuming all queued entries belong to the current cron's target.
