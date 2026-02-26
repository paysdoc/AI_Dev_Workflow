# Feature: Fix PR Review Double Trigger

## Metadata
issueNumber: `25`
adwId: `pr-review-comments-g-0lf7uf`
issueJson: `{"number":25,"title":"PR Review comments get picked up twice by the trigger","body":"The webhook trigger triggers twice when a PR comment is issued...","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-02-26T07:35:10Z","comments":[],"actionableComment":null}`

## Feature Description
When a PR review comment is submitted on GitHub, GitHub sends two separate webhook events for the same action: `pull_request_review_comment` (for the individual comment on the diff) and `pull_request_review` (for the review submission). The webhook handler in `trigger_webhook.ts` handles both event types identically at line 143, which causes two `adwPrReview.tsx` processes to be spawned for the same PR within ~300ms. This fix adds a deduplication mechanism so only one ADW PR Review process is spawned per PR within a configurable cooldown window.

## User Story
As an ADW operator
I want PR review comments to trigger only one ADW PR Review workflow per PR
So that resources are not wasted on duplicate workflow runs and conflicting changes are avoided

## Problem Statement
GitHub sends two webhook events (`pull_request_review_comment` and `pull_request_review`) when a review comment is submitted. The webhook handler treats both as triggers for `adwPrReview.tsx`, resulting in two concurrent ADW PR Review processes for the same PR. This wastes compute resources, creates race conditions, and may produce conflicting changes.

## Solution Statement
Add an in-memory deduplication Map to the webhook's PR review handler that tracks recently triggered PR numbers with timestamps. When a PR review event arrives, check whether the same PR was already triggered within a cooldown window (60 seconds). If so, log the duplicate and skip spawning. The first event to arrive wins; subsequent events for the same PR within the window are ignored. The Map entries are cleaned up after the cooldown expires.

## Relevant Files
Use these files to implement the feature:

- `adws/triggers/trigger_webhook.ts` — The main webhook server. Contains the PR review handler (lines 143–163) that currently spawns on both `pull_request_review_comment` and `pull_request_review` events without deduplication. This is the primary file to modify.
- `adws/__tests__/triggerSpawnArgs.test.ts` — Existing tests for trigger spawn argument construction. Reference for test patterns.
- `adws/__tests__/triggerCommentHandling.test.ts` — Existing tests for comment filtering logic. Reference for test patterns.
- `adws/__tests__/triggerWebhookPort.test.ts` — Existing test for webhook port logic. Reference for test patterns.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow during implementation.

### New Files
- `adws/__tests__/triggerPrReviewDedup.test.ts` — Unit tests for the PR review deduplication logic.

## Implementation Plan
### Phase 1: Foundation
Extract the PR review deduplication logic into a testable module-level function and data structure in `trigger_webhook.ts`:
- Create an in-memory `Map<number, number>` to track PR number → last trigger timestamp.
- Create a `shouldTriggerPrReview(prNumber: number)` function that checks the map and returns `true` if the PR should be triggered (not in cooldown), and `false` otherwise.
- Define a `PR_REVIEW_COOLDOWN_MS` constant (60000ms = 60 seconds).

### Phase 2: Core Implementation
Integrate the deduplication check into the existing PR review event handler:
- Before spawning `adwPrReview.tsx`, call `shouldTriggerPrReview(prNumber)`.
- If it returns `false`, log that the event was deduplicated and respond with `{ status: 'ignored', reason: 'duplicate' }`.
- If it returns `true`, record the timestamp in the map and proceed with spawning.

### Phase 3: Integration
- Write unit tests for the deduplication logic that verify:
  - First event for a PR triggers normally.
  - Second event for the same PR within the cooldown window is deduplicated.
  - Events for different PRs are triggered independently.
  - Events after the cooldown window expires trigger normally again.
