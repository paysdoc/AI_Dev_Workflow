---
status: accepted
date: 2026-04-20
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: specs/prd/orchestrator-coordination-resilience.md
  - kind: contemporaneous
    source: specs/issue-459-adw-x3p7tf-orchestrator-resilie-sdlc_planner-document-single-host-constraint.md
  - kind: contemporaneous
    source: README.md, "Key design decisions" (commit 045b1f56, 2026-05-12) and "Single-host constraint" (commit f5eb9339, 2026-04-20)
supersedes: []
superseded-by: []
---

# One host runs the triggers for a repo; this is a convention and the code does not enforce it

## Context and Problem Statement

The coordination design of [ADR-0034](0034-coordination-kernel.md) had to settle where the truth about a running workflow lives. A lock file, a PID with its start time, a heartbeat written to a state file and a worktree reset all exist on one machine. If two machines ran the cron or webhook trigger for the same repository, none of these would see the other machine. The design needed either coordination across hosts or a rule that makes it unnecessary.

The decision covers where `adws/triggers/trigger_cron.ts` and `adws/triggers/trigger_webhook.ts` may run.

## Decision Drivers

* Keep the coordination primitives simple and local.
* Make the limit visible to whoever sets up a second machine.

## Considered Options

* Coordinate across hosts in code.
* A canonical-registration protocol in issue comments, which would be visible from any host.
* Accept one host per repo as a deployment convention, and document it.

## Decision Outcome

Chosen option: "one host per repo as a deployment convention". The PRD states it as the first of its four grounding observations: "for a given repo, only one host runs the ADW triggers. This is a deployment convention, not a code-enforced constraint, and the design accepts this." Cross-host coordination was placed out of scope as a "deployment-level constraint, not code-level". The comment protocol was rejected "once the single-host-per-repo invariant was accepted".

The PRD gives no further reason. The README section "Key design decisions", written three weeks later, does: "cross-host distributed locking adds complexity disproportionate to the benefit — one team, one repo, one host suffices."

The rule is per repository. One host may run a cron process for each of several repositories. Running two hosts against one repository is, in the words that #459 required of the documentation, "undefined territory" and not merely degraded performance. The documented escape hatch is the `## Cancel` directive ([ADR-0032](0032-explicit-cancel-and-retry-directives.md)).

### Consequences

* Good, because lock, liveness, heartbeat and reset need no network and no shared store.
* Good, because the takeover decision can be tested with local doubles.
* Bad, because nothing stops a second host. The failure is silent until duplicate comments, branches or PRs appear.
* Bad, because ADW cannot be scaled out or made redundant by adding a host for the same repo.
* Bad, because a development machine must point at a fork or a test repo, never at a repo that a production host serves.

### Confirmation

Checked on 2026-09-29.

* `README.md` and `adws/README.md` each have a section "Single-host constraint". Both say the rule is not enforced by code.
* A search of `adws/` for `hostname` finds two uses. `adws/core/authGate.ts` writes the host name into the gate record and never compares it. `adws/core/sshCloneUrl.ts` reads the host of a URL. No code compares hosts or refuses to start on a second host.
* The spawn lock is a file under the local state directory (`getSpawnLockFilePath` in `adws/triggers/spawnGate.ts`), and `adws/triggers/cronProcessGuard.ts` keeps one cron process per repo on a host by a local PID file.
* There is no test or CI gate for this decision, and there cannot be one: it is a rule about deployment.

## More Information

* The constraint was restated on 2026-09-25: the PRD for [ADR-0055](0055-rate-limit-structured-signals-two-tier-wait.md) lists "Cross-host coordination. The single-host constraint stands." under out of scope. The same PRD deals with several cron processes on one host, which share one pause queue, by giving each queue entry to the cron of its own repo.
* The process-group kill of the agent watchdog relies on a POSIX host (#521, [ADR-0023](0023-context-exhaustion-is-a-reset.md)).
* `adws/README.md` describes how to recognise a split brain and how to recover: stop the triggers on the second host, post `## Cancel` on each affected issue, and confirm that one host remains.
