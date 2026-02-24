# PR-Review: Fix merge conflicts for PR #6

## PR-Review Description
PR #6 (`chore-issue-2-add-trigger-adw-mappings`) is in a `CONFLICTING` merge state against `main`. After PR #5 (`chore-issue-3-update-slash-command-model-map`) was merged into `main`, three files now have merge conflicts that must be resolved before this PR can be merged. The reviewer (paysdoc) requested these conflicts be fixed.

The three conflicting files are:
1. **`adws/__tests__/issueClassifier.test.ts`** — PR #5 changed the `vi.mock('../core')` approach from inline mock objects to using `importOriginal` (spreading the actual module and only overriding `log`). This branch uses inline mock objects that include `issueTypeToOrchestratorMap`. The two approaches conflict.
2. **`adws/core/utils.ts`** — Both branches modified `LogLevel` type member ordering. Main has `'info' | 'error' | 'success' | 'warn'`, this branch has `'info' | 'warn' | 'error' | 'success'`.
3. **`package.json`** — Main has `"build": "tsc --noEmit"` and `"lint": "tsc --noEmit"`, this branch has `"build": "tsc"` and `"lint": "eslint ."` (with eslint devDependencies added).

## Summary of Original Implementation Plan
The original implementation plan (`specs/issue-2-adw-add-mappings-to-trig-411ox1-sdlc_planner-add-trigger-adw-mappings.md`) introduced an explicit `issueTypeToOrchestratorMap` in `adws/core/issueTypes.ts` mapping issue types to orchestrator scripts (bug→adwPlanBuildTest, chore→adwPlanBuild, feature→adwSdlc, pr_review→adwPlanBuild). It replaced a `switch` statement in `getWorkflowScript()` with a map lookup, exported the new map from the barrel, updated tests, and updated README documentation. All 6 steps were completed successfully.

## Relevant Files
Use these files to resolve the review:

- `adws/__tests__/issueClassifier.test.ts` — Has a merge conflict in the `vi.mock('../core', ...)` block. PR #5's `importOriginal` approach conflicts with this branch's inline mock objects. Must be resolved to use `importOriginal` pattern (main's approach) while keeping this branch's new imports and parametric test.
- `adws/core/utils.ts` — Has a merge conflict in the `LogLevel` type definition. Member ordering differs between branches. Trivial conflict to resolve.
- `package.json` — Has a merge conflict in the `scripts` section. This branch's `"build": "tsc"` and `"lint": "eslint ."` scripts conflict with main's `"build": "tsc --noEmit"` and `"lint": "tsc --noEmit"`.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Rebase the branch onto `origin/main`
- Run `git fetch origin main` to ensure the latest main is available.
- Run `git rebase origin/main` to rebase this branch onto the updated main. This will surface the three conflicts.

### Step 2: Resolve conflict in `adws/__tests__/issueClassifier.test.ts`
- **Accept main's `importOriginal` mock approach** — The `vi.mock('../core', async (importOriginal) => { ... })` pattern from main is superior because it uses the real module data and only overrides `log`. This branch's inline mock objects are redundant since the real maps are available.
- The resolved `vi.mock('../core', ...)` block should be:
  ```typescript
  vi.mock('../core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../core')>();
    return {
      ...actual,
      log: vi.fn(),
    };
  });
  ```
- **Keep this branch's import additions on line 9** — Ensure `issueTypeToOrchestratorMap` and `IssueClassSlashCommand` remain in the import from `../core/dataTypes`:
  ```typescript
  import { adwCommandToIssueTypeMap, adwCommandToOrchestratorMap, issueTypeToOrchestratorMap, AdwSlashCommand, IssueClassSlashCommand, GitHubIssue } from '../core/dataTypes';
  ```
- **Keep this branch's updated test expectations** — The `/feature`, `/chore`, `/bug` routing expectations and the new parametric `issueTypeToOrchestratorMap` test at the bottom of the file must be preserved.

### Step 3: Resolve conflict in `adws/core/utils.ts`
- **Accept main's `LogLevel` ordering**: `export type LogLevel = 'info' | 'error' | 'success' | 'warn';`
- Also revert the `LOG_PREFIXES` record to match main's ordering:
  ```typescript
  const LOG_PREFIXES: Record<LogLevel, string> = {
    info: '📋',
    error: '❌',
    success: '✅',
    warn: '⚠️'
  };
  ```
- This keeps the diff minimal and avoids unnecessary cosmetic changes.

### Step 4: Resolve conflict in `package.json`
- **Accept this branch's scripts** since they are more correct (eslint for linting, tsc without `--noEmit` for building):
  ```json
  "scripts": {
    "build": "tsc",
    "lint": "eslint .",
    "test": "vitest run",
    "test:watch": "vitest"
  }
  ```
- **Keep this branch's eslint devDependencies** (`@eslint/js`, `eslint`, `typescript-eslint`) since the `"lint": "eslint ."` command requires them.

### Step 5: Complete the rebase
- After resolving all conflicts, stage the resolved files and run `git rebase --continue`.
- If there are additional commits with conflicts, repeat the resolution process for each.

### Step 6: Force push the rebased branch
- Run `git push --force-with-lease origin chore-issue-2-add-trigger-adw-mappings` to update the remote branch with the rebased history.

### Step 7: Run Validation Commands
- Run all validation commands to ensure zero regressions after the rebase.

## Validation Commands
Execute every command to validate the review is complete with zero regressions.

- `npm run lint` - Run linter to check for code quality issues
- `npm run build` - Build the application to verify no build errors
- `npm test` - Run tests to validate the review is complete with zero regressions

## Notes
- The `guidelines/` directory referenced in the original plan does not exist in the repository. This is a boilerplate reference and is non-blocking.
- PR #5 (`chore-issue-3-update-slash-command-model-map`) was merged into main between the time this branch was created and the review. That PR introduced: `importOriginal` mock pattern in tests, `getModelForCommand` utility, and build script updates.
- The `importOriginal` mock pattern from PR #5 is preferred because it uses real module exports and only overrides what's necessary (`log`), making tests less brittle and avoiding duplicated map data in mocks.
- After force-pushing, verify on GitHub that the PR merge state changes from `CONFLICTING` to `MERGEABLE`.
