# Bug: PR review workflow targets wrong repository for worktree creation

## Metadata
issueNumber: `223`
adwId: `ie8l08-wrong-repository-bei`
issueJson: `{"number":223,"title":"Wrong repository being targeted","body":"The Pr Review is trying to access the wrong repository. It is supposed to be vestmatic but it is looking in AI Developer Workflow.","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-17T16:58:18Z"}`

## Bug Description
When `adwPrReview.tsx` processes a PR from a target repository (e.g., vestmatic), it calls `initializePRReviewWorkflow` which calls `ensureWorktree(prDetails.headBranch)` **without passing the target repository workspace path**. This causes all git commands (branch lookup, worktree creation) to execute against the ADW repository instead of the target repository.

**Symptoms:**
- `git log "chore-issue-30-update-adw-settings"` fails with "ambiguous argument" because the branch doesn't exist in the ADW repo
- `ensureWorktree` fails with "Branch does not exist and no base branch was provided"
- The worktree is attempted at `AI_Dev_Workflow/.worktrees/` instead of the target repo's `.worktrees/`

**Expected behavior:** When processing a PR for vestmatic, all git operations should execute against the vestmatic workspace (e.g., `~/.adw/repos/paysdoc/vestmatic/`).

**Actual behavior:** Git operations execute against the ADW repository's working directory.

## Problem Statement
`initializePRReviewWorkflow` in `prReviewPhase.ts` does not resolve or thread through the target repository workspace path. While `adwPrReview.tsx` parses `--target-repo` args into `repoInfo` and `repoId`, the `TargetRepoInfo` (with `cloneUrl`) is discarded, and no workspace path is ever computed. The `ensureWorktree` call on line 92 receives no `baseRepoPath`, so all git commands default to the current process directory (ADW repo).

## Solution Statement
1. Add `targetRepo?: TargetRepoInfo` parameter to `initializePRReviewWorkflow`
2. When `targetRepo` is provided, call `ensureTargetRepoWorkspace(targetRepo)` to clone/pull the target repo and get its workspace path
3. Pass the workspace path as `baseRepoPath` to `ensureWorktree`
4. Pass the full `targetRepo` object from `adwPrReview.tsx` to `initializePRReviewWorkflow`

This mirrors the pattern already established in `workflowInit.ts` (lines 140-168).

