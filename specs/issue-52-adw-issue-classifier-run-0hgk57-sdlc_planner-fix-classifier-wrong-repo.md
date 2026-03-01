# Bug: Issue classifier fetching from wrong repository

## Metadata
issueNumber: `52`
adwId: `issue-classifier-run-0hgk57`
issueJson: `{"number":52,"title":"Issue classifier running on incorrect repo","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-01T16:37:36Z","comments":[],"actionableComment":null}`

## Bug Description
When the webhook trigger receives an issue event from an external target repository (e.g., `paysdoc/Millennium`), the issue classifier fetches the issue from the **ADW repository** (`paysdoc/AI_Dev_Workflow`) instead of the target repository. This causes:
- Classifying the wrong issue (a previously closed issue on the ADW repo)
- Incorrect issue type classification
- Spawning the wrong workflow for the target repo issue

**Expected behavior**: When a webhook event arrives for issue #35 from `paysdoc/Millennium`, the classifier should fetch issue #35 from `paysdoc/Millennium` and classify it correctly.

**Actual behavior**: The classifier fetches issue #35 from `paysdoc/AI_Dev_Workflow` (the ADW repo), resulting in misclassification and incorrect workflow routing.

## Problem Statement
`classifyIssueForTrigger()` in `adws/core/issueClassifier.ts` calls `fetchGitHubIssue(issueNumber)` without passing any repository information. `fetchGitHubIssue` falls back to `getRepoInfo()`, which reads from `git remote get-url origin` — returning the ADW repo, not the target repo from the webhook payload.

The webhook trigger (`trigger_webhook.ts`) already extracts target repo info from the payload via `extractTargetRepoArgs(body)`, but this information is only passed to the **spawned orchestrator** as CLI args — it is never passed to `classifyIssueForTrigger()` which runs in the trigger process itself.

## Solution Statement
Add a `repoInfo?: RepoInfo` parameter to `classifyIssueForTrigger()` and thread it through to `fetchGitHubIssue()`. In the webhook trigger, extract `RepoInfo` from the webhook payload and pass it to `classifyIssueForTrigger()` in both the `issues opened` and `issue_comment` handler paths.

This follows the existing pattern: `fetchGitHubIssue`, `commentOnIssue`, `closeIssue`, and other GitHub API functions all already accept an optional `repoInfo` parameter. The fix simply threads this parameter through the classifier.

