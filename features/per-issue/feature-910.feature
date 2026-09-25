@adw-910 @adw-6a1674-pause-queue-waits-fo
Feature: The pause queue waits for the reset time the CLI reported — the pause records it, a pure decider gates every entry on it, the scanner runs no probe before it, and only a confirmed non-rate-limit failure counts a strike, with an eviction that leaves the workflow paused and names ## Retry as the recovery

  Issue #910 is the pause-queue slice of `specs/prd/rate-limit-indefinite-retry.md` (section
  "Pause queue", and the reset-time parts of "Wait policy"; user stories 7–10, 12 and 42).

  On 2026-09-22 the orchestrator for #840 hit a five-hour session limit at 11:57 UTC. The agent's
  own stream-json said when the limit would reset: 12:50 UTC. Since #907, that reset time and the
  limit type travel on `RateLimitError` and on the probe's classification. The pause path still
  drops them, so the queue entry does not know when to try again, and the scanner probes blindly
  every `PROBE_INTERVAL_CYCLES`. It evicted #840 at 12:06 UTC, 44 minutes before the reset, after
  three probe results it could not classify. Its eviction comment asked for a manual restart,
  which no GitHub comment could provide until #908 taught `## Retry` to revive a paused workflow.

  What #910 changes:
    • `PausedWorkflow` gains an optional `resetsAt` (ISO 8601) and an optional `rateLimitType`.
      The pause path writes them from the `RateLimitError` when it carries them. It invents
      neither when it does not.
    • A new pure decider takes an entry, the probe classification (with its optional reset facts)
      and the clock. It returns exactly one action: `skip_before_reset`, `resume`,
      `refresh_reset`, `count_strike` or `evict`.
    • The scanner becomes a thin shell over the decider. It reads the entries and runs the probe
      once per scan, but only when at least one entry is past its reset time or has none. It
      feeds each entry through the decider and executes the action.
    • A `limited` probe never counts a strike. When it reports a reset time, the entry moves to
      that time.
    • `failed` counts toward the existing three-strike budget. It is the confirmed non-rate-limit
      verdict of #907's classifier, returned today for an authentication failure. `unknown` also
      still counts, exactly as before: #903's scanner tests must stay green, and they count it. A
      CLI that dies before emitting any JSON is also the "broken CLI binary" that user story 10
      wants evicted rather than probed forever.
    • Eviction leaves the stage `paused`. The error comment names `## Retry` as the recovery.
    • Entries written before this change have neither field. They load unchanged and stay on the
      cadence-probe path.
  Outside this slice: one owning cron per entry and remove-before-spawn (#911), the in-process
  wait for five-hour limits (#912), and the probe's classification itself (#907). The decider
  leaves a seam for the scanning cron's repo identity, but no scenario here exercises ownership.

  The labels below are the section numbers used for the scenario groups further down (§1–§7):

    §1  THE PAUSE RECORDS WHEN THE LIMIT LIFTS (AC1). The real pause path is fed a
        `RateLimitError`. It writes the limit type and the reset time onto the queue entry, the
        reset time as ISO 8601. A limit type without a reset time gets no invented one. An error
        with no facts (an overload, a server error) writes an entry shaped like one written
        before this change. Every row uses a limit that #912's wait policy will still send down
        the pause path: a seven-day limit, a limit without a reset time, or no facts at all. That
        way #912 has nothing here to rewrite.

    §2  THE DECIDER (AC2). Decision tables over the pure decider, with the clock given explicitly.
        Before the reset time the answer is `skip_before_reset`, whatever the probe says, even one
        strike short of eviction. After it, or with no reset time at all, the probe decides:
        `clear` resumes; `failed` and `unknown` count a strike, and the third evicts; `limited`
        with a reset time refreshes the entry to it; `limited` without one counts no strike and
        changes nothing.

    §3  THE SCANNER WAITS FOR THE RESET TIME (AC3, and the issue's end-to-end path). When every
        entry is before its reset time, the probe does not run at all. With a mix, it runs once
        per scan, and an entry still before its reset time is neither resumed by a clear probe
        nor struck by a failed one. The #840 incident is replayed. The whole path is also driven
        end to end: the pause writes the reset time, nothing probes before it, and the first
        clear probe after it resumes the workflow.

    §4  A LIMITED PROBE NEVER COUNTS A STRIKE (AC4). After the reset time, a limited probe that
        reports a new reset time moves the entry to it without a strike, even one short of
        eviction. The scanner then waits for the new time.

    §5  EVICTION (AC5). After the reset time, each probe that meets a confirmed failure counts a
        strike. The third evicts the workflow, the stage stays `paused`, and the comment names
        `## Retry`.

    §6  ENTRIES WRITTEN BEFORE THIS CHANGE (AC6). An entry in the pre-#910 shape loads and is
        probed at every probing scan. It gains no invented field, counts no strike while an
        overload holds, and resumes when the probe is clear.

    §7  BACKSTOPS (AC8). `bun run test` is the type-check. `bun run lint:git-guard` is the git/gh
        guard, which runs over the rewritten scanner.

  Changes to feature-902 and feature-907. Their scanner rows now run through the decider. The
  rows that pin behaviour this slice must keep carry `@adw-910`:
    • modified: feature-902's unknown-drop row. #908 left it asserting the old eviction text on
      purpose, because this slice was expected to change that text. The row is renamed. It keeps
      its "failed to resume after 3 probe attempts" assertion and now also requires the comment
      to name `## Retry`. feature-902's description records the amendment.
    • flagged but unchanged:
        – feature-902's three-hour journey: an entry with no reset time stays on the cadence
          path through a limited probe that reports none;
        – feature-902's threshold row and its 2026-09-24 replay: a limited probe that reports a
          reset time counts no strike, against an entry one strike short of eviction and against
          six entries at once. This is AC4's "extends the #903 tests to the reset-time case";
        – feature-907's expired-login row: a confirmed failure strikes, and the third evicts.
  AC7 ("scanner tests from #903 remain green through the injected probe seam") and
  `bun run test:unit` are obligations on the vitest suite, which the build and test phases
  discharge. The flagged rows are their behavioural counterpart here.

  AMENDED BY #912 (`specs/prd/rate-limit-indefinite-retry.md`, "Wait policy"). #912 puts a pure
  wait policy in front of this file's pause path. The phase runner now waits out a five-hour
  limit with a known reset time in-process, so that limit never reaches the pause queue. Every
  other rejection still takes the pause path specified here, and no scenario in this file
  changes. §1's three rows and §3's end-to-end journey drive the real `runPhase` with a seven-day
  limit, a five-hour limit without a reset time, or no facts at all. Those are exactly the
  rejections #912 still enqueues. The four rows therefore also carry `@adw-912`, as the guard
  that the enqueue branch keeps recording the limit facts. #912's hooks are scoped to
  `@adw-912 and not @adw-910`, so these rows keep running under this file's harness alone. The
  rest of #912's behaviour is specified in `features/per-issue/feature-912.feature`.

  How these scenarios observe the system. Every assertion targets a runtime artefact:
    • the action the pure decider returns for a given entry, classification and clock;
    • the pause-queue state file (`agents/paused_queue.json`): whether an entry is present, its
      probe failures, its reset time and its limit type;
    • the workflow's top-level state file, and the `workflowStage` it records;
    • the Claude CLI invocations recorded at the probe's injected exec seam, which show whether
      and how often the scanner ran the probe;
    • the relaunch the resume path performs;
    • the comments the scanner posts, as recorded by the mock GitHub API.
  No scenario reads, greps or parses a source file.

  Notes for the step definitions:

    • REUSE THE #902 HARNESS (`feature-902.steps.ts`, `feature-902-queue.steps.ts`): the injected
      probe stub, the saved-and-restored queue file, the fixture orchestrator, and the `gh`
      shadow that replays the scanner's comments against the mock GitHub API. Widen each of its
      hooks from `@adw-902 or @adw-907` to `@adw-902 or @adw-907 or @adw-910`. Do not add a
      separate `@adw-910` hook: the flagged rows carry several tags, and a second hook would
      initialise the mock infrastructure twice.
    • THE CLOCK. "the cron host's clock reads {string}" pins the wall clock that the scanner
      hands the decider, and a later use moves it. The scanner's clock seam is the third
      argument of `scanPauseQueue`, `{ now: () => Date }`. The shared "the pause-queue scanner
      runs N probe cycle(s)" step passes the pinned instant through it, and omits it when no
      clock is pinned. Never fake `setTimeout` or `setInterval`: the resume path's two-second
      readiness window and the fixture orchestrator need real timers. Clear the pinned clock in
      an `After` hook. Rows without this step run on the real clock. They only hold entries
      without a reset time, or entries whose probe reports a reset time that is already past.
    • "the paused workflow for issue N was queued with a {string} limit that resets at {string}"
      updates the entry that G20 seeded. It sets `rateLimitType` as given, and `resetsAt` as the
      given ISO-8601 string, the form AC1 fixes.
    • "… by a release that recorded no reset time or limit type" writes the raw pre-#910 JSON
      straight into the queue file. The fields are exactly those `PausedWorkflow` had before this
      change: adwId, issueNumber, orchestratorScript, pausedAtPhase, pauseReason, pausedAt,
      probeFailures, worktreePath, branchName, extraArgs. It does not go through
      `appendToPauseQueue`, so a default added on the write path cannot mask a regression on
      load. Everything else it seeds exactly as G20 does. G20 must also keep seeding that shape,
      because the flagged feature-902 and feature-907 rows rely on it.
    • "the scanner did not run the rate-limit probe" and "… ran the rate-limit probe once per
      probe cycle" count the probe stub's invocations during the most recent "the pause-queue
      scanner runs N probe cycle(s)" step. Record the count before and after that step.
    • THE PAUSE PATH. "a workflow for issue N is running its {string} phase for the target
      repository {string}" builds a `WorkflowConfig`:
        – a fresh adwId (lowercase letters, digits and hyphens);
        – a throwaway worktree directory and orchestrator state path;
        – the given target repository;
        – NO `repoContext`, so the pause posts nothing and every recorded comment is the
          scanner's.
      It writes top-level state that carries the adwId, because the resume path's
      canonical-claim check requires it. It registers the workflow with feature-902-queue's
      seeded entries (a baseline of 0 probe failures), so the shared queue steps find its entry
      by issue number.
      "the {string} phase is stopped by a rate-limit error carrying …" drives the REAL pause
      path: `runPhase` with that phase name, and a phase function that throws
      `new RateLimitError(<phase>, facts)`. `resetsAt` is in epoch seconds, as #907's parser
      captures it. The pause path ends the process with `process.exit(0)`. For the duration of
      the call, replace `process.exit` with a function that throws a sentinel, catch the
      sentinel, and restore `process.exit`. Any other throw fails the step.
    • NEVER RELAUNCH A REAL ORCHESTRATOR. Entries seeded through G20 or the legacy Given name the
      fixture orchestrator. An entry written by the real pause path names the real script, so
      the end-to-end journey intercepts the relaunch at the process boundary: shadow `bunx` on
      PATH the way feature-902-queue.steps.ts shadows `gh`. The shadow records its argv, stays
      alive past the readiness window, and is killed in `After`. Do not rewrite the entry the
      pause path wrote: the journey exists to prove that the scanner consumes exactly what the
      pause recorded. "the paused workflow for issue N is relaunched under its original adwId"
      reads whichever record applies.
    • THE DECIDER steps call the real pure decider in process (`adws/triggers/pauseQueueDecider.ts`
      in the issue's touched files).
        – The entry is a complete `PausedWorkflow` targeting `acme/widgets`: `resetsAt` as the
          given ISO-8601 string, or absent, and `probeFailures` as given.
        – The classification is a `ProbeClassification`: the verdict, plus `rateLimitType` and
          `resetsAt` when given. `resetsAt` is in epoch seconds, as #907's classifier returns it.
        – The clock is the given instant, as the `Date` the decider takes.
        – The strike budget is the production three-strike budget. Pass
          `MAX_UNKNOWN_PROBE_FAILURES`: the decider takes the budget as an input and never reads
          the environment itself. Do not override it in the environment.
        – The repo identity is a seam only. The issue lists this slice's decider inputs as the
          entry, the probe classification and the clock, so the decider has no repo-identity
          input yet. Pass none. When #911 adds that input, these rows pass `acme/widgets`, the
          identity that owns the entry, and keep their meaning.
      "returns {string} with the reset time {string}" compares the action and the instant the
      decision carries. "neither resumes, strikes nor evicts the entry" means the action is none
      of `resume`, `count_strike` and `evict`. "sets no new reset time on the entry" means the
      decision carries no reset time, or only the one the entry already has.
    • ENTRY ASSERTIONS. "records the reset time {string}" parses the stored string and compares
      instants. "stores its reset time as an ISO 8601 timestamp" requires a string in ISO-8601
      date-time form; an epoch number fails. "records no reset time" and "records no limit type"
      require the field to be absent; `null` or any defaulted value fails.
    • "the workflow for issue N is recorded at workflow stage {string}" reads the top-level state
      file of that issue's adwId (`agents/<adwId>/state.json`). T1 cannot be used, because it
      needs a literal adwId and these scenarios generate theirs.
    • `acme/widgets` is fictional, as in feature-902, so a mis-wired post can never reach a real
      issue. Once #911 lands, the shared scanner step runs as the `acme/widgets` cron, so every
      scanner row here keeps its meaning.

  Vocabulary note. These registered phrases from `features/regression/vocabulary.md` are reused:
    • G18 `the ADW codebase is checked out`
    • G20 `a workflow for issue {int} is paused in the rate-limit queue for the target repository {string}`
    • G1 `the mock GitHub API is configured to accept issue comments`
    • T2 `the mock GitHub API recorded a comment on issue {int}`
    • T3 `the mock GitHub API recorded a comment containing the text {string}`
    • T14 `the mock harness recorded zero comment posts on issue {int}`
    • T22 `the ADW TypeScript type-check passes`
  W13 `the pause-queue resume scan runs` is not reused, because it calls `resumeWorkflow` with no
  probe and no decider. T1 is not reused either (see the notes). The unregistered phrases from
  feature-902 and feature-907, and the git/gh guard phrases from feature-844, are reused as they
  are written. The registry has nothing for the following, so they are novel: the clock, an
  entry's reset facts (seeding and assertions), the legacy-shaped seed, the pause path, how often
  the scanner probed, the workflow stage by issue number, and every decider step.

  Background:
    Given the ADW codebase is checked out

  # ── §1 THE PAUSE RECORDS WHEN THE LIMIT LIFTS ──────────────────────────────────────────────────

  @adw-910 @adw-6a1674-pause-queue-waits-fo @adw-912
  Scenario: A workflow stopped by a seven-day limit records the limit type and the reset time on its pause-queue entry, the reset time as an ISO 8601 timestamp
    Given a workflow for issue 910 is running its "build" phase for the target repository "acme/widgets"
    When the "build" phase is stopped by a rate-limit error carrying a "seven_day" limit that resets at "2026-09-28T07:00:00Z"
    Then the workflow for issue 910 is recorded at workflow stage "paused"
    And the pause queue entry for issue 910 records the limit type "seven_day"
    And the pause queue entry for issue 910 records the reset time "2026-09-28T07:00:00Z"
    And the pause queue entry for issue 910 stores its reset time as an ISO 8601 timestamp

  @adw-910 @adw-6a1674-pause-queue-waits-fo @adw-912
  Scenario: A rate-limit error that carries a limit type but no reset time records the type and invents no reset time
    Given a workflow for issue 910 is running its "build" phase for the target repository "acme/widgets"
    When the "build" phase is stopped by a rate-limit error carrying a "five_hour" limit with no reset time
    Then the workflow for issue 910 is recorded at workflow stage "paused"
    And the pause queue entry for issue 910 records the limit type "five_hour"
    And the pause queue entry for issue 910 records no reset time

  @adw-910 @adw-6a1674-pause-queue-waits-fo @adw-912
  Scenario: A rate-limit error that carries no limit facts, such as an overload or a server error, pauses with neither field — the same shape as an entry written before this change
    Given a workflow for issue 910 is running its "build" phase for the target repository "acme/widgets"
    When the "build" phase is stopped by a rate-limit error carrying no limit type and no reset time
    Then the workflow for issue 910 is recorded at workflow stage "paused"
    And the pause queue entry for issue 910 records no limit type
    And the pause queue entry for issue 910 records no reset time

  # ── §2 THE DECIDER ─────────────────────────────────────────────────────────────────────────────

  @adw-910 @adw-6a1674-pause-queue-waits-fo
  Scenario Outline: Before its reset time an entry is skipped whatever the probe classification says, even one strike short of eviction
    Given a pause-queue entry with a reset time of "2026-09-22T12:50:00Z" and 2 probe failures
    And the rate-limit probe classification is "<verdict>"
    When the pause-queue decider is consulted at "2026-09-22T12:06:00Z"
    Then the pause-queue decider returns "skip_before_reset"

    Examples:
      | verdict |
      | clear   |
      | limited |
      | failed  |
      | unknown |

  @adw-910 @adw-6a1674-pause-queue-waits-fo
  Scenario Outline: Once an entry's reset time has passed, or when it has none, the probe classification decides — "clear" resumes, and "failed" or "unknown" counts a strike until the third, which evicts
    Given a pause-queue entry with <entry> and <failures> probe failures
    And the rate-limit probe classification is "<verdict>"
    When the pause-queue decider is consulted at "2026-09-22T12:51:00Z"
    Then the pause-queue decider returns "<action>"

    Examples:
      | entry                                  | verdict | failures | action       |
      | a reset time of "2026-09-22T12:50:00Z" | clear   | 0        | resume       |
      | a reset time of "2026-09-22T12:50:00Z" | clear   | 2        | resume       |
      | a reset time of "2026-09-22T12:50:00Z" | failed  | 0        | count_strike |
      | a reset time of "2026-09-22T12:50:00Z" | failed  | 1        | count_strike |
      | a reset time of "2026-09-22T12:50:00Z" | failed  | 2        | evict        |
      | a reset time of "2026-09-22T12:50:00Z" | unknown | 0        | count_strike |
      | a reset time of "2026-09-22T12:50:00Z" | unknown | 2        | evict        |
      | no reset time                          | clear   | 0        | resume       |
      | no reset time                          | failed  | 0        | count_strike |
      | no reset time                          | failed  | 1        | count_strike |
      | no reset time                          | failed  | 2        | evict        |
      | no reset time                          | unknown | 1        | count_strike |
      | no reset time                          | unknown | 2        | evict        |

  @adw-910 @adw-6a1674-pause-queue-waits-fo
  Scenario Outline: A "limited" classification that reports a reset time refreshes the entry to that time and counts no strike, even one strike short of eviction
    Given a pause-queue entry with <entry> and 2 probe failures
    And the rate-limit probe classification is "limited" with a "five_hour" limit that resets at "2026-09-22T17:50:00Z"
    When the pause-queue decider is consulted at "2026-09-22T12:51:00Z"
    Then the pause-queue decider returns "refresh_reset" with the reset time "2026-09-22T17:50:00Z"

    Examples:
      | entry                                  |
      | a reset time of "2026-09-22T12:50:00Z" |
      | no reset time                          |

  @adw-910 @adw-6a1674-pause-queue-waits-fo
  Scenario Outline: A "limited" classification with no reset time counts no strike and changes nothing, even one strike short of eviction
    Given a pause-queue entry with <entry> and 2 probe failures
    And the rate-limit probe classification is "limited"
    When the pause-queue decider is consulted at "2026-09-22T12:51:00Z"
    Then the pause-queue decider neither resumes, strikes nor evicts the entry
    And the pause-queue decider sets no new reset time on the entry

    Examples:
      | entry                                  |
      | a reset time of "2026-09-22T12:50:00Z" |
      | no reset time                          |

  # ── §3 THE SCANNER WAITS FOR THE RESET TIME ────────────────────────────────────────────────────

  @adw-910 @adw-6a1674-pause-queue-waits-fo
  Scenario: While every queued workflow is still before its reset time the scanner does not run the probe at all, so it can neither strike nor comment
    Given the mock GitHub API is configured to accept issue comments
    And the cron host's clock reads "2026-09-25T09:00:00Z"
    And a workflow for issue 874 is paused in the rate-limit queue for the target repository "acme/widgets"
    And the paused workflow for issue 874 was queued with a "five_hour" limit that resets at "2026-09-25T12:50:00Z"
    And a workflow for issue 875 is paused in the rate-limit queue for the target repository "acme/widgets"
    And the paused workflow for issue 875 was queued with a "seven_day" limit that resets at "2026-09-28T07:00:00Z"
    And the Claude CLI answers the rate-limit probe with exit code 1 and stdout:
      """
      {"type":"system","subtype":"init","session_id":"probe-910"}
      {"type":"system","subtype":"api_retry","attempt":1,"max_retries":10,"retry_delay_ms":500,"error_status":401,"error":"authentication_failed","session_id":"probe-910"}
      {"type":"result","subtype":"success","is_error":true,"api_error_status":401,"terminal_reason":"api_error","result":"OAuth token has expired · Please run /login","session_id":"probe-910"}
      """
    When the pause-queue scanner runs 3 probe cycles
    Then the scanner did not run the rate-limit probe
    And the pause queue still holds a workflow for each of these issues, none of which has gained a probe failure:
      | issue |
      | 874   |
      | 875   |
    And the pause queue entry for issue 874 records the reset time "2026-09-25T12:50:00Z"
    And the pause queue entry for issue 875 records the reset time "2026-09-28T07:00:00Z"
    And the mock harness recorded zero comment posts on issue 874
    And the mock harness recorded zero comment posts on issue 875

  @adw-910 @adw-6a1674-pause-queue-waits-fo
  Scenario: Replaying 2026-09-22 — the entry for #840, queued at 11:57 with a 12:50 reset, is not probed by the 12:06 scans that evicted it, and resumes on the first clear probe after 12:50
    Given the mock GitHub API is configured to accept issue comments
    And the cron host's clock reads "2026-09-22T11:57:00Z"
    And a workflow for issue 840 is paused in the rate-limit queue for the target repository "acme/widgets"
    And the paused workflow for issue 840 was queued with a "five_hour" limit that resets at "2026-09-22T12:50:00Z"
    And the Claude CLI answers the rate-limit probe with exit code 1 and stderr:
      """
      You've hit your session limit · resets 2:50pm (Europe/Amsterdam)
      """
    When the cron host's clock reads "2026-09-22T12:06:00Z"
    And the pause-queue scanner runs 3 probe cycles
    Then the scanner did not run the rate-limit probe
    And the pause queue still holds the workflow for issue 840
    And the pause queue entry for issue 840 has not gained a probe failure
    And the mock harness recorded zero comment posts on issue 840
    When the cron host's clock reads "2026-09-22T12:51:00Z"
    And the Claude CLI answers the rate-limit probe with exit code 0 and stdout:
      """
      {"type":"system","subtype":"init","session_id":"probe-910"}
      {"type":"assistant","message":{"content":[{"type":"text","text":"pong"}]}}
      {"type":"result","subtype":"success","is_error":false,"result":"pong"}
      """
    And the pause-queue scanner runs 1 probe cycle
    Then the scanner ran the rate-limit probe once per probe cycle
    And the paused workflow for issue 840 is relaunched under its original adwId
    And the pause queue no longer holds the workflow for issue 840
    And the mock GitHub API recorded a comment on issue 840

  @adw-910 @adw-6a1674-pause-queue-waits-fo
  Scenario: A clear probe, run because one queued workflow has no reset time, resumes that workflow and leaves alone another that is still before its reset time
    Given the mock GitHub API is configured to accept issue comments
    And the cron host's clock reads "2026-09-25T09:00:00Z"
    And a workflow for issue 874 is paused in the rate-limit queue for the target repository "acme/widgets"
    And the paused workflow for issue 874 was queued with a "seven_day" limit that resets at "2026-09-28T07:00:00Z"
    And a workflow for issue 876 is paused in the rate-limit queue for the target repository "acme/widgets"
    And the Claude CLI answers the rate-limit probe with exit code 0 and stdout:
      """
      {"type":"system","subtype":"init","session_id":"probe-910"}
      {"type":"assistant","message":{"content":[{"type":"text","text":"pong"}]}}
      {"type":"result","subtype":"success","is_error":false,"result":"pong"}
      """
    When the pause-queue scanner runs 1 probe cycle
    Then the scanner ran the rate-limit probe once per probe cycle
    And the paused workflow for issue 876 is relaunched under its original adwId
    And the pause queue no longer holds the workflow for issue 876
    And the pause queue still holds the workflow for issue 874
    And the pause queue entry for issue 874 records the reset time "2026-09-28T07:00:00Z"
    And the mock harness recorded zero comment posts on issue 874

  @adw-910 @adw-6a1674-pause-queue-waits-fo
  Scenario: A confirmed failure, probed because one queued workflow has no reset time, strikes and finally evicts only that workflow — never another that is still before its reset time and one strike short of eviction
    Given the mock GitHub API is configured to accept issue comments
    And the cron host's clock reads "2026-09-28T06:00:00Z"
    And a workflow for issue 874 is paused in the rate-limit queue for the target repository "acme/widgets"
    And the paused workflow for issue 874 was queued with a "seven_day" limit that resets at "2026-09-28T07:00:00Z"
    And the paused workflow for issue 874 has already recorded 2 unknown probe failures
    And a workflow for issue 877 is paused in the rate-limit queue for the target repository "acme/widgets"
    And the Claude CLI answers the rate-limit probe with exit code 1 and stdout:
      """
      {"type":"system","subtype":"init","session_id":"probe-910"}
      {"type":"system","subtype":"api_retry","attempt":1,"max_retries":10,"retry_delay_ms":500,"error_status":401,"error":"authentication_failed","session_id":"probe-910"}
      {"type":"result","subtype":"success","is_error":true,"api_error_status":401,"terminal_reason":"api_error","result":"OAuth token has expired · Please run /login","session_id":"probe-910"}
      """
    When the pause-queue scanner runs 3 probe cycles
    Then the scanner ran the rate-limit probe once per probe cycle
    And the pause queue no longer holds the workflow for issue 877
    And the mock GitHub API recorded a comment on issue 877
    And the pause queue still holds the workflow for issue 874
    And the pause queue entry for issue 874 has not gained a probe failure
    And the mock harness recorded zero comment posts on issue 874

  @adw-910 @adw-6a1674-pause-queue-waits-fo @adw-912
  Scenario: End to end — a workflow stopped by a seven-day limit waits in the pause queue, unprobed, until the reset time it reported, then resumes on the first clear probe after it
    Given the mock GitHub API is configured to accept issue comments
    And the cron host's clock reads "2026-09-25T09:00:00Z"
    And a workflow for issue 910 is running its "build" phase for the target repository "acme/widgets"
    When the "build" phase is stopped by a rate-limit error carrying a "seven_day" limit that resets at "2026-09-28T07:00:00Z"
    Then the workflow for issue 910 is recorded at workflow stage "paused"
    And the pause queue entry for issue 910 records the reset time "2026-09-28T07:00:00Z"
    When the Claude CLI answers the rate-limit probe with exit code 1 and stderr:
      """
      Error: Claude Code process exited unexpectedly
      """
    And the pause-queue scanner runs 3 probe cycles
    Then the scanner did not run the rate-limit probe
    And the pause queue still holds the workflow for issue 910
    And the pause queue entry for issue 910 has not gained a probe failure
    When the cron host's clock reads "2026-09-28T07:01:00Z"
    And the Claude CLI answers the rate-limit probe with exit code 0 and stdout:
      """
      {"type":"system","subtype":"init","session_id":"probe-910"}
      {"type":"assistant","message":{"content":[{"type":"text","text":"pong"}]}}
      {"type":"result","subtype":"success","is_error":false,"result":"pong"}
      """
    And the pause-queue scanner runs 1 probe cycle
    Then the scanner ran the rate-limit probe once per probe cycle
    And the paused workflow for issue 910 is relaunched under its original adwId
    And the pause queue no longer holds the workflow for issue 910
    And the mock GitHub API recorded a comment on issue 910

  # ── §4 A LIMITED PROBE NEVER COUNTS A STRIKE ───────────────────────────────────────────────────

  @adw-910 @adw-6a1674-pause-queue-waits-fo
  Scenario: After the reset time, a limited probe that reports a new reset time moves the entry to it and counts no strike, even one strike short of eviction, and the scanner then waits for the new time
    Given the mock GitHub API is configured to accept issue comments
    And the cron host's clock reads "2026-09-22T12:51:00Z"
    And a workflow for issue 875 is paused in the rate-limit queue for the target repository "acme/widgets"
    And the paused workflow for issue 875 was queued with a "five_hour" limit that resets at "2026-09-22T12:50:00Z"
    And the paused workflow for issue 875 has already recorded 2 unknown probe failures
    And the Claude CLI answers the rate-limit probe with exit code 1 and stdout:
      """
      {"type":"system","subtype":"init","session_id":"probe-910"}
      {"type":"rate_limit_event","rate_limit_info":{"status":"rejected","resetsAt":1790099400,"rateLimitType":"five_hour"},"session_id":"probe-910"}
      {"type":"result","subtype":"success","is_error":true,"api_error_status":429,"terminal_reason":"api_error","result":"You've hit your session limit · resets 7:50pm (Europe/Amsterdam)","session_id":"probe-910"}
      """
    When the pause-queue scanner runs 1 probe cycle
    Then the scanner ran the rate-limit probe once per probe cycle
    And the pause queue still holds the workflow for issue 875
    And the pause queue entry for issue 875 has not gained a probe failure
    And the pause queue entry for issue 875 records the reset time "2026-09-22T17:50:00Z"
    And the pause queue entry for issue 875 stores its reset time as an ISO 8601 timestamp
    And the mock harness recorded zero comment posts on issue 875
    When the cron host's clock reads "2026-09-22T15:00:00Z"
    And the pause-queue scanner runs 3 probe cycles
    Then the scanner did not run the rate-limit probe
    And the pause queue entry for issue 875 has not gained a probe failure

  # ── §5 EVICTION ────────────────────────────────────────────────────────────────────────────────

  @adw-910 @adw-6a1674-pause-queue-waits-fo
  Scenario: After the reset time, a confirmed non-rate-limit failure counts a strike at each probe, and the third evicts the workflow, leaves it paused, and names ## Retry as the recovery
    Given the mock GitHub API is configured to accept issue comments
    And the cron host's clock reads "2026-09-28T07:05:00Z"
    And a workflow for issue 877 is paused in the rate-limit queue for the target repository "acme/widgets"
    And the paused workflow for issue 877 was queued with a "seven_day" limit that resets at "2026-09-28T07:00:00Z"
    And the Claude CLI answers the rate-limit probe with exit code 1 and stdout:
      """
      {"type":"system","subtype":"init","session_id":"probe-910"}
      {"type":"system","subtype":"api_retry","attempt":1,"max_retries":10,"retry_delay_ms":500,"error_status":401,"error":"authentication_failed","session_id":"probe-910"}
      {"type":"result","subtype":"success","is_error":true,"api_error_status":401,"terminal_reason":"api_error","result":"OAuth token has expired · Please run /login","session_id":"probe-910"}
      """
    When the pause-queue scanner runs 2 probe cycles
    Then the pause queue entry for issue 877 records 2 probe failures
    And the mock harness recorded zero comment posts on issue 877
    When the pause-queue scanner runs 1 probe cycle
    Then the pause queue no longer holds the workflow for issue 877
    And the workflow for issue 877 is recorded at workflow stage "paused"
    And the mock GitHub API recorded a comment on issue 877
    And the mock GitHub API recorded a comment containing the text "## Retry"

  # ── §6 ENTRIES WRITTEN BEFORE THIS CHANGE ──────────────────────────────────────────────────────

  @adw-910 @adw-6a1674-pause-queue-waits-fo
  Scenario: An entry written before reset times were recorded loads unchanged and stays on the cadence path — probed at every probing scan, never struck and never given an invented field while an overload holds, and resumed when the probe is clear
    Given the mock GitHub API is configured to accept issue comments
    And a workflow for issue 872 was paused in the rate-limit queue for the target repository "acme/widgets" by a release that recorded no reset time or limit type
    And the Claude CLI answers the rate-limit probe with exit code 1 and stdout:
      """
      {"type":"system","subtype":"init","session_id":"probe-910"}
      {"type":"system","subtype":"api_retry","attempt":1,"max_retries":10,"retry_delay_ms":500,"error_status":529,"error":"overloaded","session_id":"probe-910"}
      {"type":"result","subtype":"success","is_error":true,"api_error_status":529,"terminal_reason":"api_error","result":"API Error: 529 Overloaded","session_id":"probe-910"}
      """
    When the pause-queue scanner runs 3 probe cycles
    Then the scanner ran the rate-limit probe once per probe cycle
    And the pause queue still holds the workflow for issue 872
    And the pause queue entry for issue 872 has not gained a probe failure
    And the pause queue entry for issue 872 records no reset time
    And the pause queue entry for issue 872 records no limit type
    And the mock harness recorded zero comment posts on issue 872
    When the Claude CLI answers the rate-limit probe with exit code 0 and stdout:
      """
      {"type":"system","subtype":"init","session_id":"probe-910"}
      {"type":"assistant","message":{"content":[{"type":"text","text":"pong"}]}}
      {"type":"result","subtype":"success","is_error":false,"result":"pong"}
      """
    And the pause-queue scanner runs 1 probe cycle
    Then the paused workflow for issue 872 is relaunched under its original adwId
    And the pause queue no longer holds the workflow for issue 872
    And the mock GitHub API recorded a comment on issue 872

  # ── §7 BACKSTOPS ───────────────────────────────────────────────────────────────────────────────

  @adw-910 @adw-6a1674-pause-queue-waits-fo
  Scenario: TypeScript type-check passes with the reset facts on the pause-queue entry and the scanner running through the decider
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes

  @adw-910 @adw-6a1674-pause-queue-waits-fo
  Scenario: The git/gh guard stays green with the scanner rewritten as a thin shell over the decider
    When the git/gh guard is run across the repository
    Then the git/gh guard reports no violations
