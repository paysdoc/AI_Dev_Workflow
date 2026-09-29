---
status: accepted
date: 2026-09-25
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: specs/prd/rate-limit-indefinite-retry.md
  - kind: contemporaneous
    source: specs/issue-907-*.md to specs/issue-912-*.md
  - kind: transcript
    source: Claude Code session 36757ede, 2026-09-22 and 2026-09-25
supersedes: ["0025"]
superseded-by: []
---

# Rate limits are read from structured signals and waited out without limit, in the process or in the queue

## Context and Problem Statement

The pause and resume of [ADR-0025](0025-rate-limit-pause-and-resume-queue.md) paused correctly and then failed to bring workflows back. On 2026-09-22 the chore run for #840 hit a five-hour limit at 11:57 UTC. The agent's output carried the reset time, 12:50 UTC. The scanner evicted the queue entry at 12:06 after three probe results it could not classify; two cron processes scanning the same queue had used two of the three strikes 1.9 seconds apart. On 2026-09-24 six chore workflows were stranded the same way, and while stranded they counted against the concurrency cap of their repo.

The PRD names five causes: the probe matched the CLI's wording against a hand-kept list; the reset time was thrown away; every cron scanned every entry; `paused` was terminal and no directive could revive it; and the stream-json envelope that all of this reads has no stability guarantee.

The owner's requirement: "I need the orchestrator to keep on retrying indefinitely when a rate limit occurs."

## Decision Drivers

* A rate limit is never a permanent failure.
* A change of wording in the CLI must not strand workflows.
* One process owns the strike budget and the resume of an entry.
* A host must not hold a process and a worktree for days.

## Considered Options

* Keep the text list and extend it, as PR #903 had done.
* Classify from structured fields only.
* Check the envelope at cron start-up.
* Check the envelope in CI against a pinned CLI version.

## Decision Outcome

Chosen options: "structured fields only" and "CI against a pinned version". On text matching the owner said: "This is brittle because the API can change again", and decided: "Delete the text list and add the jsonl gate to the PRD. conformance gate on CI only - cadence is often smaller than cron restart". The PRD calls the deletion "a deliberate decision, not an oversight".

* Signals are ranked by how much of a contract they carry. The documented `api_retry` error values and HTTP status codes (429, 529, 401, other 5xx) decide what happened. The undocumented rate-limit event is read only for the limit type and the reset time. Output without JSON is `unknown`. An authentication failure is a confirmed failure and never a limit ([ADR-0039](0039-host-wide-auth-gate.md)).
* Tier one, in the process. For a five-hour limit with a known reset time the orchestrator stays alive, keeps worktree, lock and heartbeat, posts a comment with the wait-until time and the attempt number, sleeps until the reset time, re-runs the phase, and repeats without bound. No new stage is written.
* Tier two, in the queue. Every other case (seven-day limit, unknown type, overload, repeated server error, no reset time) exits and enqueues as before. The entry carries the reset time when known, and the scanner does not probe before it.
* A confirmed rate limit never counts a strike. Eviction leaves the stage `paused` and its comment names `## Retry`.
* Each cron acts only on the entries of its own target repo. Entries without a target repo belong to the self-host cron. The entry is removed before the orchestrator is spawned.
* `## Retry` on a `paused` workflow drops the queue entry and respawns ([ADR-0032](0032-explicit-cancel-and-retry-directives.md)).
* The wait policy and the queue decider are pure functions; the phase runner and the scanner are shells around them.

### Consequences

* Good, because a five-hour limit is resumed at the reported time with no probe and no human.
* Good, because two crons can no longer strike or resume the same entry.
* Good, because the undocumented event can disappear and the pause still works, by the documented signals.
* Bad, because an orchestrator may sleep for hours while it holds its lock and counts as running.
* Bad, because rate limit, overload and auth signals now act on the first retry. The plan for #907 records that some first retries used to clear by themselves, so "a few one-second transients now cause a pause and a phase restart".
* Bad, because the attempt counter lives in memory and restarts at 1 after a takeover.
* Bad, because entries whose owning cron is not running are left alone; the PRD puts them out of scope.

### Confirmation

Checked on 2026-09-29.

* `adws/triggers/rateLimitProbe.ts` classifies through the shared stream parser and has no text fallback. A search of the non-test code under `adws/` for string or regex matches on limit wording found none.
* `adws/core/rateLimitWaitPolicy.ts` (`decideRateLimitWait`), the wait loop in `runPhase` and `runPhasesParallel`, `adws/triggers/pauseQueueDecider.ts`, the remove-before-spawn in `adws/triggers/pauseQueueResume.ts`, and the `paused` case in `adws/triggers/retryHandler.ts` exist and were read.
* Vitest run of `rateLimitWaitPolicy.test.ts`, `pauseQueueDecider.test.ts` and `rateLimitProbe.test.ts` passed. `phaseRunner.test.ts`, `pauseQueueScanner.test.ts` and `retryHandler.test.ts` were not run.
* CI gate: `.github/workflows/envelope-conformance.yml` runs on every pull request and on pushes to `dev` and `main`, pins CLI 2.1.282 and runs `bun run jsonl:check`. Its last ten runs, up to 2026-09-28, succeeded (`gh run list`).
* The repository has no required status checks, so a failing gate is visible on a pull request and does not block the merge.

## More Information

* Unresolved: the live leg of the gate (`bun run jsonl:probe:check` against the pinned CLI) runs only when the secret `ANTHROPIC_API_KEY` is set. `gh secret list` on 2026-09-29 shows no such secret, so the leg is skipped with a warning and the run is green. The plan for #909 listed creating the secret as a decision for the human. Whether running without the live leg is intended is not recorded. The same plan notes that a probe with an API key never sees the rate-limit event, which is why that part of the schema is curated by hand from a captured fixture.
* The PRD says only confirmed non-rate-limit results count a strike. In the code a `failed` and an `unknown` probe result both count. The plan for #910 records this as a decision: a broken CLI binary classifies as `unknown` and must not wait forever. What changed is that no strike can fall before an entry's reset time.
* Partly supersedes [ADR-0025](0025-rate-limit-pause-and-resume-queue.md); that ADR lists what still holds.
* Left out of scope by the PRD: the false green on #840 ([ADR-0048](0048-one-adwid-per-issue-and-review-failed-gate.md)), the `gh` 401 failures on the cron host, any change to `## Cancel`, and coordination across hosts ([ADR-0035](0035-single-host-per-repo.md)).
* The PRD states that Anthropic closed the request for a stable stream-json schema as not planned. This was not checked.
* The sleep is timer-based, so the heartbeat of [ADR-0034](0034-coordination-kernel.md) keeps ticking and the hung detector leaves the waiting process alone. It is cut into slices of at most one minute so that a suspended host or a clock jump is noticed.
