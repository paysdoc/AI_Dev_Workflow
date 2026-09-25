@adw-912 @adw-kdrab9-in-process-wait-and
Feature: A five-hour session limit with a known reset time is ridden out in-process — a pure wait policy decides, the phase runner announces each wait on the issue and sleeps through an injected clock until the reset time, re-running the phase without bound while the workflow stays running, heartbeating and lock-holding, and every other rejection still exits through the pause path

  Issue #912 is the wait-policy slice of `specs/prd/rate-limit-indefinite-retry.md` (section
  "Wait policy"; user stories 1–6, 22–25, 32, 34 and 35).

  On 2026-09-22 the orchestrator for #840 hit a five-hour session limit at 11:57 UTC. The CLI
  reported that the limit would reset at 12:50 UTC. The orchestrator exited to the pause queue
  anyway, and the scanner evicted the entry at 12:06, 44 minutes before the reset. #907 made the
  limit type and the reset time travel on `RateLimitError`, and #910 made the pause queue wait for
  the reset time. For a five-hour window, though, leaving is the expensive choice. The process,
  its worktree, its spawn lock and its heartbeat are all still there, and the wait is under five
  hours.

  What #912 changes:
    • A new pure wait policy (`adws/core/rateLimitWaitPolicy.ts`) takes the rate-limit facts that
      `RateLimitError` carries, and the clock. It returns `{ kind: 'wait_in_process', until }` or
      `{ kind: 'enqueue', resetsAt? }`. A `five_hour` limit with a reset time is waited out
      in-process until that reset time. Everything else is enqueued: a `seven_day` limit, any
      other or unknown limit type, a limit without a reset time, and an overload or server error,
      which carries no facts at all. An enqueue decision carries the reset time whenever the CLI
      reported one.
    • `runPhase` consults the policy when a phase throws `RateLimitError`. On a wait decision it
      posts an issue comment stating the wait-until time (UTC) and the attempt number. It then
      sleeps until that time through an injected clock and re-runs the phase, without bound. On
      an enqueue decision it takes the existing pause path, which queues the entry with the limit
      facts (#910) and exits 0.
    • The wait writes no stage of its own. The top-level stage stays what it was when the limit
      hit, which is the phase's `*_running` stage when the phase runs under its name. The
      heartbeat keeps ticking, the spawn lock stays held, and the wait sits between agent spawns,
      so no per-agent timeout runs. If the process dies mid-wait, takeover branch 8 (a dead PID
      in a running stage) already recovers the workflow.
    • A later rejection is decided afresh by the same policy. Without a reset time the
      orchestrator exits and enqueues, whatever waits came before.

  The labels below are the section numbers used for the scenario groups further down (§1–§5):

    §1  THE WAIT POLICY (AC1; user stories 2, 32). Decision tables over the pure policy, with the
        clock given explicitly. A five-hour limit with a reset time is waited out until exactly
        that time, wherever the clock stands before it. Every other rejection is enqueued, with
        the reset time when there is one.

    §2  RIDING OUT THE LIMIT IN-PROCESS (AC2, AC3; user stories 1–5, 35). The #840 incident is
        replayed: three five-hour rejections in a row, each waited out until its own reset time,
        and then a run that succeeds and completes the phase. The workflow is never paused and
        never queued. Before each wait, a comment names the wait-until time in UTC and the attempt
        number. An outline with more rejections than any retry cap in the codebase shows there is
        no budget.

    §3  STILL A LIVE, RUNNING ORCHESTRATOR (AC4; user stories 22–24). Throughout every wait the
        top-level stage is unchanged and the heartbeat advances `lastSeenAt`, so the
        hung-orchestrator detector stays quiet. The spawn lock turns away every candidate that
        arrives at the issue. This holds for a phase run under its name and for one run
        anonymously, which is how the orchestrators run most of their phases. An orchestrator
        that dies mid-wait is taken over under its adwId, not stranded.

    §4  EVERYTHING ELSE STILL EXITS (AC5; user story 6). A first rejection that is not a
        five-hour limit with a reset time is never waited out. The orchestrator exits 0 through
        the pause path, which queues the facts the CLI reported. After a wait, a later rejection
        is decided afresh, and the same rejections exit the same way.

    §5  BACKSTOPS (AC7). `bun run test` is the type-check. `bun run lint:git-guard` is the git/gh
        guard, which now also runs over the post of the wait comment.

  Each row is written to fail for a specific wrong implementation:
    • the exact-instant rows fail for a wait of a fixed length (five hours after the rejection,
      or the scanner's probe cadence) instead of the reset time the CLI reported, and for any
      margin added to that time;
    • the enqueue rows fail for a policy that waits whenever a reset time is known. A seven-day
      limit would then hold a host, a worktree and a concurrency slot for days;
    • the no-budget rows fail for a retry cap. The caps in the codebase are 3, 5 and 10, so the
      rows use 6 and 12 rejections;
    • "no re-run … started before the reset time it waited for" fails for a re-run that does not
      wait, or that waits for the wrong rejection's reset time;
    • the comment rows fail for a comment posted after the sleep, when it can no longer tell the
      operator anything. They also fail for a comment ADW does not recognise as its own. The
      plan agent and the cron tell ADW's comments from a human's with `isAdwComment`, so an
      unsigned wait comment would reach the plan agent as if a human had written it;
    • the stage rows fail for a new "waiting" stage. `classifyStageString` sends an unknown stage
      to the takeover's `spawn_fresh`, so a crash mid-wait would start the issue over under a new
      adwId. They also fail for a runner that marks the workflow `paused` while it sleeps:
      `## Retry` (#908) respawns a paused workflow, and would start a second orchestrator beside
      the sleeping one. The anonymous row fails for a runner that writes `${phaseName}_running`
      without a phase name;
    • the heartbeat rows fail for a sleep that blocks the event loop or stops the heartbeat. The
      hung-orchestrator detector would then kill a healthy waiting orchestrator;
    • the candidate row fails for a runner that releases the spawn lock while it sleeps, which
      would let a second orchestrator start on the issue;
    • the §4 rows that follow a wait fail for a runner that keeps waiting because it has waited
      before, and for one that re-runs the phase after the pause path.

  ── WHY SOME CRITERIA GET NO SCENARIO OF THEIR OWN ──────────────────────────────────────────
  AC1's unit tests and `bun run test:unit` (AC7) are obligations on the vitest suite, which the
  build and test phases discharge. §1 is their behavioural counterpart here. AC6 ("the existing
  pause/resume smoke scenario in the regression suite stays green") is discharged by the
  `@regression` run. That scenario is not re-tagged: the regression suite changes only by a human
  decision, and its CLI stub emits no rate-limit event, so #912 does not change its path. The
  per-issue guard on the pause path is the four feature-910 rows listed below. User story 25 (no
  per-agent timeout runs during a wait) follows from where the wait sits: between phase
  attempts, outside any agent run. No agent runs in this harness, so a scenario for it would pass
  vacuously. Two edges are left to the unit tests: a reported reset time that is already at or
  behind the clock, and whether the attempt number restarts for each phase. The vitest suite
  also covers three shell details that no criterion names: the same wait around a parallel phase
  group, the default comment poster over the issue tracker, and the paused comment naming the
  limit type and the reset time on the enqueue path.

  Changes to feature-910. Its §1 rows and its end-to-end journey drive the real `runPhase` with a
  seven-day limit, a five-hour limit without a reset time, or no facts at all. Those are exactly
  the rejections #912 still enqueues. The four rows are unchanged, and now also carry `@adw-912`
  as the guard that the enqueue branch still records the limit facts. feature-910's description
  records the amendment.

  How these scenarios observe the system. Every assertion targets a runtime artefact:
    • the decision the pure wait policy returns for given facts and a given clock;
    • the attempts the phase runner makes and the waits it asks of its injected clock, both
      recorded at those seams;
    • the comments the phase runner posts, recorded at its injected comment seam;
    • the top-level state file (`agents/<adwId>/state.json`): its stage and its `lastSeenAt`;
    • the pause-queue state file (`agents/paused_queue.json`);
    • the exit the pause path performs, trapped in process;
    • the decisions the real takeover handler and hung-orchestrator detector reach from those
      artefacts, and the spawn-lock artefact they read.
  No scenario reads, greps or parses a source file.

  Notes for the step definitions:

    • NEVER RUN A REAL AGENT, NEVER SLEEP FOR REAL HOURS. The phase is a fake phase function
      scripted by "the {string} phase meets these outcomes, attempt by attempt:". A
      "rate-limited" attempt throws `new RateLimitError(<phase>, facts)`, with `rateLimitType` as
      given and `resetsAt` in epoch seconds, as #907's parser captures it. An empty cell means the
      key is absent from the facts. A "succeeds" attempt returns a zero-cost `PhaseResult`.
      Record each attempt with the orchestrator's clock reading at its start. "rejected by N
      five-hour limits in a row, the first resetting at X and each later one five hours after
      the one before, and then succeeds" scripts N `five_hour` rejections resetting at X,
      X + 5 h, X + 10 h, …, followed by one success.
    • THE ORCHESTRATOR'S CLOCK is the phase runner's injected clock (user story 35). It is not
      feature-910's scanner clock ("the cron host's clock"). "the orchestrator's clock reads
      {string}" pins it. When the runner asks the clock to wait, the fake clock advances the
      pinned instant to the end of the wait and records that instant. It then keeps the runner
      suspended for a short REAL delay before resolving (see the notes on waits below). If the
      clock is handed a duration rather than an instant, the end is the pinned reading plus the
      duration. Never fake `setTimeout` or `setInterval`: the heartbeat is a real interval timer.
    • THE ORCHESTRATOR. "an orchestrator for issue N in the target repository R is running under
      adwId X" mirrors `runWithOrchestratorLifecycle`:
        – top-level state through `AgentStateManager.writeTopLevelState`: the adwId, the issue
          number, `workflowStage: 'starting'` (what `initializeWorkflow` writes), `pid` =
          `process.pid`, `pidStartedAt` from `getProcessStartTime`, and a `lastSeenAt`;
        – the real spawn lock: `acquireIssueSpawnLock(R, N, process.pid)`;
        – the real heartbeat: `startHeartbeat(X, <interval>)`. The production interval
          (`HEARTBEAT_TICK_INTERVAL_MS`, 30 s) is too slow for a test; 20 ms works;
        – a `WorkflowConfig` built the way feature-910's harness builds one (a throwaway worktree
          and orchestrator state path, `targetRepo` R), plus the seams below.
      Stop the heartbeat when the When step ends. Remove the spawn-lock artefacts in `After`.
    • THE COMMENT SEAM. Record every comment the phase runner posts, at the comment seam it
      exposes (the issue calls it "the injected comment seam"). If that seam is
      `repoContext.issueTracker.commentOnIssue`, supply a recording tracker whose `moveToStatus`
      resolves, because the pause path calls it. The pause path's own paused-stage comment
      (`## :pause_button: ADW Workflow Paused`) then lands at the same seam; it is not a wait
      comment. A wait comment is a comment the in-process wait posts. Never let a comment reach
      GitHub: #840 and #871–#877 are real incident issues on paysdoc/AI_Dev_Workflow, while
      `acme/widgets` is fictional.
    • ONE ORDERED EVENT LOG across the seams: attempt started, comment posted, wait began, wait
      ended. "each wait comment … was posted before the wait it announces began" reads it: wait
      comment k precedes wait k. "no re-run of the {string} phase started before the reset time
      it waited for" reads the attempts: attempt k + 1 starts at an orchestrator-clock reading
      no earlier than the reset time attempt k's rejection reported.
    • WAIT COMMENT CONTENT.
        – "wait-until times in UTC": the body carries the instant either in ISO 8601 with a `Z`
          (`2026-09-22T12:50:00Z`, with or without milliseconds), or as the UTC clock time
          `12:50` followed by `UTC` (seconds optional, optionally preceded by the date
          `2026-09-22`).
        – "attempts" and "attempt numbers": the word "attempt" in any case, then at most a few
          non-digit characters (`#`, `:`, `*`, spaces), then the number as a whole word, so
          "attempt 12" never satisfies 1. Attempt k is the rejected attempt's own number, which
          is the count of attempts made so far.
        – "says the workflow is waiting for a rate limit to reset": the body matches
          /rate[ _-]?limit|five[ _-]?hour|5[ -]?hour|session limit|usage limit/i.
        – "is recognised by ADW as its own comment": `isAdwComment(body)` is true.
    • PROCESS EXIT. The pause path ends the process with `process.exit(0)`. For the whole When
      step, replace `process.exit` with a function that records the code and throws a sentinel.
      Catch the sentinel and restore `process.exit`. Any other throw fails the step. "exited
      with code N" reads the recorded code; "never exited" requires that none was recorded.
    • INSIDE EVERY WAIT, before it resolves, sample the top-level state when the wait begins and
      again when it ends:
        – "recorded workflowStage S throughout every wait": both samples of every wait carry S;
        – "the heartbeat advanced lastSeenAt … during every wait": in every wait, the end
          sample's `lastSeenAt` is strictly later, as an instant, than the begin sample's. Keep
          each wait suspended in real time for several heartbeat intervals;
        – "the hung-orchestrator detector did not report adwId X at the end of any wait": at the
          end of each wait, call `findHungOrchestrators(Date.now(), threshold, deps)` with deps
          that list only X, read the real top-level state, and use real process liveness. Scale
          the threshold to the test heartbeat the way production does (a 30 s heartbeat against
          a 180 s threshold, so six ticks). Keep each wait suspended for longer than the
          threshold, so that a stopped heartbeat WOULD be reported.
      Each of these steps fails when no wait happened at all.
    • CANDIDATES. "a candidate arrives at issue N during every wait" makes each wait run the REAL
      `evaluateCandidate` for issue N. Use a minimal launch boundary for `acme/widgets`, and
      `TakeoverDeps` built from the real spawn-gate functions (`acquireIssueSpawnLock`,
      `releaseIssueSpawnLock`, `readSpawnLockRecord`) with inert stubs for the rest. "every
      candidate … was deferred to the waiting orchestrator": at least one candidate arrived, and
      every decision was `defer_live_holder` naming `process.pid`.
    • DEATH. "the orchestrator process dies during its first wait" makes the first wait never
      resolve. The When step returns as soon as that wait has begun, and the phase runner's
      promise is abandoned. At that moment, stop the heartbeat and leave the artefacts a dead
      orchestrator leaves. Point the top-level state's `pid`/`pidStartedAt` and the spawn-lock
      record at a PID that is really dead: spawn a short-lived child, capture its PID and
      start-time token while it lives, then kill it and wait for it to exit. Touch no other
      field; the stage under test is whatever the phase runner left.
      "the next candidate arrives at issue N" runs the REAL `evaluateCandidate` with the real
      spawn-gate functions, the real top-level state and real process liveness.
        – It resolves the adwId the way the default deps do: `extractLatestAdwId` over the
          issue's comments. Those are a workflow comment naming the adwId (the one the
          orchestrator posts when it starts), followed by the comments recorded at the seam.
        – Stub only what this harness cannot reach: `resetWorktree` and `clearOrphanedIndexLock`
          (recorded), `probeWorktree` (healthy), `deriveStageFromRemote` (any stage),
          `commentOnIssue` (recorded), and `killProcess` (must not be called).
        – The boundary's `gitContext.worktreePathFor` returns the throwaway worktree.
      "the candidate takes the workflow over under adwId X": the decision is `take_over_adwId`
      for X.
    • THE POLICY steps call the real pure policy in process (`adws/core/rateLimitWaitPolicy.ts`
      in the issue's touched files).
        – The facts carry `rateLimitType` as given and `resetsAt` in epoch seconds, as
          `RateLimitError` carries them. An absent fact is an absent key.
        – The clock is the given instant, in whatever form the policy takes (a `Date` or a
          `now()`).
        – Compare every returned time as an instant, whatever its representation (a `Date`,
          epoch seconds or milliseconds, or an ISO 8601 string).
      "decides to wait in-process until T": kind `wait_in_process`, and `until` equals T.
      "decides to enqueue with the reset time T": kind `enqueue`, and `resetsAt` equals T.
      "… with no reset time": kind `enqueue`, and `resetsAt` is absent; `null` or a defaulted
      value fails.
    • THE PAUSE QUEUE is the real `agents/paused_queue.json`, relative to the working directory.
      Save and clear it in `Before`, and restore it in `After`; never clobber an operator's
      queue. "the pause queue holds adwId X with …" reads X's entry: the limit type verbatim, the
      reset time as an instant, and an absent fact as an absent key. "does not hold adwId X"
      requires that there is no entry for X.
    • COUNTS AND WAITS.
        – "the {string} phase ran N time(s)" counts attempts.
        – "waited in-process until each of these times, in order" compares the recorded wait
          ends with the table. "did not wait in-process" requires that none was recorded.
        – "waited in-process N times, each until the reset time reported by the rejection before
          it": N waits, and wait k ends at the reset time attempt k's rejection reported.
        – "exactly N wait comment(s) was/were posted" and "no wait comment was posted" count the
          issue's wait comments.
        – "the wait comments … carry the attempt numbers 1 to N, in order": exactly N wait
          comments, and comment k names attempt k.
    • HOOKS. Scope every hook to `@adw-912 and not @adw-910`. The four feature-910 rows that also
      carry `@adw-912` run under #902's and #910's harness, and a second mock-infrastructure hook
      would initialise it twice.
        – `Before`: initialise `mockContext` with `setupMockInfrastructure()`, because T1 falls
          into a legacy source-inspection branch when it is null. Save and clear the pause queue.
        – `After`: stop any heartbeat and restore `process.exit`. Remove `agents/<adwId>` for
          every adwId used, and the spawn locks of every `acme/widgets` issue used. Restore the
          pause queue, and tear the mock infrastructure down.
    • REUSED, NOT REDEFINED. T1 is defined in the regression suite's thenSteps.ts. T22 and the
      git/gh guard pair are defined in feature-844.steps.ts. Redefining any of them is an
      AmbiguousStepDefinition. (The guard pair is written `git\/gh` there, because "/" means
      alternation in a cucumber expression.)

  Vocabulary note. These registered phrases from `features/regression/vocabulary.md` are reused:
    • G18 `the ADW codebase is checked out`
    • T1  `the state file for adwId {string} records workflowStage {string}`
    • T22 `the ADW TypeScript type-check passes`
  The git/gh guard pair from feature-844 is reused as it is written, as #908 and #910 do. These
  registered phrases are deliberately NOT reused:
    • G5 and T6 name a legacy lock path (`.adw/locks/issue-N.lock`). The spawn lock lives under
      `agents/spawn_locks/`, so T6 would pass vacuously;
    • G6 writes state under a temporary worktree's `.adw/state.json`. The phase runner writes the
      top-level `agents/<adwId>/state.json`;
    • T2, T3 and T14 read the mock GitHub API. The issue fixes the injected comment seam as the
      place where the wait comment is observed;
    • T5 reads a subprocess's exit code. Here the pause path's exit is trapped in process.
  Apart from the guard pair, no unregistered phrase from another per-issue feature is reused.
  Their step definitions are swept with their feature, and several are bound to that feature's
  own world. In particular, feature-910's "the cron host's clock reads {string}" pins the
  scanner's clock, not the phase runner's. The registry has no phrase for the following, so
  novel phrasing is introduced for them: the orchestrator's clock; the running orchestrator; the
  scripted phase outcomes; the phase runner's When; the death and candidate Givens; attempt
  counts; waits; wait comments; the exit; the stage, heartbeat, detector and candidate
  assertions; the pause-queue entry by adwId; and every policy step.

  Background:
    Given the ADW codebase is checked out

  # ── §1 THE WAIT POLICY ─────────────────────────────────────────────────────────────────────────

  @adw-912 @adw-kdrab9-in-process-wait-and
  Scenario Outline: A five-hour limit with a known reset time is waited out in-process until exactly the reset time the CLI reported, wherever the clock stands before it
    Given rate-limit facts with a "five_hour" limit that resets at "<resets at>"
    When the rate-limit wait policy decides at "<now>"
    Then the wait policy decides to wait in-process until "<resets at>"

    Examples:
      | now                  | resets at            |
      | 2026-09-22T11:57:00Z | 2026-09-22T12:50:00Z |
      | 2026-09-22T12:49:59Z | 2026-09-22T12:50:00Z |
      | 2026-09-22T12:50:00Z | 2026-09-22T17:50:00Z |

  @adw-912 @adw-kdrab9-in-process-wait-and
  Scenario Outline: Every other rejection is enqueued for the pause-queue scanner, carrying the reset time whenever the CLI reported one
    Given rate-limit facts with <facts>
    When the rate-limit wait policy decides at "2026-09-22T11:57:00Z"
    Then the wait policy decides to enqueue <carrying>

    Examples:
      | rejection                             | facts                                                          | carrying                                   |
      | seven-day window                      | a "seven_day" limit that resets at "2026-09-28T07:00:00Z"      | with the reset time "2026-09-28T07:00:00Z" |
      | seven-day window, no reset time       | a "seven_day" limit and no reset time                          | with no reset time                         |
      | five-hour window, no reset time       | a "five_hour" limit and no reset time                          | with no reset time                         |
      | a weekly window of another kind       | a "seven_day_opus" limit that resets at "2026-09-28T07:00:00Z" | with the reset time "2026-09-28T07:00:00Z" |
      | a limit type ADW does not know        | a "monthly" limit that resets at "2026-10-01T00:00:00Z"        | with the reset time "2026-10-01T00:00:00Z" |
      | a reset time without a limit type     | no limit type and a reset time of "2026-09-22T12:50:00Z"       | with the reset time "2026-09-22T12:50:00Z" |
      | no facts: an overload or server error | no limit type and no reset time                                | with no reset time                         |

  # ── §2 RIDING OUT THE LIMIT IN-PROCESS ─────────────────────────────────────────────────────────

  @adw-912 @adw-kdrab9-in-process-wait-and
  Scenario: Replaying #840 — three five-hour rejections in a row are each waited out in-process until the reset time the CLI reported, and the fourth run completes the phase without the workflow ever being paused
    Given the orchestrator's clock reads "2026-09-22T11:57:00Z"
    And an orchestrator for issue 840 in the target repository "acme/widgets" is running under adwId "wait912-840"
    And the "build" phase meets these outcomes, attempt by attempt:
      | attempt | outcome      | limit type | resets at            |
      | 1       | rate-limited | five_hour  | 2026-09-22T12:50:00Z |
      | 2       | rate-limited | five_hour  | 2026-09-22T17:50:00Z |
      | 3       | rate-limited | five_hour  | 2026-09-22T22:50:00Z |
      | 4       | succeeds     |            |                      |
    When the phase runner runs the "build" phase
    Then the "build" phase ran 4 times
    And the orchestrator waited in-process until each of these times, in order:
      | waits until          |
      | 2026-09-22T12:50:00Z |
      | 2026-09-22T17:50:00Z |
      | 2026-09-22T22:50:00Z |
    And no re-run of the "build" phase started before the reset time it waited for
    And the orchestrator never exited
    And the state file for adwId "wait912-840" records workflowStage "build_completed"
    And the pause queue does not hold adwId "wait912-840"

  @adw-912 @adw-kdrab9-in-process-wait-and
  Scenario: Replaying #840 — before each wait, a comment ADW recognises as its own tells the issue, in UTC, until when the workflow waits and which attempt the limit rejected
    Given the orchestrator's clock reads "2026-09-22T11:57:00Z"
    And an orchestrator for issue 840 in the target repository "acme/widgets" is running under adwId "wait912-840"
    And the "build" phase meets these outcomes, attempt by attempt:
      | attempt | outcome      | limit type | resets at            |
      | 1       | rate-limited | five_hour  | 2026-09-22T12:50:00Z |
      | 2       | rate-limited | five_hour  | 2026-09-22T17:50:00Z |
      | 3       | rate-limited | five_hour  | 2026-09-22T22:50:00Z |
      | 4       | succeeds     |            |                      |
    When the phase runner runs the "build" phase
    Then exactly 3 wait comments were posted on issue 840
    And the wait comments on issue 840 name these attempts and wait-until times in UTC, in order:
      | attempt | waits until          |
      | 1       | 2026-09-22T12:50:00Z |
      | 2       | 2026-09-22T17:50:00Z |
      | 3       | 2026-09-22T22:50:00Z |
    And each wait comment on issue 840 was posted before the wait it announces began
    And every wait comment on issue 840 says the workflow is waiting for a rate limit to reset
    And every wait comment on issue 840 is recognised by ADW as its own comment

  @adw-912 @adw-kdrab9-in-process-wait-and
  Scenario Outline: There is no retry budget — however many five-hour limits reject the phase in a row, each is waited out in-process, and the phase completes when a run finally succeeds
    Given the orchestrator's clock reads "2026-09-22T11:57:00Z"
    And an orchestrator for issue 877 in the target repository "acme/widgets" is running under adwId "wait912-877"
    And the "build" phase is rejected by <limits> five-hour limits in a row, the first resetting at "2026-09-22T12:50:00Z" and each later one five hours after the one before, and then succeeds
    When the phase runner runs the "build" phase
    Then the "build" phase ran <runs> times
    And the orchestrator waited in-process <limits> times, each until the reset time reported by the rejection before it
    And the wait comments on issue 877 carry the attempt numbers 1 to <limits>, in order
    And the orchestrator never exited
    And the state file for adwId "wait912-877" records workflowStage "build_completed"
    And the pause queue does not hold adwId "wait912-877"

    Examples:
      | limits | runs |
      | 6      | 7    |
      | 12     | 13   |

  # ── §3 STILL A LIVE, RUNNING ORCHESTRATOR ──────────────────────────────────────────────────────

  @adw-912 @adw-kdrab9-in-process-wait-and
  Scenario Outline: While it waits, a workflow whose phase runs under its name stays in that phase's running stage and keeps its heartbeat, so the hung-orchestrator detector never mistakes it for a wedged process
    Given the orchestrator's clock reads "2026-09-22T11:57:00Z"
    And an orchestrator for issue 871 in the target repository "acme/widgets" is running under adwId "wait912-871"
    And the "<phase>" phase meets these outcomes, attempt by attempt:
      | attempt | outcome      | limit type | resets at            |
      | 1       | rate-limited | five_hour  | 2026-09-22T12:50:00Z |
      | 2       | rate-limited | five_hour  | 2026-09-22T17:50:00Z |
      | 3       | succeeds     |            |                      |
    When the phase runner runs the "<phase>" phase
    Then the state file for adwId "wait912-871" recorded workflowStage "<phase>_running" throughout every wait
    And the heartbeat advanced lastSeenAt in the state file for adwId "wait912-871" during every wait
    And the hung-orchestrator detector did not report adwId "wait912-871" at the end of any wait
    And the orchestrator never exited
    And the state file for adwId "wait912-871" records workflowStage "<phase>_completed"

    Examples:
      | phase   |
      | build   |
      | stepDef |

  @adw-912 @adw-kdrab9-in-process-wait-and
  Scenario: A phase run anonymously, as the orchestrators run most of their phases, keeps the stage the workflow already had throughout every wait — the wait never writes a stage of its own
    Given the orchestrator's clock reads "2026-09-22T11:57:00Z"
    And an orchestrator for issue 872 in the target repository "acme/widgets" is running under adwId "wait912-872"
    And the state file for adwId "wait912-872" records workflowStage "starting"
    And the "plan" phase meets these outcomes, attempt by attempt:
      | attempt | outcome      | limit type | resets at            |
      | 1       | rate-limited | five_hour  | 2026-09-22T12:50:00Z |
      | 2       | succeeds     |            |                      |
    When the phase runner runs the "plan" phase anonymously
    Then the "plan" phase ran 2 times
    And the state file for adwId "wait912-872" recorded workflowStage "starting" throughout every wait
    And the heartbeat advanced lastSeenAt in the state file for adwId "wait912-872" during every wait
    And the orchestrator never exited
    And the state file for adwId "wait912-872" records workflowStage "starting"
    And the pause queue does not hold adwId "wait912-872"

  @adw-912 @adw-kdrab9-in-process-wait-and
  Scenario: The waiting orchestrator keeps the issue's spawn lock, so every candidate that arrives at the issue during a wait defers to it instead of starting a competing run
    Given the orchestrator's clock reads "2026-09-22T11:57:00Z"
    And an orchestrator for issue 874 in the target repository "acme/widgets" is running under adwId "wait912-874"
    And the "build" phase meets these outcomes, attempt by attempt:
      | attempt | outcome      | limit type | resets at            |
      | 1       | rate-limited | five_hour  | 2026-09-22T12:50:00Z |
      | 2       | rate-limited | five_hour  | 2026-09-22T17:50:00Z |
      | 3       | succeeds     |            |                      |
    And a candidate arrives at issue 874 during every wait
    When the phase runner runs the "build" phase
    Then every candidate that arrived at issue 874 during a wait was deferred to the waiting orchestrator
    And the "build" phase ran 3 times
    And the state file for adwId "wait912-874" records workflowStage "build_completed"

  @adw-912 @adw-kdrab9-in-process-wait-and
  Scenario: An orchestrator that dies while it waits leaves its workflow in the running stage, so the next candidate at the issue takes it over under its adwId instead of leaving it stranded or starting it afresh
    Given the orchestrator's clock reads "2026-09-22T11:57:00Z"
    And an orchestrator for issue 876 in the target repository "acme/widgets" is running under adwId "wait912-876"
    And the "build" phase meets these outcomes, attempt by attempt:
      | attempt | outcome      | limit type | resets at            |
      | 1       | rate-limited | five_hour  | 2026-09-22T12:50:00Z |
      | 2       | succeeds     |            |                      |
    And the orchestrator process dies during its first wait
    When the phase runner runs the "build" phase
    Then the state file for adwId "wait912-876" records workflowStage "build_running"
    And the pause queue does not hold adwId "wait912-876"
    When the next candidate arrives at issue 876
    Then the candidate takes the workflow over under adwId "wait912-876"

  # ── §4 EVERYTHING ELSE STILL EXITS ─────────────────────────────────────────────────────────────

  @adw-912 @adw-kdrab9-in-process-wait-and
  Scenario Outline: A first rejection that is not a five-hour limit with a known reset time is never waited out — the orchestrator exits 0 through the pause path at once, posts no wait comment, and the queue entry keeps the facts the CLI reported
    Given the orchestrator's clock reads "2026-09-25T09:00:00Z"
    And an orchestrator for issue 875 in the target repository "acme/widgets" is running under adwId "wait912-875"
    And the "build" phase meets these outcomes, attempt by attempt:
      | attempt | outcome      | limit type   | resets at   |
      | 1       | rate-limited | <limit type> | <resets at> |
      | 2       | succeeds     |              |             |
    When the phase runner runs the "build" phase
    Then the "build" phase ran 1 time
    And the orchestrator did not wait in-process
    And no wait comment was posted on issue 875
    And the orchestrator exited with code 0
    And the state file for adwId "wait912-875" records workflowStage "paused"
    And the pause queue holds adwId "wait912-875" <queued facts>

    Examples:
      | rejection                             | limit type | resets at            | queued facts                                                   |
      | seven-day window                      | seven_day  | 2026-09-28T07:00:00Z | with a "seven_day" limit that resets at "2026-09-28T07:00:00Z" |
      | five-hour window, no reset time       | five_hour  |                      | with a "five_hour" limit and no reset time                     |
      | a limit type ADW does not know        | monthly    | 2026-10-01T00:00:00Z | with a "monthly" limit that resets at "2026-10-01T00:00:00Z"   |
      | no facts: an overload or server error |            |                      | with no limit type and no reset time                           |

  @adw-912 @adw-kdrab9-in-process-wait-and
  Scenario Outline: After an in-process wait, a rejection that is not a five-hour limit with a known reset time is decided afresh — the orchestrator stops waiting and exits 0 through the pause path, whatever waits came before
    Given the orchestrator's clock reads "2026-09-22T11:57:00Z"
    And an orchestrator for issue 873 in the target repository "acme/widgets" is running under adwId "wait912-873"
    And the "build" phase meets these outcomes, attempt by attempt:
      | attempt | outcome      | limit type   | resets at            |
      | 1       | rate-limited | five_hour    | 2026-09-22T12:50:00Z |
      | 2       | rate-limited | <limit type> | <resets at>          |
      | 3       | succeeds     |              |                      |
    When the phase runner runs the "build" phase
    Then the "build" phase ran 2 times
    And the orchestrator waited in-process until each of these times, in order:
      | waits until          |
      | 2026-09-22T12:50:00Z |
    And exactly 1 wait comment was posted on issue 873
    And the orchestrator exited with code 0
    And the state file for adwId "wait912-873" records workflowStage "paused"
    And the pause queue holds adwId "wait912-873" <queued facts>

    Examples:
      | second rejection                      | limit type | resets at            | queued facts                                                   |
      | five-hour window, no reset time       | five_hour  |                      | with a "five_hour" limit and no reset time                     |
      | no facts: an overload or server error |            |                      | with no limit type and no reset time                           |
      | seven-day window                      | seven_day  | 2026-09-29T12:50:00Z | with a "seven_day" limit that resets at "2026-09-29T12:50:00Z" |

  # ── §5 BACKSTOPS ───────────────────────────────────────────────────────────────────────────────

  @adw-912 @adw-kdrab9-in-process-wait-and
  Scenario: TypeScript type-check passes with the wait policy in front of the pause path
    Then the ADW TypeScript type-check passes

  @adw-912 @adw-kdrab9-in-process-wait-and
  Scenario: The git/gh guard stays green with the phase runner posting wait comments
    When the git/gh guard is run across the repository
    Then the git/gh guard reports no violations