## Steps to Reproduce
1. A PR exists on `paysdoc/vestmatic` (e.g., PR #31 with branch `chore-issue-30-update-adw-settings`)
2. The cron trigger spawns `adwPrReview.tsx 31 --target-repo paysdoc/vestmatic --clone-url <url>`
3. `adwPrReview.tsx` parses `--target-repo` but only passes `repoInfo` (owner/repo) to `initializePRReviewWorkflow`
4. `initializePRReviewWorkflow` calls `ensureWorktree(prDetails.headBranch)` without `baseRepoPath`
5. Git operations execute against ADW repo → branch not found → crash

## Root Cause Analysis
This is a recurring class of bugs (see issues #52, #56, #33, #23, #62, #217) where functions operating on external target repos default to the ADW repository's working directory.

**Why it's back:** When `prReviewPhase.ts` was written or last refactored, the `ensureWorktree` call was not updated to receive the target repo workspace path. The regular workflow init (`workflowInit.ts`) was fixed in prior issues to correctly thread `targetRepoWorkspacePath` through to `ensureWorktree` (line 168), but the PR review init path was missed.

**Prior fixes addressed:**
- Issue #56: Added `baseRepoPath` parameter to worktree functions
- Issue #52: Threaded `repoInfo` to classifier
- Issue #217: Added `git fetch` fallback in `createWorktree`

None of these fixes addressed `initializePRReviewWorkflow`'s `ensureWorktree` call specifically.

## Relevant Files
Use these files to fix the bug:

- `adws/phases/prReviewPhase.ts` — Contains `initializePRReviewWorkflow` with the broken `ensureWorktree` call (line 92). **Primary fix location.**
- `adws/adwPrReview.tsx` — Entry point that parses `--target-repo` args. Currently discards the full `TargetRepoInfo` and only passes `repoInfo` (owner/repo). Needs to pass `targetRepo` through.
- `adws/vcs/worktreeCreation.ts` — `ensureWorktree` already supports `baseRepoPath` parameter. No changes needed.
- `adws/core/targetRepoManager.ts` — `ensureTargetRepoWorkspace` already handles cloning/pulling. Needs to be imported in `prReviewPhase.ts`.
- `adws/phases/workflowInit.ts` — Reference implementation showing correct target repo workspace handling (lines 140-168).
- `guidelines/coding_guidelines.md` — Coding guidelines to follow.
- `features/pr_review_worktree_creation.feature` — Existing BDD feature for PR review worktree creation. Will add new regression scenarios here.
- `features/step_definitions/prReviewWorktreeFetchSteps.ts` — Existing step definitions. Will add new steps for target repo regression.

## Step by Step Tasks

### 1. Fix `initializePRReviewWorkflow` to accept and use target repo info

- Open `adws/phases/prReviewPhase.ts`
- Import `ensureTargetRepoWorkspace` from `../core` and `TargetRepoInfo` from `../types/issueTypes`
- Add `targetRepo?: TargetRepoInfo` parameter to the `initializePRReviewWorkflow` function signature
- Before the `ensureWorktree` call (line 92), add target repo workspace resolution:
  ```typescript
  let targetRepoWorkspacePath: string | undefined;
  if (targetRepo) {
    log(`Setting up target repo workspace for ${targetRepo.owner}/${targetRepo.repo}...`, 'info');
    targetRepoWorkspacePath = ensureTargetRepoWorkspace(targetRepo);
    log(`Target repo workspace: ${targetRepoWorkspacePath}`, 'success');
  }
  ```
- Change the `ensureWorktree` call to pass the workspace path:
  ```typescript
  const worktreePath = ensureWorktree(prDetails.headBranch, undefined, targetRepoWorkspacePath);
  ```

### 2. Update `adwPrReview.tsx` to pass `targetRepo` to `initializePRReviewWorkflow`

- Open `adws/adwPrReview.tsx`
- Change the `initializePRReviewWorkflow` call (line 46) to pass the full `targetRepo`:
  ```typescript
  const config = await initializePRReviewWorkflow(prNumber, null, repoInfo, repoId, targetRepo ?? undefined);
  ```

### 3. Add regression BDD scenarios

- Open `features/pr_review_worktree_creation.feature`
- Add new `@adw-223 @regression` scenarios that verify:
  1. `initializePRReviewWorkflow` calls `ensureTargetRepoWorkspace` when a target repo is provided
  2. `ensureWorktree` is called with `baseRepoPath` (not bare) when processing a target repo PR
  3. The `adwPrReview.tsx` entry point passes the `targetRepo` parameter through to `initializePRReviewWorkflow`

### 4. Add step definitions for new regression scenarios

- Open `features/step_definitions/prReviewWorktreeFetchSteps.ts`
- Add step definitions that verify:
  1. `prReviewPhase.ts` imports `ensureTargetRepoWorkspace`
  2. `prReviewPhase.ts` calls `ensureTargetRepoWorkspace` when `targetRepo` is provided
  3. `ensureWorktree` is called with a third argument (baseRepoPath) derived from the target repo workspace
  4. `adwPrReview.tsx` passes `targetRepo` to `initializePRReviewWorkflow`

### 5. Run validation commands

- Run `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json` to verify type safety
- Run `bun run lint` to verify code quality
- Run `bunx cucumber-js --tags "@adw-223"` to verify new regression scenarios pass
- Run `bunx cucumber-js --tags "@adw-217"` to verify existing PR review worktree scenarios still pass
- Run `bunx cucumber-js --tags "@regression"` to verify no regressions across all BDD scenarios

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bunx tsc --noEmit` — Root TypeScript type check
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW TypeScript type check
- `bun run lint` — Linter check
- `bunx cucumber-js --tags "@adw-223"` — Run new regression scenarios for this fix
- `bunx cucumber-js --tags "@adw-217"` — Run existing PR review worktree scenarios (no regressions)
- `bunx cucumber-js --tags "@regression"` — Run all regression scenarios

## Notes
- This is a **surgical fix** — only 2 source files need changes (`prReviewPhase.ts` and `adwPrReview.tsx`), plus regression tests
- The fix mirrors the proven pattern in `workflowInit.ts` (lines 140-168) which already handles target repos correctly
- This is the 7th instance of the "wrong repository" class of bugs (issues #23, #33, #52, #56, #62, #119, #217). The regression BDD scenarios should prevent this specific path from breaking again.
- Follow `guidelines/coding_guidelines.md` for all changes
