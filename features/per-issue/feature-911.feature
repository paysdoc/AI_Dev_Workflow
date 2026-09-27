@adw-911 @adw-gtxas1-per-repo-ownership-o
Feature: Every pause-queue entry has exactly one owning cron — the cron whose launch identity is the entry's target repository, or the self-host cron when the entry records none — so only that cron probes for it, strikes it, evicts it or resumes it; and a resume takes the entry off the queue before it spawns the orchestrator, putting it back with one more strike if the spawn dies inside the readiness window

  Issue #911 is the ownership slice of `specs/prd/rate-limit-indefinite-retry.md` (section "Pause
  queue": ownership and remove-before-spawn; user stories 18–21).

  Every cron process on a host scans every entry of the shared `agents/paused_queue.json`. On
  2026-09-22 the devplatform cron and the AI_Dev_Workflow cron both scanned #840's entry and burned
  strikes 1/3 and 2/3 on it 1.9 seconds apart. The three-strike budget was spent by whichever crons
  happened to be running, at their combined cadence. The resume path has a race of its own. It
  takes the per-issue spawn lock, releases it, spawns the orchestrator, waits two seconds for the
  child to prove it is alive, and only then removes the entry. For those two seconds another scan
  can see the entry, find the lock free and spawn a duplicate orchestrator.

  What #911 changes:
    • The decider from #910 gains an ownership rule, checked before every other rule. An entry
      belongs to the cron whose launch identity is the target repository the entry records
      (`--target-repo` in its `extraArgs`). An entry that records no target repository belongs to
      the self-host cron. Every other cron gets `skip_not_owner`, whatever the reset time, the
      probe and the strike count say.
    • The scanner takes the scanning cron's launch identity and hands it to the decider. The cron
      trigger passes the identity it already resolved at startup, and builds no new context.
    • The scanner runs the probe only when an entry it owns is due. In the PRD's words: "The probe
      is not run at all when every owned entry is still before its reset time."
    • On `resume`, the entry leaves the queue before the orchestrator is spawned. If the spawned
      process exits inside the readiness window, the entry goes back on the queue with one more
      strike, so a failed spawn still counts toward the budget as it does today.
  Out of scope: an orphaned entry whose owning cron is not running (PRD "Out of Scope").

  Which cron owns what, concretely:
    • A cron launched with `--target-repo R` has the identity R. Every cron the webhook starts is
      launched this way.
    • A cron launched without `--target-repo` is the self-host cron. Its identity is the
      repository its own checkout's remote names; `buildLaunchBoundary(null)` marks it `selfHost`.
    • Every orchestrator a cron spawns is given `--target-repo` naming the cron's identity
      (`buildCronTargetRepoArgs`), the self-host cron's orchestrators included, and the pause path
      copies it into the entry. So the self-host cron's own paused workflows do record a target
      repository: its own. The self-host cron owns them because that repository is its identity,
      not through the no-target-repository rule. A fix that compared an entry with the cron's
      `--target-repo` argument, instead of its launch identity, would leave the self-host cron
      only the target-less entries and orphan every workflow it paused itself.

  The labels below are the section numbers used for the scenario groups further down (§1–§5):

    §1  THE DECIDER'S OWNERSHIP RULE (AC1; user stories 18, 20). Decision tables over the pure
        decider, each consulted by a named cron at an explicit clock. The owning cron gets #910's
        decision unchanged. Any other cron gets `skip_not_owner` before every other rule: before
        the reset time, on a clear probe, one strike short of eviction, and on a limited probe
        that reports a new reset time. A target-less entry belongs to the self-host cron and to
        no `--target-repo` cron. The self-host cron owns an entry recorded for its own repository.

    §2  EACH CRON ACTS ONLY ON ITS OWN ENTRIES (AC2; user stories 18–20). Two crons scan one
        queue. A cron that does not own an entry leaves its strike count, its last-probe time and
        its reset time alone, relaunches nothing and comments on nothing; the owner then acts on
        it exactly as #910 specifies. A cron that owns no due entry runs no probe. The 2026-09-22
        incident is replayed.

    §3  THE ENTRY LEAVES THE QUEUE BEFORE THE ORCHESTRATOR IS SPAWNED (AC3, AC4; user stories 19,
        21). At the moment of the spawn the queue no longer holds the entry. A scan that starts
        inside the readiness window finds nothing to relaunch. A spawn that dies inside the window
        puts the entry back with one more strike and everything else it recorded. A resume
        skipped because the spawn lock is held keeps the entry queued.

    §4  THE CRON TRIGGER HANDS THE SCANNER ITS OWN IDENTITY (AC5). A real cron process launched
        with `--target-repo` relaunches its own paused workflow on its first probing tick and
        leaves another repository's alone.

    §5  BACKSTOPS (AC5, AC6). `bun run test` is the type-check. `bun run lint:git-guard` is the
        git/gh guard, which also enforces AC5's "no new context construction".

  Each row is written to fail for a reason, not to restate a criterion:
    • every `skip_not_owner` row and every §2 row fails today, because the scanner acts on every
      entry;
    • the owning-cron rows of §1 are GREEN TODAY and must stay green. They fail for an ownership
      rule that misreads the entry's target repository or the cron's identity;
    • the self-host rows fail for a fix that compares an entry with the cron's `--target-repo`
      argument instead of its launch identity, for a fix that hands target-less entries to every
      cron, and for one that leaves them to none;
    • the probe row fails for a fix that puts ownership into the decider but still probes whenever
      any entry in the queue is due;
    • the relaunch rows require `--target-repo` in the relaunched orchestrator's arguments, and the
      failed-spawn row requires it on the re-queued entry. Both fail for a fix that reads an
      entry's target repository by calling `parseTargetRepoArgs` on the entry's own `extraArgs`.
      That parser splices the flag out of the array it is given, so the relaunch would resolve the
      cron host's own checkout and the re-queued entry would change owner;
    • the queue-at-spawn assertion fails for today's order (spawn, wait two seconds, remove), and
      for a fix that removes the entry right after the spawn;
    • the overlapping-scan row fails for today's order: the second scan launches a second
      orchestrator;
    • the failed-spawn row fails for a fix that removes the entry before the spawn but never puts
      it back, or puts it back without its extra strike, its target repository or its reset facts;
    • the held-lock row is GREEN TODAY and must stay green. It fails for a fix that takes the
      entry off the queue before the spawn-lock check: the resume is then skipped with the entry
      already gone, and the workflow is stranded;
    • the real-cron row fails for a cron trigger that does not hand its identity to the scanner,
      whatever the scanner then does without one. Acting on every entry relaunches the
      `acme/gadgets` workflow; acting on none leaves the `acme/widgets` workflow queued.

  Changes to existing features. #911 runs every scan through ownership and changes the resume
  path, so the existing rows that depend on either now also carry `@adw-911`. None of their steps
  change, and each file's description records why:
    • feature-910: the four §2 decider outlines. Consulted by the `acme/widgets` cron, the owner of
      their entry, they are AC1's "matching target repo → proceeds to the other rules" across
      #910's whole decision table. Also the end-to-end journey: its entry is the only one written
      by the real pause path, so it proves that ownership reads the target repository the pause
      path records;
    • feature-902: the three-hour journey (the resume path) and the unknown-drop row (strikes and
      eviction);
    • feature-908: the still-queued row. Its follow-up scan must run as the entry's owner, or its
      "relaunched nothing" would pass whatever `## Retry` did;
    • feature-812: the tick-guard row. Its lever is a malformed entry that a real `--target-repo`
      cron must reach on every tick, and under ownership that cron reaches only entries it owns.
  `bun run test:unit` (AC6) is an obligation on the vitest suite, which also holds the decider unit
  tests AC1 lists. The build and test phases discharge it; §1 is their behavioural counterpart.

  How these scenarios observe the system. Every assertion targets a runtime artefact:
    • the action the pure decider returns for an entry, a probe classification, a clock and a
      scanning cron;
    • the pause-queue state file (`agents/paused_queue.json`), read back after a scan, and also at
      the moment of a spawn through the scanner's injected spawn seam: whether an entry is present,
      and its strike count, last-probe time, reset time, limit type and target repository;
    • the Claude CLI invocations recorded at the probe's exec seam, which show whether the scanner
      probed;
    • the launches the fixture orchestrators record, with their arguments;
    • the comments the mock GitHub API records;
    • for §4, the queue file and the launches that a real cron process leaves behind.
  No scenario reads, greps or parses a source file.

  Notes for the step definitions:

    • REUSE THE #902/#910 HARNESS (`feature-902.steps.ts`, `feature-902-queue.steps.ts`,
      `feature-910.steps.ts`): the probe stub, the saved-and-restored queue file, the fixture
      orchestrator, the `gh` shadow that replays the scanner's comments against the mock GitHub
      API, the pinned clock and the decider world. Widen the 902 hooks to
      `(@adw-902 or @adw-907 or @adw-910 or @adw-911) and not @adw-908 and not @adw-812`, and the
      910 hooks to `@adw-910 or @adw-911`. The flagged feature-908 and feature-812 rows keep
      running under their own features' hooks alone; letting the 902 hooks run for them as well
      would initialise the mock infrastructure a second time. Do not add a separate `@adw-911`
      hook for setup those hooks already do.
    • THE SCANNING CRON. Every scan and every decision here names the cron that makes it:
        – "the cron polling the target repository R" was launched with `--target-repo R`. Its
          identity is R, and it is not the self-host cron;
        – "the self-host cron on a host checked out at R" was launched without `--target-repo`,
          in a checkout whose remote names R. Its identity is R, and it is the self-host cron.
      Hand the scanner and the decider exactly the input the cron trigger fills from its launch
      boundary. If that input is a launch boundary, a fake one carrying `repoId` and
      `gitContext.selfHost` is enough; never mint a real one for these fictional repositories.
      Never rely on a default for a missing identity. Three existing steps act as the cron polling
      `acme/widgets`, the owner of every entry they seed, and must pass that identity explicitly:
      the shared "the pause-queue scanner runs N probe cycle(s)", feature-910's "the pause-queue
      decider is consulted at {string}", and feature-908's "the pause-queue scanner then runs a
      probe cycle in which the rate limit has cleared".
    • The cron-qualified scanner steps run exactly what the shared step runs: cycle counts that
      are multiples of `PROBE_INTERVAL_CYCLES`, the pinned clock when one is set, the probe stub,
      and the comment replay after each cycle. They update the probe-call counters that "the
      scanner did not run the rate-limit probe" and "… ran the rate-limit probe once per probe
      cycle" read. Factor feature-902-queue's runner to take the cron instead of copying it.
    • THE SPAWN SEAM (AC3). Every scan these steps run injects the scanner's spawn seam with a
      wrapper. At the moment it is called, the wrapper reads `agents/paused_queue.json`
      synchronously and records whether the entry for the adwId it launches is present. It then
      hands the same arguments to the real `child_process.spawn`, so the fixture orchestrator
      still starts and the readiness window still runs on real timers. "the pause queue no longer
      held the workflow for issue N when its orchestrator was spawned" fails when no call was
      recorded for that issue's adwId, and when the entry was present at the call.
    • OVERLAPPING CYCLES. Start the first cycle without awaiting it. As soon as the spawn seam has
      been called for the issue (resolve a promise from the wrapper), run the second cycle to
      completion, then await the first. Never fake timers.
    • RELAUNCHES are counted from the seeded fixture's invocation log; a launch that exits at once
      still records itself. "has been relaunched N time(s)" and "has not been relaunched" wait a
      moment before they conclude, because a real spawn records asynchronously. "is relaunched
      with the target repository R" requires `--target-repo R` among the arguments the fixture
      recorded (`[issueNumber, adwId, ...extraArgs]`).
    • "the orchestrator of the paused workflow for issue N exits as soon as it starts on its first
      launch" rewrites that fixture. Its first launch records its arguments and exits 1 at once;
      every later launch records them and stays alive. Keep that state in a marker file beside the
      invocation log.
    • ENTRY ASSERTIONS read the entry back from the queue file. "still records the target
      repository R" requires `--target-repo R` in its `extraArgs`. "was last probed at T" writes
      `lastProbeAt` as the ISO string T, and "still records its last probe at T" compares
      instants. "records N probe failure(s)" is feature-902-queue's existing step: widen its
      expression to `probe failure(s)` rather than adding a second definition, which would be
      ambiguous.
    • "a workflow for issue N is paused in the rate-limit queue with no target repository" seeds
      exactly what G20 seeds, but with no `extraArgs` key. That is how the pause path writes a
      workflow launched without `--target-repo`. The rows that seed one only ever strike it. No
      row resumes or evicts a target-less entry, because those paths resolve its repository from
      the real checkout's remote, `paysdoc/AI_Dev_Workflow`, which is a real repository.
    • THE HELD SPAWN LOCK. "another live process holds the spawn lock for issue N in the
      repository R" starts a throwaway long-lived process and takes the per-issue spawn lock for
      R#N under its pid (`acquireIssueSpawnLock`). "the process holding the spawn lock … exits"
      kills it and waits until it is gone. That leaves a stale lock, which the resume path clears
      by itself. Kill the process and remove the lock file in an `@adw-911` `After` hook.
    • THE REAL CRON (§4). Launch `bunx tsx adws/triggers/trigger_cron.ts --target-repo R` the way
      feature-812's `spawnCron` does; factor that helper out instead of copying it:
        – a detached process group, cwd `REPO_ROOT`, a syntactically complete fake PAT, blank
          GitHub App variables, a throwaway `TARGET_REPOS_DIR`, and `PROBE_INTERVAL_CYCLES=1`, so
          that the first tick probes;
        – the environment the 902 hook set up, so that the cron's `gh` calls reach the shadow and
          are recorded;
        – G22 has no step definition yet. Implement it to its registry semantics: point the cron's
          `CLAUDE_CODE_PATH` at `test/mocks/claude-cli-stub.ts`, whose default reply the probe
          classifies `clear`;
        – remove any cron registration for R first, and save, remove and later restore
          `agents/.auth_gate`, because a set gate ends the tick before the scan;
        – wait until the first tick has ended, at its `POLL:` line or its
          `checkAndTrigger: tick failed` line, whichever it reaches (the scan runs before both).
          Then replay the recorded comments;
        – kill the process group and remove its registration in an `@adw-911` `After` hook.
      Never launch a cron without `--target-repo` here. It would resolve the real checkout,
      `paysdoc/AI_Dev_Workflow`, and poll that repository's real issues.
    • SAFETY. Every repository named in this file is fictional. `acme/adw-host` stands in for the
      framework's own repository and `acme/platform` for the devplatform repository. The 902 hook
      blanks the GitHub App variables and shadows `gh` before any step runs; keep both.
    • REUSED, NOT REDEFINED. T25 is defined in `feature-908.steps.ts`. It matches the resumed
      stage comment among the mock's recorded requests, which the 902 replay feeds. The git/gh
      guard pair and T22 are defined in `feature-844.steps.ts`.

  Vocabulary note. These registered phrases from `features/regression/vocabulary.md` are reused:
    • G18 `the ADW codebase is checked out`
    • G1  `the mock GitHub API is configured to accept issue comments`
    • G20 `a workflow for issue {int} is paused in the rate-limit queue for the target repository {string}`
    • G22 `the rate-limit probe reports the limit has cleared`
    • T2  `the mock GitHub API recorded a comment on issue {int}`
    • T14 `the mock harness recorded zero comment posts on issue {int}`
    • T25 `the resumed comment is recorded on issue {int} in the target repository {string}`
    • T22 `the ADW TypeScript type-check passes`
  These registered phrases are deliberately NOT reused:
    • G19 describes a single cron. Here the scanning cron is named step by step, because several
      rows run two crons against one queue;
    • W13 calls `resumeWorkflow` directly, with no probe, no decider and no scanning cron;
    • G5 and T6 assert that a spawn lock is absent, and §3 needs one held by a live process.
  feature-908's launch phrases are not reused either: they count launches in 908's own world. The
  unregistered pause-queue phrases of feature-902 and feature-910, and the git/gh guard pair of
  feature-844, are reused as written. The registry has nothing for the following, so they are
  novel:
    • the cron-qualified scanner and decider steps, and the overlapping-cycle step;
    • the target-qualified decider entry and the target-less queue seed;
    • the last-probe seed and assertion, and the target-repository assertion on an entry;
    • the relaunch count, the missing relaunch, the relaunch's target repository and the
      queue-at-spawn assertion;
    • the crash-on-first-launch fixture, the held spawn lock and the real cron process.

  Background:
    Given the ADW codebase is checked out

  # ── §1 THE DECIDER'S OWNERSHIP RULE ────────────────────────────────────────────────────────────

  @adw-911 @adw-gtxas1-per-repo-ownership-o
  Scenario Outline: The cron that owns an entry reaches the same decision #910 made without ownership — the reset gate, the probe verdict and the strike budget still decide
    Given a pause-queue entry recorded for the target repository "acme/widgets", with <reset> and <failures> probe failures
    And the rate-limit probe classification is <probe>
    When the pause-queue decider is consulted at "2026-09-22T12:51:00Z" by the cron polling the target repository "acme/widgets"
    Then the pause-queue decider returns "<action>"

    Examples:
      | reset                                  | failures | probe                                                                    | action            |
      | a reset time of "2026-09-22T13:50:00Z" | 2        | "clear"                                                                  | skip_before_reset |
      | a reset time of "2026-09-22T12:50:00Z" | 0        | "clear"                                                                  | resume            |
      | no reset time                          | 2        | "clear"                                                                  | resume            |
      | no reset time                          | 0        | "failed"                                                                 | count_strike      |
      | no reset time                          | 2        | "failed"                                                                 | evict             |
      | no reset time                          | 2        | "unknown"                                                                | evict             |
      | no reset time                          | 2        | "limited" with a "five_hour" limit that resets at "2026-09-22T17:50:00Z" | refresh_reset     |

  @adw-911 @adw-gtxas1-per-repo-ownership-o
  Scenario Outline: A cron that does not own an entry gets skip_not_owner before any other rule — before the entry's reset time, on a clear probe, one strike short of eviction, and on a limited probe that reports a new reset time
    Given a pause-queue entry recorded for the target repository "acme/widgets", with <reset> and 2 probe failures
    And the rate-limit probe classification is <probe>
    When the pause-queue decider is consulted at "2026-09-22T12:51:00Z" by <cron>
    Then the pause-queue decider returns "skip_not_owner"

    Examples:
      | cron                                                        | reset                                  | probe                                                                    | decision without ownership |
      | the cron polling the target repository "acme/gadgets"       | a reset time of "2026-09-22T13:50:00Z" | "clear"                                                                  | skip_before_reset          |
      | the cron polling the target repository "acme/gadgets"       | no reset time                          | "clear"                                                                  | resume                     |
      | the cron polling the target repository "acme/gadgets"       | no reset time                          | "failed"                                                                 | evict                      |
      | the cron polling the target repository "acme/gadgets"       | no reset time                          | "unknown"                                                                | evict                      |
      | the cron polling the target repository "acme/gadgets"       | no reset time                          | "limited" with a "five_hour" limit that resets at "2026-09-22T17:50:00Z" | refresh_reset              |
      | the self-host cron on a host checked out at "acme/adw-host" | no reset time                          | "clear"                                                                  | resume                     |
      | the self-host cron on a host checked out at "acme/adw-host" | no reset time                          | "failed"                                                                 | evict                      |

  @adw-911 @adw-gtxas1-per-repo-ownership-o
  Scenario Outline: An entry that records no target repository belongs to the self-host cron, which decides it by the other rules, and to no cron launched with --target-repo
    Given a pause-queue entry recorded for no target repository, with <reset> and <failures> probe failures
    And the rate-limit probe classification is "<verdict>"
    When the pause-queue decider is consulted at "2026-09-22T12:51:00Z" by <cron>
    Then the pause-queue decider returns "<action>"

    Examples:
      | cron                                                        | reset                                  | verdict | failures | action            |
      | the self-host cron on a host checked out at "acme/adw-host" | no reset time                          | clear   | 0        | resume            |
      | the self-host cron on a host checked out at "acme/adw-host" | no reset time                          | failed  | 0        | count_strike      |
      | the self-host cron on a host checked out at "acme/adw-host" | no reset time                          | unknown | 2        | evict             |
      | the self-host cron on a host checked out at "acme/adw-host" | a reset time of "2026-09-22T13:50:00Z" | clear   | 0        | skip_before_reset |
      | the cron polling the target repository "acme/widgets"       | no reset time                          | clear   | 0        | skip_not_owner    |
      | the cron polling the target repository "acme/widgets"       | no reset time                          | failed  | 2        | skip_not_owner    |

  @adw-911 @adw-gtxas1-per-repo-ownership-o
  Scenario Outline: The self-host cron owns an entry recorded for its own checkout's repository — the target every workflow it spawns is given — and no entry recorded for another repository
    Given a pause-queue entry recorded for the target repository "<entry target>", with no reset time and 0 probe failures
    And the rate-limit probe classification is "clear"
    When the pause-queue decider is consulted at "2026-09-22T12:51:00Z" by the self-host cron on a host checked out at "acme/adw-host"
    Then the pause-queue decider returns "<action>"

    Examples:
      | entry target  | action         |
      | acme/adw-host | resume         |
      | acme/widgets  | skip_not_owner |

  # ── §2 EACH CRON ACTS ONLY ON ITS OWN ENTRIES ──────────────────────────────────────────────────

  @adw-911 @adw-gtxas1-per-repo-ownership-o
  Scenario: A confirmed failure probed by one cron strikes only that cron's own workflow — the other cron's workflow, one strike short of eviction, keeps its strikes and its last-probe time and gets no comment until its owner's scan evicts it
    Given the mock GitHub API is configured to accept issue comments
    And a workflow for issue 874 is paused in the rate-limit queue for the target repository "acme/widgets"
    And the paused workflow for issue 874 has already recorded 2 unknown probe failures
    And the paused workflow for issue 874 was last probed at "2026-09-25T08:40:00Z"
    And a workflow for issue 877 is paused in the rate-limit queue for the target repository "acme/gadgets"
    And the Claude CLI answers the rate-limit probe with exit code 1 and stdout:
      """
      {"type":"system","subtype":"init","session_id":"probe-911"}
      {"type":"system","subtype":"api_retry","attempt":1,"max_retries":10,"retry_delay_ms":500,"error_status":401,"error":"authentication_failed","session_id":"probe-911"}
      {"type":"result","subtype":"success","is_error":true,"api_error_status":401,"terminal_reason":"api_error","result":"OAuth token has expired · Please run /login","session_id":"probe-911"}
      """
    When the pause-queue scanner of the cron polling the target repository "acme/gadgets" runs 1 probe cycle
    Then the pause queue entry for issue 877 records 1 probe failure
    And the pause queue still holds the workflow for issue 874
    And the pause queue entry for issue 874 has not gained a probe failure
    And the pause queue entry for issue 874 still records its last probe at "2026-09-25T08:40:00Z"
    And the mock harness recorded zero comment posts on issue 874
    When the pause-queue scanner of the cron polling the target repository "acme/widgets" runs 1 probe cycle
    Then the pause queue no longer holds the workflow for issue 874
    And the mock GitHub API recorded a comment on issue 874
    And the pause queue entry for issue 877 records 1 probe failure

  @adw-911 @adw-gtxas1-per-repo-ownership-o
  Scenario: On a clear probe each cron relaunches only its own paused workflow, into its own repository — the workflow another cron owns stays queued, unlaunched and uncommented until its owner scans
    Given the mock GitHub API is configured to accept issue comments
    And a workflow for issue 875 is paused in the rate-limit queue for the target repository "acme/widgets"
    And a workflow for issue 876 is paused in the rate-limit queue for the target repository "acme/gadgets"
    And the Claude CLI answers the rate-limit probe with exit code 0 and stdout:
      """
      {"type":"system","subtype":"init","session_id":"probe-911"}
      {"type":"assistant","message":{"content":[{"type":"text","text":"pong"}]}}
      {"type":"result","subtype":"success","is_error":false,"result":"pong"}
      """
    When the pause-queue scanner of the cron polling the target repository "acme/gadgets" runs 1 probe cycle
    Then the paused workflow for issue 876 is relaunched under its original adwId
    And the paused workflow for issue 876 is relaunched with the target repository "acme/gadgets"
    And the resumed comment is recorded on issue 876 in the target repository "acme/gadgets"
    And the pause queue still holds the workflow for issue 875
    And the paused workflow for issue 875 has not been relaunched
    And the mock harness recorded zero comment posts on issue 875
    When the pause-queue scanner of the cron polling the target repository "acme/widgets" runs 1 probe cycle
    Then the paused workflow for issue 875 is relaunched under its original adwId
    And the paused workflow for issue 875 is relaunched with the target repository "acme/widgets"
    And the resumed comment is recorded on issue 875 in the target repository "acme/widgets"
    And the pause queue no longer holds the workflow for issue 875
    And the paused workflow for issue 876 has been relaunched 1 time

  @adw-911 @adw-gtxas1-per-repo-ownership-o
  Scenario: A limited probe taken by one cron moves only that cron's own entry to the reported reset time — the other cron's entry keeps its reset time and its last-probe time
    Given the mock GitHub API is configured to accept issue comments
    And the cron host's clock reads "2026-09-22T12:51:00Z"
    And a workflow for issue 871 is paused in the rate-limit queue for the target repository "acme/widgets"
    And the paused workflow for issue 871 was queued with a "five_hour" limit that resets at "2026-09-22T12:50:00Z"
    And the paused workflow for issue 871 was last probed at "2026-09-22T12:45:00Z"
    And a workflow for issue 872 is paused in the rate-limit queue for the target repository "acme/gadgets"
    And the Claude CLI answers the rate-limit probe with exit code 1 and stdout:
      """
      {"type":"system","subtype":"init","session_id":"probe-911"}
      {"type":"rate_limit_event","rate_limit_info":{"status":"rejected","resetsAt":1790099400,"rateLimitType":"five_hour"},"session_id":"probe-911"}
      {"type":"result","subtype":"success","is_error":true,"api_error_status":429,"terminal_reason":"api_error","result":"You've hit your session limit · resets 7:50pm (Europe/Amsterdam)","session_id":"probe-911"}
      """
    When the pause-queue scanner of the cron polling the target repository "acme/gadgets" runs 1 probe cycle
    Then the pause queue entry for issue 872 records the reset time "2026-09-22T17:50:00Z"
    And the pause queue entry for issue 871 records the reset time "2026-09-22T12:50:00Z"
    And the pause queue entry for issue 871 still records its last probe at "2026-09-22T12:45:00Z"
    And the mock harness recorded zero comment posts on issue 871
    When the pause-queue scanner of the cron polling the target repository "acme/widgets" runs 1 probe cycle
    Then the pause queue entry for issue 871 records the reset time "2026-09-22T17:50:00Z"
    And the pause queue entry for issue 871 has not gained a probe failure

  @adw-911 @adw-gtxas1-per-repo-ownership-o
  Scenario: A cron whose own entries are all still before their reset times runs no probe, even while another cron's entry is due, and leaves that entry to its owner
    Given the cron host's clock reads "2026-09-25T09:00:00Z"
    And a workflow for issue 874 is paused in the rate-limit queue for the target repository "acme/widgets"
    And the paused workflow for issue 874 was queued with a "seven_day" limit that resets at "2026-09-28T07:00:00Z"
    And a workflow for issue 877 is paused in the rate-limit queue for the target repository "acme/gadgets"
    And the Claude CLI answers the rate-limit probe with exit code 1 and stdout:
      """
      {"type":"system","subtype":"init","session_id":"probe-911"}
      {"type":"system","subtype":"api_retry","attempt":1,"max_retries":10,"retry_delay_ms":500,"error_status":401,"error":"authentication_failed","session_id":"probe-911"}
      {"type":"result","subtype":"success","is_error":true,"api_error_status":401,"terminal_reason":"api_error","result":"OAuth token has expired · Please run /login","session_id":"probe-911"}
      """
    When the pause-queue scanner of the cron polling the target repository "acme/widgets" runs 3 probe cycles
    Then the scanner did not run the rate-limit probe
    And the pause queue still holds a workflow for each of these issues, none of which has gained a probe failure:
      | issue |
      | 874   |
      | 877   |
    When the pause-queue scanner of the cron polling the target repository "acme/gadgets" runs 1 probe cycle
    Then the scanner ran the rate-limit probe once per probe cycle
    And the pause queue entry for issue 877 records 1 probe failure
    And the pause queue entry for issue 874 has not gained a probe failure
    And the pause queue entry for issue 874 records the reset time "2026-09-28T07:00:00Z"

  @adw-911 @adw-gtxas1-per-repo-ownership-o
  Scenario: Replaying 2026-09-22 — two crons on one host scan #840's entry back to back, and only the owning cron's scans spend its three-strike budget
    Given the mock GitHub API is configured to accept issue comments
    And a workflow for issue 840 is paused in the rate-limit queue for the target repository "acme/adw-host"
    And the Claude CLI answers the rate-limit probe with exit code 1 and stderr:
      """
      Error: Claude Code process exited unexpectedly
      """
    When the pause-queue scanner of the cron polling the target repository "acme/platform" runs 1 probe cycle
    And the pause-queue scanner of the self-host cron on a host checked out at "acme/adw-host" runs 1 probe cycle
    Then the pause queue entry for issue 840 records 1 probe failure
    When the pause-queue scanner of the cron polling the target repository "acme/platform" runs 3 probe cycles
    Then the pause queue entry for issue 840 records 1 probe failure
    And the mock harness recorded zero comment posts on issue 840
    When the pause-queue scanner of the self-host cron on a host checked out at "acme/adw-host" runs 2 probe cycles
    Then the pause queue no longer holds the workflow for issue 840
    And the mock GitHub API recorded a comment on issue 840

  @adw-911 @adw-gtxas1-per-repo-ownership-o
  Scenario: A workflow paused with no target repository is struck only by the self-host cron — a cron launched with --target-repo leaves it alone
    Given a workflow for issue 878 is paused in the rate-limit queue with no target repository
    And the paused workflow for issue 878 was last probed at "2026-09-25T08:40:00Z"
    And the Claude CLI answers the rate-limit probe with exit code 1 and stdout:
      """
      {"type":"system","subtype":"init","session_id":"probe-911"}
      {"type":"system","subtype":"api_retry","attempt":1,"max_retries":10,"retry_delay_ms":500,"error_status":401,"error":"authentication_failed","session_id":"probe-911"}
      {"type":"result","subtype":"success","is_error":true,"api_error_status":401,"terminal_reason":"api_error","result":"OAuth token has expired · Please run /login","session_id":"probe-911"}
      """
    When the pause-queue scanner of the cron polling the target repository "acme/widgets" runs 1 probe cycle
    Then the pause queue still holds the workflow for issue 878
    And the pause queue entry for issue 878 has not gained a probe failure
    And the pause queue entry for issue 878 still records its last probe at "2026-09-25T08:40:00Z"
    When the pause-queue scanner of the self-host cron on a host checked out at "acme/adw-host" runs 1 probe cycle
    Then the pause queue entry for issue 878 records 1 probe failure

  # ── §3 THE ENTRY LEAVES THE QUEUE BEFORE THE ORCHESTRATOR IS SPAWNED ───────────────────────────

  @adw-911 @adw-gtxas1-per-repo-ownership-o
  Scenario: A resume takes the workflow off the queue before it spawns the orchestrator — at the moment of the spawn the queue no longer holds the entry
    Given the mock GitHub API is configured to accept issue comments
    And a workflow for issue 871 is paused in the rate-limit queue for the target repository "acme/widgets"
    And the Claude CLI answers the rate-limit probe with exit code 0 and stdout:
      """
      {"type":"system","subtype":"init","session_id":"probe-911"}
      {"type":"assistant","message":{"content":[{"type":"text","text":"pong"}]}}
      {"type":"result","subtype":"success","is_error":false,"result":"pong"}
      """
    When the pause-queue scanner of the cron polling the target repository "acme/widgets" runs 1 probe cycle
    Then the pause queue no longer held the workflow for issue 871 when its orchestrator was spawned
    And the paused workflow for issue 871 is relaunched under its original adwId
    And the paused workflow for issue 871 is relaunched with the target repository "acme/widgets"
    And the pause queue no longer holds the workflow for issue 871
    And the resumed comment is recorded on issue 871 in the target repository "acme/widgets"

  @adw-911 @adw-gtxas1-per-repo-ownership-o
  Scenario: A second scan that starts while a relaunch is still inside its readiness window finds no entry to act on, so the workflow is relaunched exactly once
    Given a workflow for issue 872 is paused in the rate-limit queue for the target repository "acme/widgets"
    And the Claude CLI answers the rate-limit probe with exit code 0 and stdout:
      """
      {"type":"system","subtype":"init","session_id":"probe-911"}
      {"type":"assistant","message":{"content":[{"type":"text","text":"pong"}]}}
      {"type":"result","subtype":"success","is_error":false,"result":"pong"}
      """
    When the pause-queue scanner of the cron polling the target repository "acme/widgets" runs two overlapping probe cycles, the second starting while the first cycle's relaunch of issue 872 is still inside its readiness window
    Then the paused workflow for issue 872 has been relaunched 1 time
    And the pause queue no longer holds the workflow for issue 872

  @adw-911 @adw-gtxas1-per-repo-ownership-o
  Scenario: A relaunch whose orchestrator dies inside the readiness window puts the workflow back on the queue with one more strike and everything else it recorded, posts no resumed comment, and the owning cron's next clear scan relaunches it
    Given the mock GitHub API is configured to accept issue comments
    And the cron host's clock reads "2026-09-22T12:51:00Z"
    And a workflow for issue 873 is paused in the rate-limit queue for the target repository "acme/widgets"
    And the paused workflow for issue 873 was queued with a "five_hour" limit that resets at "2026-09-22T12:50:00Z"
    And the orchestrator of the paused workflow for issue 873 exits as soon as it starts on its first launch
    And the Claude CLI answers the rate-limit probe with exit code 0 and stdout:
      """
      {"type":"system","subtype":"init","session_id":"probe-911"}
      {"type":"assistant","message":{"content":[{"type":"text","text":"pong"}]}}
      {"type":"result","subtype":"success","is_error":false,"result":"pong"}
      """
    When the pause-queue scanner of the cron polling the target repository "acme/widgets" runs 1 probe cycle
    Then the pause queue no longer held the workflow for issue 873 when its orchestrator was spawned
    And the paused workflow for issue 873 has been relaunched 1 time
    And the pause queue still holds the workflow for issue 873
    And the pause queue entry for issue 873 records 1 probe failure
    And the pause queue entry for issue 873 still records the target repository "acme/widgets"
    And the pause queue entry for issue 873 records the reset time "2026-09-22T12:50:00Z"
    And the pause queue entry for issue 873 records the limit type "five_hour"
    And the mock harness recorded zero comment posts on issue 873
    When the pause-queue scanner of the cron polling the target repository "acme/widgets" runs 1 probe cycle
    Then the paused workflow for issue 873 has been relaunched 2 times
    And the pause queue no longer holds the workflow for issue 873
    And the resumed comment is recorded on issue 873 in the target repository "acme/widgets"

  @adw-911 @adw-gtxas1-per-repo-ownership-o
  Scenario: A resume that finds the issue's spawn lock held by a live process leaves the workflow queued without a strike, and relaunches it once that process is gone
    Given the mock GitHub API is configured to accept issue comments
    And a workflow for issue 874 is paused in the rate-limit queue for the target repository "acme/widgets"
    And another live process holds the spawn lock for issue 874 in the repository "acme/widgets"
    And the Claude CLI answers the rate-limit probe with exit code 0 and stdout:
      """
      {"type":"system","subtype":"init","session_id":"probe-911"}
      {"type":"assistant","message":{"content":[{"type":"text","text":"pong"}]}}
      {"type":"result","subtype":"success","is_error":false,"result":"pong"}
      """
    When the pause-queue scanner of the cron polling the target repository "acme/widgets" runs 1 probe cycle
    Then the pause queue still holds the workflow for issue 874
    And the pause queue entry for issue 874 has not gained a probe failure
    And the paused workflow for issue 874 has not been relaunched
    And the mock harness recorded zero comment posts on issue 874
    When the process holding the spawn lock for issue 874 in the repository "acme/widgets" exits
    And the pause-queue scanner of the cron polling the target repository "acme/widgets" runs 1 probe cycle
    Then the paused workflow for issue 874 is relaunched under its original adwId
    And the pause queue no longer holds the workflow for issue 874

  # ── §4 THE CRON TRIGGER HANDS THE SCANNER ITS OWN IDENTITY ─────────────────────────────────────

  @adw-911 @adw-gtxas1-per-repo-ownership-o
  Scenario: A cron trigger process launched with --target-repo hands its pause-queue scanner that identity — its first probing tick relaunches its own paused workflow and leaves another repository's alone
    Given the mock GitHub API is configured to accept issue comments
    And a workflow for issue 871 is paused in the rate-limit queue for the target repository "acme/widgets"
    And a workflow for issue 872 is paused in the rate-limit queue for the target repository "acme/gadgets"
    And the rate-limit probe reports the limit has cleared
    When a cron trigger process launched with --target-repo "acme/widgets" completes its first probing poll tick
    Then the paused workflow for issue 871 is relaunched under its original adwId
    And the paused workflow for issue 871 is relaunched with the target repository "acme/widgets"
    And the pause queue no longer holds the workflow for issue 871
    And the resumed comment is recorded on issue 871 in the target repository "acme/widgets"
    And the pause queue still holds the workflow for issue 872
    And the pause queue entry for issue 872 has not gained a probe failure
    And the paused workflow for issue 872 has not been relaunched
    And the mock harness recorded zero comment posts on issue 872

  # ── §5 BACKSTOPS ───────────────────────────────────────────────────────────────────────────────

  @adw-911 @adw-gtxas1-per-repo-ownership-o
  Scenario: TypeScript type-check passes with the scanning cron's identity threaded from the cron trigger through the scanner into the decider
    Then the ADW TypeScript type-check passes

  @adw-911 @adw-gtxas1-per-repo-ownership-o
  Scenario: The git/gh guard stays green with the cron handing its launch identity to the pause-queue scanner — no new context is constructed
    When the git/gh guard is run across the repository
    Then the git/gh guard reports no violations
