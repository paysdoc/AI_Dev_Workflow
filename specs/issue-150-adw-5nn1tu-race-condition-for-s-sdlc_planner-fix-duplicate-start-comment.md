# Bug: Race condition causes duplicate workflow start comments

## Metadata
issueNumber: `150`
adwId: `5nn1tu-race-condition-for-s`
issueJson: `{"number":150,"title":"Race condition for starting workflow","body":"Each issue has either two comments showing that the workflow has started or one comment started and one comment resuming.","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-12T19:11:51Z"}`

## Bug Description
When a workflow is triggered via webhook, each GitHub issue receives **two** comments indicating the workflow has started instead of one. The symptom manifests in two variants:

1. **Two "started" comments**: Both `## :rocket: ADW Workflow Started` appear on the issue
2. **One "started" + one "resuming"**: `## :rocket: ADW Workflow Started` followed by `## :arrows_counterclockwise: ADW Workflow Resuming`

**Expected behavior:** A single `## :rocket: ADW Workflow Started` comment is posted when a fresh workflow begins.

**Actual behavior:** Two comments are posted due to a race condition between the webhook gatekeeper and the orchestrator initialization.

## Problem Statement
There are two independent code paths that both post workflow start comments:

1. **Webhook gatekeeper** (`adws/triggers/webhookGatekeeper.ts:44`): Posts "starting" immediately before spawning the orchestrator process
2. **Workflow initialization** (`adws/phases/workflowInit.ts:243-247`): Posts "starting" or "resuming" after detecting recovery state

These two paths are not coordinated, causing duplicate comments. The timing determines the variant:
- If the orchestrator fetches issue comments **before** GitHub indexes the gatekeeper's comment → two "starting" comments
- If the orchestrator fetches issue comments **after** GitHub indexes the gatekeeper's comment → `detectRecoveryState()` treats "starting" as a completed stage, sets `canResume = true`, and posts "resuming"

## Solution Statement
Remove the premature `postWorkflowComment()` call from `webhookGatekeeper.ts`. The orchestrator's `initializeWorkflow()` in `workflowInit.ts` is the canonical place to post the "starting" comment because it runs after fetching the issue, detecting recovery state, and setting up the workflow context. This eliminates the race condition with a single-line removal (plus import cleanup).

## Steps to Reproduce
1. Trigger a workflow via webhook (e.g., open an issue or post a `## Take action` comment)
2. The webhook handler calls `classifyAndSpawnWorkflow()` which posts "starting" comment and spawns the orchestrator
3. The spawned orchestrator calls `initializeWorkflow()` which fetches issue comments and posts either "starting" or "resuming"
4. Observe two comments on the issue instead of one

## Root Cause Analysis
The race condition exists because `classifyAndSpawnWorkflow()` in `webhookGatekeeper.ts` was designed to post a "starting" comment "immediately to signal ownership" (line 43 comment). However, `initializeWorkflow()` in `workflowInit.ts` independently posts its own "starting" or "resuming" comment without checking if one already exists.

The `detectRecoveryState()` function in `workflowCommentParsing.ts` compounds the problem: it treats `'starting'` as a valid completed stage (it's in `STAGE_ORDER` at index 0), so when it finds the gatekeeper's "starting" comment, it sets `canResume = true` and `lastCompletedStage = 'starting'`. This causes `workflowInit.ts` to post a "resuming" comment instead of recognizing it as a fresh start.

The fix is straightforward: remove the gatekeeper's premature comment posting and let the orchestrator be the single source of truth for workflow start comments.

## Relevant Files
Use these files to fix the bug:

- `adws/triggers/webhookGatekeeper.ts` — Contains the premature `postWorkflowComment()` call on line 44 that must be removed, along with the now-unused import of `postWorkflowComment` on line 13.
- `adws/triggers/__tests__/triggerWebhookGatekeeper.test.ts` — Tests for `classifyAndSpawnWorkflow` that assert `postWorkflowComment` is called; these assertions must be removed since the gatekeeper will no longer post comments.
- `adws/phases/workflowInit.ts` — Contains the canonical "starting"/"resuming" comment posting logic (lines 232-249). No changes needed here, but read to confirm the orchestrator handles this correctly.
- `adws/core/workflowCommentParsing.ts` — Contains `detectRecoveryState()` and `STAGE_ORDER`. No changes needed; the fix at the gatekeeper level prevents the race entirely.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Remove premature "starting" comment from webhookGatekeeper

- Read `adws/triggers/webhookGatekeeper.ts`
- Remove the `postWorkflowComment` import from line 13 (`import { postWorkflowComment } from '../github/workflowCommentsIssue';`)
- Remove line 43 (comment: `// Post "starting" comment immediately to signal ownership`) and line 44 (`postWorkflowComment(issueNumber, 'starting', { issueNumber, adwId }, resolvedRepoInfo);`) from the `classifyAndSpawnWorkflow()` function
- Verify no other code in this file references `postWorkflowComment`

### 2. Update webhookGatekeeper tests

- Read `adws/triggers/__tests__/triggerWebhookGatekeeper.test.ts`
- Remove the mock for `../../github/workflowCommentsIssue` (lines 18-20) since `postWorkflowComment` is no longer imported
- Remove the import of `postWorkflowComment` (line 32)
- In the `'posts starting comment and spawns workflow'` test (line 44): remove the `postWorkflowComment` assertion (line 50) and rename the test to `'classifies issue and spawns workflow'` since it no longer posts a comment
- In the `'uses classification adwId when available'` test (line 54): remove the `postWorkflowComment` assertion (line 60) and update the test to verify the adwId is passed to `spawnDetached` instead

### 3. Run validation commands

- Execute the validation commands listed below to verify the fix is correct with zero regressions.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bun run lint` - Run linter to check for code quality issues
- `bunx tsc --noEmit` - Type check the main project
- `bunx tsc --noEmit -p adws/tsconfig.json` - Type check the adws scripts
- `bun run test` - Run all tests to validate the fix with zero regressions

## Notes
- This is a minimal, surgical fix: removing the premature comment from the gatekeeper eliminates the race condition without changing any other behavior.
- The `initializeWorkflow()` function in `workflowInit.ts` already correctly handles both fresh starts (posts "starting") and recovery (posts "resuming"), so no changes are needed there.
- The `detectRecoveryState()` function correctly treats `'starting'` as a stage — this is useful for actual recovery scenarios (e.g., if the process crashes after posting "starting" but before completing later stages). The bug was not in recovery detection but in having two code paths both posting comments.
- `adwBuild.tsx` has a separate `detectRecoveryState()` + `postWorkflowComment()` flow (lines 136-160) but it is NOT triggered from the webhook path — it only runs as a standalone orchestrator with pre-provided branch/plan args, so it is not affected by this bug.
- Strictly adhere to the coding guidelines in `guidelines/coding_guidelines.md`.
