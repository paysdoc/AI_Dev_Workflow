# Bug: CLEAR_COMMENT_PATTERN should trigger ADW

## Metadata
issueNumber: `29`
adwId: `clear-comment-patter-my7g9p`
issueJson: `{"number":29,"title":"CLEAR_COMMENT_PATTERN should trigger adw","body":"CLEAR_COMMENT_PATTERN is a subset of ACTIONABLE_COMMENT_PATTERN and should trigger the adw. Currently, it is being ignored","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-02-26T11:58:22Z","comments":[{"author":"paysdoc","createdAt":"2026-02-26T12:10:35Z","body":"## Take action"}],"actionableComment":null}`

## Bug Description
When a user posts a `## Clear` comment on a GitHub issue, the system correctly clears all existing comments but does **not** trigger an ADW workflow afterward. The `## Clear` directive is conceptually a subset of `## Take action` — both are human directives that should result in an ADW workflow being spawned. Currently, `## Clear` only performs comment cleanup and then returns early, leaving the issue without a re-triggered ADW run.

**Expected behavior:** A `## Clear` comment should (1) clear all existing comments on the issue, then (2) trigger an ADW workflow (classify + spawn), just like `## Take action` does.

**Actual behavior:** A `## Clear` comment clears comments and returns `{ status: 'cleared' }` without triggering any ADW workflow. In the cron trigger, `## Clear` is not recognized as qualifying, so the issue is also skipped.

## Problem Statement
Both the webhook trigger (`trigger_webhook.ts`) and the cron trigger (`trigger_cron.ts`) fail to spawn an ADW workflow when a `## Clear` comment is detected. The webhook handler returns early after clearing comments (line 227), and the cron trigger's `isQualifyingIssue` function only checks `isActionableComment` (which matches `## Take action`), not `isClearComment` (which matches `## Clear`).

## Solution Statement
1. **Webhook trigger (`trigger_webhook.ts`):** After clearing comments, instead of returning early, continue to the ADW workflow classification and spawning logic. The response status should reflect both the clear action and the workflow trigger.
2. **Cron trigger (`trigger_cron.ts`):** In `isQualifyingIssue`, add a check for `isClearComment` on the latest comment so that issues with a `## Clear` directive also qualify for ADW processing.
3. **Tests:** Update `webhookClearComment.test.ts` and `triggerCommentHandling.test.ts` to validate that `## Clear` comments trigger ADW workflows.

## Steps to Reproduce
1. Create a GitHub issue.
2. Let ADW run and post workflow comments on the issue.
3. Post a `## Clear` comment on the issue.
4. **Expected:** Comments are cleared AND a new ADW workflow is triggered.
5. **Actual:** Comments are cleared but no ADW workflow is triggered. The webhook returns `{ status: 'cleared' }` and stops.

## Root Cause Analysis
There are two trigger entry points, both with the same deficiency:

**Webhook trigger (`trigger_webhook.ts`, lines 222-228):**
```typescript
if (isClearComment(commentBody)) {
  log(`Clear directive on issue #${issueNumber}, clearing all comments`);
  const result = clearIssueComments(issueNumber);
  log(`Cleared ${result.deleted}/${result.total} comments on issue #${issueNumber}`);
  jsonResponse(res, 200, { status: 'cleared', issue: issueNumber, deleted: result.deleted });
  return;  // ← EARLY RETURN prevents ADW workflow from being spawned
}
```
The `return` statement on line 227 exits the handler before the classification + spawn logic (lines 236-261) is reached.

**Cron trigger (`trigger_cron.ts`, lines 56-71, `isQualifyingIssue`):**
```typescript
function isQualifyingIssue(issue: RawIssue): boolean {
  if (issue.comments.length === 0) return true;
  const latestComment = issue.comments[issue.comments.length - 1];
  if (isActionableComment(latestComment.body)) return true;  // Only checks ## Take action
  return false;  // ← ## Clear falls through here and is ignored
}
```
The function only checks `isActionableComment`, which matches `## Take action` but not `## Clear`. There is no `isClearComment` check.

## Relevant Files
Use these files to fix the bug:

