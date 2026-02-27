# Feature: Auto-commit and push cost CSV files on PR close

## Metadata
issueNumber: `34`
adwId: `adw-unknown`
issueJson: `{}`

## Feature Description
When the ADW trigger detects that a PR has been closed, it should automatically commit and push all cost-related CSV files that were written to the main branch of the ADW repository during the workflow run. A new `/commit_cost` Claude slash command is created to stage and commit only the specific cost CSV files (the per-issue breakdown and the project total-cost file), then push to origin. This replaces the manual cleanup step required after each ADW workflow.

## User Story
As an ADW operator
I want cost CSV files to be automatically committed and pushed when a PR is closed
So that cost tracking data is always persisted to the repository without manual intervention

## Problem Statement
After each ADW workflow completes, two cost CSV files are written to the main branch of the ADW repository:
1. `projects/{repoName}/{issueNumber}-{slug}.csv` — per-issue model usage and cost breakdown
2. `projects/{repoName}/total-cost.csv` — running project totals

These files are written to `process.cwd()` (the ADW repo root on `main`) when a `--target-repo` is set. However, the files are never committed or pushed. This leaves cost data uncommitted in the working tree until someone manually runs a git commit.

## Solution Statement
Add a new `/commit_cost` Claude slash command that stages only the two specific cost CSV files (instead of `git add -A`) and commits them, then pushes to origin. Add a corresponding `runCommitCostAgent` function in `gitAgent.ts` that invokes this command. Update `webhookHandlers.ts` to call `runCommitCostAgent` after a PR close event successfully identifies a linked issue, ensuring cost files are always committed and pushed when the ADW detects a merged PR.

## Relevant Files

- `.claude/commands/commit.md` — Existing `/commit` command used as the template for `/commit_cost`. Read this to understand the exact structure to copy and modify.
- `adws/agents/gitAgent.ts` — Contains `runCommitAgent` and `formatCommitArgs`. The new `runCommitCostAgent` and `formatCommitCostArgs` functions follow these exact patterns.
- `adws/agents/index.ts` — Barrel export file for agents. Add `runCommitCostAgent` export here.
- `adws/triggers/webhookHandlers.ts` — The `handlePullRequestEvent` function must be updated to call `runCommitCostAgent` after detecting a closed PR with a linked issue.
- `adws/core/costCsvWriter.ts` — `getIssueCsvPath` and `getProjectCsvPath` define the exact file paths for cost CSVs. Use these to construct the `git add` paths in `/commit_cost`.
- `adws/__tests__/gitAgent.test.ts` — Existing tests for `gitAgent.ts`. Add tests for `formatCommitCostArgs` and `runCommitCostAgent` here.
- `adws/__tests__/webhookHandlers.test.ts` — Existing tests for `webhookHandlers.ts`. Add tests for the cost commit call here.
- `adws/core/utils.ts` — `ensureLogsDirectory` is used to create a logs directory for the agent run from within the webhook handler.

### New Files
- `.claude/commands/commit_cost.md` — New slash command for committing and pushing cost CSV files. Copy of `/commit` with step 2 changed to `git add` specific CSV paths and with a push step added.

## Implementation Plan

### Phase 1: Foundation
Create the `/commit_cost` slash command as a copy of `/commit` with two changes:
1. Step 2: `git add` only the specific cost CSV files rather than all changes
2. Add a step to `git push` after the commit

### Phase 2: Core Implementation
Add `formatCommitCostArgs` and `runCommitCostAgent` to `adws/agents/gitAgent.ts` following the exact pattern of `formatCommitArgs` / `runCommitAgent`, with the additional `repoName` and `issueNumber` parameters. Export the new function from `adws/agents/index.ts`.

### Phase 3: Integration
Update `adws/triggers/webhookHandlers.ts` to call `runCommitCostAgent` after a PR-closed event identifies a linked issue. Use `ensureLogsDirectory` to create a logs directory for the agent run.

## Step by Step Tasks

### Step 1: Create the `/commit_cost` slash command
- Read `.claude/commands/commit.md` to understand the exact structure
- Create `.claude/commands/commit_cost.md` as a copy of `/commit` with these changes:
  - Add `repoName: $4` and `issueNumber: $5` to the `## Variables` section
  - Replace step 2 (`git add -A`) with:
    ```
    2. Run `git add projects/{repoName}/{issueNumber}-*.csv projects/{repoName}/total-cost.csv` to stage only cost CSV files
    ```
  - Add step 4 after the commit: `4. Run `git push` to push the changes to origin`
  - Update the `## Report` section to return ONLY the commit message (same as `/commit`)

### Step 2: Add `runCommitCostAgent` to `adws/agents/gitAgent.ts`
- Add `formatCommitCostArgs` function directly below `formatCommitArgs`:
  ```typescript
  export function formatCommitCostArgs(
    agentName: string,
    issueClass: string,
    issueContext: string,
    repoName: string,
    issueNumber: number,
  ): string {
    return `agentName: ${agentName}
  issueClass: ${issueClass}
  issue: ${issueContext}
  repoName: ${repoName}
  issueNumber: ${issueNumber}`;
  }
  ```
