# Worktree and VCS

## Overview

This module manages git worktrees and branch operations for ADW workflows. It provides creation, cleanup, branch management, commit utilities, and the worktree setup step that copies Claude skills and commands into a new workspace.

## Responsibilities

- `ensureWorktree`: idempotently creates or reuses a worktree for a branch; copies `.env` from the base repo to the worktree.
- `createWorktree`: creates a worktree for an existing branch; handles branch-checked-out-elsewhere by reusing that worktree or freeing it from the main repo.
- `createWorktreeForNewBranch`: creates a worktree and a new branch in one operation, branching from `origin/<baseBranch>`.
- `getWorktreeForBranch`: returns the worktree path for a branch if it exists (checks both the expected path and the porcelain list), or null.
- `removeWorktree`: kills processes in the worktree directory (SIGTERM then SIGKILL), removes the worktree via `git worktree remove --force`, and deletes the local branch.
- `removeWorktreesForIssue`: finds all worktrees matching `issue-<N>` in their path, kills processes, removes each worktree, and deletes corresponding local branches.
- `killProcessesInDirectory`: uses `lsof +D` to find PIDs with open files in a directory, sends SIGTERM, then SIGKILL for survivors after 500ms.
- `generateBranchName`: assembles a canonical `<prefix>-issue-<N>-<slug>` branch name, validating the slug first.
- `validateSlug`: enforces lowercase, hyphens-only, no leading/trailing/consecutive hyphens, ≤50 chars, no branch prefix, no `issue-<N>` segment, no forbidden git-ref characters.
- `getDefaultBranch`: queries `gh repo view --json defaultBranchRef` for the repo's default branch.
- `mergeLatestFromDefaultBranch`: fetches and merges `origin/<defaultBranch>` into the current branch; logs warnings on failure without throwing.
- `fetchAndResetToRemote`: fetches `origin/<defaultBranch>` and hard-resets the worktree to it; throws on failure.
- `deleteLocalBranch` / `deleteRemoteBranch`: delete branches, refusing to touch protected branches (`main`, `master`, `develop`).
- `commitChanges`: stages all changes and commits with a message; returns false when there is nothing to commit.
- `getHeadTreeHash`: returns `HEAD^{tree}` hash for use by the progress gate.
- `hasUncommittedChanges`: returns true when `git status --porcelain` is non-empty.
- `pushBranch`: pushes the branch to `origin` with upstream tracking.
- `copyClaudeAssetsToWorktree`: copies all `.claude/commands/*.md` and `.claude/skills/` directories from the ADW framework repo into the worktree, applying gitignore entries for assets not marked `target: true`.
- `ensureGitignoreEntry` / `ensureGitignoreEntries`: idempotently appends entries to the worktree's `.gitignore`.
- `verifyAdwRegen`: checks that all six canonical `.adw/` config files exist and are non-empty, that `vocabulary.md` exists, and that `.adw/.regen-receipt` carries the expected framework hash.

## Contracts & Invariants

- `ensureWorktree` always copies `.env` from the base repo path into the worktree regardless of whether the worktree was newly created or reused.
- `removeWorktree` falls back to `fs.rmSync` when `git worktree remove` fails but the directory still exists on disk.
- Protected branches (`main`, `master`, `develop`) are never deleted by `deleteLocalBranch` or `deleteRemoteBranch`.
- `validateSlug` throws with a human-readable message on any constraint violation; `generateBranchName` never propagates a malformed name.
- `copyClaudeAssetsToWorktree` never gitignores a path already tracked by git — `git ls-files` is consulted before adding gitignore entries.
- `verifyAdwRegen` requires both file presence and receipt freshness (hash match); a receipt from a prior upgrade cycle carrying the old hash fails the check.
- `fetchAndResetToRemote` throws on failure; `mergeLatestFromDefaultBranch` only logs warnings.

## Configuration

The ADW framework repo root is resolved relative to the `worktreeSetup.ts` file's location (`../../` from `adws/phases/`). Worktrees are created under `.worktrees/<branchName>` relative to the base repo root. `PROTECTED_BRANCHES` is a module-level constant.

## Gotchas

- `checkoutBranch` and `checkoutDefaultBranch` are deprecated and log a warning; they run `git pull --rebase` which crashes on divergent branches. Use `fetchAndResetToRemote` instead.
- `killProcessesInDirectory` silently no-ops when `lsof` is unavailable or returns no results.
- `createWorktree` prefers `origin/<baseBranch>` over the local `<baseBranch>` ref when the two diverge, logging a warning.
- `copyClaudeAssetsToWorktree` overwrites existing files unconditionally; skills with `target: true` in their `SKILL.md` frontmatter are left committable (not gitignored), allowing the product repo to track them.
- `removeWorktreesForIssue` matches worktrees using the regex `-issue-<N>-`, not an exact branch-name lookup, so multiple worktrees for the same issue are all removed.