- Ensure all existing tests continue to pass.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add deduplication data structure and function to trigger_webhook.ts
- Add a `PR_REVIEW_COOLDOWN_MS` constant set to `60_000` (60 seconds) near the top of the file.
- Add a module-level `Map<number, number>` called `recentPrReviewTriggers` to track `prNumber → timestamp`.
- Create and export a `shouldTriggerPrReview(prNumber: number): boolean` function that:
  1. Gets the current timestamp via `Date.now()`.
  2. Checks if `recentPrReviewTriggers` has an entry for `prNumber`.
  3. If it does and the elapsed time is less than `PR_REVIEW_COOLDOWN_MS`, return `false`.
  4. Otherwise, set/update the entry with the current timestamp and return `true`.
- Also export a `resetPrReviewTriggers()` function (for test cleanup) that clears the map.

### Step 2: Integrate deduplication into the PR review handler
- In the PR review event handler block (lines 143–163), after the action check and before the `log` + `spawnDetached` call, add a check:
  ```typescript
  if (!shouldTriggerPrReview(prNumber)) {
    log(`Deduplicated PR review trigger for PR #${prNumber}, already triggered recently`);
    jsonResponse(res, 200, { status: 'ignored', reason: 'duplicate' });
    return;
  }
  ```
- Keep the existing log and spawn logic for the case when `shouldTriggerPrReview` returns `true`.

### Step 3: Create unit tests for deduplication logic
- Create `adws/__tests__/triggerPrReviewDedup.test.ts` with tests:
  - `shouldTriggerPrReview returns true for first trigger of a PR` — verify the function returns `true` on first call.
  - `shouldTriggerPrReview returns false for duplicate trigger within cooldown` — call twice rapidly for the same PR, verify second call returns `false`.
  - `shouldTriggerPrReview returns true for different PR numbers` — verify independent PRs are not affected by each other.
  - `shouldTriggerPrReview returns true after cooldown expires` — manipulate the map entry timestamp to simulate expiry, verify the function returns `true` again.
  - `resetPrReviewTriggers clears the map` — verify the reset function works.
- Use `beforeEach` to call `resetPrReviewTriggers()` to ensure test isolation.

### Step 4: Run validation commands
- Run the full validation suite to ensure zero regressions.

## Testing Strategy
### Unit Tests
- Test `shouldTriggerPrReview` function in isolation with various scenarios.
- Test that `resetPrReviewTriggers` properly clears state.
- Test timing edge cases by manipulating the internal map.

### Edge Cases
- Two events for the same PR arriving within milliseconds of each other (the primary bug scenario).
- Events for different PRs arriving simultaneously — must be independent.
- An event arriving exactly at the cooldown boundary.
- Multiple rapid events for the same PR (more than 2) — all after the first should be deduplicated.
- Server restart clears the in-memory map — this is acceptable since the cooldown is short.

## Acceptance Criteria
- When GitHub sends both `pull_request_review_comment` and `pull_request_review` events for the same PR review, only one `adwPrReview.tsx` process is spawned.
- The deduplication log message clearly indicates that a duplicate was ignored.
- Events for different PRs are still handled independently.
- After the cooldown window (60 seconds), a new event for the same PR triggers normally.
- All existing tests pass without modification.
- New unit tests cover the deduplication logic with 100% branch coverage.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `npm run lint` — Run linter to check for code quality issues
- `npx tsc --noEmit` — Type check the main project
- `npx tsc --noEmit -p adws/tsconfig.json` — Type check the adws project
- `npm test` — Run all tests to validate the feature works with zero regressions

## Notes
- The in-memory Map approach is appropriate here because the webhook server is a long-running process and the cooldown window is short (60s). There is no need for persistent storage.
- The `resetPrReviewTriggers` export is only needed for test cleanup; it will not be used in production code.
- Follow the coding guidelines in `guidelines/coding_guidelines.md`: immutability, type safety, pure functions where possible, and isolating side effects at boundaries.
- The 60-second cooldown is conservative. GitHub typically sends both events within 1 second of each other, but 60 seconds provides a safe buffer against network delays or retries.
