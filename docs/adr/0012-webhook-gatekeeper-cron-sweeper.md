---
status: accepted
date: 2026-03-09
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: specs/issue-103-adw-refactor-triggers-we-mycisw-sdlc_planner-refactor-webhook-cron-triggers.md
  - kind: contemporaneous
    source: specs/issue-291-adw-wqzfqj-ensurecronprocess-no-sdlc_planner-ensure-cron-before-gates.md
  - kind: contemporaneous
    source: specs/issue-382-adw-lvakyr-remove-webhook-auto-sdlc_planner-simplify-webhook-handlers.md
  - kind: contemporaneous
    source: specs/issue-389-adw-fequcj-fix-fail-open-depend-sdlc_planner-fix-fail-open-dependency-check.md
  - kind: contemporaneous
    source: specs/issue-501-adw-0lhdw4-webhook-call-ensurec-sdlc_planner-ensure-cron-on-every-event.md
  - kind: contemporaneous
    source: specs/issue-776-adw-zbw0v7-webhook-server-dies-sdlc_planner-contain-webhook-event-failures.md
supersedes: []
superseded-by: []
---

# Webhook as real-time gatekeeper, cron as backlog sweeper

## Context and Problem Statement

ADW has two triggers, `adws/triggers/trigger_webhook.ts` and `adws/triggers/trigger_cron.ts`. Before #103 they had "overlapping responsibilities with minimal differentiation beyond the trigger mechanism", no dependency check between issues and no per-repository concurrency limit. Many issues arriving at once could exhaust the host, and an issue could start before the issue it depended on was closed.

## Decision Drivers

* No duplicate processing of one issue by both triggers.
* Issues with open dependencies, or arriving over the concurrency limit, must wait and be picked up later without a human.
* Incident #381 (2026-04-03): an issue blocked by two open issues was started by both triggers after GitHub API calls failed under contention.
* Incident 2026-07-30: one throwing `## Cancel` handler killed the webhook server; GitHub recorded six `502`s over 22 minutes (#776).

## Considered Options

For the trigger roles, none recorded. For failure containment (#776):

* A per-event boundary around the dispatch
* A process-level `process.on('uncaughtException')` handler

## Decision Outcome

The two triggers have distinct roles and share one eligibility check.

* **Webhook, gatekeeper.** It evaluates an event at once and either spawns a workflow or defers silently. It does no orchestration; since #382 it is a thin event relay, and `issues.closed` is the single cleanup point.
* **Cron, sweeper.** One process per repository polls every 20 seconds (`POLL_INTERVAL_MS`), skips issues with activity inside `GRACE_PERIOD_MS` (5 minutes) and picks up whatever was deferred or missed.
* **Shared eligibility.** `checkIssueEligibility` checks open dependencies, then `MAX_CONCURRENT_PER_REPO` (default 5). Transitive dependencies are not resolved.
* **The webhook keeps the cron alive.** `ensureCronProcess` runs once per accepted delivery, before any per-event branch (#291, widened by #501).
* **Fail closed (#389).** A dependency whose state cannot be read counts as open. A webhook handler that fails does not spawn a fallback workflow; the cron re-evaluates the issue.
* **Per-event containment (#776).** Chosen option: "per-event boundary", because a process-level handler "would also swallow genuinely fatal, non-request-scoped errors" and "gives no place to answer the delivery that failed". A synchronous throw is answered `500`; every failure is logged and sent to Slack with event type, repository and issue number.

### Consequences

* Good, because a deferred issue needs no human action: the next sweep re-checks it.
* Good, because a failing event no longer takes the webhook down for the whole host.
* Bad, because `ensureCronProcess` is the only code that starts a cron; a repository that receives no deliveries gets no sweeper unless someone starts one by hand.
* Bad, because a failure in an asynchronous continuation cannot be answered `500`: the delivery was already answered `200 processing`.
* Bad, because every contained failure posts to Slack, one alert per GitHub retry, with no deduplication.

### Confirmation

Checked against the code on 2026-09-29:

* `dispatchWebhookEvent` calls `ensureCronProcess` before the first `if (event === ...)` branch; the `req.on('end')` callback wraps it in `try`/`catch` and calls `containEventFailure`.
* `findOpenDependencies` (`adws/triggers/issueDependencies.ts`) pushes the dependency onto `openDeps` in its `catch` block.
* `grep -rn "uncaughtException\|unhandledRejection" adws` returns nothing outside tests.
* `bunx vitest run` on `webhookEventBoundary.test.ts` and `cronIssueFilter.test.ts` passed. `webhookGatekeeper.test.ts` could not be loaded in this checkout because `@paysdoc/devplatform` is not installed in `node_modules`; it was not run.

No CI workflow runs the unit suite (`grep "test:unit\|vitest" .github/workflows/*.yml` returns nothing).

## More Information

* Merging moved from the webhook to the cron in [ADR-0028](0028-orchestrators-stop-at-awaiting-merge.md).
* Which issues the sweeper may pick up by label is recorded in [ADR-0041](0041-label-based-classification.md).
* One cron per repository on one host is recorded in [ADR-0035](0035-single-host-per-repo.md).
* The #389 spec asked for the fail-closed case to be logged at level `error`; the code logs it at `warn`.
