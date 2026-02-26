# Feature: Commit and Push Cost CSV Files on PR Close

## Metadata
issueNumber: `34`
adwId: `trigger-should-commi-f8jwcf`
issueJson: `{"number":34,"title":"Trigger should commit and push all cost related CSV files","body":"The trigger, when it detects that a PR was closed, should commit and push all related cost calculations that have been added in the main branch of the ADW.\n\nA new claude command /commit_cost should be created. This command is essentially a copy of /commit, but limited to cost related files for the repo and issue that was affected by closing the ADW. \n\n```2. Run `git add -A` to stage all changes``` should be changed to add only specific files - the cost of the current issue and the total cost for the repo.","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-02-26T13:03:05Z","comments":[],"actionableComment":null}`

## Feature Description
When an ADW workflow completes and its PR is merged/closed, cost CSV files (per-issue and project total) are written to the ADW repo's main branch but remain uncommitted. This feature adds automatic commit and push of those cost CSV files when the webhook trigger detects a PR close event. Additionally, a new `/commit_cost` Claude slash command is created as a targeted version of `/commit` that only stages cost-related CSV files instead of using `git add -A`.

## User Story
As an ADW operator
I want cost CSV files to be automatically committed and pushed when a PR is closed
So that cost tracking data is persisted in the repository without manual intervention

## Problem Statement
After an ADW workflow completes, `completeWorkflow()` writes cost CSV files (`projects/<repo>/<issue>-<slug>.csv` and `projects/<repo>/total-cost.csv`) to the ADW repo's working directory. These files remain uncommitted and unpushed, requiring manual action to persist them. When the trigger detects a PR closure, it cleans up worktrees and closes issues but does not commit the accumulated cost data.

## Solution Statement
1. Create a new `/commit_cost` Claude slash command (`.claude/commands/commit_cost.md`) that mirrors `/commit` but only stages specific cost CSV files (the issue CSV and project total CSV) instead of running `git add -A`.
2. Create a new TypeScript function `commitAndPushCostFiles()` in `adws/github/gitOperations.ts` that programmatically stages only cost CSV files, commits with a descriptive message, and pushes to the current branch.
3. Update `handlePullRequestEvent()` in `adws/triggers/webhookHandlers.ts` to call `commitAndPushCostFiles()` after a PR is closed, using the repo name and issue number extracted from the webhook payload.

## Relevant Files
Use these files to implement the feature:

- `adws/triggers/webhookHandlers.ts` — Contains `handlePullRequestEvent()` which handles PR close events. This is where the cost commit/push call will be added.
- `adws/triggers/trigger_webhook.ts` — The webhook server that dispatches events. May need import updates.
- `adws/github/gitOperations.ts` — Contains `commitChanges()` and `pushBranch()`. The new `commitAndPushCostFiles()` function will be added here.
- `adws/core/costCsvWriter.ts` — Contains `getIssueCsvPath()` and `getProjectCsvPath()` which compute the relative paths for cost CSV files. These will be used by the new commit function.
- `adws/core/index.ts` — Barrel exports for the core module. May need to export new functions if added to core.
- `adws/core/issueTypes.ts` — Contains `SlashCommand` type union and model maps. Needs `/commit_cost` added.
- `adws/core/config.ts` — Contains `SLASH_COMMAND_MODEL_MAP` and `SLASH_COMMAND_MODEL_MAP_FAST`. Needs `/commit_cost` entry.
- `.claude/commands/commit.md` — The existing `/commit` command to use as a template for `/commit_cost`.
- `adws/__tests__/webhookHandlers.test.ts` — Existing tests for webhook handlers. New tests for cost commit behavior will be added here.
- `guidelines/coding_guidelines.md` — Coding guidelines that must be followed.

### New Files
- `.claude/commands/commit_cost.md` — New slash command for committing cost CSV files.
- `adws/__tests__/commitCostFiles.test.ts` — Unit tests for the new `commitAndPushCostFiles()` function.

