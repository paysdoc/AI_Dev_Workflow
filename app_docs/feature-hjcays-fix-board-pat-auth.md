# Fix GitHubBoardManager PAT Auth (ensureColumns / createBoard / findBoard)

**ADW ID:** hjcays-ensurecolumns-fails
**Date:** 2026-04-18
**Specification:** specs/issue-446-adw-hjcays-ensurecolumns-fails-sdlc_planner-fix-board-pat-auth.md

## Overview

`GitHubBoardManager` had asymmetric PAT-fallback coverage: `findBoard` performed a lazy inner retry that restored the app token before returning, leaving `ensureColumns` and `createBoard` running under the app token — causing `gh: Resource not accessible by integration` on user-owned Projects V2 repos. This fix ports the upfront-PAT-swap pattern from `adws/github/projectBoardApi.ts::moveIssueToStatus` into a private `withProjectBoardAuth<T>` wrapper that all three public methods now delegate through.

## What Was Built

- Private `withProjectBoardAuth<T>(fn: () => Promise<T>): Promise<T>` method on `GitHubBoardManager` — calls `refreshTokenIfNeeded`, swaps `GH_TOKEN → GITHUB_PAT` upfront, runs `fn()`, restores original token in `finally`
- `findBoard`, `createBoard`, and `ensureColumns` each rewritten to wrap their bodies in `this.withProjectBoardAuth(async () => { ... })`
- Stale lazy-retry block removed from `findBoard` (was restoring app token before callers ran, defeating the PAT swap)
- Exported `mergeStatusOptions` pure helper (extracted from `ensureColumns`) and enriched `getStatusFieldOptions` to fetch `color` and `description` fields
- `updateStatusFieldOptions` replaces `addStatusOption` — issues a single bulk `updateProjectV2Field` call via `gh api graphql --input -` (stdin JSON) instead of one call per column
- 6 new unit tests for the wrapper covering swap, restore-on-return, restore-on-throw, and three no-op paths
- BDD feature file `features/fix_board_manager_pat_auth.feature` with 14 regression scenarios (`@adw-446 @regression`)
- New step definitions in `features/step_definitions/fixBoardManagerPatAuthSteps.ts` for structural assertions against the provider file

## Technical Implementation

### Files Modified

- `adws/providers/github/githubBoardManager.ts`: added `withProjectBoardAuth` wrapper; rewrote `findBoard`/`createBoard`/`ensureColumns` to delegate through it; removed lazy-retry; replaced `addStatusOption` with `updateStatusFieldOptions`; enriched `getStatusFieldOptions` to fetch `color`/`description`; exported `mergeStatusOptions`
- `adws/providers/__tests__/boardManager.test.ts`: added `mergeStatusOptions` unit test suite and `GitHubBoardManager PAT fallback wrapper` suite (6 tests); added module-level mocks for `githubAppAuth` and `config.GITHUB_PAT`

### New Files

- `features/fix_board_manager_pat_auth.feature`: 14 BDD scenarios tagged `@adw-446 @regression` asserting the wrapper structure, public-method delegation, stale-retry removal, and TypeScript type-check pass
- `features/step_definitions/fixBoardManagerPatAuthSteps.ts`: step definitions for wrapper structural assertions (`withProjectBoardAuth` calls `refreshTokenIfNeeded` before swap, guards with `isGitHubAppConfigured`, assigns and restores `GH_TOKEN`, `finally` block present) and delegation/negative assertions (`findBoard` no longer assigns `GH_TOKEN`)

### Key Changes

- **Upfront PAT swap pattern** — mirrors `moveIssueToStatus` in `projectBoardApi.ts` exactly: `let savedToken; let usingPatFallback = false;` → outer `try` swap → `await fn()` → `finally` restore. All three public methods run under PAT before any GraphQL call is made.
- **Wrapper is idempotent** — if `GITHUB_PAT` equals current `GH_TOKEN` or is absent, or `isGitHubAppConfigured()` returns false, the wrapper is a no-op.
- **Single bulk mutation** — `updateStatusFieldOptions` sends the full merged option list via `gh api graphql --input -` (JSON body to stdin) instead of per-column add calls, consistent with the prior `fix-board-update-mutation` fix.
- **`mergeStatusOptions` exported** — pure function computes the merged option list and `changed`/`added` metadata; now independently unit-testable and consumed by `ensureColumns`.
- **No changes** to `adws/github/projectBoardApi.ts` or `adws/providers/github/githubIssueTracker.ts`.

## How to Use

This fix is transparent — no configuration changes are needed. When `GITHUB_PAT` is set in the ADW environment and the GitHub App token cannot access Projects V2 (user-owned repos), the wrapper automatically uses `GITHUB_PAT` for all board operations.

1. Ensure `GITHUB_PAT` (or `GITHUB_PERSONAL_ACCESS_TOKEN`) is set in the ADW `.env` / environment.
2. Run any ADW workflow that calls `initializeWorkflow` against a user-owned GitHub repo with a linked Projects V2 board.
3. Board initialization (`findBoard` → `ensureColumns`) will now succeed; all five `BOARD_COLUMNS` (`Blocked`, `Todo`, `In Progress`, `Review`, `Done`) will be present after the phase completes.

## Configuration

| Variable | Purpose |
|---|---|
| `GITHUB_PAT` / `GITHUB_PERSONAL_ACCESS_TOKEN` | Personal access token with `project` scope; used when the GitHub App token is refused by Projects V2 |
| `GH_TOKEN` | Runtime token; temporarily set to `GITHUB_PAT` during board operations, then restored |

No new env vars are introduced — only the existing `GITHUB_PAT` pattern is extended to cover `GitHubBoardManager`.

## Testing

```bash
# Unit tests (wrapper swap/restore/no-op paths + mergeStatusOptions)
bun run test:unit

# BDD regression scenarios for this feature
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-446"

# Full regression suite (includes existing project-board-pat-fallback scenarios)
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"

# TypeScript typecheck
bunx tsc --noEmit -p adws/tsconfig.json
```

## Notes

- **Why the bug recurred twice** — the original `b449834` fix targeted `projectBoardApi.ts::moveIssueToStatus` only. PR #428 introduced `githubBoardManager.ts` with a lazy inner retry in `findBoard` that restored the app token in its own `finally`, silently leaving `ensureColumns` on the app token. This fix closes that gap by moving auth setup to a single outer wrapper.
- **Concurrent-process caveat** — `process.env.GH_TOKEN` is process-global; concurrent `GitHubBoardManager` instances in the same Node.js process would race. ADW is single-threaded per workflow and board initialization is sequential, so this is not a practical risk.
- **No shared helper with `projectBoardApi.ts`** — the two files belong to different layers (per-board setup vs per-issue status moves) and were intentionally separated in PR #428. A shared helper is YAGNI.
- **Integration testing deferred** — true behavioral testing against a sandbox user-owned GitHub project (asserting all five columns appear after a real `setupProjectBoard` run) is tracked as a separate follow-up issue. The BDD scenarios in this PR are static source-level checks that guard against regression of the specific patterns.
