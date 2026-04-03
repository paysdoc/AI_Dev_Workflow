# Fix `is not mergeable` Retry and ENOENT Commit Message Leak

**ADW ID:** 643xf3-fix-is-not-mergeable
**Date:** 2026-04-03
**Specification:** specs/issue-377-adw-643xf3-fix-is-not-mergeable-sdlc_planner-fix-retry-and-commit-leak.md

## Overview

Two independent runtime bugs were fixed: `execWithRetry` now short-circuits immediately on errors that can never succeed on retry (avoiding ~5 seconds of wasted backoff), and `runCommitAgent` now guards against agent failures producing garbage commit messages containing ENOENT or spawn error strings.

## What Was Built

- `NON_RETRYABLE_PATTERNS` constant in `execWithRetry` — immediate throw on `"is not mergeable"`, `"No commits between"`, and `"already exists"` errors
- `result.success` guard in `runCommitAgent` — throws instead of extracting a commit message from failed agent output
- Unit tests for both changes: `execWithRetry.test.ts` and `gitAgent.test.ts`
- Updated `known_issues.md` with `"is not mergeable"` in the existing `non-retryable-error-retried` entry and a new `enoent-commit-message-leak` entry

## Technical Implementation

### Files Modified

- `adws/core/utils.ts`: Added `NON_RETRYABLE_PATTERNS` array and early-exit logic in the `execWithRetry` catch block
- `adws/agents/gitAgent.ts`: Added `result.success` guard after `runClaudeAgentWithCommand` returns in `runCommitAgent`
- `adws/known_issues.md`: Updated `non-retryable-error-retried` entry; added `enoent-commit-message-leak` entry
- `features/fix_retry_and_commit_leak.feature`: BDD scenarios covering both bug fixes
- `features/step_definitions/fixRetryAndCommitLeakSteps.ts`: Step definitions for the new feature file

### New Files

- `adws/core/__tests__/execWithRetry.test.ts`: Unit tests for non-retryable pattern detection (immediate failure vs. retry)
- `adws/agents/__tests__/gitAgent.test.ts`: Unit tests for the `result.success` guard in `runCommitAgent`

### Key Changes

- **Non-retryable pattern detection** (`core/utils.ts`): Before sleeping and retrying, `execWithRetry` converts the caught error to a string and checks it against `NON_RETRYABLE_PATTERNS` using `some()` + `includes()`. A match causes an immediate re-throw, skipping all backoff.
- **Commit agent failure guard** (`agents/gitAgent.ts`): A 4-line guard added after `runClaudeAgentWithCommand` returns checks `result.success`. On `false`, it throws `Commit agent '${agentName}' failed: ${result.output.slice(0, 200)}`, preventing the error string from reaching `extractCommitMessageFromOutput`.
- **Single-point fix** for all 9 `runCommitAgent` call sites: `planPhase`, `buildPhase`, `documentPhase`, `planValidationPhase`, `alignmentPhase`, `prPhase`, `prReviewCompletion`, `reviewRetry`, and any future callers.
- **Pattern matching is substring-based** (`includes()`), so partial matches in longer error messages are caught correctly.
- **Output is truncated** to 200 characters in the thrown error to prevent log flooding.

## How to Use

These are passive defensive fixes — no action required by operators. The changes take effect automatically:

1. When `gh pr merge` fails with "is not mergeable", the workflow skips retries and proceeds immediately to conflict resolution.
2. When the Claude CLI is unavailable (ENOENT) or any commit agent fails, the phase throws an error with a meaningful message rather than creating a garbage commit.

## Configuration

No configuration changes required. The `NON_RETRYABLE_PATTERNS` list in `core/utils.ts` can be extended by adding new string patterns to the array if additional non-retryable error classes are identified.

## Testing

```bash
bun run test
```

Key test files:
- `adws/core/__tests__/execWithRetry.test.ts` — verifies immediate failure on each non-retryable pattern and that transient errors still retry
- `adws/agents/__tests__/gitAgent.test.ts` — verifies `runCommitAgent` throws on `result.success === false` and succeeds on `true`

## Notes

- The `known_issues.md` entry `non-retryable-error-retried` was previously marked `solved` but the implementation in `core/utils.ts` was missing. This fix completes the actual implementation.
- No new dependencies were introduced.