## Implementation Plan
### Phase 1: Foundation
Create the `/commit_cost` slash command and add it to the type system:
- Create `.claude/commands/commit_cost.md` based on the existing `/commit` command, modified to stage only cost CSV files.
- Add `/commit_cost` to the `SlashCommand` type union in `issueTypes.ts`.
- Add `/commit_cost` to both model maps in `config.ts` (mapped to `'haiku'` since it's a simple structured task).

### Phase 2: Core Implementation
Implement the `commitAndPushCostFiles()` function:
- Add the function to `adws/github/gitOperations.ts` that accepts repo name, issue number, issue title, and optional cwd.
- The function uses `getIssueCsvPath()` and `getProjectCsvPath()` from `costCsvWriter.ts` to determine exact file paths.
- Instead of `git add -A`, it runs `git add` on only the two cost CSV files.
- Creates a commit with a descriptive message (e.g., `cost: add cost CSV for issue #N`).
- Pushes to the current branch.
- Returns a boolean indicating whether changes were committed.
- Write unit tests for this new function.

### Phase 3: Integration
Wire the cost commit into the PR close handler:
- Update `handlePullRequestEvent()` in `webhookHandlers.ts` to call `commitAndPushCostFiles()` after cleaning up worktrees and closing the linked issue.
- The function will need the repo name (from `repository.name`), issue number (already extracted), and issue title (can be fetched or derived from the PR title).
- The commit and push should happen on the ADW repo's main/default branch.
- Add error handling so failures in cost commit don't break the existing PR close flow.
- Update existing webhook handler tests and add new tests for the cost commit integration.

## Step by Step Tasks

### Step 1: Create the `/commit_cost` slash command
- Read `.claude/commands/commit.md` to understand the existing commit command format.
- Create `.claude/commands/commit_cost.md` with the following changes from `/commit`:
  - Same format structure: `agentName`, `issueClass`, `issue` variables.
  - Add `repoName` variable.
  - In the `Run` section, replace `git add -A` with `git add` targeting only:
    - `projects/<repoName>/<issueNumber>-*.csv` (issue cost CSV)
    - `projects/<repoName>/total-cost.csv` (project total CSV)
  - Keep the same commit message format convention.

### Step 2: Add `/commit_cost` to the type system and model maps
- In `adws/core/issueTypes.ts`, add `'/commit_cost'` to the `SlashCommand` type union.
- In `adws/core/config.ts`, add `'/commit_cost': 'haiku'` to both `SLASH_COMMAND_MODEL_MAP` and `SLASH_COMMAND_MODEL_MAP_FAST`.

### Step 3: Implement `commitAndPushCostFiles()` in gitOperations
- Add a new exported function `commitAndPushCostFiles()` to `adws/github/gitOperations.ts`.
- Parameters: `repoName: string`, `issueNumber: number`, `issueTitle: string`, `cwd?: string`.
- Implementation:
  1. Import `getIssueCsvPath` and `getProjectCsvPath` from `../core/costCsvWriter`.
  2. Compute the two relative file paths using those functions.
  3. Check `git status --porcelain` filtered to those paths to see if there are changes.
  4. If no changes, log and return `false`.
  5. Run `git add <issueCsvPath> <projectCsvPath>` (staging only these files).
  6. Run `git commit -m "cost: add cost data for issue #<issueNumber>"`.
  7. Determine the current branch via `getCurrentBranch()`.
  8. Run `git push origin <branch>`.
  9. Return `true` on success.
  10. Wrap in try/catch and return `false` on failure, logging the error.

### Step 4: Write unit tests for `commitAndPushCostFiles()`
- Create `adws/__tests__/commitCostFiles.test.ts`.
- Mock `child_process.execSync` and `../core/utils` log (following the pattern in `webhookHandlers.test.ts`).
- Test cases:
  - Successfully stages, commits, and pushes cost files when changes exist.
  - Returns false and skips commit when no cost file changes exist.
  - Returns false on commit failure (e.g., execSync throws).
  - Correctly constructs file paths from repoName, issueNumber, and issueTitle.
  - Passes `cwd` option through to execSync calls.

### Step 5: Integrate cost commit into `handlePullRequestEvent()`
- In `adws/triggers/webhookHandlers.ts`:
  - Import `commitAndPushCostFiles` from `../github/gitOperations`.
  - After the existing worktree cleanup and issue closure logic, add a cost commit step.
  - Extract the repo name from `payload.repository.name`.
  - Extract the issue title from the PR title (strip any branch/issue prefixes) or use a generic description.
  - Call `commitAndPushCostFiles(repoName, issueNumber, issueTitle)`.
  - Wrap in try/catch so failures don't affect the existing PR close handling.
  - Log success/failure of the cost commit.

### Step 6: Update webhook handler tests
- In `adws/__tests__/webhookHandlers.test.ts`:
  - Add a mock for `commitAndPushCostFiles` from `../github/gitOperations`.
  - Add test: when PR is closed and issue number is found, `commitAndPushCostFiles` is called with correct arguments.
  - Add test: when `commitAndPushCostFiles` throws, the PR close handler still succeeds.
  - Add test: when PR is closed but no issue link found, `commitAndPushCostFiles` is not called.
  - Add test: when PR action is not "closed", `commitAndPushCostFiles` is not called.

### Step 7: Run validation commands
- Run all validation commands to ensure zero regressions.

## Testing Strategy
### Unit Tests
- **`commitAndPushCostFiles()` function**: Test file path construction, git add with specific files only, commit message format, push behavior, error handling, and cwd propagation.
- **`handlePullRequestEvent()` integration**: Test that cost commit is called after PR close, that errors are caught gracefully, and that existing behavior (worktree cleanup, issue closure) is unaffected.

### Edge Cases
- PR closed without an issue link in body (no `Implements #N` pattern) — cost commit should be skipped.
- PR closed but cost CSV files don't exist (no changes to commit) — function returns false, no error.
- Git push fails (e.g., network error) — error is logged but PR close handler completes successfully.
- PR body has issue number but the repo name in the payload is different from expected — function still works with the payload repo name.
- Non-closed PR events (opened, synchronize) — no cost commit attempted.
- Cost CSV files partially exist (only total, no issue CSV) — git add handles this gracefully.

## Acceptance Criteria
- A new `/commit_cost` Claude slash command exists at `.claude/commands/commit_cost.md` that stages only cost CSV files (issue CSV and project total CSV) instead of `git add -A`.
- `/commit_cost` is registered in the `SlashCommand` type union and both model maps.
- A new `commitAndPushCostFiles()` function exists in `adws/github/gitOperations.ts` that stages only the two cost CSV files, commits, and pushes.
- When the webhook trigger detects a PR close event with a linked issue, `commitAndPushCostFiles()` is called to commit and push cost data.
- Failures in cost commit do not break the existing PR close handling (worktree cleanup, issue closure).
- All existing tests pass with zero regressions.
- New unit tests cover the `commitAndPushCostFiles()` function and its integration with the webhook handler.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `npm run lint` — Run linter to check for code quality issues
- `npx tsc --noEmit` — Type check the main project
- `npx tsc --noEmit -p adws/tsconfig.json` — Type check the adws project
- `npm test` — Run all tests to validate zero regressions
- `npm run build` — Build the application to verify no build errors

## Notes
- The `guidelines/coding_guidelines.md` must be followed: strict TypeScript, pure functions where possible, immutable data, meaningful error handling.
- The `/commit_cost` command maps to `'haiku'` model since it performs simple, structured git operations with no complex reasoning required.
- The `commitAndPushCostFiles()` function uses existing `getIssueCsvPath()` and `getProjectCsvPath()` from `costCsvWriter.ts` to determine file paths, avoiding path duplication.
- The cost commit happens on whatever branch the ADW repo is currently on (expected to be the default branch). The function does not switch branches.
- The PR title is used as a fallback for the issue title when constructing the issue CSV filename. This is because the webhook payload doesn't include the full issue data; however, the exact filename match isn't critical since `git add` uses glob patterns as a fallback.