## Steps to Reproduce
1. Configure the ADW webhook trigger to receive events from an external repo (e.g., `paysdoc/Millennium`)
2. Open a new issue (#35) in the external repo
3. The webhook trigger receives the `issues/opened` event
4. Observe in logs: `classifyIssueForTrigger` fetches issue #35 from the ADW repo (wrong repo), classifying a closed/different issue
5. The classifier produces an incorrect issue type (e.g., `/pr_review` instead of the actual type)

## Root Cause Analysis
The execution path for the bug:

1. **Webhook receives event**: `trigger_webhook.ts` receives `issues/opened` from `paysdoc/Millennium` for issue #35
2. **Target repo extracted**: `extractTargetRepoArgs(body)` correctly returns `['--target-repo', 'paysdoc/Millennium', '--clone-url', '...']`
3. **Classifier called without repo**: `classifyIssueForTrigger(issueNumber)` is called with only the issue number — no repo info
4. **Wrong issue fetched**: Inside `classifyIssueForTrigger`, `fetchGitHubIssue(issueNumber)` calls `getRepoInfo()` which reads `git remote get-url origin` → returns `paysdoc/AI_Dev_Workflow`
5. **Wrong classification**: Issue #35 from the ADW repo (a previously closed issue about something else) gets classified, producing an incorrect issue type

The same bug exists in the `issue_comment` handler path — both the `issues opened` and `issue_comment` handlers call `classifyIssueForTrigger(issueNumber)` without repo context.

## Relevant Files
Use these files to fix the bug:

- `adws/core/issueClassifier.ts` — Contains `classifyIssueForTrigger()` which needs to accept and forward `repoInfo` to `fetchGitHubIssue()`. This is the core of the fix.
- `adws/triggers/trigger_webhook.ts` — Contains the webhook handlers for `issues/opened` and `issue_comment` events. Both call `classifyIssueForTrigger()` without repo info. Need to extract `RepoInfo` from the payload and pass it.
- `adws/github/githubApi.ts` — Contains `getRepoInfo()`, `getRepoInfoFromPayload()`, and re-exports `fetchGitHubIssue`. No changes needed — these already support `RepoInfo`.
- `adws/github/issueApi.ts` — Contains `fetchGitHubIssue()` which already accepts optional `repoInfo`. No changes needed.
- `adws/__tests__/issueClassifier.test.ts` — Tests for `classifyIssueForTrigger()`. Must add tests verifying `repoInfo` is forwarded to `fetchGitHubIssue`.
- `adws/core/index.ts` — Re-exports from `issueClassifier.ts`. No changes needed (signature change is backward-compatible).

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Add `repoInfo` parameter to `classifyIssueForTrigger`

- Open `adws/core/issueClassifier.ts`
- Add an optional `repoInfo?: RepoInfo` parameter to the `classifyIssueForTrigger` function signature (after `issueNumber`)
- Import `RepoInfo` from `../github/githubApi` (it's already imported indirectly via `fetchGitHubIssue`)
- Pass `repoInfo` to `fetchGitHubIssue(issueNumber, repoInfo)` on line 200
- This is a backward-compatible change — existing callers that don't pass `repoInfo` continue to work as before

### 2. Pass target repo info from webhook trigger to classifier

- Open `adws/triggers/trigger_webhook.ts`
- In the **`issues opened` handler** (around line 327):
  - Before calling `classifyIssueForTrigger(issueNumber)`, extract `RepoInfo` from the webhook payload using the existing `getRepoInfoFromPayload()` function (already imported)
  - The payload's `repository.full_name` field contains the target repo identity
  - Pass the extracted `RepoInfo` to `classifyIssueForTrigger(issueNumber, repoInfo)`
- In the **`issue_comment` handler** (around line 250):
  - The variable `webhookRepoInfo` is already computed from the payload on line 224. Pass it to `classifyIssueForTrigger(issueNumber)` → `classifyIssueForTrigger(issueNumber, webhookRepoInfo)`

### 3. Add tests for `classifyIssueForTrigger` with `repoInfo`

- Open `adws/__tests__/issueClassifier.test.ts`
- Add a new test in the `classifyIssueForTrigger` describe block:
  - **Test**: "passes repoInfo to fetchGitHubIssue when provided"
    - Create a `RepoInfo` object `{ owner: 'ext-owner', repo: 'ext-repo' }`
    - Mock `fetchGitHubIssue` to return a mock issue with a body containing `/adw_plan_build_test`
    - Call `classifyIssueForTrigger(35, repoInfo)`
    - Assert that `fetchGitHubIssue` was called with `(35, { owner: 'ext-owner', repo: 'ext-repo' })`
    - Assert classification succeeds
  - **Test**: "fetches from default repo when repoInfo is not provided" (existing behavior preserved)
    - Call `classifyIssueForTrigger(42)` (no repoInfo)
    - Assert that `fetchGitHubIssue` was called with `(42, undefined)`
- Import `RepoInfo` type in the test file

### 4. Run validation commands

- Run all validation commands listed below to confirm the fix is correct with zero regressions.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `npx vitest run adws/__tests__/issueClassifier.test.ts` — Run classifier tests to validate the new repoInfo parameter works
- `npx vitest run adws/__tests__/triggerSpawnArgs.test.ts` — Run trigger spawn args tests to ensure no regressions
- `npx vitest run adws/__tests__/webhookClearComment.test.ts` — Run webhook comment tests to ensure no regressions
- `npx vitest run adws/__tests__/triggerCommentHandling.test.ts` — Run trigger comment handling tests
- `npm test` — Run full test suite to validate zero regressions
- `npx tsc --noEmit` — Type-check main project
- `npx tsc --noEmit -p adws/tsconfig.json` — Type-check ADW scripts
- `npm run lint` — Lint for code quality issues
- `npm run build` — Build to verify no build errors

## Notes
- The fix is backward-compatible: `classifyIssueForTrigger(issueNumber)` continues to work for callers that don't need external repo support (e.g., the cron trigger which only processes issues from the ADW repo).
- The `issue_comment` handler already computes `webhookRepoInfo` from the payload for `clearIssueComments` — we reuse that same variable for the classifier call, avoiding duplication.
- The `extractTargetRepoArgs` function returns CLI args (`['--target-repo', 'owner/repo', ...]`), not a `RepoInfo` object. We use `getRepoInfoFromPayload(repository.full_name)` instead, which is already imported and used in the `issue_comment` handler.
- For the `issues opened` handler, we need to extract `RepoInfo` from the payload in the same way the `issue_comment` handler does — by reading `repository.full_name` from the payload body.
