# ensureCronProcess Called Before Webhook Gates

**ADW ID:** wqzfqj-ensurecronprocess-no
**Date:** 2026-03-25
**Specification:** specs/issue-291-adw-wqzfqj-ensurecronprocess-no-sdlc_planner-ensure-cron-before-gates.md

## Overview

Fixes a bug where `ensureCronProcess()` was only reachable via the "happy path" inside `trigger_webhook.ts`. If any earlier gate (non-actionable comment, cooldown, eligibility check) rejected a webhook event, the cron poller process was never respawned — leaving it dead indefinitely. The fix moves `ensureCronProcess` to execute immediately after repo info is extracted, before any issue-specific gating logic, in both the `issue_comment` and `issues.opened` handlers.

## What Was Built

- Relocated `ensureCronProcess()` call in the `issue_comment` handler to execute unconditionally after `webhookRepoInfo` is resolved, before `isActionableComment`, `shouldTriggerIssueWorkflow`, and all other gates
- Relocated `commentTargetRepoArgs` declaration to match the new earlier call site
- Relocated `ensureCronProcess()` call in the `issues.opened` handler to execute unconditionally after `issueRepoInfo` is resolved, before the async IIFE that runs eligibility checks
- New BDD feature file `features/ensure_cron_on_webhook_gates.feature` with 6 `@regression` scenarios verifying the fix structurally
- New step definitions `features/step_definitions/ensureCronBeforeGatesSteps.ts` implementing source-code-reading assertions

## Technical Implementation

### Files Modified

- `adws/triggers/trigger_webhook.ts`: Moved `ensureCronProcess` calls and `commentTargetRepoArgs` declaration earlier in both `issue_comment` and `issues.opened` handlers; removed the old nested calls
- `features/ensure_cron_on_webhook_gates.feature`: New BDD feature file with `@adw-291` and `@regression` tags covering structural position of `ensureCronProcess` in both handlers
- `features/step_definitions/ensureCronBeforeGatesSteps.ts`: New step definitions that read `trigger_webhook.ts` source and assert call ordering

### Key Changes

- In the `issue_comment` handler: `commentTargetRepoArgs = extractTargetRepoArgs(body)` and `if (webhookRepoInfo) ensureCronProcess(...)` are now placed immediately after `webhookRepoInfo` is computed (line ~155), before `isClearComment`, `isActionableComment`, and `shouldTriggerIssueWorkflow`
- In the `issues.opened` handler: `if (issueRepoInfo) ensureCronProcess(...)` is now placed immediately after `issueRepoInfo` is computed, before the async IIFE that calls `checkIssueEligibility`
- The old `ensureCronProcess` calls inside the `.then()` callback and the async eligibility IIFE were removed
- Decouples cron process lifecycle (infrastructure concern) from issue-processing gates (business logic concern)
- BDD scenarios verify structural ordering by reading the source file — not by runtime mock injection — consistent with prior cron-related regression tests

## How to Use

The fix is transparent — no configuration or API changes are required. The cron poller will now be checked and respawned on every incoming webhook event for a recognized repository, regardless of whether the event passes any issue-processing gates.

To verify the fix manually:
1. Start the webhook server: `bunx tsx adws/triggers/trigger_webhook.ts`
2. Let the cron process start for a repo via a valid webhook event
3. Kill the cron process: `kill <pid>`
4. Send a non-actionable comment webhook (comment body without `## Take action` heading)
5. Observe that `ensureCronProcess` is now called and the cron process is respawned

## Configuration

No configuration changes required. The fix relies on the existing `ensureCronProcess` function in `adws/triggers/webhookGatekeeper.ts`, which is idempotent and uses an in-memory Set fast-path plus an optional PID file read — adding negligible overhead.

## Testing

Run the regression BDD scenarios tagged `@adw-291`:

```sh
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-291"
```

Run all regression scenarios to verify no regressions:

```sh
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
```

The 6 new scenarios assert:
1. `ensureCronProcess` appears before `isActionableComment` in the `issue_comment` handler
2. `ensureCronProcess` appears before `shouldTriggerIssueWorkflow` in the `issue_comment` handler
3. `ensureCronProcess` is not inside the `isAdwRunningForIssue` `.then()` callback
4. `ensureCronProcess` appears before `checkIssueEligibility` in the `issues.opened` handler
5. `ensureCronProcess` is not inside the eligibility block in the `issues.opened` handler
6. TypeScript type-check passes after the relocation

## Notes

- `webhookGatekeeper.ts` and `cronProcessGuard.ts` required no changes — the fix is confined to `trigger_webhook.ts` plus new BDD test assets
- The BDD approach (source-code-reading assertions) follows the same pattern established for the previous cron fix (issue #250 / ADW `7nl59l`)
- `ensureCronProcess` is idempotent: safe to call on every webhook event without side effects
