# Feature: Fix `is not mergeable` retry and ENOENT commit message leak

## Metadata
issueNumber: `377`
adwId: `643xf3-fix-is-not-mergeable`
issueJson: `{"number":377,"title":"Fix `is not mergeable` retry and ENOENT commit message leak","body":"## Parent PRD\n\n`specs/prd/orchestrator-lifecycle-redesign.md`\n\n## What to build\n\nTwo independent bug fixes observed in webhook log analysis:\n\n**1. `is not mergeable` retried by `execWithRetry`**\n\nAdd `is not mergeable` to the `NON_RETRYABLE_PATTERNS` list in `execWithRetry` (`core/utils.ts`). When a PR merge fails because conflicts haven't been resolved, retrying the same `gh pr merge` command will never succeed. Currently it retries 3 times with exponential backoff, wasting ~5 seconds before the auto-merge handler moves on to conflict resolution.\n\n**2. ENOENT error leaking into commit message**\n\nWhen the commit agent fails (e.g., `spawn claude ENOENT`), the error string is used as the commit message: `Commit message: review-agent: feat: spawn /Users/martin/.local/bin/claude ENOENT`. The commit flow must check `result.success` before accepting agent output as a commit message. On failure, skip the commit or throw rather than committing garbage.\n\n## Acceptance criteria\n\n- [ ] `is not mergeable` added to `NON_RETRYABLE_PATTERNS` in `core/utils.ts`\n- [ ] `execWithRetry` fails immediately (no retry) when error matches `is not mergeable`\n- [ ] Commit agent failure (ENOENT or otherwise) does not produce a commit with the error string as message\n- [ ] Existing `phaseRunner.test.ts` tests still pass\n- [ ] Update `known_issues.md`: add `is not mergeable` to `non-retryable-error-retried` patterns, add new entry for ENOENT-in-commit-message\n\n## Blocked by\n\nNone - can start immediately\n\n## User stories addressed\n\n- User story 23\n- User story 24","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-03T09:25:22Z","comments":[],"actionableComment":null}`

## Feature Description
Two independent bug fixes observed in webhook log analysis:

1. **`is not mergeable` retried by `execWithRetry`**: The `execWithRetry` function in `core/utils.ts` currently has no non-retryable pattern detection. When `gh pr merge` fails with "is not mergeable" (unresolved conflicts), it wastes ~5 seconds retrying 3 times before the auto-merge handler proceeds to conflict resolution. This pattern — along with "No commits between" and "already exists" — should never be retried.

2. **ENOENT error leaking into commit message**: When the commit agent spawns Claude CLI and it fails (e.g., `spawn claude ENOENT`), the error string flows through `extractCommitMessageFromOutput` and `validateCommitMessage` unchecked, producing garbage commits like `review-agent: feat: spawn /Users/martin/.local/bin/claude ENOENT`. The `runCommitAgent` function must check `result.success` before accepting agent output as a commit message.

## User Story
As a workflow operator
I want non-retryable errors to fail immediately and agent failures to never produce garbage commits
So that workflow execution is faster and the git history stays clean

## Problem Statement
Two runtime bugs waste time and pollute git history:
1. `execWithRetry` retries commands that can never succeed on retry ("is not mergeable", "No commits between", "already exists"), wasting ~5 seconds per occurrence.
2. When `runCommitAgent` receives a failed `AgentResult` (e.g., ENOENT), it extracts the error text as a commit message and proceeds to commit it, leaking error strings into the repository history.

## Solution Statement
1. Add a `NON_RETRYABLE_PATTERNS` array to `execWithRetry` in `core/utils.ts`. Before retrying, check the error message against these patterns. If matched, throw immediately without retry.
2. In `runCommitAgent` (`agents/gitAgent.ts`), check `result.success` after `runClaudeAgentWithCommand` returns. If `false`, throw an error with context instead of extracting a commit message from failed output.

## Relevant Files
Use these files to implement the feature:

