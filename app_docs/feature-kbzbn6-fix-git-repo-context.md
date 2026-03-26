# Fix: Git Repository Context Threading

**ADW ID:** kbzbn6-fix-ensure-all-git-o
**Date:** 2026-03-26
**Specification:** specs/issue-317-adw-tphvsj-fix-ensure-all-git-o-sdlc_planner-fix-git-repo-context.md

## Overview

Fixed a systemic bug where multiple git operations silently defaulted to `process.cwd()` (the ADW repo) instead of the target external repository. The fix threads explicit `baseRepoPath`/`cwd` parameters through all affected VCS and GitHub functions, ensuring that worktree creation, `.env` copying, and remote URL resolution always target the correct repository.

## What Was Built

- `baseRepoPath` parameter added to `copyEnvToWorktree()` so `.env` is copied from the correct source repo
- `cwd` parameter added to `getRepoInfo()` so git remote reads target the correct repo
- `cwd` parameter added to `activateGitHubAppAuth()` git remote fallback
- Auto-merge handler now derives target repo workspace path from the webhook payload and passes it to `ensureWorktree()`
- `workflowInit.ts` threads `targetRepoWorkspacePath` through all VCS function calls
- `convertToSshUrl()` pure helper added to `targetRepoManager.ts` — converts HTTPS GitHub clone URLs to SSH format to prevent "could not read Username" failures in non-interactive contexts

## Technical Implementation

### Files Modified

- `adws/vcs/worktreeOperations.ts`: Added `baseRepoPath?` to `copyEnvToWorktree()`, passed to `getMainRepoPath(cwd?)`
- `adws/vcs/worktreeCreation.ts`: Threaded `baseRepoPath` through both `copyEnvToWorktree()` calls in `ensureWorktree()`
- `adws/github/githubApi.ts`: Added `cwd?` parameter to `getRepoInfo()`, passed to `execSync`
- `adws/github/githubAppAuth.ts`: Added `cwd?` parameter to `activateGitHubAppAuth()`, passed to git remote fallback
- `adws/triggers/autoMergeHandler.ts`: Added `getTargetRepoWorkspacePath` import and derived workspace path before calling `ensureWorktree(headBranch, undefined, targetRepoWorkspacePath)`
- `adws/phases/workflowInit.ts`: Passed `targetRepoWorkspacePath` to `findWorktreeForIssue()` and both `copyEnvToWorktree()` call sites; added `completedPhases` support for pause/resume
- `adws/core/targetRepoManager.ts`: Added exported `convertToSshUrl()` helper and applied it in `cloneTargetRepo()`

### Key Changes

- **Root cause**: `copyEnvToWorktree` and `getRepoInfo` had no `cwd`/`baseRepoPath` parameter, so they silently resolved to the ADW repo's path via `process.cwd()` instead of the target repo
- **All parameter additions are optional** — backward compatibility is fully preserved; callers that don't pass repo context continue to work for ADW-internal workflows
- **SSH URL conversion** applies only to new clones; existing repos cloned via HTTPS are unaffected
- **Auto-merge fix** follows the established pattern from `webhookHandlers.ts` (lines 69-71) and `prReviewPhase.ts` (line 99)
- **No new silent defaults** introduced — every git operation now receives explicit repo context when one is available

## How to Use

These are internal infrastructure fixes; no user-facing API changes are required. The fixes apply automatically when ADW processes issues for external target repositories.

For operators adding a new target repo:
1. The new target repo will be cloned via SSH (`git@github.com:owner/repo.git`) automatically
2. Existing HTTPS-cloned repos can be manually converted: `git -C <workspace_path> remote set-url origin git@github.com:owner/repo.git`

## Configuration

No new configuration required. The `getTargetRepoWorkspacePath()` function already reads target repo paths from existing ADW configuration.

## Testing

```bash
# Run issue-specific BDD regression scenarios
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-317 and @regression"

# Run full regression suite
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
```

BDD scenarios are in `features/fix_git_repo_context.feature` with step definitions in `features/step_definitions/fixGitRepoContextSteps.ts`.

## Notes

- The `convertToSshUrl()` function is a pure helper (exported) — it can be reused wherever HTTPS→SSH conversion is needed
- `getRepoInfo()` callers that run with `cwd` already set to the correct repo (e.g., `trigger_cron.ts`) continue to work correctly without changes
- `findWorktreeForIssue()` already accepted `cwd?` as its third parameter — only the caller in `workflowInit.ts` needed updating