- `adws/triggers/trigger_webhook.ts` — Contains the webhook handler for `issue_comment` events. The clear comment branch (lines 222-228) returns early without spawning an ADW workflow. Needs to be modified to continue to classification/spawn logic after clearing comments.
- `adws/triggers/trigger_cron.ts` — Contains `isQualifyingIssue` (lines 56-71) which only checks `isActionableComment`. Needs to also check `isClearComment` and clear comments before qualifying.
- `adws/__tests__/webhookClearComment.test.ts` — Tests for the webhook clear-comment handler. Needs new tests to validate that `## Clear` triggers ADW workflow after clearing comments.
- `adws/__tests__/triggerCommentHandling.test.ts` — Tests for the cron trigger's qualifying-issue logic. Needs new tests to validate that `## Clear` qualifies an issue.
- `adws/github/workflowCommentsBase.ts` — Defines `isClearComment` and `isActionableComment`. Read-only reference for understanding the patterns.
- `adws/adwClearComments.tsx` — Defines `clearIssueComments`. Read-only reference for understanding the clearing logic.
- `adws/core/issueClassifier.ts` — Defines `classifyIssueForTrigger` and `getWorkflowScript`. Read-only reference for understanding the classification flow.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Modify the webhook trigger to spawn ADW after clearing comments
- Read `adws/triggers/trigger_webhook.ts`.
- In the `issue_comment` handler (around lines 222-228), modify the `isClearComment` branch:
  - Keep the existing clear logic: call `clearIssueComments(issueNumber)` and log the result.
  - **Remove the early return** (`jsonResponse` + `return`).
  - After clearing, fall through to the existing classification and spawn logic (lines 236-261).
  - The response should still be sent immediately (like the actionable comment path on line 263), but the status should indicate both clearing and processing, e.g., `{ status: 'cleared_and_processing', issue: issueNumber, deleted: result.deleted }`.
- Ensure the `isAdwRunningForIssue` check and `classifyIssueForTrigger` flow are reused (not duplicated) — the clear branch should fall through to the same code path that the actionable comment branch uses.

### Step 2: Modify the cron trigger to qualify issues with `## Clear` comments
- Read `adws/triggers/trigger_cron.ts`.
- Import `isClearComment` from `../github`.
- In `isQualifyingIssue` (lines 56-71), add a check: if the latest comment matches `isClearComment`, log a message and return `true`.
- In `checkAndTrigger` (lines 74-112), before spawning the workflow for a qualifying issue, check if the latest comment is a clear comment. If so, call `clearIssueComments(issueNumber)` before spawning the workflow. Import `clearIssueComments` from `../adwClearComments`.

### Step 3: Update webhook clear-comment tests
- Read `adws/__tests__/webhookClearComment.test.ts`.
- The existing `handleIssueComment` helper function (lines 41-47) only replicates the clear-and-return logic. Update it to also replicate the new behavior: after clearing, proceed to return a status indicating ADW was triggered (e.g., `{ status: 'cleared_and_processing', ... }`).
- Add tests:
  - `## Clear` comment clears comments AND returns a status indicating ADW processing was triggered.
  - Verify `clearIssueComments` is still called for `## Clear` comments.

### Step 4: Update cron trigger comment handling tests
- Read `adws/__tests__/triggerCommentHandling.test.ts`.
- The existing `isQualifyingIssue` helper (lines 17-22) replicates the cron logic. Update it to also check `isClearComment`.
- Add tests:
  - An issue whose latest comment is `## Clear` qualifies.
  - An issue whose latest comment is `## clear` (lowercase) qualifies.
  - An issue whose latest comment is `## Clear` with surrounding text qualifies.

### Step 5: Run validation commands
- Run all validation commands listed below to ensure the bug is fixed with zero regressions.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `npm run lint` — Run linter to check for code quality issues
- `npx tsc --noEmit` — TypeScript type check for main project
- `npx tsc --noEmit -p adws/tsconfig.json` — TypeScript type check for adws
- `npm test` — Run all tests to validate the bug is fixed with zero regressions

## Notes
- IMPORTANT: Strictly adhere to `guidelines/coding_guidelines.md` coding guidelines.
- The `clearIssueComments` function is synchronous (uses `execSync` internally). This is important in the webhook handler since the response needs to be sent quickly — the clear operation should complete before the async classification/spawn begins.
- The cron trigger's `isQualifyingIssue` is a module-private function. Tests replicate its logic via a local helper. When updating the real function, also update the test helper to match.
- No new libraries are needed for this fix.
