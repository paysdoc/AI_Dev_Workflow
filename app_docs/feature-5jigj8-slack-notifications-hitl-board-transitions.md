# HITL Slack Notifications for Board Transitions

**ADW ID:** 5jigj8-slack-notifications
**Date:** 2026-06-15
**Specification:** specs/issue-587-adw-5jigj8-slack-notifications-sdlc_planner-hitl-board-slack-notifications.md

## Overview

Adds push Slack notifications for HITL-gated issues when ADW moves them to the **Review** board column (PR awaiting approval) or into a **Blocked** terminal state (discarded workflow or PR-review error). Reviewers no longer need to poll the project board — they receive a direct ping the moment their action is required. Only issues carrying the `hitl` label are notified; non-HITL issues auto-merge silently.

## What Was Built

- New `adws/github/hitlBoardNotifier.ts` module — self-contained notifier owning `gh` issue/PR reads, message building, and Slack delivery
- Review transition hook — fire-and-forget notification inside `moveIssueToStatus` after the board write, guarded to `targetStatus === 'review'`
- PR-review-error hook — awaited notification inside `handlePRReviewWorkflowError` before `process.exit(1)`
- Live discard hook — awaited notification at the `prState === 'CLOSED'` branch in `adwMerge.tsx`, injected via `MergeDeps` for testability
- Dormant `handleWorkflowDiscarded` hook — forward-compatible `async` version that notifies when/if a future caller routes through it
- Unit test suite `adws/github/__tests__/hitlBoardNotifier.test.ts` covering all message templates, the `hitl` filter, PR-lookup digit-boundary disambiguation, error snippet truncation, and the no-throw boundary

## Technical Implementation

### Files Modified

- `adws/github/hitlBoardNotifier.ts` *(new)*: exports `notifyReviewTransition` and `notifyBlockedTransition`; uses injected `NotifierDeps` for testability; no `providers/` import
- `adws/github/__tests__/hitlBoardNotifier.test.ts` *(new)*: Vitest unit tests for all public functions and edge cases
- `adws/github/index.ts`: barrel-exports both public functions from `hitlBoardNotifier`
- `adws/github/projectBoardApi.ts`: adds `void notifyReviewTransition(...)` after the successful board write, guarded by `targetStatus.toLowerCase() === 'review'`
- `adws/phases/prReviewCompletion.ts`: `handlePRReviewWorkflowError` made `async`; `await notifyBlockedTransition({ source: 'review_error' })` added inside the `Platform.GitHub` guard before `process.exit(1)`
- `adws/adwPrReview.tsx`: `await handlePRReviewWorkflowError(...)` so the notification completes before exit
- `adws/adwMerge.tsx`: `MergeDeps` extended with `notifyBlockedTransition`; `buildDefaultDeps(platform)` supplies the real function on GitHub, a no-op otherwise; `executeMerge` awaits it at the discard site
- `adws/phases/workflowCompletion.ts`: `handleWorkflowDiscarded` made `async`; same `notifyBlockedTransition({ source: 'discarded' })` call added (dormant — see Notes)
- `adws/core/slackNotifier.ts`: `postSlack` exported (was private)
- `adws/__tests__/adwMerge.test.ts`: `makeDeps` extended with a `vi.fn()` for `notifyBlockedTransition`; closed-PR test asserts it is called with `source: 'discarded'`

### Key Changes

- **Layering preserved:** `hitlBoardNotifier.ts` imports only `core` and sibling `github` modules — no `providers/` edge. Non-GitHub no-op is enforced at call sites via `Platform.GitHub` guards.
- **Review hook uses a string literal** (`'review'`) not `BoardStatus.Review` to avoid introducing a `github → providers` import.
- **PR disambiguation** uses `new RegExp(\`Implements #${issueNumber}(?!\\d)\`)` to reject `#5870` and `#58` when looking for `#587`.
- **`handleWorkflowDiscarded` is currently uninvoked.** The live discard path runs through `adwMerge.tsx` directly; `handleWorkflowDiscarded` was made async as a forward-compatible hook. The two paths are mutually exclusive — no double-notify risk.
- **Error snippet hygiene:** `errorMessage` is collapsed to a single line and capped at 200 chars before inclusion in the `:warning:` message.

## How to Use

The feature is automatic — no user action is required once `SLACK_WEBHOOK_URL` is set.

1. Ensure `SLACK_WEBHOOK_URL` is set in the ADW environment (same webhook used by auth-gate alerts in `core/slackNotifier.ts`).
2. Label a GitHub issue with `hitl`.
3. Run an ADW workflow against that issue:
   - When ADW moves the issue to **Review**, a `:eyes:` Slack message fires with a link to the open PR.
   - If the PR is closed without merge (discarded), a `:no_entry:` message fires with a link to the issue.
   - If the PR review phase errors out, a `:warning:` message fires with a truncated error snippet and a link to the issue.
4. Non-HITL issues are silent throughout.

## Configuration

| Variable | Description |
|---|---|
| `SLACK_WEBHOOK_URL` | Incoming Webhook URL for your Slack channel. Shared with auth-gate alerts. Unset → all notifications silently no-op. |

No new environment variables or `.adw/` config keys are required.

## Testing

```bash
# Unit tests for the new notifier module and updated adwMerge test
bun run test:unit

# Full typecheck (catches the async signature changes)
bunx tsc --noEmit -p adws/tsconfig.json

# Lint
bun run lint

# Regression safety net (board/merge/PR-review chokepoints)
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
```

## Notes

- **Channel reuse is intentional.** `SLACK_WEBHOOK_URL` is shared with auth-gate alerts; splitting channels is deferred until volume warrants it.
- **Teardown latency** is bounded: each discard/review-error exit adds one `gh issue view` + optional Slack POST (capped at 10 s via `AbortSignal.timeout`). Only fires for `hitl` issues.
- **`abandoned` transitions are intentionally silent.** That path auto-retries via cron (`isRetriableStage`), so no human action is needed.
- **Re-asserting Review never double-pings.** The `moveIssueToStatus` "already in target status" short-circuit returns before the hook.
- **Non-GitHub repos (GitLab, Jira) post nothing.** The Blocked hooks are guarded on `Platform.GitHub`; the Review hook is inside GitHub Projects V2 code.