- `adws/core/utils.ts` — Contains `execWithRetry` function (lines 38-58). Add `NON_RETRYABLE_PATTERNS` and early-exit logic here.
- `adws/agents/gitAgent.ts` — Contains `runCommitAgent` (lines 177-212). Add `result.success` guard before extracting commit message.
- `adws/agents/claudeAgent.ts` — Contains `runClaudeAgentWithCommand` which returns `AgentResult` with `success` field. Reference for understanding the return contract.
- `adws/known_issues.md` — Known issues registry. Update `non-retryable-error-retried` entry and add new `enoent-commit-message-leak` entry.
- `adws/core/__tests__/phaseRunner.test.ts` — Existing test file that must continue passing.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow.

### New Files
- `adws/core/__tests__/execWithRetry.test.ts` — Unit tests for the new non-retryable pattern detection in `execWithRetry`.
- `adws/agents/__tests__/gitAgent.test.ts` — Unit tests for the `result.success` guard in `runCommitAgent`.

## Implementation Plan
### Phase 1: Foundation — Non-retryable pattern detection in execWithRetry
Add a `NON_RETRYABLE_PATTERNS` constant array containing known non-retryable error strings. In the `catch` block of `execWithRetry`, before sleeping and retrying, check if the error message matches any pattern. If it does, throw immediately. This is a self-contained change in `core/utils.ts`.

### Phase 2: Core Implementation — Commit agent failure guard
In `runCommitAgent` (`agents/gitAgent.ts`), add a `result.success` check after `runClaudeAgentWithCommand` returns. If `result.success` is `false`, throw an error with the agent name and a summary of the failure. This prevents error strings from being extracted as commit messages. All 9 call sites automatically benefit because they all flow through `runCommitAgent`.

### Phase 3: Integration — Known issues registry and validation
Update `known_issues.md` with:
1. Add `"is not mergeable"` to the `non-retryable-error-retried` entry's pattern list.
2. Add a new `enoent-commit-message-leak` entry documenting the ENOENT-in-commit-message bug and its fix.

Run existing tests to verify zero regressions.

## Step by Step Tasks

### Step 1: Add NON_RETRYABLE_PATTERNS to execWithRetry
- In `adws/core/utils.ts`, add a `NON_RETRYABLE_PATTERNS` constant array above `execWithRetry` containing:
  - `"No commits between"`
  - `"already exists"`
  - `"is not mergeable"`
- In the `catch` block, after logging the error, check if the error message string matches any pattern using `some()` + `includes()`.
- If matched, log a message like `execWithRetry: non-retryable error detected, failing immediately` and re-throw the error without sleeping or retrying.
- The check must happen before the backoff sleep, so insert it between the log line and the `if (attempt < maxAttempts - 1)` block.

### Step 2: Write unit tests for execWithRetry non-retryable patterns
- Create `adws/core/__tests__/execWithRetry.test.ts`.
- Mock `child_process.execSync` to throw errors with messages containing each non-retryable pattern.
- Assert that `execWithRetry` throws immediately after 1 attempt (not 3).
- Test that transient errors (not matching patterns) still retry the configured number of times.
- Test that successful commands return the trimmed output.

### Step 3: Add result.success guard in runCommitAgent
- In `adws/agents/gitAgent.ts`, in the `runCommitAgent` function, after `const result = await runClaudeAgentWithCommand(...)` (line 204), add a check:
  ```typescript
  if (!result.success) {
    throw new Error(`Commit agent '${agentName}' failed: ${result.output.slice(0, 200)}`);
  }
  ```
- This prevents the flow from reaching `extractCommitMessageFromOutput` when the agent has failed.
- All 9 call sites (planPhase, buildPhase, documentPhase, planValidationPhase, alignmentPhase, prPhase, prReviewCompletion, reviewRetry) benefit from this single fix.

### Step 4: Write unit tests for runCommitAgent failure guard
- Create `adws/agents/__tests__/gitAgent.test.ts`.
- Mock `runClaudeAgentWithCommand` to return `{ success: false, output: 'spawn claude ENOENT', ... }`.
- Assert that `runCommitAgent` throws with a message containing the agent name and error excerpt.
- Mock a successful result and assert that `runCommitAgent` returns the expected commit message.

