# Worktree and VCS

## Overview

`adws/vcs/` provides branch and commit operations for ADW workflows, plus two surviving worktree-adjacent utilities. Worktree create/remove/reset/list/find operations have been migrated to `GitContext` methods in `adws/gitContext/` (see `feature-oqb76h-gitcontext-base-path-authority.md`). The worktree-setup step that copies Claude skills and commands into a new workspace lives in `adws/phases/worktreeSetup.ts`.

## Responsibilities

**Branch operations (`adws/vcs/branchOperations.ts`)**
- `generateBranchName`: assembles a canonical `<prefix>-issue-<N>-<slug>` branch name, validating the slug first.
- `validateSlug`: enforces lowercase, hyphens-only, no leading/trailing/consecutive hyphens, ≤50 chars, no branch prefix, no `issue-<N>` segment, no forbidden git-ref characters.
- `getDefaultBranch`: queries `gh repo view --json defaultBranchRef` for the repo's default branch.
- `mergeLatestFromDefaultBranch`: fetches and merges `origin/<defaultBranch>` into the current branch; logs warnings on failure without throwing.
- `fetchAndResetToRemote`: fetches `origin/<defaultBranch>` and hard-resets the worktree to it; throws on failure.
- `deleteLocalBranch` / `deleteRemoteBranch`: delete branches, refusing to touch protected branches (`main`, `master`, `develop`).

**Commit operations (`adws/vcs/commitOperations.ts`)**
- `commitChanges`: stages all changes and commits with a message; returns false when there is nothing to commit.
- `getHeadTreeHash`: returns `HEAD^{tree}` hash for use by the progress gate.
- `hasUncommittedChanges`: returns true when `git status --porcelain` is non-empty.
- `pushBranch`: pushes the branch to `origin` using `--force-with-lease --force-if-includes`. First refreshes the remote-tracking ref via `git fetch origin "<branch>"` (fetch errors are tolerated for first-push). On a genuine lease refusal (remote moved underneath ADW), throws a distinct actionable error rather than propagating a raw git error. All feature-branch push call sites (`prPhase`, `documentPhase`, `reviewPhase`, `scenarioFixPhase`, `prReviewPhase`) route through this single function.

**Surviving worktree utilities**
- `getMainRepoPath` (`adws/vcs/worktreeOperations.ts`): explicit-`cwd` reverse lookup (worktree → main repo root) used by `claudeAgent.ts` to set `ADW_MAIN_REPO_PATH`. Not a base-path defaulter; retained intentionally.
- `killProcessesInDirectory` (`adws/vcs/worktreeProcessKill.ts`): uses `lsof +D` to find PIDs with open files in a directory, sends SIGTERM, then SIGKILL for survivors after 500ms. Used by `devServerJanitor.ts`. Not a base-path computation; retained intentionally.

**Branch identity (`adws/vcs/branchIdentity.ts`)**
- `deterministicBranchName` / `branchMatchesIssue`: slug-agnostic branch matching predicates used by the branch-identity fallback system.

**Worktree setup (`adws/phases/worktreeSetup.ts`)**
- `copyClaudeAssetsToWorktree`: copies all `.claude/commands/*.md` and `.claude/skills/` directories from the ADW framework repo into the worktree, applying gitignore entries for assets not marked `target: true`.
- `ensureGitignoreEntry` / `ensureGitignoreEntries`: idempotently appends entries to the worktree's `.gitignore`.
- `verifyAdwRegen`: checks that all six canonical `.adw/` config files exist and are non-empty, that `vocabulary.md` exists, and that `.adw/.regen-receipt` carries the expected framework hash.
- `decideWorktreeReuse` (`worktreeReuseGate`): pure guard-clause function over a `WorktreeProbe` record of Class-A git-operability signals. Returns `{ reuse: true }` when all health conditions hold; returns `{ reuse: false, reason }` with a typed `WorktreeResetReason`. No I/O.
- `probeWorktree` (`worktreeProbe`): thin I/O shell that gathers `WorktreeProbe` signals from a real worktree. All I/O is injected via `ProbeDeps` so the function is unit-testable without a real git repo.
- `clearOrphanedIndexLock` (`worktreeProbe`): removes a stale `<gitdir>/index.lock` after the reuse gate confirms it is orphaned.

## Contracts & Invariants

- Protected branches (`main`, `master`, `develop`) are never deleted by `deleteLocalBranch` or `deleteRemoteBranch`.
- `validateSlug` throws with a human-readable message on any constraint violation; `generateBranchName` never propagates a malformed name.
- `copyClaudeAssetsToWorktree` never gitignores a path already tracked by git — `git ls-files` is consulted before adding gitignore entries.
- `verifyAdwRegen` requires both file presence and receipt freshness (hash match); a receipt from a prior upgrade cycle fails the check.
- `fetchAndResetToRemote` throws on failure; `mergeLatestFromDefaultBranch` only logs warnings.
- `pushBranch` recovers a legitimately rewritten branch without clobbering unseen remote work. A genuine lease failure throws a distinct error containing "force-with-lease" and "manual" and does NOT retry.

## Configuration

Branch names use the form `<prefix>-issue-<N>-<slug>`. `PROTECTED_BRANCHES` is a module-level constant. `copyClaudeAssetsToWorktree` reads `target: true` frontmatter from skill/command files to determine what is committed vs gitignored in the worktree.

## Gotchas

- **Worktree create/remove/reset/list are now on `GitContext`** — `ensureWorktree`, `createWorktree`, `createWorktreeForNewBranch`, `getWorktreeForBranch`, `removeWorktree`, `removeWorktreesForIssue`, `listWorktrees`, `findWorktreeForIssue`, `worktreeExists`, `copyEnvToWorktree`, and `resetWorktree` were deleted from `adws/vcs/` and are now methods on `GitContext` in `adws/gitContext/`. All callers now go through `gitContextFor` / `gitContextForSync`.
- `checkoutBranch` and `checkoutDefaultBranch` are deprecated and log a warning; they run `git pull --rebase` which crashes on divergent branches. Use `fetchAndResetToRemote` instead.
- `killProcessesInDirectory` silently no-ops when `lsof` is unavailable or returns no results.
- `createWorktree` (now in `GitContext`) prefers `origin/<baseBranch>` over the local `<baseBranch>` ref when they diverge, logging a warning.
- `copyClaudeAssetsToWorktree` overwrites existing files unconditionally; skills with `target: true` in their `SKILL.md` frontmatter are left committable.
- `decideWorktreeReuse` checks `liveOwner` first, then `indexLock === 'live_held'`, then interrupted ops, then HEAD, then registration. The guard order is deterministic.
- `pushBranch` uses `--force-if-includes` (git ≥ 2.30) alongside `--force-with-lease`. A bare `--force-with-lease` after a fetch would lease against the just-fetched tip and always succeed — `--force-if-includes` restores the safety check. If a rewrite happened in a different clone/worktree (tip absent from local reflog), the push refuses with the distinct lease error.
- `adwUpgrade.tsx` has its own separate branch-push (claim-branch) with `non-fast-forward` "park as loser" semantics; it is intentionally NOT routed through `pushBranch`.
