# Bug: ensureCronProcess not called when webhook gates reject event

## Metadata
issueNumber: `291`
adwId: `wqzfqj-ensurecronprocess-no`
issueJson: `{"number":291,"title":"ensureCronProcess not called when webhook gates reject event","body":"## Bug\n\n`ensureCronProcess()` is only called deep inside the issue-processing happy path in `trigger_webhook.ts`. If any earlier gate rejects the webhook event, the dead cron process is never respawned.\n\n## Current behavior\n\nIn the `issue_comment` handler (lines 147-183), `ensureCronProcess` at line 174 is only reached after passing **all** of these gates:\n\n1. `action === 'created'`\n2. `isActionableComment(commentBody)` — requires `## Take action` heading\n3. `shouldTriggerIssueWorkflow(issueNumber)` — cooldown check\n4. `isAdwRunningForIssue()` returns false\n5. `webhookRepoInfo` is defined\n6. `checkIssueEligibility()` passes\n\nThe same pattern exists in the `issues.opened` handler (line 231).\n\nIf a non-actionable comment (e.g. a plain text comment without `## Take action`) triggers the webhook, the event is ignored at step 2 and `ensureCronProcess` is never called — leaving the cron process dead indefinitely.\n\n## Expected behavior\n\n`ensureCronProcess` should be called on any incoming webhook event for a recognized repo, independently of whether the specific issue/comment passes eligibility or actionability gates. The cron poller is a background concern that should always be running, regardless of whether the triggering event leads to a workflow spawn.\n\n## Suggested fix\n\nMove the `ensureCronProcess` call earlier in the webhook handler — e.g. after repo info is extracted but before any issue-specific gating logic. This applies to both the `issue_comment` and `issues` event handlers.\n\n## Files\n\n- `adws/triggers/trigger_webhook.ts` — webhook handler where `ensureCronProcess` is called too late\n- `adws/triggers/webhookGatekeeper.ts` — contains `ensureCronProcess` (no changes needed here)","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-25T08:37:38Z","comments":[],"actionableComment":null}`

## Bug Description
`ensureCronProcess()` is called too late in the webhook handler flow inside `trigger_webhook.ts`. In the `issue_comment` handler, it is positioned inside the `.then()` async chain at line 174 — after all gating checks (actionable comment check, cooldown check, running-for-issue check, eligibility check). In the `issues.opened` handler, it is similarly nested inside the async IIFE after the eligibility check at line 231. If any earlier gate rejects the event (e.g. a non-actionable comment), the cron process is never respawned, leaving it dead indefinitely.

## Problem Statement
The cron process poller is a background infrastructure concern that must always be running for each recognized repo, regardless of whether a specific webhook event results in a workflow spawn. Currently, `ensureCronProcess` is only reached on the "happy path" — when all issue-specific gates pass. Any rejected event (non-actionable comment, cooldown hit, already-running ADW, ineligible issue) skips the cron respawn entirely.

## Solution Statement
Move the `ensureCronProcess()` call in both the `issue_comment` and `issues.opened` handlers to execute immediately after repo info is extracted from the payload, before any issue-specific gating logic. This ensures the cron process is always checked and respawned on every webhook event for a recognized repo, decoupling the infrastructure concern from the issue-processing gates. No changes are needed to `webhookGatekeeper.ts` or `cronProcessGuard.ts`.

## Steps to Reproduce
1. Start the webhook server: `bunx tsx adws/triggers/trigger_webhook.ts`
2. Let the cron process start for a repo (via a valid `issue_comment` or `issues.opened` event)
3. Kill the cron process manually (e.g. `kill <pid>`)
4. Send a non-actionable comment webhook (a comment without `## Take action` heading)
5. Observe that `ensureCronProcess` is never called — the cron process remains dead
6. Subsequent actionable comments may also fail if they hit cooldown or other gates before reaching the `ensureCronProcess` call

## Root Cause Analysis
In the `issue_comment` handler, `ensureCronProcess` was placed inside the `.then()` callback of `isAdwRunningForIssue()`, which itself is only reached after passing `isActionableComment()` and `shouldTriggerIssueWorkflow()` checks. The `commentTargetRepoArgs` variable (needed by `ensureCronProcess`) was also declared too late in the flow — after the gating checks. In the `issues.opened` handler, `ensureCronProcess` was inside the async IIFE after `checkIssueEligibility()`. Both placements couple the cron lifecycle to issue-processing gates that have nothing to do with whether the cron process should be running.

## Relevant Files
Use these files to fix the bug:

