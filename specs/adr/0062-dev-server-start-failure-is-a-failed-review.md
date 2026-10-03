---
status: accepted
date: 2026-10-02
recorded: 2026-10-04
provenance:
  - kind: transcript
    source: "Claude Code session 2dc3e364, 2026-10-01 to 2026-10-04"
supersedes: ["0031"]
superseded-by: []
---

# A dev server that will not start on the issue branch is a failed review; a successful start resets the count

## Context and Problem Statement

[ADR-0031](0031-active-test-phase-passive-review-judge.md) has `withDevServer` retry the start three times and then run the work anyway. With the scenarios of a `web` repository running against that server ([ADR-0061](0061-application-type-decides-evidence-web-repos-run-playwright-bdd.md)), "run anyway" means every scenario errors (verified in the spike of 2026-10-02: with the server down both scenarios error, exit 1) and the failure is reported as a scenario failure, which sends the fix agent after the scenarios instead of the server.

A server that does not start on the issue branch, after the baseline of [ADR-0060](0060-baseline-gate-on-the-base-branch.md) showed that it starts on the base branch, was broken by the change.

The decision covers the dev-server start in the scenario phase of every orchestrator.

## Considered Options

* Run the work anyway after three failed starts (ADR-0031)
* Fail the scenario phase and send the server output to the scenario fix loop
* Treat a failed start as a failed review: the builder gets a blocker with the server output

## Decision Outcome

Chosen: "treat a failed start as a failed review". The owner (2026-10-02): "The adw needs to keep trying. If it doesn't start up it is a hard problem and probably means that the builder made a mistake. In other words, treat a failing start as a failed review. However, once that problem is solved the number of failed reviews resets."

* A failed start produces a review blocker carrying the server's output; the builder fixes it through the review patch loop.
* Each failed start uses one review attempt. When the cap is reached the issue goes to `review_failed` ([ADR-0048](0048-one-adwid-per-issue-and-review-failed-gate.md)).
* When the server starts, the failed-review count resets to zero, so the server problem does not eat the attempts the real review may need.
* The lifecycle itself (process group, probe, kill in `finally`) and the janitor stand.

### Consequences

* Good, because the fix goes to whoever broke the start, with the evidence, rather than to a scenario fix agent facing a wall of connection errors.
* Good, because "run anyway" can no longer produce a scenario verdict that is really a server verdict.
* Bad, because a flaky start (a slow machine, a port in use) now costs a review attempt; the reset limits the damage but does not remove it.
* Bad, because the review attempt counter gains a second writer, which the orchestrators must keep consistent.

### Confirmation

Not yet implemented; carried by `specs/prd/review-proof-redesign.md`. Checked on 2026-10-02 at `origin/dev`: `adws/core/devServerLifecycle.ts` still has `MAX_START_ATTEMPTS = 3` and runs the work after the third failure.

## More Information

* Supersedes, in part, ADR-0031: only the rule "runs the work anyway after 3 failures".
* The baseline start on the base branch is governed by ADR-0060 and parks the issue instead; the review counter is untouched there.
