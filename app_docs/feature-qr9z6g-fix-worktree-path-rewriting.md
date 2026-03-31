# Fix Worktree Path Rewriting & Remove Dangerous Git Pulls

**ADW ID:** qr9z6g-fix-worktree-root-co
**Date:** 2026-03-31
**Specification:** specs/issue-370-adw-n8bk8n-fix-worktree-root-co-sdlc_planner-fix-worktree-path-rewriting.md

## Overview

This fix addresses two root causes of ADW workflow crashes: Claude Code agents writing files to the main repo root instead of their worktree directory, and `git pull` operations on the main repo root crashing on divergent branches. A pre-tool-use hook now intercepts file tool calls and rewrites paths from the main repo root to the correct worktree path, while all unsafe `git pull` operations in the main repo root have been removed or replaced with fetch-only alternatives.

## What Was Built

- **Pre-tool-use hook path rewriting** — `rewriteWorktreePath()` in `.claude/hooks/pre-tool-use.ts` intercepts `Write`, `Edit`, `Read`, `Glob`, `Grep`, and `MultiEdit` tool calls and redirects `file_path`/`path` from the main repo root to the worktree path
- **Worktree env var injection** — `claudeAgent.ts` injects `ADW_WORKTREE_PATH` and `ADW_MAIN_REPO_PATH` into spawned Claude CLI processes when running inside a worktree
- **Env var allowlist update** — `environment.ts` adds both new env vars to `SAFE_ENV_VARS` so they pass through `getSafeSubprocessEnv()`
- **`fetchLatestRefs` function** — replaces `pullLatestDefaultBranch` in `targetRepoManager.ts` with a safe fetch-only operation; old function kept as a deprecated alias
- **`freeBranchFromMainRepo` patch** — removes `git pull` from the park step in `worktreeOperations.ts`; only the `git checkout` (needed to free the branch) is retained
- **Deprecated `checkoutBranch` and `checkoutDefaultBranch`** — both functions in `branchOperations.ts` now emit a warning log and are marked `@deprecated`

## Technical Implementation

### Files Modified

- `.claude/hooks/pre-tool-use.ts`: Added `rewriteWorktreePath()` function; integrated into `main()` before safety checks; downstream checks use `effectiveInput` (rewritten input if applicable)
- `adws/agents/claudeAgent.ts`: Imports `getMainRepoPath`; injects `ADW_WORKTREE_PATH` / `ADW_MAIN_REPO_PATH` into spawn env when `cwd` contains `.worktrees/`
- `adws/core/environment.ts`: Added `'ADW_WORKTREE_PATH'` and `'ADW_MAIN_REPO_PATH'` to `SAFE_ENV_VARS`
- `adws/core/targetRepoManager.ts`: Renamed `pullLatestDefaultBranch` → `fetchLatestRefs`; removed `git checkout` + `git pull`; old name kept as deprecated alias; updated `ensureTargetRepoWorkspace` call site
- `adws/core/index.ts`: Added `fetchLatestRefs` export alongside deprecated `pullLatestDefaultBranch`
- `adws/vcs/worktreeOperations.ts`: Removed `&& git pull` from `freeBranchFromMainRepo`
- `adws/vcs/branchOperations.ts`: Added `@deprecated` JSDoc and warning log to `checkoutBranch` and `checkoutDefaultBranch`

### Key Changes

- The hook reads `ADW_WORKTREE_PATH` and `ADW_MAIN_REPO_PATH` from `process.env`; if either is absent (interactive sessions), no rewriting occurs — zero impact outside ADW-spawned agents
- Path rewriting replaces the `ADW_MAIN_REPO_PATH` prefix with `ADW_WORKTREE_PATH` only when the path starts with the main repo root but not already with the worktree path
- Both `file_path` (Write/Edit/Read/MultiEdit) and `path` (Glob/Grep) parameters are handled
- The hook outputs `{ tool_input: modifiedInput }` to stdout; Claude Code's hook system applies the modification and proceeds with exit code 0
- `getMainRepoPath(cwd)` call in `claudeAgent.ts` is wrapped in try/catch — a resolution failure is non-fatal and silently skips env var injection

## How to Use

The fix is automatic — no configuration required for normal ADW workflows.

1. Run any ADW workflow that uses worktrees (e.g., `bunx tsx adws/adwSdlc.tsx <issueNumber>`)
2. When a Claude agent spawns inside a worktree, `claudeAgent.ts` automatically injects `ADW_WORKTREE_PATH` and `ADW_MAIN_REPO_PATH`
3. The pre-tool hook silently redirects any file operations that would land in the main repo root to the correct worktree directory
4. Git operations no longer run `git pull` in the main repo root — `ensureTargetRepoWorkspace` runs `git fetch origin` only

## Configuration

No new configuration required. The two new env vars (`ADW_WORKTREE_PATH`, `ADW_MAIN_REPO_PATH`) are computed and injected automatically by `claudeAgent.ts` per-spawn. They are added to `SAFE_ENV_VARS` so they propagate through the subprocess environment filter.

## Testing

- `bun run lint` — linter passes
- `bunx tsc --noEmit` — main project type-checks clean
- `bunx tsc --noEmit -p adws/tsconfig.json` — adws module type-checks clean
- `bun run build` — build succeeds
- Manual: run `bunx tsx adws/adwSdlc.tsx <issueNumber>` and verify `.feature` files land in the worktree directory, not the main repo root

## Notes

- The `Bash` tool is intentionally excluded from path rewriting — shell commands are too complex to parse reliably for path substitution
- The `getMainRepoPath` function uses `git worktree list --porcelain` under the hood; it works correctly for any repo using `git worktree add`
- `checkoutBranch` and `checkoutDefaultBranch` are not removed — external consumers may use them; the deprecation warning is a runtime signal to migrate
- The deprecated `pullLatestDefaultBranch` in `targetRepoManager.ts` now delegates to `fetchLatestRefs`, ensuring callers that haven't been updated still work safely
