# PR-Review: Resolve application tests and merge conflicts for external repo support

## PR-Review Description
PR #4 (`feat-issue-1-run-on-external-git-repo`) has two review comments from paysdoc:

1. **Application Tests in `test.md` (line 69):** "Application tests should not be removed, they are essential, but they have to be run in the target repo." The Application Tests section was removed in commit `e81b25f` and later restored in commit `a92d0c2` along with a `src -> adws` symlink workaround. However, the reviewer's intent is that the application tests (`npm test -- --run src`) must execute inside the **target repo workspace** when ADW operates on an external repository — not be faked via a symlink pointing `src` back to `adws`. The `src -> adws` symlink and the `passWithNoTests` config are incorrect solutions; instead, the test execution logic needs to be aware of whether it's running on the ADW repo itself or an external target repo, and run the application tests in the correct context.

2. **General comment:** "resolve merge conflicts." The PR is in a CONFLICTING state on GitHub (`mergeable: CONFLICTING`). Remote `origin/main` has merged PRs #5 and #6 since this branch diverged, introducing changes across 10 files that conflict with this branch.

## Summary of Original Implementation Plan
The original plan (`specs/issue-1-adw-enable-adw-to-run-on-uwva44-sdlc_planner-external-repo-workspace.md`) describes enabling ADW to operate on external git repositories by:
- Introducing a `TargetRepoManager` module to manage workspace directories for external repos (cloned to `~/.adw/repos/{owner}/{repo}/`)
- Extracting target repo info from webhook/cron payloads
- Propagating target repo context through the entire workflow lifecycle via `WorkflowConfig.targetRepo`
- Updating GitHub API modules, worktree operations, and workflow phases to support external repo context
- Keeping all ADW state (logs, agents, specs) in the ADW repository while git worktrees are created in the target repo workspace

## Relevant Files
Use these files to resolve the review:

- `.claude/commands/test.md` — The test validation suite slash command. The Application Tests section (step 6) needs to be updated so the command runs in the target repo context rather than the ADW repo. Currently uses `npm test -- --run src` which only makes sense when executed in a project with a `src/` directory containing tests.
- `src` (symlink) — The `src -> adws` symlink created in commit `14aca3a` is a workaround that must be removed. It fakes `npm test -- --run src` by pointing at `adws`, which defeats the purpose of application tests.
- `vitest.config.ts` — Updated in commit `14aca3a` to include `src/**` patterns for the symlink. The `src/**` include pattern and the comment referencing the symlink need to be reverted.
- `adws/core/index.ts` — Conflict with origin/main which adds new exports (`SLASH_COMMAND_MODEL_MAP_FAST`, `getModelForCommand`, `isFastMode`, `issueTypeToOrchestratorMap`).
- `adws/core/utils.ts` — Conflict: both branches add `warn` to LogLevel but in different order within the union type.
- `adws/github/pullRequestCreator.ts` — Conflict: origin/main removes an old `getRepoInfo` import.
- `adws/phases/buildPhase.ts` — Conflict: origin/main adds `issue.body` as 7th parameter to `runCommitAgent`.
- `adws/phases/planPhase.ts` — Conflict: origin/main removes unused import and adds `issue.body` parameter.
- `adws/phases/prReviewPhase.ts` — Conflict: origin/main adds `prDetails.body` and `issueBody` parameters to multiple agent calls.
- `adws/phases/testPhase.ts` — Conflict: origin/main adds `issue` to destructuring and `issueBody: issue.body` to test configs.
- `adws/phases/workflowLifecycle.ts` — Conflict: origin/main removes unused import and adds `issueBody` parameter to review config.
- `eslint.config.js` — ADD/ADD conflict: both branches created this file with slightly different content. Origin/main adds `.claude/` to ignores and adds `prefer-const` rule.
- `package.json` — May need updating after merge conflict resolution.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Remove the `src -> adws` symlink
- Delete the `src` symlink from the repo root: `rm src`
- Stage the deletion: `git rm src`
- This symlink was a workaround that made `npm test -- --run src` run ADW tests instead of real application tests, which is not what the reviewer intended

### Step 2: Revert vitest.config.ts symlink-related changes
- In `vitest.config.ts`, remove the `src/**` pattern from the `include` array since `src` is no longer a symlink to `adws`
- Revert the comment to its original form or remove the symlink reference
- The include should only have: `['adws/**/*.{test,spec}.?(c|m)[jt]s?(x)']`
- The `passWithNoTests` config added in commit `a92d0c2` should also be removed since it was added to suppress warnings from the empty symlink pattern

