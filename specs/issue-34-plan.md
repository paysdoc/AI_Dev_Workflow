# PR-Review: Make `/commit_cost` command flexible with optional parameters

## PR-Review Description
The PR review on `.claude/commands/commit_cost.md` requests that the `/commit_cost` slash command and its underlying `commitAndPushCostFiles()` function become more flexible when parameters are omitted:

1. **agentName optional** — If `agentName` is not provided, exclude it from the commit message prefix (e.g., `feat: add cost data` instead of `sdlc_planner: feat: add cost data`).
2. **issueClass optional** — If `issueClass` is not provided, exclude it from the commit message prefix (e.g., `add cost data` instead of `feat: add cost data`).
3. **issue optional** — If `issue` is not provided, commit **all** cost CSV files in the project directory (`projects/<project>/*.csv`).
4. **project required when issue is given** — If `project` is not provided but `issue` is, log an error and abort (cannot locate issue CSV without a project).
5. **Both missing** — If neither `project` nor `issue` is provided, commit **everything** under the `projects/` directory (`projects/**/*.csv`).

Currently the command and function only support the single-issue path: they stage exactly two files (`<issueNumber>-<slug>.csv` and `total-cost.csv`) and require all four arguments. This review asks us to support three commit scopes (single issue, whole project, all projects) and gracefully handle missing arguments.

## Summary of Original Implementation Plan
The original spec (`specs/issue-34-adw-trigger-should-commi-f8jwcf-sdlc_planner-commit-push-cost-csv.md`) describes:
- Creating a `/commit_cost` slash command that stages only cost CSV files
- Implementing `commitAndPushCostFiles()` in `gitOperations.ts` that targets issue CSV + project total CSV
- Integrating into the PR close webhook handler to auto-commit cost files
- Registering `/commit_cost` in the type system and model maps
- Adding tests for the new function and webhook integration

## Relevant Files
Use these files to resolve the review:

- **`.claude/commands/commit_cost.md`** — The slash command definition. Must be updated to describe optional parameter handling, flexible commit message format, and the three staging scopes.
- **`adws/github/gitOperations.ts`** — Contains `commitAndPushCostFiles()`. Must be refactored to support three modes: single issue, whole project, all projects. Must add validation for the error case (issue without project).
- **`adws/triggers/webhookHandlers.ts`** — Calls `commitAndPushCostFiles()` on PR close. Must be updated if the function signature changes.
- **`adws/__tests__/commitCostFiles.test.ts`** — Unit tests for `commitAndPushCostFiles()`. Must add tests for new modes (project-wide, all-projects, error case).
- **`adws/__tests__/webhookHandlers.test.ts`** — Tests for webhook handler. Must be updated if the call signature changes.
- **`guidelines/coding_guidelines.md`** — Coding guidelines to follow during implementation.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Refactor `commitAndPushCostFiles()` in `adws/github/gitOperations.ts`

Refactor the function to support three commit scopes via optional parameters:

- Change the signature to accept an options object for clarity:
  ```typescript
  interface CommitCostFilesOptions {
    repoName?: string;
    issueNumber?: number;
    issueTitle?: string;
    cwd?: string;
  }
  export function commitAndPushCostFiles(options: CommitCostFilesOptions): boolean
  ```
- **Validation**: If `issueNumber` is provided but `repoName` is not, log an error (`log('Cannot commit issue cost files without a project name', 'error')`) and return `false`.
- **Single issue mode** (repoName + issueNumber + issueTitle all provided): Current behavior — stage `getIssueCsvPath(repoName, issueNumber, issueTitle)` and `getProjectCsvPath(repoName)`, check status for those two paths, commit with message `cost: add cost data for issue #<issueNumber>`.
- **Project mode** (repoName provided, no issueNumber): Stage all CSV files in the project directory using `git add projects/<repoName>/*.csv`. Check `git status --porcelain -- "projects/<repoName>/"` for changes. Commit with message `cost: add cost data for <repoName>`.
- **All projects mode** (neither repoName nor issueNumber): Stage all CSV files under projects using `git add projects/`. Check `git status --porcelain -- "projects/"` for changes. Commit with message `cost: add cost data for all projects`.
- After commit, push to the current branch (same as current behavior).
- Keep the same error handling pattern (try/catch, log on failure, return false).

