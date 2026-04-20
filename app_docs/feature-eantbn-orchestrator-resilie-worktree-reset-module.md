# Worktree Reset Module (`resetWorktreeToRemote`)

**ADW ID:** eantbn-orchestrator-resilie
**Date:** 2026-04-20
**Specification:** specs/issue-457-adw-eantbn-orchestrator-resilie-sdlc_planner-worktree-reset-module.md

## Overview

Adds `adws/vcs/worktreeReset.ts`, a standalone VCS deep module that deterministically returns any worktree to the exact state of `origin/<branch>`. It is the first primitive needed for dead-orchestrator takeover: before a successor can resume work it must eliminate all traces of what the previous orchestrator left behind (mid-merge, mid-rebase, dirty files, untracked artifacts, unpushed commits). Integration into the `takeoverHandler` decision tree lands in a subsequent slice (PRD slice #11).

## What Was Built

- `adws/vcs/worktreeReset.ts` — new deep module exporting `resetWorktreeToRemote(worktreePath, branch)`
- `adws/vcs/__tests__/worktreeReset.test.ts` — vitest unit test file with 17+ scenarios covering all acceptance criteria
- `adws/vcs/index.ts` — `resetWorktreeToRemote` re-exported under a new `// Worktree reset` section

## Technical Implementation

### Files Modified

- `adws/vcs/worktreeReset.ts`: New file (~103 lines). Exports one public function; three private helpers handle git-dir resolution, merge abort, and rebase abort.
- `adws/vcs/__tests__/worktreeReset.test.ts`: New vitest file (~307 lines). Mocks `child_process`, `fs`, and `../../core`; covers all five PRD coverage scenarios plus fallback, failure, and git-dir resolution edge cases.
- `adws/vcs/index.ts`: Added `// Worktree reset` export block for `resetWorktreeToRemote`.
- `adws/providers/types.ts`: Minor change (unrelated to the worktree reset feature, present in the diff).

### Key Changes

- **Worktree-aware git-dir resolution**: `resolveGitDir` runs `git rev-parse --git-dir` inside the worktree and resolves the result to an absolute path. This is required because linked worktrees have a `.git` *file* (not directory) pointing to `<main>/.git/worktrees/<name>`, so `MERGE_HEAD` and rebase markers live there, not under `<worktreePath>/.git/`.
- **Conditional merge abort with filesystem fallback**: `abortInProgressMerge` skips entirely when `MERGE_HEAD` is absent. On `git merge --abort` failure it removes `MERGE_HEAD`, `MERGE_MSG`, and `MERGE_MODE` directly via `fs.rmSync`.
- **Conditional rebase abort with filesystem fallback**: `abortInProgressRebase` skips when neither `rebase-apply/` nor `rebase-merge/` exists. On `git rebase --abort` failure it removes both directories with `{ recursive: true, force: true }`.
- **Mandatory hard-reset sequence**: `git fetch origin "<branch>"` → `git reset --hard "origin/<branch>"` → `git clean -fdx`. Each step throws a wrapped error on failure; later steps do not run if an earlier one fails.
- **Explicit discard guarantee in JSDoc**: Both the module-level doc comment and the `resetWorktreeToRemote` JSDoc explicitly state that all unpushed local commits, staged/unstaged changes, untracked files, ignored files, and partial merge/rebase state are permanently discarded.

## How to Use

`resetWorktreeToRemote` is not yet wired to any caller (PRD slice #11). To use it in a takeover handler:

```typescript
import { resetWorktreeToRemote } from '../vcs';

// Before resuming work in a dead orchestrator's worktree:
resetWorktreeToRemote('/path/to/worktrees/feature-issue-123', 'feature-issue-123-my-feature');
```

The function is synchronous and throws on any mandatory-step failure. Catch or let it propagate — the caller decides the recovery strategy.

## Configuration

No new environment variables or configuration entries. All inputs are explicit parameters:

| Parameter | Type | Description |
|---|---|---|
| `worktreePath` | `string` | Absolute path to the worktree to reset |
| `branch` | `string` | Remote branch name to reset to (`origin/<branch>`) |

## Testing

```bash
bun run test:unit
```

The new tests live in `adws/vcs/__tests__/worktreeReset.test.ts`. They use `vi.mock('child_process', ...)` and `vi.mock('fs', ...)` — no real git or filesystem operations. Key scenarios covered:

- Clean worktree (idempotent — calling twice produces identical call sequence)
- Dirty tracked files
- In-progress merge (plumbing succeeds)
- In-progress merge (plumbing fails → filesystem fallback)
- In-progress rebase (plumbing succeeds)
- In-progress rebase (plumbing fails → filesystem fallback)
- Both merge and rebase markers present simultaneously
- Untracked files
- Absolute vs relative git-dir path from `rev-parse --git-dir` (covers linked worktree indirection)
- Mandatory-step failures: `git fetch`, `git reset --hard`, and `git clean -fdx` each individually throw

## Notes

- This slice is **standalone**. `resetWorktreeToRemote` is dead code from the caller side until PRD slice #11 (`takeoverHandler`) lands. This is intentional.
- `fetchAndResetToRemote` in `adws/vcs/branchOperations.ts` is **not** replaced or extended. It assumes a clean-tree precondition and does not run `git clean`. The new module exists because that contract is narrower than what a takeover requires.
- Branch names in ADW are generated by `generateBranchName()` and are `[a-z0-9/-]+`. The module double-quotes all branch interpolation defensively to match the convention in `branchOperations.ts`.
- No new runtime dependencies. All imports (`child_process`, `fs`, `path`) are Node built-ins already used across `adws/vcs/**`.
