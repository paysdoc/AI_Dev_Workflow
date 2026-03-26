# Patch: Verify all @adw-317 implementation and BDD scenarios pass

## Metadata
adwId: `kbzbn6`
reviewChangeRequest: `Issue #1: All @adw-317 scenarios FAILED with 'Undefined' step definitions. Zero implementation changes were applied to the 7 target source files.`

## Issue Summary
**Original Spec:** specs/issue-317-adw-tphvsj-fix-ensure-all-git-o-sdlc_planner-fix-git-repo-context.md
**Issue:** The scenario proof at `logs/kbzbn6-fix-ensure-all-git-o/scenario_proof/scenario_proof.md` showed all 21 @adw-317 scenarios FAILED — every `Then` step was "Undefined" and no implementation changes had been applied to the 7 target source files.
**Solution:** Prior patches (`patch-adw-tphvsj-apply-all-impl-steps-and-stepdefs.md`, `patch-adw-kbzbn6-add-e2e-step-definitions.md`) have since applied all 7 implementation steps and created the step definitions file. A dry-run confirms 21 scenarios / 73 steps with zero undefined. This patch validates the complete set of changes passes all BDD scenarios and the full regression suite with zero regressions.

## Files to Modify
No new code changes are needed. All implementation and step definition changes are already in the working tree:

- `adws/vcs/worktreeOperations.ts` — `baseRepoPath?` param added to `copyEnvToWorktree`, threaded to `getMainRepoPath`
- `adws/vcs/worktreeCreation.ts` — Both `copyEnvToWorktree` calls inside `ensureWorktree` pass `baseRepoPath`
- `adws/github/githubApi.ts` — `cwd?` param added to `getRepoInfo`, passed to `execSync`
- `adws/github/githubAppAuth.ts` — `cwd?` param added to `activateGitHubAppAuth`, passed to `execSync`
- `adws/triggers/autoMergeHandler.ts` — `getTargetRepoWorkspacePath` derived from webhook payload, passed to `ensureWorktree`
- `adws/phases/workflowInit.ts` — `targetRepoWorkspacePath` threaded to `findWorktreeForIssue` and both `copyEnvToWorktree` calls
- `adws/core/targetRepoManager.ts` — `convertToSshUrl` helper added and used in `cloneTargetRepo`
- `features/step_definitions/fixGitRepoContextSteps.ts` — All 21 @adw-317 scenario step definitions (structural + E2E)

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Confirm zero undefined steps via dry-run
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-317" --dry-run`
- Expect: 21 scenarios, 73 steps, 0 undefined
- If any steps are undefined, diagnose and fix the step definitions in `features/step_definitions/fixGitRepoContextSteps.ts`

### Step 2: Run @adw-317 regression scenarios
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-317 and @regression"`
- Expect: all 16 regression-tagged scenarios pass
- If any fail, diagnose the failure and apply a targeted fix within the corresponding source file or step definition

### Step 3: Run all @adw-317 scenarios including E2E
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-317"`
- Expect: all 21 scenarios pass (including the E2E scenarios that test `copyEnvToWorktree` with a real temp git repo and the structural auto-merge handler verification)
- If any fail, diagnose and fix

### Step 4: Run full regression suite
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`
- Expect: zero regressions across the full suite
- If any non-@adw-317 scenarios regress, diagnose whether the parameter additions broke any existing callers

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-317" --dry-run` — Zero undefined steps (21 scenarios, 73 steps)
2. `bun run lint` — No lint errors
3. `bunx tsc --noEmit` — Root TypeScript type-check passes
4. `bunx tsc --noEmit -p adws/tsconfig.json` — adws TypeScript type-check passes
5. `bun run build` — Build succeeds
6. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-317 and @regression"` — Issue-specific regression scenarios pass
7. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-317"` — All 21 issue scenarios pass
8. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Full regression suite passes with zero regressions

## Patch Scope
**Lines of code to change:** 0 (validation-only — all changes already applied by prior patches)
**Risk level:** low
**Testing required:** Full BDD validation: dry-run + lint + type-check + build + @adw-317 scenarios + full @regression suite