- `adws/triggers/trigger_webhook.ts` — The webhook HTTP server handler. Contains the `issue_comment` handler (lines 147-183) and `issues.opened` handler (lines 217-241) where `ensureCronProcess` must be moved earlier in the flow.
- `adws/triggers/webhookGatekeeper.ts` — Contains the `ensureCronProcess` function itself. No changes needed, but should be read for context on how `ensureCronProcess` works (in-memory cache + PID file guard).
- `adws/triggers/cronProcessGuard.ts` — The PID-file-based cron guard. No changes needed, but provides context on the liveness detection mechanism.
- `features/cron_respawn_dead_process.feature` — Existing BDD scenarios for cron respawn behavior. Reference for BDD style and tagging conventions.
- `app_docs/feature-ak5lea-trigger-cron-process-prevent-duplicate-cron.md` — Documentation on the cron process guard feature.
- `app_docs/feature-7nl59l-fix-cron-respawn-cache.md` — Documentation on the previous cron respawn cache fix.
- `guidelines/coding_guidelines.md` — Coding guidelines that must be followed.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Read relevant files for context
- Read `adws/triggers/trigger_webhook.ts` to understand the current flow
- Read `adws/triggers/webhookGatekeeper.ts` for `ensureCronProcess` signature and behavior
- Read `features/cron_respawn_dead_process.feature` for BDD style reference
- Read `guidelines/coding_guidelines.md` for coding standards

### 2. Move `ensureCronProcess` earlier in the `issue_comment` handler
- In the `issue_comment` handler (around lines 147-183):
  - Move the `const commentTargetRepoArgs = extractTargetRepoArgs(body);` declaration to immediately after `webhookRepoInfo` is computed (after line 155)
  - Add `if (webhookRepoInfo) ensureCronProcess(webhookRepoInfo, commentTargetRepoArgs);` immediately after `commentTargetRepoArgs` — before `isClearComment`, `isActionableComment`, `shouldTriggerIssueWorkflow`, and all other gates
  - Remove the existing `ensureCronProcess(webhookRepoInfo, commentTargetRepoArgs);` call from inside the `.then()` callback (the old location deep in the happy path)

### 3. Move `ensureCronProcess` earlier in the `issues.opened` handler
- In the `issues.opened` handler (around lines 217-241):
  - Add `if (issueRepoInfo) ensureCronProcess(issueRepoInfo, issueTargetRepoArgs);` immediately after `issueRepoInfo` is computed — before the async IIFE that runs eligibility checks
  - Remove the existing `ensureCronProcess(issueRepoInfo, issueTargetRepoArgs);` call from inside the async IIFE (the old location after `checkIssueEligibility`)

### 4. Create BDD feature file for regression testing
- Create `features/ensure_cron_before_gates.feature` with `@regression` and `@adw-291` tags
- Scenario 1: In the `issue_comment` handler, verify `ensureCronProcess` is called before `isActionableComment` by checking source code structure — the `ensureCronProcess` call must appear before the `isActionableComment` call in the handler
- Scenario 2: In the `issues.opened` handler, verify `ensureCronProcess` is called before `checkIssueEligibility` by checking source code structure — the `ensureCronProcess` call must appear before the async IIFE or the `checkIssueEligibility` call
- Scenario 3: Verify `ensureCronProcess` is not called inside the `.then()` callback or the async IIFE in either handler (i.e., it is at the top level of the handler, not nested in async processing)
- Scenario 4: TypeScript type-check passes after the fix

### 5. Create step definitions for the new BDD scenarios
- Create `features/step_definitions/ensureCronBeforeGatesSteps.ts`
- Implement steps that read `adws/triggers/trigger_webhook.ts` source code and verify the structural position of `ensureCronProcess` calls relative to gating logic
- Follow the pattern from `features/step_definitions/cronRespawnDeadProcessSteps.ts` which reads the source file and asserts structural properties

### 6. Run validation commands
- Run `bun run lint` to check for linting issues
- Run `bunx tsc --noEmit` to verify TypeScript compilation
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to verify ADW-specific TypeScript compilation
- Run `bun run build` to verify build succeeds
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` to run regression BDD scenarios

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Root TypeScript type-check
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type-check
- `bun run build` — Build the application to verify no build errors
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-291"` — Run the new BDD scenarios for this fix
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run all regression BDD scenarios to verify zero regressions

## Notes
- The `guidelines/coding_guidelines.md` file must be followed. Key relevant guidelines: clarity over cleverness, modularity, isolate side effects at boundaries.
- No new libraries are needed for this fix.
- The `webhookGatekeeper.ts` and `cronProcessGuard.ts` files require no changes — the fix is entirely within `trigger_webhook.ts` (code changes) plus new BDD scenarios and step definitions.
- This fix follows the same structural pattern as the previous cron-related fix (issue #250 / ADW `7nl59l`) which also used source-code-reading BDD scenarios to verify implementation structure.
- The `ensureCronProcess` function is idempotent and cheap (in-memory Set fast-path + optional PID file read), so calling it earlier in the flow adds negligible overhead.
