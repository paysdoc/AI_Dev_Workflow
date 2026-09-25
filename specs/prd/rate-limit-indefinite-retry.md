# PRD: Indefinite Retry on Rate Limits

## Problem Statement

When a pipeline agent is rejected by a Claude rate limit, the orchestrator pauses correctly, but the machinery that is supposed to bring it back does not. The operator's experience is that a workflow "paused due to a rate limit" simply never comes back, and no GitHub comment they can post will revive it.

Two production incidents established the shape of the failure:

- On 2026-09-22, issue #840's chore orchestrator hit a five-hour session limit at 11:57 UTC with a machine-readable reset time of 12:50 UTC in the agent's own output. The pause-queue scanner evicted the entry at 12:06 UTC, 44 minutes before the limit reset, after three probe results it could not classify. Two cron processes were scanning the same queue and burned two of those three strikes 1.9 seconds apart. The workflow was left in a `paused` stage that nothing in the system will ever touch again. The operator posted `## Retry` and `## continue`; neither is recognised for a paused workflow.
- On 2026-09-24, six chore workflows (#871, #872, #874 to #877) were stranded the same way within fifteen minutes of pausing, and while stranded they counted against the per-repo concurrency cap and starved the issues behind them.

Root causes, all verified against the code and the incident logs:

1. The probe that decides whether capacity has returned matched the CLI's human-readable text against a hand-kept string list, and could not see stdout at all when the CLI exited non-zero. PR #903 (issue #902) replaced this with a structural classifier that feeds the probe's stream-json output through the shared parser. That fixes the misclassification, but it extended the string list rather than removing it, treats an authentication failure as a rate limit, and still discards the reset time the CLI provides.
2. The reset time (`resetsAt`) is present in the rate-limit event at pause time and is thrown away. The scanner probes blindly on a fixed cadence for the whole duration of a multi-hour limit.
3. Every cron process on the host scans every pause-queue entry. The strike budget is shared and nondeterministic across crons, and the resume path acquires and releases the spawn lock before spawning, then waits two seconds before removing the entry, so two crons scanning inside that window can each spawn an orchestrator for the same issue.
4. The `paused` stage is classified as terminal. The takeover handler skips it, the cron filter marks it ineligible, and the only directive handler (`## Retry`) acts solely on `merge_blocked`. Once the queue entry is gone, the only recovery is a manual respawn on the cron host or a full `## Cancel`.
5. The stream-json envelope that all of this depends on has no stability guarantee from Anthropic. The repo already contains a probed envelope schema with a conformance checker and fixtures, but nothing runs it, the schema was last probed six months ago, it does not know the rate-limit event or the error fields on the result envelope, and its error fixture uses field names the CLI no longer emits.

The user's requirement is simple: when a rate limit occurs, keep retrying until it clears, without human intervention, and give the human a GitHub directive that works when automation has given up for a non-rate-limit reason.

## Solution

A rate-limited workflow waits as long as it takes, in the cheapest place available, and never loses track of when it may try again.

- The orchestrator learns the limit type and reset time from the agent's structured output. For a five-hour window with a known reset time it stays alive, keeps its worktree, lock, and heartbeat, sleeps until the reset time, re-runs the phase, and repeats forever. It tells the issue what it is waiting for and how many attempts it has made.
- For any other case (a seven-day window, an overload, a repeated server error, or an unknown limit type) it exits and enqueues as today, but the queue entry now carries the reset time when one is known, and the scanner does not probe before it.
- The probe classifies from structured signals only, ranked by how much of a contract they have: the documented `api_retry` error enum and HTTP status codes first, the undocumented rate-limit event second and only to obtain a reset time. Text matching is removed. Output with no JSON is `unknown`.
- A confirmed rate limit never counts against any budget. Only a confirmed non-rate-limit probe result (including an authentication failure) counts toward a finite strike budget, after which the entry is evicted with a comment telling the human exactly what to post.
- Each cron scans only the entries that belong to its own target repo, so the strike budget and the resume are owned by exactly one process.
- `## Retry` on a `paused` workflow drops any queue entry and respawns the orchestrator immediately.
- The stream-json envelope the whole path depends on is guarded by a CI conformance gate against a pinned CLI version, with a rate-limited fixture, so a change in the CLI's output fails a build instead of stranding workflows.

## User Stories

1. As an ADW operator, I want a workflow that hits a five-hour session limit to resume by itself after the limit resets, so that I never have to notice or intervene.
2. As an ADW operator, I want the orchestrator to wait for the exact reset time the CLI reports rather than polling blindly, so that recovery is prompt and the probe does not itself consume capacity.
3. As an ADW operator, I want a rate-limited workflow to retry indefinitely, so that a long limit is never mistaken for a permanent failure.
4. As an ADW operator, I want the issue to say what the workflow is waiting for and until when, so that I can tell a waiting orchestrator from a hung one.
5. As an ADW operator, I want each retry attempt to be counted in the issue comment, so that a limit that keeps re-triggering is visible without reading host logs.
6. As an ADW operator, I want a seven-day limit or a limit with no known reset time to release the orchestrator process and its worktree, so that a host is not holding resources for days.
7. As an ADW operator, I want a queued entry with a known reset time to be left alone until that time, so that the scanner does not burn probes or log noise for hours.
8. As an ADW operator, I want an overload or repeated server error, which has no reset time, to be probed on the existing cadence until it clears, so that transient outages recover without a human.
9. As an ADW operator, I want a probe that observes a rate limit to refresh the entry's reset time and count no strike, so that a limit that extends itself never leads to eviction.
10. As an ADW operator, I want a probe that fails for a reason that is not a rate limit, such as a broken CLI binary or an expired login, to count toward a finite budget, so that a dead workflow does not sit in the queue forever pretending to wait.
11. As an ADW operator, I want an expired OAuth session to be treated as a confirmed failure rather than a rate limit, so that it evicts and alerts me instead of probing silently forever.
12. As an ADW operator, I want the eviction comment to tell me the exact directive to post, so that recovery is one GitHub comment away.
13. As an ADW operator, I want `## Retry` on a paused workflow to respawn it immediately, so that I do not need shell access to the cron host.
14. As an ADW operator, I want `## Retry` to remove any stale queue entry before respawning, so that the scanner cannot spawn a second orchestrator later.
15. As an ADW operator, I want `## Retry` to be a no-op while the orchestrator is alive and sleeping in-process, so that I cannot accidentally create a duplicate run.
16. As an ADW operator, I want `## Retry` to leave `paused_auth` alone, so that the auth queue's automatic resume after login remains the single path for auth recovery.
17. As an ADW operator, I want `## Retry` to keep working for `merge_blocked` exactly as it does today, so that adding the paused case changes nothing for merges.
18. As an ADW operator running several crons on one host, I want each cron to scan only the pause-queue entries for its own target repo, so that a strike budget is consumed by one process at one cadence.
19. As an ADW operator running several crons on one host, I want exactly one cron to resume a given entry, so that two crons cannot each spawn an orchestrator for the same issue.
20. As an ADW operator, I want the self-host cron to own entries that have no target repo, so that framework workflows are covered by the same rule.
21. As an ADW operator, I want the queue entry removed before the orchestrator is spawned, so that a concurrent scan cannot see and act on an entry whose resume is already in flight.
22. As an ADW operator, I want an orchestrator that dies while sleeping in-process to be recovered by the existing takeover path for a dead process in a running stage, so that a host reboot mid-wait does not strand the issue.
23. As an ADW operator, I want the heartbeat to keep ticking during an in-process wait, so that the hung-orchestrator detector does not kill a healthy waiting process.
24. As an ADW operator, I want a sleeping orchestrator to hold its spawn lock, so that no candidate arriving at the issue can start a competing run.
25. As an ADW operator, I want the in-process wait to happen between agent spawns, so that no per-agent timeout can fire while the orchestrator is waiting.
26. As an ADW operator, I want the probe classification to depend on structured fields rather than the CLI's wording, so that a copy change in the CLI cannot strand workflows again.
27. As an ADW operator, I want structured signals ranked by how much of a contract they carry, with the documented error enum and HTTP status codes first, so that the undocumented rate-limit event can vanish without breaking the pause itself.
28. As an ADW operator, I want probe output that contains no JSON to be classified as unknown, so that the probe never guesses from text.
29. As an ADW operator, I want an unknown probe result to log the tail of the CLI's output, so that the next unrecognised failure is diagnosable from the cron log.
30. As an ADW maintainer, I want the stream parser to capture the rate-limit type and reset time, so that every consumer of the pause path sees the same facts.
31. As an ADW maintainer, I want the rate-limit error raised by an agent run to carry the limit type and reset time, so that the phase runner can decide the wait policy without re-parsing anything.
32. As an ADW maintainer, I want the wait policy to be a pure decision over the rate-limit facts and the clock, so that every branch (five-hour with reset, seven-day with reset, no reset, unknown type) has a unit test.
33. As an ADW maintainer, I want the pause-queue decider to be a pure decision over an entry, the scanning cron's repo, the probe classification, and the clock, so that ownership, the reset-time gate, strike counting, and eviction are each tested in isolation.
34. As an ADW maintainer, I want the scanner and phase runner to be thin shells over those decisions, so that their I/O is the only thing they own.
35. As an ADW maintainer, I want the in-process sleep to go through an injected clock, so that a test can drive the loop through several resets in milliseconds.
36. As an ADW maintainer, I want an envelope conformance gate in CI against a pinned CLI version, so that a change to the stream-json format fails a pull request.
37. As an ADW maintainer, I want the probed envelope schema to include the rate-limit event and the error fields on the result envelope, so that the gate actually covers the fields the pause path reads.
38. As an ADW maintainer, I want a rate-limited fixture captured from a real limit, so that the parser, the probe classifier, and the gate are all tested against the CLI's actual output.
39. As an ADW maintainer, I want the stale error fixture with outdated field names corrected, so that the fixtures reflect what the CLI emits.
40. As an ADW maintainer, I want the parser's overloaded-error match verified against the documented enum value, so that the overloaded branch is known to fire.
41. As an ADW maintainer, I want the CLI stub used by the hermetic regression suite to emit a rate-limit event with a reset time, so that the whole path can be driven without a real limit.
42. As an ADW maintainer, I want the queue entry schema to accept a missing reset time and a missing limit type, so that entries written before this change still load and are handled by the cadence-probe path.
43. As an ADW operator, I want the existing `## Cancel` behaviour untouched, so that scorched-earth recovery remains available in every state.

## Implementation Decisions

### Detection

- The stream parser captures, from the rate-limit event, the limit type and the reset time, in addition to the existing rejected flag. Both are optional in the parser state because the event is undocumented and may disappear.
- The parser's classification of the documented `api_retry` system message is aligned with the published error enum and the HTTP status it carries. The result envelope's HTTP error status is read as an additional, independent signal.
- Signals are ranked: the documented error enum and HTTP status codes (429 rate limit, 529 overloaded, 401 authentication, other 5xx server error) decide whether an agent run is rate-limited or auth-failed; the rate-limit event is consulted only to obtain the limit type and reset time.
- The rate-limit error raised when an agent run is terminated for a rate limit carries the limit type and reset time when known.
- The probe classifier (introduced by #903) returns, alongside its verdict, the reset time and limit type when a rate-limit event was present. Its text-fallback list is removed entirely. Output that contains no parseable JSON is `unknown`. An authentication failure is a confirmed non-rate-limit failure, not `limited`.

### Wait policy

- A new pure module decides, from the rate-limit facts and the current time, one of two actions: wait in-process until a given time, or exit and enqueue with an optional reset time.
- Five-hour limit with a known reset time: wait in-process.
- Every other case, including seven-day limits, unknown limit types, overload, repeated server error, and any limit without a reset time: exit and enqueue.
- The in-process wait lives in the phase runner, wrapping the phase function: on a wait decision it posts a comment stating the wait-until time and the attempt number, sleeps through an injected clock, re-runs the phase, and repeats without bound. The workflow stage is left as the phase's running stage; no new stage is introduced. The spawn lock is held and the heartbeat keeps ticking for the whole wait.
- A second rate limit encountered after an in-process wait is decided afresh by the same policy. If it has no reset time, the orchestrator exits and enqueues regardless of history.

### Pause queue

- The queue entry gains an optional reset time and an optional limit type. Existing entries without them load unchanged and follow the cadence-probe path.
- A new pure decider takes an entry, the scanning cron's repo identity, the probe classification, and the clock, and returns exactly one action: skip because not owner, skip because the reset time has not passed, resume, refresh the reset time, count a strike, or evict.
- Ownership: an entry belongs to the cron whose target repo matches the target repo recorded on the entry. Entries with no target repo belong to the self-host cron. A cron never acts on an entry it does not own.
- A confirmed rate limit never counts a strike. If the probe reports a reset time, the entry's reset time is refreshed.
- Only confirmed non-rate-limit results count toward the existing three-strike budget. Eviction leaves the stage as `paused` and posts an error comment that names the `## Retry` directive as the recovery.
- The scanner becomes a thin shell: read entries, run the probe once per scan, feed each owned entry through the decider, execute the action. On resume, the entry is removed from the queue before the orchestrator is spawned.
- The probe is not run at all when every owned entry is still before its reset time.

### Directive

- `## Retry` on a workflow whose stage is `paused`: remove any queue entry for that adwId, then spawn the orchestrator resolved from top-level state, passing the cron's target repo. The existing `merge_blocked` behaviour is unchanged. `paused_auth` and every running stage remain no-ops.

### Envelope conformance gate

- The existing envelope schema, conformance checker, and fixture updater are revived rather than replaced.
- The schema is re-probed and extended to include the rate-limit event and the result envelope's error fields, from a fixture captured during a real rate limit.
- The stale error fixture is corrected to the field names the CLI emits.
- The conformance check runs in CI against a pinned CLI version. It does not run at cron startup; CLI upgrades on the host outpace cron restarts, so a startup probe would not add coverage.
- The parser's overloaded-error match is checked against the documented enum value as part of reviving the fixtures.

### Hermetic testing support

- The Claude CLI stub used by the regression suite gains a rate-limited response that emits a rate-limit event with a reset time and a result envelope with the 429 status.

## Testing Decisions

A good test here observes an external behaviour: the decision a pure module returns for given inputs, the action a shell executes as recorded at an injected seam, the state file the scanner writes, or the comment posted to the mock GitHub API. A test that asserts on which internal function was called, or that reads source text, is not a good test.

Unit tests are written for the pure modules only:

- The wait policy: every branch over limit type, presence of a reset time, and clock position.
- The pause-queue decider: ownership match and mismatch, self-host ownership of entries without a target repo, reset-time gate before and after, strike counting only for confirmed failures, no strike and reset refresh for a limited probe, eviction at the budget, resume when clear.
- The probe classifier: verdicts and extracted reset facts for a rejected rate-limit event, a 429 result status, an `api_retry` with each documented error value, an authentication failure, a clean result, and output with no JSON.
- The stream parser's capture of limit type and reset time, and its handling of the documented error enum.

The shells (phase runner loop, scanner, retry handler) and the end-to-end regression scenario are left to the implementer's judgement. Prior art: the probe classifier and scanner tests added by #903 use an injected exec seam and a temporary queue file; the pause-and-resume smoke scenario in the regression suite drives the CLI stub and the mock GitHub API; the takeover handler's decision-tree tests show the pattern for a pure decider over injected facts.

## Out of Scope

- Orphaned queue entries whose owning cron is not running. A separate effort is addressing this.
- The review-retry exhaustion path that, on 2026-09-22, produced ten consecutive review blockers followed by a document phase, a commit, and a "PR approved" completion comment on #840. That is a false green and needs its own issue.
- The `gh` 401 failures observed on the cron host on the same day. That is a credential problem on the host.
- Auth-failure recovery. The auth gate, `paused_auth`, and the auth queue scanner remain the sole path for expired logins.
- Any change to `## Cancel`.
- Cross-host coordination. The single-host constraint stands.
- A cron-startup envelope probe.

## Further Notes

- The phrase "rate limit" in this PRD means a rejection surfaced by the CLI as a 429, a session or usage limit, or an overload, as distinct from an authentication failure. The distinction matters because the user explicitly chose a finite budget for confirmed non-rate-limit failures, and #903's classification of auth as limited contradicts that.
- The absence of any stability guarantee for the stream-json envelope is the reason the conformance gate is in scope. Anthropic closed the request for a stable schema as not planned; the documented `api_retry` message is the only written contract, and the design leans on it first.
- The deleted text list was the original root cause of both incidents. Extending it, as #903 did, keeps the same failure class alive under a different wording. Deleting it is a deliberate decision, not an oversight.
- For issue #840 specifically, the immediate recovery path today is a manual respawn on the owning cron host or `## Cancel`. Given the false-green finding, respawning it before that bug is understood will most likely re-enter the same review loop.
