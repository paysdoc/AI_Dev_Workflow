# Webhook Triggers

## Overview

The webhook trigger is ADW's real-time event handler: an HTTP server that receives GitHub webhook events, constructs an immutable `GitContext` per event from the payload's repository, and immediately routes the event to the appropriate handler. It complements the cron sweeper by reacting to events within seconds rather than waiting for the next poll cycle. Because a single webhook process handles events for many repositories concurrently and asynchronously, each event gets its own authoritative `GitContext` at receipt — before any `await` — so interleaved multi-repo events cannot cross-contaminate auth or worktree base paths.

## Responsibilities

- `trigger_webhook.ts`: starts an HTTP server on port 8001 (or a random port if 8001 is taken), validates webhook signatures, and routes events by type — `issues`, `issue_comment`, `pull_request`, `pull_request_review`, and `pull_request_review_comment`.
- Per-event repo resolution via `resolveWebhookRepo(body)` (from `webhookRepoResolver.ts`): parses the raw payload `repository` object into `{ repoInfo, targetRepo, targetRepoArgs }`, or `null` when no usable repository is present. Pure — no I/O.
- Per-event `GitContext` construction via `buildLaunchGitContext(resolution.targetRepo)`: constructed synchronously before any `await`, captures owner/repo, base path, and auth token into an immutable object (`eventGitContext`) that all async continuations for this event carry. Construction failures are logged at `warn` and degrade to the legacy path; the long-lived server never crashes on one malformed event.
- Threads `eventGitContext` through all spawn paths: `classifyAndSpawnWorkflow` → `evaluateCandidate` (worktree/takeover path resolution), `routeIssueOpened` (issues.opened router), and `handleIssueClosedDependencyUnblock` (closed-event dependency unblocking).
- Ensures a cron process is running for each repo it handles (`ensureCronProcess` before all per-event branching).
- Handles `issues.opened`: routes through `routeIssueOpened` (label-based routing); applies a 60-second per-issue cooldown to de-duplicate rapid webhook delivery.
- Handles `issues.closed`: calls `handleIssueClosedEvent` to clean up worktrees, delete the remote branch, and unblock or close dependent issues.
- Handles `issue_comment.created`: checks for `## Cancel` (calls `handleCancelDirective`), `## Retry` (calls `handleRetryDirective`), or an actionable ADW comment pattern (dependency + concurrency check, then `classifyAndSpawnWorkflow`).
- Handles `pull_request.closed`: calls `handlePullRequestEvent` to write `discarded` state and close the linked issue when the PR was abandoned (closed without merge).
- Handles `pull_request_review` and `pull_request_review_comment`: spawns `adwPrReview.tsx` with a 60-second per-PR cooldown; ignores `approved` review events (merge is handled by cron).
- `webhookRepoResolver.ts`: pure payload-to-identity resolver extracted from `trigger_webhook.ts` so the per-event boundary is unit-testable without starting the HTTP server. Exports `resolveWebhookRepo(body)` and the `WebhookRepoResolution` interface.
- `validateWebhookSignature`: validates the `x-hub-signature-256` header using HMAC-SHA256 with constant-time comparison.
- `handlePullRequestEvent`: for abandoned PRs, extracts the issue number from the branch name, writes `discarded` state for the adwId, and closes the linked issue with a comment.
- `handleIssueClosedEvent`: reads state to detect active vs. finished workflows, applies a grace period guard, removes worktrees, deletes the remote branch, and dispatches dependency unblocking or cascaded closure depending on the workflow stage. Accepts an optional `gitContext` for per-event scoping.
- `classifyAndSpawnWorkflow` (in `webhookGatekeeper`): enforces auth gate, routes `adw:upgrade` issues directly to `adwUpgrade.tsx`, calls `evaluateCandidate` (using per-event `gitContext` when available) for takeover decisions, classifies and spawns the appropriate workflow script.
- `handleIssueClosedDependencyUnblock`: finds open issues that depend on the closed issue, re-evaluates their eligibility, and spawns with the per-event `gitContext` for correct worktree base resolution.
- `spawnDetached`: spawns a detached child process with `cwd` pinned to `REPO_ROOT` and relative script paths resolved.
- `ensureCronProcess`: checks whether a cron process is alive for the event's repo and spawns one if not.
- `closeAbandonedDependents`: finds open issues that depend on an abandoned issue and closes them with an explanatory comment.
- `issueOpenedRouter.ts`: `routeIssueOpened(params, deps)` and `IssueOpenedRouterDeps.classifyAndSpawn` — both accept an optional trailing `gitContext` that is forwarded to `classifyAndSpawnWorkflow`.

