# Bug: Clearing issue comments triggers additional classification

## Metadata
issueNumber: `48`
adwId: `clearing-issue-comme-7n3wv8`
issueJson: `{"number":48,"title":"Clearing issue comments triggers additional classification"}`

## Bug Description
When a user posts a `## Clear` issue comment, the ADW webhook handler correctly detects the clear directive and deletes all issue comments on the issue. However, after clearing completes, the handler falls through to the classifier/workflow spawning logic — triggering `classifyIssueForTrigger()` and spawning a new ADW workflow. This is incorrect because the `## Clear` directive is not an actionable workflow command; it should only clear comments and return.

**Expected behavior:** After processing the `## Clear` directive and deleting comments, the webhook handler should respond with the cleared status and not trigger any classification or workflow spawning.

**Actual behavior:** After clearing comments, the handler falls through to `isAdwRunningForIssue()` → `classifyIssueForTrigger()` → `spawnDetached()`, causing an unnecessary and unwanted workflow to run.

## Problem Statement
In `adws/triggers/trigger_webhook.ts`, the `issue_comment` handler's `isClearComment()` branch (lines 227-230) does not return early after clearing comments. The only early return in the if/else chain is for non-actionable comments. The clear branch sets `clearResult` but execution continues to the classifier logic at lines 240-262, which classifies the issue and spawns a new workflow process.

## Solution Statement
Add an early return after the `isClearComment()` branch in the webhook handler so that after clearing comments, the handler sends the `cleared` response and does not proceed to classification or workflow spawning. This is a minimal one-line fix: add a `jsonResponse` call and `return` statement inside the clear comment branch, before the code falls through to the classifier section.

## Steps to Reproduce
1. Open a GitHub issue that has existing ADW comments
2. Post a comment containing `## Clear` on the issue
3. Observe that all comments are deleted (correct behavior)
4. Observe that the classifier subsequently runs and spawns a new ADW workflow (incorrect behavior — the webhook logs show `classifyIssueForTrigger` being called)

## Root Cause Analysis
In `adws/triggers/trigger_webhook.ts` lines 227-268, the `issue_comment` handler uses an if/else-if/else chain:

```typescript
if (isClearComment(commentBody)) {
    // Clears comments but does NOT return
    clearResult = clearIssueComments(issueNumber, webhookRepoInfo);
} else if (!isActionableComment(commentBody)) {
    // Returns early — correct
    jsonResponse(res, 200, { status: 'ignored' });
    return;
} else {
    // Actionable comment — falls through to classifier
}

// Classifier logic runs here for BOTH clear comments AND actionable comments
isAdwRunningForIssue(issueNumber).then(...)
```

The `isClearComment` branch mutates `clearResult` but does not return. After the if/else chain, the code unconditionally proceeds to check if a workflow is running and then classifies/spawns a workflow. This means that a `## Clear` comment both clears all comments AND triggers a new workflow — the latter being unintended.

The fix is to add an early return inside the `isClearComment` branch so it sends the response and exits before reaching the classifier logic.

## Relevant Files
Use these files to fix the bug:

- `adws/triggers/trigger_webhook.ts` — The webhook server that handles `issue_comment` events. Contains the buggy control flow where the `isClearComment` branch falls through to the classifier. **This is the file to fix.**
- `adws/__tests__/webhookClearComment.test.ts` — Existing tests for the webhook clear-comment handler logic. Needs a new test to verify that the clear comment branch does NOT trigger classification.
- `adws/github/workflowCommentsBase.ts` — Contains `isClearComment()`, `isActionableComment()`, and `isAdwRunningForIssue()` utilities. Read-only reference for understanding the detection logic.
- `adws/core/issueClassifier.ts` — Contains `classifyIssueForTrigger()` and `getWorkflowScript()`. Read-only reference for understanding what gets incorrectly triggered.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow during implementation.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Fix the webhook handler to return early after clearing comments
- In `adws/triggers/trigger_webhook.ts`, modify the `isClearComment(commentBody)` branch (around line 227) to send the JSON response and return immediately after clearing comments, preventing fallthrough to the classifier logic.
- The fix: after calling `clearIssueComments()` and logging the result, add a `jsonResponse(res, 200, { status: 'cleared', issue: issueNumber, deleted: clearResult.deleted })` call and a `return` statement.
- Remove `clearResult` variable declaration and the `cleared_and_processing` response logic at the bottom of the handler since the clear branch now handles its own response.
- Ensure the response status changes from `cleared_and_processing` to `cleared` to accurately reflect that clearing is the only action taken (no processing/classification follows).

### 2. Add a test verifying clear comments does not trigger classification
- In `adws/__tests__/webhookClearComment.test.ts`, add a new test that verifies the webhook handler returns early after clearing comments and does NOT call the classifier.
- The test should replicate the webhook handler's updated branching logic and assert that:
  - For `## Clear` comments, the response status is `cleared` (not `cleared_and_processing`)
  - The handler returns before reaching any classifier/workflow logic
- Update the existing `handleIssueComment` helper function in the test file to match the updated handler behavior (return `cleared` status instead of `cleared_and_processing`)
- Update all existing test assertions that check for `cleared_and_processing` to check for `cleared` instead

### 3. Run validation commands to confirm the fix
- Run the validation commands listed below to ensure the fix works correctly and introduces no regressions.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `npm run lint` — Run linter to check for code quality issues
- `npx tsc --noEmit` — Type check the main project
- `npx tsc --noEmit -p adws/tsconfig.json` — Type check the adws scripts
- `npm test` — Run all tests to validate the bug is fixed with zero regressions
- `npm run build` — Build the application to verify no build errors

## Notes
- This is a minimal fix: one early return added to the existing control flow. No new files, dependencies, or architectural changes are needed.
- The `trigger_cron.ts` has a similar flow where `## Clear` comments are handled but its behavior is intentionally different — it clears comments and THEN classifies/spawns a workflow. This is by design for the cron trigger since the `## Clear` directive in cron context means "reset and re-process." The webhook trigger should NOT follow this pattern because the `## Clear` webhook is triggered by the `action=created` event for the clear comment itself, and spawning a new workflow would be redundant/unwanted.
- Strictly adhere to the coding guidelines in `guidelines/coding_guidelines.md`.