### Step 2: Update `adws/triggers/webhookHandlers.ts`

- Update the call to `commitAndPushCostFiles()` to use the new options object signature:
  ```typescript
  commitAndPushCostFiles({ repoName, issueNumber, issueTitle });
  ```
  where `repoName = repository.name`, `issueNumber` is from `extractIssueNumberFromPRBody`, and `issueTitle = pull_request.title`.

### Step 3: Update `.claude/commands/commit_cost.md`

- Update the Variables section to clarify all are optional:
  ```
  agentName: $1 (optional)
  issueClass: $2 (optional)
  issue: $3 (optional)
  project: $4 (optional)
  ```
- Update Instructions to describe flexible commit message format:
  - If both agentName and issueClass provided: `<agentName>: <issueClass>: <commit message>`
  - If only agentName provided: `<agentName>: <commit message>`
  - If only issueClass provided: `<issueClass>: <commit message>`
  - If neither provided: `<commit message>`
- Update Run section with conditional logic:
  - If `project` is not provided but `issue` is: log an error explaining project is required when issue is specified, and stop.
  - If both `project` and `issue` are provided: stage `projects/<project>/<issueNumber>-*.csv` and `projects/<project>/total-cost.csv` (current behavior).
  - If `project` is provided but `issue` is not: stage all CSV files in `projects/<project>/` via `git add projects/<project>/*.csv`.
  - If neither `project` nor `issue` is provided: stage everything in `projects/` via `git add projects/`.

### Step 4: Update `adws/__tests__/commitCostFiles.test.ts`

- Update all existing tests to use the new options object signature.
- Add test: **project mode** — calls with `{ repoName: 'my-repo' }` (no issue), verifies `git add projects/my-repo/*.csv` is called, commit message is `cost: add cost data for my-repo`.
- Add test: **all projects mode** — calls with `{}` (empty options), verifies `git add projects/` is called, commit message is `cost: add cost data for all projects`.
- Add test: **error case** — calls with `{ issueNumber: 42, issueTitle: 'Some title' }` (no repoName), verifies function returns `false` without calling git add or git commit.
- Add test: **project mode with no changes** — returns false when `git status --porcelain -- "projects/my-repo/"` is empty.
- Add test: **all projects mode with no changes** — returns false when `git status --porcelain -- "projects/"` is empty.

### Step 5: Update `adws/__tests__/webhookHandlers.test.ts`

- Update the test `'calls commitAndPushCostFiles with correct arguments when PR is closed with issue link'` to verify the new options object format:
  ```typescript
  expect(commitAndPushCostFiles).toHaveBeenCalledWith({
    repoName: 'repo',
    issueNumber: 42,
    issueTitle: 'Add feature',
  });
  ```

### Step 6: Run Validation Commands

Run all validation commands to ensure zero regressions.

## Validation Commands
Execute every command to validate the review is complete with zero regressions.

- `npm run lint` - Run linter to check for code quality issues
- `npx tsc --noEmit` - Type check the main project
- `npx tsc --noEmit -p adws/tsconfig.json` - Type check the adws project
- `npm test` - Run tests to validate the review is complete with zero regressions

## Notes
- The reviewer's last bullet says "If neither project nor error is provided" — this is interpreted as "If neither project nor **issue** is provided" (likely a typo).
- The webhook handler always has both `repoName` and `issueNumber` available, so its behavior won't change — it will continue using the single-issue path. The new flexibility is primarily for the slash command (manual invocation) use case.
- The options object pattern is preferred over positional optional parameters because the function now has multiple optional fields where any combination may be provided, making positional args confusing.
- The `getIssueCsvPath` and `getProjectCsvPath` helpers from `costCsvWriter.ts` are only used in single-issue mode. Project-wide and all-projects modes use direct glob paths.