## Contracts & Invariants

- **Per-event `GitContext` is constructed synchronously at receipt, before any `await`/`.then`.** This makes the context an immutable per-event capture; no later event can overwrite it, and the async continuations carry the right context regardless of interleaving.
- `resolveWebhookRepo` returns `null` for payloads without a usable `repository.full_name` + (`clone_url` or `html_url`); all downstream callers guard on `resolution !== null`.
- `ensureCronProcess` is always called before any per-event handler branching — even when per-event construction fails. The `ensureCronProcess`-before-branching ordering invariant is preserved.
- `buildLaunchGitContext` also calls `ensureAppAuthForRepo` internally (idempotent, transitional) so not-yet-migrated `gh` call sites continue to work; the webhook no longer has its own standalone `ensureAppAuthForRepo` poke.
- Webhook signature validation uses `timingSafeEqual` to prevent timing attacks; when `GITHUB_WEBHOOK_SECRET` is not set, validation is skipped with a warning.
- The auth gate is checked before every spawn — when set, all spawn paths return immediately with `status: ignored`.
- The grace period guard in `handleIssueClosedEvent` prevents cleanup when the orchestrator is actively running within `GRACE_PERIOD_MS` of its last phase activity.
- For PR-closed events, only abandoned (not merged) PRs trigger the `discarded` state write and issue closure.
- `extractIssueNumberFromBranch` uses the `issue-N` pattern; PRs without this pattern in the branch name are ignored on closure.
- `classifyAndSpawnWorkflow` intercepts `adw:upgrade` issues before calling `evaluateCandidate` to prevent the classifier from mislabeling the upgrade tracking issue.
- The `precomputedDecision` path in `classifyAndSpawnWorkflow` (cron) is unaffected — the cron supplies its own context via `precomputedDecision` and ignores the new `gitContext` param.

## Configuration

Server port defaults to `process.env.PORT || 8001`. `GITHUB_WEBHOOK_SECRET` enables signature validation. GitHub App auth is activated at startup. The `PR_REVIEW_COOLDOWN_MS` and `ISSUE_COOLDOWN_MS` cooldowns are module-level constants (60 000 ms each). The server listens on `0.0.0.0`. `.env` is loaded at the top of `trigger_webhook.ts` via an explicit `import '../core/environment'`.

## Gotchas

- **Per-command auth cutover is still pending (story 7):** the per-event `GitContext` is now the auth/scoping authority for path resolution and immutable context capture, but in-process `gh` helper calls (`checkIssueEligibility`, `isAdwRunningForIssue`, `fetchIssueCommentsRest`, etc.) still read the process-global `GH_TOKEN` (refreshed transitionally inside `buildLaunchGitContext` via `ensureAppAuthForRepo`). Full elimination of the process-global bleed for those calls is the next PRD slice.
- **`pull_request*` spawn paths do not receive `eventGitContext`:** they `spawnDetached` with `--target-repo` args; the spawned child re-derives its own context from those args at its own launch boundary. No in-process takeover on that path, so no context needed.
- **`webhookRepoResolver.ts` cannot be bypassed for testing:** `trigger_webhook.ts` starts an HTTP server on import, so it cannot be imported by a unit test. `resolveWebhookRepo` is extracted precisely to provide a directly importable, I/O-free seam for the per-event boundary test (`webhookRepoResolver.test.ts`).
- **Two-context isolation is proven at the command boundary:** `webhookRepoResolver.test.ts` injects a recording `exec` into each context's `GitContextDeps` and asserts that each context's `defaultBranch()` records its own token and its own `basePath` — including immunity to a mid-flight `process.env.GH_TOKEN` overwrite (vestmatic #181 bleed) and to interleaved two-repo execution.
- The `issue_comment` handler is fully async via `.then().catch()` but the HTTP response is sent immediately (`status: processing`). Errors in the async continuation are logged but not surfaced to the client.
- The `pull_request_review` handler ignores `approved` reviews by design; ADW relies on the cron + `adwMerge.tsx` path to poll approval state, not real-time merge-on-approve.
- When port 8001 is in use and `GITHUB_WEBHOOK_SECRET` is set (tunnel mode), the server throws instead of falling back to a random port — a tunnel must have a fixed port.
- `recentPrReviewTriggers` and `recentIssueTriggers` are in-memory maps and reset on server restart; rapid consecutive events within the cooldown window after a restart may both be processed.
