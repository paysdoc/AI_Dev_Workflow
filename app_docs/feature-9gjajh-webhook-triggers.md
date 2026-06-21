# Webhook Triggers

## Overview

The webhook trigger is ADW's real-time event handler: an HTTP server that receives GitHub webhook events and immediately routes them to the appropriate handler. It complements the cron sweeper by reacting to events within seconds rather than waiting for the next poll cycle, and it ensures a cron process is running for each repo it handles.

## Responsibilities

- `trigger_webhook.ts`: starts an HTTP server on port 8001 (or a random port if 8001 is taken), validates webhook signatures, and routes events by type — `issues`, `issue_comment`, `pull_request`, `pull_request_review`, and `pull_request_review_comment`.
- Handles `issues.opened`: routes through `routeIssueOpened` (label-based routing); applies a 60-second per-issue cooldown to de-duplicate rapid webhook delivery.
- Handles `issues.closed`: calls `handleIssueClosedEvent` to clean up worktrees, delete the remote branch, and unblock or close dependent issues.
- Handles `issue_comment.created`: checks for `## Cancel` (calls `handleCancelDirective`), `## Retry` (calls `handleRetryDirective`), or an actionable ADW comment pattern (dependency + concurrency check, then `classifyAndSpawnWorkflow`).
- Handles `pull_request.closed`: calls `handlePullRequestEvent` to write `discarded` state and close the linked issue when the PR was abandoned (closed without merge).
- Handles `pull_request_review` and `pull_request_review_comment`: spawns `adwPrReview.tsx` with a 60-second per-PR cooldown; ignores `approved` review events (merge is handled by cron).
- `validateWebhookSignature`: validates the `x-hub-signature-256` header using HMAC-SHA256 with constant-time comparison.
- `handlePullRequestEvent`: for abandoned PRs, extracts the issue number from the branch name, writes `discarded` state for the adwId, and closes the linked issue with a comment.
- `handleIssueClosedEvent`: reads state to detect active vs. finished workflows, applies a grace period guard, removes worktrees, deletes the remote branch, and dispatches dependency unblocking or cascaded closure depending on the workflow stage.
- `classifyAndSpawnWorkflow` (in `webhookGatekeeper`): enforces auth gate, routes `adw:upgrade` issues directly to `adwUpgrade.tsx`, calls `evaluateCandidate` for takeover decisions, classifies and spawns the appropriate workflow script.
- `spawnDetached`: spawns a detached child process with `cwd` pinned to `REPO_ROOT` and relative script paths resolved.
- `ensureCronProcess`: checks whether a cron process is alive for the event's repo and spawns one if not.
- `handleIssueClosedDependencyUnblock`: finds open issues that depend on the closed issue and re-evaluates their eligibility.
- `closeAbandonedDependents`: finds open issues that depend on an abandoned issue and closes them with an explanatory comment.

## Contracts & Invariants

- Webhook signature validation uses `timingSafeEqual` to prevent timing attacks; when `GITHUB_WEBHOOK_SECRET` is not set, validation is skipped with a warning.
- The auth gate is checked before every spawn — when set, all spawn paths return immediately with `status: ignored`.
- `ensureAppAuthForRepo` is called per-request (before any `gh` work) to ensure the app token targets the correct repo for multi-repo webhook deployments.
- The grace period guard in `handleIssueClosedEvent` prevents cleanup when the orchestrator is actively running within `GRACE_PERIOD_MS` of its last phase activity.
- For PR-closed events, only abandoned (not merged) PRs trigger the `discarded` state write and issue closure; merged PRs are ignored here because GitHub's auto-close fires `issues.closed` which handles cleanup.
- `extractIssueNumberFromBranch` uses the `issue-N` pattern; PRs without this pattern in the branch name are ignored on closure.
- `classifyAndSpawnWorkflow` intercepts `adw:upgrade` issues before calling `evaluateCandidate` to prevent the classifier from mislabeling the upgrade tracking issue.

## Configuration

Server port defaults to `process.env.PORT || 8001`. `GITHUB_WEBHOOK_SECRET` enables signature validation. GitHub App auth is activated at startup. The `PR_REVIEW_COOLDOWN_MS` and `ISSUE_COOLDOWN_MS` cooldowns are module-level constants (60 000 ms each). The server listens on `0.0.0.0`. `.env` is loaded at the top of `trigger_webhook.ts` via an explicit `import '../core/environment'` (codifying the contract that was already satisfied transitively through the `../core` barrel — present regardless of runtime (node vs bun) or future import-order refactors).

## Gotchas

- The `issue_comment` handler is fully async via `.then().catch()` but the HTTP response is sent immediately (`status: processing`). Errors in the async continuation are logged but not surfaced to the client — the cron will retry on the next poll cycle.
- `extractTargetRepoArgs` reads the repository's `full_name` and `clone_url`/`html_url` from the webhook payload body to build `--target-repo` args for spawned children.
- The `pull_request_review` handler ignores `approved` reviews by design; ADW relies on the cron + `adwMerge.tsx` path to poll approval state, not real-time merge-on-approve.
- When port 8001 is in use and `GITHUB_WEBHOOK_SECRET` is set (tunnel mode), the server throws instead of falling back to a random port — a tunnel must have a fixed port.
- `recentPrReviewTriggers` and `recentIssueTriggers` are in-memory maps and reset on server restart; rapid consecutive events within the cooldown window after a restart may both be processed.