- Add `runCommitCostAgent` function directly below `runCommitAgent`, mirroring its signature but with `repoName` and `issueNumber` parameters and using `/commit_cost` and `commit-cost-agent.jsonl`

### Step 3: Export `runCommitCostAgent` from `adws/agents/index.ts`
- Add `runCommitCostAgent` and `formatCommitCostArgs` to the existing Git Agent export block in `adws/agents/index.ts`

### Step 4: Update `webhookHandlers.ts` to commit cost files after PR close
- Import `runCommitCostAgent` from `../agents`
- Import `ensureLogsDirectory` from `../core`
- In `handlePullRequestEvent`, after the `closeIssue` call (whether it returns `true` or `false`), add a call to `runCommitCostAgent`:
  - `agentName`: `'webhook-trigger'`
  - `issueClass`: `'chore'`
  - `issueContext`: a minimal JSON string with the issue number
  - `repoName`: `repository.name` (already available in the function)
  - `issueNumber`: the extracted `issueNumber`
  - `logsDir`: `ensureLogsDirectory(`cost-commit-${issueNumber}`)`
- Wrap the call in a `try/catch` so a failure does not break the PR close flow — log errors with `'error'` level
- The call should be awaited (the function is already async)

### Step 5: Add unit tests to `adws/__tests__/gitAgent.test.ts`
- Add a `describe('formatCommitCostArgs', ...)` block testing that output includes `agentName`, `issueClass`, `issue`, `repoName`, and `issueNumber`
- Add a `describe('runCommitCostAgent', ...)` block following the `runCommitAgent` tests pattern:
  - Verify it calls `runClaudeAgentWithCommand` with `/commit_cost`
  - Verify the log file name is `commit-cost-agent.jsonl`
  - Verify it uses the `sonnet` model
  - Verify it extracts the commit message from the output
  - Verify it passes `cwd` and `statePath` when provided

### Step 6: Add unit tests to `adws/__tests__/webhookHandlers.test.ts`
- Mock `runCommitCostAgent` from `../agents`
- Mock `ensureLogsDirectory` from `../core`
- In the existing `describe('handlePullRequestEvent', ...)` block, add tests:
  - `it('calls runCommitCostAgent with the linked issue number and repo name', ...)`
  - `it('calls runCommitCostAgent even when the issue was already closed', ...)`
  - `it('does not call runCommitCostAgent when no issue link is found in the PR body', ...)`
  - `it('does not throw if runCommitCostAgent rejects', ...)` — verifies the try/catch

### Step 7: Run validation commands
- Run all validation commands listed in the `Validation Commands` section

## Testing Strategy

### Unit Tests
- `formatCommitCostArgs`: Verify correct multi-line output with all five fields present
- `runCommitCostAgent`: Verify correct command name, log file, model, and pass-through of cwd/statePath
- `handlePullRequestEvent` with cost commit: Verify `runCommitCostAgent` is called with correct args, called even when issue was already closed, NOT called when no issue link exists, and does not crash if the agent throws

### Edge Cases
- PR body contains no "Implements #N" — no cost commit should be attempted
- `runCommitCostAgent` throws — should be caught and logged, PR close should still succeed
- The same issue number appears in multiple PR close events — idempotent git add/commit (git will report "nothing to commit" on the second run, which is handled by the existing commit logic in `/commit_cost`)
- `repoName` contains slashes or special characters — use `repository.name` (just the repo name, no owner prefix)

## Acceptance Criteria
- A `.claude/commands/commit_cost.md` file exists that stages only `projects/{repoName}/{issueNumber}-*.csv` and `projects/{repoName}/total-cost.csv`, commits, and pushes
- `runCommitCostAgent` exists in `adws/agents/gitAgent.ts` and is exported from `adws/agents/index.ts`
- `handlePullRequestEvent` calls `runCommitCostAgent` after detecting a PR close with a linked issue, passing the correct `repoName` and `issueNumber`
- If `runCommitCostAgent` throws, the PR close flow continues without error
- All new and existing unit tests pass with `npm test`
- TypeScript compiles without errors with `npx tsc --noEmit -p adws/tsconfig.json`

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

```bash
# Type check
npx tsc --noEmit -p adws/tsconfig.json

# Run linter
npm run lint

# Run all tests (must pass with zero failures)
npm test
```

Read `.adw/commands.md` for additional project-specific validation commands.

## Notes
- The `handlePullRequestEvent` function should call `runCommitCostAgent` regardless of whether the issue was already closed (the `closed` vs `already_closed` status). Cost files are written before the PR is even created, so they will be present on disk in both cases.
- Do NOT use `git add -A` in the `/commit_cost` command — this is the specific problem the issue is addressing. Use the glob paths for cost CSVs only.
- The `/commit_cost` command includes a `git push` step unlike `/commit`. This is intentional: cost files live on the `main` branch and must be pushed immediately so they are visible to collaborators.
- The `logsDir` for the webhook-triggered cost commit uses a dedicate key `cost-commit-{issueNumber}` so it does not collide with the main ADW workflow logs for the same issue.
