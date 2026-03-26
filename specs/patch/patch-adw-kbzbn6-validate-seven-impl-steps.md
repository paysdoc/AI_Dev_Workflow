# Patch: Validate all 7 git repo context implementation steps are applied

## Metadata
adwId: `kbzbn6-fix-ensure-all-git-o`
reviewChangeRequest: `Issue #2: Zero source code changes for the 7 spec steps`

## Issue Summary
**Original Spec:** specs/issue-317-adw-tphvsj-fix-ensure-all-git-o-sdlc_planner-fix-git-repo-context.md
**Issue:** Review flagged that none of the 7 spec steps had been implemented (no source code changes). All 7 implementation steps and BDD step definitions have since been applied by prior patches. This patch validates the changes are correct and all BDD scenarios pass.
**Solution:** Verify all 7 source changes are in place, then run the full validation suite. No new code changes are expected — this is a validation-only patch.

## Files to Modify
No files need modification. All changes are already applied:

- `adws/vcs/worktreeOperations.ts` — `baseRepoPath` param added to `copyEnvToWorktree` ✅
- `adws/vcs/worktreeCreation.ts` — `baseRepoPath` threaded to both `copyEnvToWorktree` calls ✅
- `adws/github/githubApi.ts` — `cwd` param added to `getRepoInfo` and passed to `execSync` ✅
- `adws/github/githubAppAuth.ts` — `cwd` param added to `activateGitHubAppAuth` and passed to `execSync` ✅
- `adws/triggers/autoMergeHandler.ts` — `getTargetRepoWorkspacePath` derived and passed to `ensureWorktree` ✅
- `adws/phases/workflowInit.ts` — `targetRepoWorkspacePath` threaded to `findWorktreeForIssue` and `copyEnvToWorktree` ✅
- `adws/core/targetRepoManager.ts` — `convertToSshUrl` helper added and used in `cloneTargetRepo` ✅
- `features/step_definitions/fixGitRepoContextSteps.ts` — All step definitions for @adw-317 scenarios ✅

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Verify all 7 source changes are present
- Run `git diff --stat` and confirm all 7 `adws/` files show modifications
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-317" --dry-run` to confirm zero undefined steps (expect 21 scenarios, 73 steps)
- If any step definitions are undefined or source changes are missing, stop and report — do not proceed

### Step 2: Run full validation suite
- Run `bun run lint` to verify no lint errors
- Run `bunx tsc --noEmit` to verify root TypeScript config type-checks
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to verify adws TypeScript config type-checks
- Run `bun run build` to verify no build errors
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-317 and @regression"` to verify issue-specific regression scenarios pass
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-317"` to verify ALL 21 @adw-317 scenarios pass (including E2E)
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` to verify full regression suite passes with zero regressions

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `git diff --stat` — Confirm all 7 adws files + step definitions are modified/created
2. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-317" --dry-run` — Zero undefined steps
3. `bun run lint` — No lint errors
4. `bunx tsc --noEmit` — Root TypeScript type-check passes
5. `bunx tsc --noEmit -p adws/tsconfig.json` — adws TypeScript type-check passes
6. `bun run build` — Build succeeds
7. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-317 and @regression"` — Issue regression scenarios pass
8. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-317"` — All 21 issue scenarios pass
9. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Full regression suite passes

## Patch Scope
**Lines of code to change:** 0 (validation-only — all changes already applied)
**Risk level:** low
**Testing required:** Full BDD validation suite for @adw-317 + full @regression suite
