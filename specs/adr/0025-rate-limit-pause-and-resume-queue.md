---
status: accepted
date: 2026-03-26
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: specs/issue-314-adw-chpy1a-orchestrator-refacto-sdlc_planner-generic-pipeline-runner.md
  - kind: contemporaneous
    source: specs/issue-315-adw-gcisck-robustness-hardening-sdlc_planner-retry-logic-resilience.md
supersedes: []
superseded-by: ["0055"]
---

# A rate-limited workflow pauses into a queue and is resumed by the cron trigger

## Context and Problem Statement

Before #314, a rate limit, a billing limit or an API outage reported by the Claude CLI ended the workflow. The plan for #314 states the cost: the workflow "posts an error comment and exits, wasting all prior phase progress". Four orchestrators (`adwBuild`, `adwPatch`, `adwPrReview`, `adwTest`) did not use the shared `runPhase()` path, so a cross-cutting pause could not be added in one place. Issue #315, filed one minute after #314 from an analysis of the logs, listed other transient failures that ended workflows for no good reason.

The decision covers the agent runner, `adws/core/phaseRunner.ts`, `adws/phases/workflowCompletion.ts`, `adws/core/pauseQueue.ts` and the pause-queue scan in the cron trigger.

## Decision Drivers

* Keep the work of the phases that already completed.
* Recover without a human.
* Add the behaviour once, for every agent invocation.

## Considered Options

None recorded.

## Decision Outcome

A rate limit is a pause. The rationale in the plan for #314 is that transient API failures should not cost the progress of a multi-phase workflow.

As decided in #314:

* The agent runner detects a rate limit and throws `RateLimitError`. The plan notes that this gives every agent invocation the detection, "no need to modify each individual agent runner". Detection was by matching strings in the CLI output.
* `runPhase()` catches the error and calls `handleRateLimitPause()`, which writes the stage `paused`, appends an entry to `agents/paused_queue.json`, posts a "Paused" comment and exits with code 0. Exit code 0 sets a pause apart from `handleWorkflowError`, which exits with 1.
* The queue file is shared by all repos and workflows on the host and is written by write-to-temp and rename.
* The cron trigger scans the queue every `PROBE_INTERVAL_CYCLES` cycles (default 15) and probes with a one-turn `claude` ping. A successful probe removes the entry, posts "Resumed" and respawns the original orchestrator with the same adwId. A probe that fails for a reason that is not a rate limit counts toward `MAX_UNKNOWN_PROBE_FAILURES` (default 3), after which the entry is removed and an error comment is posted.
* Phases are recorded by name when they complete, and a resumed orchestrator skips them.
* The four outlier orchestrators were moved onto `runPhase()`.

#315 added retry with backoff for transient failures that do not need a pause: `execWithRetry` (three attempts) for `gh` calls, three attempts with path re-resolution when the Claude CLI binary is missing, a pre-flight check for the CLI, worktrees created from `origin/<default>`, reuse of an existing PR, and graceful degradation when an agent returns text where JSON was expected.

### Consequences

* Good, because a workflow survives a limit with its completed phases intact.
* Good, because the pause path is one code path for all orchestrators that use `runPhase()`.
* Bad, because a paused workflow lives in a queue file and not only in top-level state. When the entry is lost, the stage `paused` stays behind and nothing acts on it. The incidents of 2026-09-22 and 2026-09-24 that led to [ADR-0055](0055-rate-limit-structured-signals-two-tier-wait.md) were of this kind.
* Bad, because the probe spends a CLI call on every probing cycle for as long as the limit lasts.
* Bad, because one queue file is read and written by every cron process on the host.

### Confirmation

Checked on 2026-09-29 by reading the code.

* `adws/core/pauseQueue.ts` exists with `PAUSE_QUEUE_PATH = 'agents/paused_queue.json'` and an atomic writer.
* `handleRateLimitPause` in `adws/phases/workflowCompletion.ts` writes `workflowStage: 'paused'`, appends the queue entry and calls `process.exit(0)`.
* `adws/core/config.ts` defines `PROBE_INTERVAL_CYCLES` (15) and `MAX_UNKNOWN_PROBE_FAILURES` (3).
* `runPhase` in `adws/core/phaseRunner.ts` skips a phase that is already completed.
* `adws/triggers/__tests__/pauseQueueScanner.test.ts` exists; it was not run. No CI workflow runs the unit tests.

## More Information

Partly superseded by [ADR-0055](0055-rate-limit-structured-signals-two-tier-wait.md). These parts no longer hold:

* Detection by matching text in the CLI output, in the agent runner and in the probe. Detection now reads structured fields only.
* Always exiting on a rate limit. A five-hour limit with a known reset time is now waited out inside the orchestrator process.
* Probing on a fixed cadence for the whole length of a limit. An entry with a known reset time is not probed before that time.
* Every cron process acting on every entry. An entry now belongs to the cron of its own target repo.
* Removing the entry after the orchestrator is spawned. The entry is now removed first.
* A confirmed rate limit can no longer lead to eviction, and an evicted or stranded `paused` workflow can be respawned with `## Retry` ([ADR-0032](0032-explicit-cancel-and-retry-directives.md)).

These parts still hold: the `paused` stage, the queue file and its path, exit code 0, the cron-side probe for entries without a reset time, the three-strike budget for failures that are not rate limits, and skipping completed phases on resume.

Related: [ADR-0020](0020-shared-phase-runner-and-core-decomposition.md) for the phase runner, [ADR-0034](0034-coordination-kernel.md) for the check that a resume still owns the claim on its issue (#466), [ADR-0039](0039-host-wide-auth-gate.md) for authentication failures, which #314 had grouped with rate limits.