### Step 3: Update `.claude/commands/test.md` Application Tests section
- The Application Tests section (step 6) should remain in `test.md` as the reviewer requested
- Update the test_purpose to correctly describe what it validates (currently it incorrectly says "ADW" — should describe application-level tests)
- Add a note/condition that this test should only execute when running in a project that has a `src/` directory with tests (i.e., the target repo). If no `src/` directory exists, the test should be skipped
- Updated section should be:
  ```markdown
  ### Application Tests

  6. **Application Tests**
     - Command: `npm test -- --run src`
     - test_name: "app_tests"
     - test_purpose: "Validates application-level test suites under the src/ directory in the target repository"
     - Condition: Only execute if a `src/` directory exists in the working directory. If `src/` does not exist, skip this test and mark it as passed with a note indicating it was skipped (no src/ directory found).
  ```

### Step 4: Rebase onto latest `origin/main` to resolve merge conflicts
- Run `git fetch origin main` to ensure we have the latest remote main
- Run `git rebase origin/main` to rebase this branch onto the latest main
- Resolve each conflict file during the rebase as described below

### Step 5: Resolve conflict in `adws/core/index.ts`
- Accept BOTH sides: keep all existing exports from the feature branch AND add the new exports from origin/main (`SLASH_COMMAND_MODEL_MAP_FAST`, `getModelForCommand`, `isFastMode`, `issueTypeToOrchestratorMap`)
- These are independent additions that don't conflict semantically

### Step 6: Resolve conflict in `adws/core/utils.ts`
- Accept origin/main's ordering of the LogLevel union type: `'info' | 'error' | 'success' | 'warn'`
- Both branches add the same `warn` level — just pick one consistent ordering (origin/main's since it's the base)
- Ensure the `parseTargetRepoArg` function and other additions from this feature branch are preserved

### Step 7: Resolve conflict in `adws/github/pullRequestCreator.ts`
- Accept origin/main's removal of the old `getRepoInfo` import
- Keep this branch's `RepoInfo` type import since it's used by the external repo feature
- Ensure the `repoInfo` parameter additions from this feature branch are preserved

### Step 8: Resolve conflicts in phase files (`buildPhase.ts`, `planPhase.ts`, `prReviewPhase.ts`, `testPhase.ts`, `workflowLifecycle.ts`)
- For each phase file, accept BOTH sets of changes:
  - From origin/main: add the `issue.body` / `issueBody` parameters to agent calls and `prDetails.body` parameters where applicable
  - From this branch: keep all `targetRepo`, `repoInfo`, and external repo context changes
- These are independent features that can coexist
- In `workflowLifecycle.ts`: accept origin/main's removal of unused `shouldExecuteStage` import while keeping this branch's `TargetRepoInfo` and `ensureTargetRepoWorkspace` imports
- In `testPhase.ts`: accept origin/main's addition of `issue` to destructuring and `issueBody` parameter while keeping this branch's `repoInfo` additions

### Step 9: Resolve conflict in `eslint.config.js`
- Accept origin/main's version as the base since it has stricter rules (`prefer-const`) and includes `.claude/` in the ignore list
- Verify that any project-specific ignores from this branch are preserved

### Step 10: Resolve conflict in `vitest.config.ts`
- After Step 2's changes, this file should only include `adws/**` test patterns
- Accept origin/main's comment wording about discovering tests via the real adws/ directory
- The final config should NOT include `src/**` patterns or any symlink references

### Step 11: Run validation commands
- Execute all validation commands listed below to confirm zero regressions after the rebase and all changes

## Validation Commands
Execute every command to validate the review is complete with zero regressions.

- `npm run lint` - Run linter to check for code quality issues
- `npm run build` - Build the application to verify no build errors
- `npm test` - Run tests to validate the review is complete with zero regressions

## Notes
- The `src -> adws` symlink (commit `14aca3a`) and `passWithNoTests` config (commit `a92d0c2`) were attempted fixes for the app tests review comment but are incorrect solutions. The reviewer wants real application tests to run in the target repo, not ADW tests disguised via a symlink.
- The merge conflicts are primarily from PRs #5 and #6 merged to main, which added: (a) dynamic model selection via `getModelForCommand` and fast mode support, (b) `issueTypeToOrchestratorMap` for trigger routing, (c) systematic addition of `issueBody` parameters to agent calls across all phases, and (d) ESLint config with stricter rules. These are independent features that should merge cleanly alongside the external repo support.
- During rebase, if `package-lock.json` conflicts arise, accept the incoming version and run `npm install` to regenerate it.
- The rebase should be done interactively to handle each commit's conflicts separately, as the 5 branch commits may each conflict differently with the 9 new commits on origin/main.
