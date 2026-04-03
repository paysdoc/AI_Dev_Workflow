# Bug: Fix `is not mergeable` retry and ENOENT commit message leak

## Metadata
issueNumber: `377`
adwId: `adw-unknown`
issueJson: `{}`

## Bug Description

Two independent bugs observed in webhook log analysis:

1. **`is not mergeable` retried by `execWithRetry`**: When a PR merge fails with `is not mergeable` (unresolved conflicts), `execWithRetry` retries the command 3 times with exponential backoff (~5 seconds wasted) before giving up. The retry can never succeed; conflicts must be resolved first.

2. **ENOENT error leaking into commit message**: When the commit agent fails (e.g., `spawn claude ENOENT`), `runCommitAgent` in `adws/agents/gitAgent.ts` does not check `result.success` before extracting the commit message. The agent's error output is parsed as a commit message, producing garbage like `review-agent: feat: spawn /Users/martin/.local/bin/claude ENOENT`.

## Problem Statement

1. `execWithRetry` in `adws/core/utils.ts` has no non-retryable pattern list. The `known_issues.md` entry `non-retryable-error-retried` documents `NON_RETRYABLE_PATTERNS` as a solution that was applied, but the implementation is absent from the code — the list was never added to `utils.ts`.

2. `runCommitAgent` in `adws/agents/gitAgent.ts` (lines 206–211) unconditionally calls `extractCommitMessageFromOutput(result.output)` and then `validateCommitMessage(rawMessage, expectedPrefix)` regardless of `result.success`. On agent failure, `result.output` contains the error string which gets accepted as the commit message.

## Solution Statement

1. Add a `NON_RETRYABLE_PATTERNS` constant to `adws/core/utils.ts` and check it inside `execWithRetry` before retrying. Include `is not mergeable` (plus existing patterns that are already documented: `No commits between`, `already exists`).

2. In `runCommitAgent` (`adws/agents/gitAgent.ts`), check `result.success` immediately after the agent returns. If the agent failed, throw an error rather than extracting a commit message from error output.

## Steps to Reproduce

**Bug 1:**
1. Have a PR with merge conflicts
2. Observe `execWithRetry` attempting `gh pr merge` 3 times before failing

**Bug 2:**
1. Ensure the Claude CLI path is broken (ENOENT)
2. Trigger the commit agent via `runCommitAgent`
3. Observe commit message like `review-agent: feat: spawn /path/to/claude ENOENT`

## Root Cause Analysis

**Bug 1:** `execWithRetry` has no mechanism to distinguish transient from permanent failures. The `NON_RETRYABLE_PATTERNS` fix documented in `known_issues.md` was never actually implemented in `core/utils.ts` — the code still retries all errors indiscriminately.

**Bug 2:** `runCommitAgent` trusts `result.output` as a commit message without validating `result.success`. The `extractCommitMessageFromOutput` function takes the last non-empty line of output, which for a failed agent is the error string. `validateCommitMessage` then prepends the expected prefix, producing a syntactically valid but semantically garbage commit message.

## Relevant Files

- **`adws/core/utils.ts`** — Contains `execWithRetry`. Add `NON_RETRYABLE_PATTERNS` array and early-exit logic.
- **`adws/agents/gitAgent.ts`** — Contains `runCommitAgent` (lines 185–212). Add `result.success` guard before commit message extraction.
- **`adws/known_issues.md`** — Registry of known runtime errors. Update `non-retryable-error-retried` entry to add `is not mergeable` to documented patterns; add new entry for ENOENT-in-commit-message.
- **`adws/core/__tests__/phaseRunner.test.ts`** — Existing tests that must continue to pass.

## Step by Step Tasks

### 1. Add `NON_RETRYABLE_PATTERNS` to `execWithRetry` in `adws/core/utils.ts`

- Add a `NON_RETRYABLE_PATTERNS` constant array above `execWithRetry` with these strings:
  - `'No commits between'`
  - `'already exists'`
  - `'is not mergeable'`
- Inside the `catch` block of `execWithRetry`, after logging the failure, check if the error message matches any pattern in `NON_RETRYABLE_PATTERNS`
- If a match is found, log `execWithRetry: non-retryable error, failing immediately` at `'error'` level and `throw lastError` immediately (no further retries)
- The check should use `String(error)` for pattern matching (consistent with how the error is already logged)

### 2. Guard `runCommitAgent` against failed agent output in `adws/agents/gitAgent.ts`

- In `runCommitAgent` (around line 206), immediately after the `await runClaudeAgentWithCommand(...)` call, add a `result.success` check:
  ```
  if (!result.success) {
    throw new Error(`Commit agent failed: ${result.output.trim()}`);
  }
  ```
- The throw must happen before `extractCommitMessageFromOutput` is called so error output never reaches commit message parsing

### 3. Update `adws/known_issues.md`

- In the `non-retryable-error-retried` entry (around line 182), update the `pattern` field to include `is not mergeable` alongside the existing patterns
- Update the `description` field to list `is not mergeable` explicitly
- Add a new entry for the ENOENT-in-commit-message bug with:
  - `slug`: `enoent-in-commit-message`
  - `pattern`: `Commit message: <agentName>: <type>: spawn ... ENOENT`
  - `description`: Commit agent fails with ENOENT; error string used as commit message because `result.success` was not checked before extracting commit message
  - `status`: `solved`
  - `solution`: `runCommitAgent` now throws immediately when `result.success` is false, before any commit message extraction
  - `fix_attempts`: 1
  - `linked_issues`: `#377`
  - `first_seen`: 2026-04-03

### 4. Run validation commands

- Run all validation commands listed below to confirm zero regressions.

## Validation Commands

```bash
# Type check
bunx tsc --noEmit -p adws/tsconfig.json

# Lint
bun run lint

# Unit tests (must all pass)
bun run test

# Targeted: phaseRunner tests specifically
bunx vitest run adws/core/__tests__/phaseRunner.test.ts
```

## Notes

- `NON_RETRYABLE_PATTERNS` strings are matched with `String(error).includes(pattern)` — same approach as the existing log line (`${error}`). No regex needed.
- The ENOENT retry logic in `claudeAgent.ts` (lines 130–155) is separate and unrelated — it retries the Claude CLI spawn itself, not the commit message flow.
- `known_issues.md` entry `non-retryable-error-retried` currently has `status: solved` but the code fix was never merged. After this fix is applied, the status remains `solved` (now actually true).
