# Bug: PR Review comments trigger ADW twice

## Metadata
issueNumber: `25`
adwId: `adw-unknown`
issueJson: `{}`

## Bug Description
When a PR review comment is submitted on GitHub, the webhook trigger fires the `adwPrReview.tsx` workflow twice within ~300ms of each other. This results in two parallel ADW PR Review processes running for the same PR simultaneously, wasting resources and potentially producing conflicting results.

**Symptoms:**
```
📋 [07:31:30.717Z] PR review comment on PR #24, triggering ADW PR Review
📋 [07:31:30.717Z] Spawning: npx tsx adws/adwPrReview.tsx 24 ...
📋 [07:31:31.021Z] PR review comment on PR #24, triggering ADW PR Review
📋 [07:31:31.021Z] Spawning: npx tsx adws/adwPrReview.tsx 24 ...
```

**Expected:** A single PR review comment triggers exactly one ADW PR Review run.
**Actual:** A single PR review comment triggers two ADW PR Review runs.

## Problem Statement
The webhook handler in `adws/triggers/trigger_webhook.ts` listens for BOTH `pull_request_review_comment` AND `pull_request_review` GitHub webhook events and spawns `adwPrReview.tsx` for each. When a user submits a PR review with inline comments, GitHub fires **both** event types for the same action, causing the workflow to be spawned twice.

## Solution Statement
Remove `pull_request_review_comment` from the event type condition, handling only `pull_request_review` events. The `pull_request_review` event fires exactly once per review submission (action: `submitted`), regardless of how many inline comments are included. This guarantees a single spawn per review action.

## Steps to Reproduce
1. Configure the webhook trigger on a GitHub repository.
2. Open a pull request.
3. Submit a PR review with at least one inline comment.
4. Observe the webhook trigger logs — two `Spawning: npx tsx adws/adwPrReview.tsx` lines appear within milliseconds of each other.

## Root Cause Analysis
In `adws/triggers/trigger_webhook.ts` at line 143, the condition is:

```typescript
if (event === 'pull_request_review_comment' || event === 'pull_request_review') {
```

When a user submits a PR review with inline comments, GitHub sends **two distinct webhook events**:
1. `pull_request_review_comment` (action: `created`) — fired for each inline comment
2. `pull_request_review` (action: `submitted`) — fired for the overall review submission

Both events match the `||` condition independently, so `spawnDetached` is called for each. The action filter (`action !== 'created' && action !== 'submitted'`) does not prevent this because each event has its own valid action (`created` vs `submitted`).

The fix is to handle only `pull_request_review` (action: `submitted`), which fires exactly once per review regardless of the number of inline comments. The `pull_request_review_comment` event should be dropped entirely — it is redundant because review comments are always submitted as part of a `pull_request_review`.

## Relevant Files

- **`adws/triggers/trigger_webhook.ts`** — Contains the webhook server and event routing logic. The bug is on line 143 where the `||` condition matches both event types. This is the only file that needs to change.
- **`adws/__tests__/triggerCommentHandling.test.ts`** — Existing webhook trigger tests. New tests covering PR review event deduplication should be added here or in a new test file for PR review event handling.

### New Files
- None required.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Fix the event type condition in trigger_webhook.ts

- Open `adws/triggers/trigger_webhook.ts`
- On line 143, change:
  ```typescript
  if (event === 'pull_request_review_comment' || event === 'pull_request_review') {
  ```
  to:
  ```typescript
  if (event === 'pull_request_review') {
  ```
- Update the action filter on line 153 to only allow `submitted` (removing `created` which was for `pull_request_review_comment`):
  ```typescript
  if (action !== 'submitted') {
  ```
- Update the log message on line 159 to be more precise about what triggered it:
  ```typescript
  log(`PR review submitted on PR #${prNumber}, triggering ADW PR Review`);
  ```

### 2. Add a unit test to prevent regression

- Open `adws/__tests__/triggerCommentHandling.test.ts` (or create `adws/__tests__/triggerPrReviewHandling.test.ts`)
- Add a new `describe` block: `'webhook PR review event deduplication'`
- Add tests that verify:
  - `pull_request_review` with action `submitted` is the only handled combination
  - `pull_request_review_comment` events are NOT handled (i.e., the event type alone does not match the condition)
  - `pull_request_review` with action `edited` or `dismissed` is ignored
- Implement the tests by replicating the event routing logic (event type + action check) in a pure function and asserting the expected outcomes

### 3. Run validation commands

- Execute all validation commands listed below to confirm zero regressions.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

```bash
# Type-check the modified file
npx tsc --noEmit -p adws/tsconfig.json

# Run linter
npm run lint

# Run tests to confirm existing and new tests pass
npm test

# Build the application
npm run build
```

**Manual verification (without live GitHub):**
- Review `trigger_webhook.ts` and confirm only `pull_request_review` appears in the event condition (not `pull_request_review_comment`).
- Review that the action filter reads `action !== 'submitted'` (not including `created`).
- Confirm the unit test added in Step 2 passes and covers both event types.

## Notes
- `pull_request_review_comment` events are safe to ignore entirely for ADW triggering purposes. Every inline PR comment is always associated with a `pull_request_review` submission; the review-level event is the canonical trigger.
- If in the future standalone pending-comment scenarios require handling, a new dedicated handler should be added carefully to avoid the same double-trigger issue.
- No new libraries are required for this fix.
