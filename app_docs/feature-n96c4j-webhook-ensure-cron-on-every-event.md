# Webhook: Ensure Cron on Every Accepted Event

**ADW ID:** n96c4j-webhook-call-ensurec
**Date:** 2026-04-28
**Specification:** specs/issue-501-adw-0lhdw4-webhook-call-ensurec-sdlc_planner-ensure-cron-on-every-event.md

## Overview

Fixes a bug where `trigger_webhook.ts` only called `ensureCronProcess` inside two event branches (`issue_comment.created` and `issues.opened`), leaving all other accepted webhook events — including `pull_request_review.approved`, `pull_request_review_comment`, `pull_request.closed`, `issues.closed`, and `issues.labeled` — silently bypassing cron respawn. Because the auto-merge path is cron-only, a repo receiving only an approving review would never spawn a cron poller, stranding `awaiting_merge` PRs indefinitely. The fix hoists `ensureCronProcess` to a single top-level call site that runs for every accepted, body-parsed webhook request, before any per-event branching.

## What Was Built

- Single top-level `ensureCronProcess` call in the `req.on('end', ...)` handler, immediately after `ensureAppAuthForRepo` and before all per-event branches
- Deduplication of three previously scattered `body.repository.full_name` / `extractTargetRepoArgs(body)` reads into a shared `webhookRepoInfo` / `webhookTargetRepoArgs` binding
- Removal of the two now-redundant nested `ensureCronProcess` calls in the `issue_comment` and `issues.opened` handlers
- New BDD feature file `features/webhook_ensure_cron_on_every_event.feature` with 17 structural scenarios covering top-level placement, removal of old call sites, rejected-request guards, and all per-event handler paths
- New step definitions `features/step_definitions/ensureCronOnEveryEventSteps.ts` using source-reading and brace-depth scanning to assert call ordering and scope

## Technical Implementation

### Files Modified

- `adws/triggers/trigger_webhook.ts`: Hoisted `ensureCronProcess` call to top of request body handler; removed duplicate calls from `issue_comment` and `issues.opened` branches; replaced three per-branch `extractTargetRepoArgs(body)` / `body.repository.full_name` reads with the shared top-level bindings

### New Files

- `features/webhook_ensure_cron_on_every_event.feature`: BDD feature with `@adw-501`, `@adw-0lhdw4-webhook-call-ensurec`, and `@regression` tags covering all acceptance criteria
- `features/step_definitions/ensureCronOnEveryEventSteps.ts`: Step definitions that read `trigger_webhook.ts` source and assert call ordering, scope, and count

### Key Changes

- `ensureCronProcess` is now called exactly once per accepted webhook request, gated on `webhookRepoInfo` truthiness (derived from `body.repository.full_name`)
- The call is positioned after all early-return guards: `/health` (line 79), non-`/webhook` URL (81), non-POST method (82), signature 401 (91), and JSON parse 400 (94) — so those paths preserve no-cron-spawn behavior without additional guards
- The `pull_request_review.approved` short-circuit still returns `{ status: 'ignored' }`, but the cron is now guaranteed to be alive before that branch is evaluated
- `webhookTargetRepoArgs` replaces the three separate `extractTargetRepoArgs(body)` calls previously scattered across `issue_comment`, `issues.closed`, and `pull_request_review_comment` handlers
- This supersedes the partial fix from issue #291 (ADW `wqzfqj`): the intent of that fix (cron must run before issue-specific gates) is preserved and broadened to all event types

## How to Use

No API or configuration changes. The fix is transparent: any inbound webhook event for a recognized repo with a resolvable `body.repository.full_name` will now guarantee a cron poller is alive for that repo.

To verify the fix manually:
1. Start the webhook server with no cron running for the repo: `bunx tsx adws/triggers/trigger_webhook.ts`
2. Confirm `ls agents/cron-pids/` has no entry for the repo
3. Drive an ADW issue to `workflowStage: "awaiting_merge"` with an approved, mergeable PR (no `hitl` label)
4. Post an approving review on the PR
5. Observe webhook logs: `Spawning cron trigger for <owner>/<repo>` should appear once after the `pull_request_review.submitted` request
6. Within ~20s, the cron sweep merges the PR

## Configuration

No new environment variables or configuration keys. The fix relies on the existing `ensureCronProcess` idempotency contract in `adws/triggers/webhookGatekeeper.ts` (in-memory `cronSpawnedForRepo` Set + PID-file liveness check).

## Testing

Run BDD scenarios for this fix and the predecessor fix:

```sh
# New scenarios for this fix
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-501"

# Previous fix regression (call now precedes all event branches, so ordering assertions still hold)
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-291"

# Full regression sweep
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
```

Type-check:
```sh
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json
```

## Notes

- The `pull_request_review.approved` short-circuit at `trigger_webhook.ts:125` intentionally returns `ignored` — merge is handled by `adwMerge.tsx` via the cron sweep, not dispatched directly from the webhook. This design is preserved; the fix only ensures the cron is alive to run that sweep.
- `ensureCronProcess` is idempotent: the in-memory `cronSpawnedForRepo` Set provides a fast-path, and `isCronAliveForRepo` (PID-file liveness) guards the slower spawn path. Calling it on every request adds negligible overhead.
- The fix does not change the single-host invariant documented in `adws/README.md#single-host-constraint`. Two hosts receiving webhooks for the same repo remains undefined territory.
- Issue #291 (ADW `wqzfqj`) is partially superseded: those per-handler call sites no longer exist. The structural BDD scenarios from `features/ensure_cron_on_webhook_gates.feature` continue to pass because `ensureCronProcess` now appears before all event branches, making the "called before isActionableComment / checkIssueEligibility" assertions trivially true.