### Step 5: Update known_issues.md
- In the `non-retryable-error-retried` entry (line 182), update the **pattern** field to explicitly include `"is not mergeable"` alongside the existing patterns.
- Verify the **status** remains `solved` and the **solution** description already mentions `NON_RETRYABLE_PATTERNS`. Update the solution text if needed to mention `"is not mergeable"` was added.
- Add `#377` to **linked_issues**.
- Add a new entry `## enoent-commit-message-leak` after the existing `claude-cli-enoent` entry with:
  - **pattern**: `Commit message:` followed by `ENOENT` or `spawn` error strings
  - **description**: When commit agent fails (ENOENT or other spawn error), the error string is used as the commit message instead of being rejected.
  - **status**: `solved`
  - **solution**: Added `result.success` guard in `runCommitAgent` (`agents/gitAgent.ts`). On failure, throws instead of extracting commit message from error output.
  - **fix_attempts**: 1
  - **linked_issues**: #377
  - **first_seen**: 2026-04
  - **sample_log**: Include the example from the issue body.

### Step 6: Run validation commands
- Run `bun run lint` to check for code quality issues.
- Run `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json` to verify type checking.
- Run `bun run build` to verify no build errors.
- Run `bun run test` to verify existing tests pass (including `phaseRunner.test.ts`).

## Testing Strategy
### Unit Tests
- **`adws/core/__tests__/execWithRetry.test.ts`**:
  - Test that errors matching each pattern in `NON_RETRYABLE_PATTERNS` cause immediate failure (1 attempt, no retry).
  - Test that non-matching (transient) errors are retried up to `maxAttempts`.
  - Test that successful commands return trimmed output on first attempt.
  - Test custom `maxAttempts` option works correctly.

- **`adws/agents/__tests__/gitAgent.test.ts`**:
  - Test that `runCommitAgent` throws when `result.success` is `false`.
  - Test that the thrown error message includes the agent name and a truncated excerpt of the output.
  - Test that `runCommitAgent` returns a valid commit message when `result.success` is `true`.

### Edge Cases
- Error message contains a non-retryable pattern as a substring of a longer message (should still match via `includes()`).
- Error message is empty or undefined (should not crash pattern matching).
- `result.output` is extremely long on failure (the thrown error should truncate it to avoid log flooding — `.slice(0, 200)`).
- Agent returns `success: false` with an output that looks like a valid commit message (must still throw, not commit).

## Acceptance Criteria
- `"is not mergeable"` is present in the `NON_RETRYABLE_PATTERNS` array in `core/utils.ts`.
- `execWithRetry` throws immediately (no retry) when the error message matches any non-retryable pattern.
- `runCommitAgent` throws an error when `result.success` is `false`, preventing garbage commit messages.
- All existing tests in `phaseRunner.test.ts` pass without modification.
- New unit tests for `execWithRetry` and `runCommitAgent` pass.
- `known_issues.md` has updated `non-retryable-error-retried` entry and a new `enoent-commit-message-leak` entry.

## Validation Commands
- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type check the project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check the adws module
- `bun run build` — Build the application to verify no build errors
- `bun run test` — Run all tests to validate zero regressions (includes `phaseRunner.test.ts` and new test files)

## Notes
- The fix in `runCommitAgent` is a single-point fix that protects all 9 call sites: `planPhase.ts`, `buildPhase.ts`, `documentPhase.ts`, `planValidationPhase.ts`, `alignmentPhase.ts`, `prPhase.ts`, `prReviewCompletion.ts`, `reviewRetry.ts`, and any future callers.
- The `known_issues.md` entry `non-retryable-error-retried` already has status `solved` and mentions `NON_RETRYABLE_PATTERNS`, but the actual implementation in `core/utils.ts` does NOT have this feature yet. The entry was written prematurely. This fix completes the actual implementation.
- No new libraries required.
- Follow `guidelines/coding_guidelines.md`: clarity over cleverness, type safety, meaningful error messages.
