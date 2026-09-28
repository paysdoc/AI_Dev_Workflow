@adw-902 @adw-0uxemg-pause-queue-probe-mi
Feature: The pause-queue probe recognises a session limit the way the agents do — from the same stream parser, with a text fallback that knows the session-limit wording — so a workflow paused on a multi-hour limit stays queued and resumes when the limit clears

  Issue #902 is a production stranding, not a refactor. On 2026-09-24 six adwChore workflows
  (#871, #872, #874–#877) paused on a Claude session limit around 10:12 UTC. The orchestrator
  paused them correctly. Around 10:26 UTC the cron's pause-queue scanner dropped all six from
  `agents/paused_queue.json` with "failed to resume after 3 probe attempts. Manual restart
  required." They were left stranded in `workflowStage: paused` with no recovery path, still
  counted against `MAX_CONCURRENT_PER_REPO`, and starving #878/#879 behind them.

  The chain, as recorded in the issue:

    1. `probeRateLimit()` (`adws/triggers/pauseQueueScanner.ts`) runs `claude --print "ping"` in
       plain-text mode and substring-matches the output against a hand-kept `RATE_LIMIT_STRINGS`
       list.
    2. The CLI now words the limit `You've hit your session limit · resets 1:50pm
       (Europe/Amsterdam)`. That does not contain `You've hit your limit`, so a non-zero exit with
       unmatched text is classified `unknown`.
    3. `unknown` increments `probeFailures`. With `MAX_UNKNOWN_PROBE_FAILURES=3` and a probe every
       `PROBE_INTERVAL_CYCLES` (15 × 20 s ≈ 5 min), any real multi-hour limit is dropped after
       about 15 minutes.
    4. The orchestrator never had this problem because it does not match text at all. It reads the
       stream-json `rate_limit_event` whose `rate_limit_info.status` is `"rejected"`
       (`adws/core/claudeStreamParser.ts`, consumed in `adws/agents/agentProcessHandler.ts`). The
       probe's comment claiming its string list is the "same as agentProcessHandler detection" is
       false. The two detectors had silently diverged.

  The fix makes the probe structural. It runs the CLI with `--output-format stream-json --verbose`
  and classifies `limited` from the same parser state the agents pause on: `rateLimitRejected`,
  plus the server-error and overloaded flags. Substring matching survives only as a fallback for
  failure output that never became stream-json (the process died first), and that fallback knows
  the session-limit wording.

  The labels below are the section numbers used for the scenario groups further down (§1–§4):

    §1  THE PROBE'S VERDICT (AC1, AC2; the outcome list AC4 asks the unit tests to cover). The
        probe runs on its own against a stubbed Claude CLI. A rejected `rate_limit_event` is
        `limited` whatever the text says and whatever the exit code. Non-JSON failure text carrying
        the limit wording is `limited` on either output stream. A clean reply is `clear`, including
        one that carries a `rate_limit_event` that was not rejected. Anything else is still
        `unknown`. §1 also pins that the probe actually ASKS the CLI for verbose stream-json.
        Without that request the real CLI never emits a `rate_limit_event`: every structured row
        would pass against a stub while production silently fell back to text.

    §2  ONE DETECTOR, NOT TWO (Fix 1). Every stream event that ends an agent run rate-limited also
        makes the probe report `limited`. The same CLI output is fed to both, and the two verdicts
        are asserted side by side.

    §3  A LIMITED PROBE NEVER COUNTS TOWARD THE DROP (AC3). This section goes through the scanner,
        not the probe alone.
          • A workflow held by a session limit stays queued through three hours of probes without
            gaining a probe failure or an issue comment. It resumes on the first probe after the
            limit clears.
          • A workflow already one failure short of the threshold is not pushed over it by a
            limited probe.
          • The incident is replayed: six workflows, text-only session-limit output, and the three
            probe cycles that used to drop them.
          • A genuinely unknown failure still counts and still drops at the third. This keeps the
            fix from degrading into "everything is limited", which would leave dead workflows
            queued forever.

    §4  TYPE-CHECK BACKSTOP.

  AMENDED BY #907 (`specs/prd/rate-limit-indefinite-retry.md`, "Detection"). #907 makes three
  changes that affect this file:
    • It deletes the text fallback. Output with no parseable JSON is now `unknown`, whatever it says.
    • It classifies `api_retry` by the documented enum, in which overload is `overloaded`, not
      `overloaded_error`.
    • It makes an authentication failure a confirmed failure rather than `limited`.
  The narrative above describes #902 as shipped and is left as written. Where it disagrees with the
  scenarios below, the scenarios are current:
    • §1's non-JSON outline is inverted. Limit wording without JSON now reports "unknown".
    • §2's overloaded row uses the documented `"error":"overloaded"`.
    • §3's threshold scenario and 2026-09-24 replay now answer with the stream-json the probe
      requests: a rejected `rate_limit_event` with its `resetsAt`, plus a `result` carrying
      `api_error_status: 429`. Text-only output no longer holds a workflow as limited.
  Those scenarios also carry `@adw-907`, as do the unchanged ones that guard the classifier #907
  rewrites. The rest of #907's behaviour is specified in `features/per-issue/feature-907.feature`.

  AMENDED BY #910 (`specs/prd/rate-limit-indefinite-retry.md`, "Pause queue"). #910 puts the
  scanner behind a pure decider and lets a queue entry carry the limit's reset time. It also
  rewrites the eviction comment: instead of asking for a manual restart, it names `## Retry`
  (#908) as the recovery. In this file:
    • §3's unknown-drop scenario is renamed. It keeps its "failed to resume after 3 probe
      attempts" assertion and now also requires the comment to name `## Retry`.
    • §3's three-hour journey, threshold scenario and 2026-09-24 replay are unchanged. Every entry
      they seed was written without a reset time. The journey pins the cadence path such entries
      must keep. The other two pin that a limited probe never counts a strike, even when it
      reports a reset time.
  Those four scenarios also carry `@adw-910`. The rest of #910's behaviour is specified in
  `features/per-issue/feature-910.feature`.

  FLAGGED BY #911 (`specs/prd/rate-limit-indefinite-retry.md`, "Pause queue": ownership and
  remove-before-spawn). Every scan now runs as one cron, and a cron acts only on the entries it
  owns. The shared scanner step runs as the cron polling `acme/widgets`, which owns every entry
  seeded here, so no scenario in this file changes. Two of them also carry `@adw-911`, because
  #911 changes what they exercise:
    • §3's three-hour journey: its resume now takes the entry off the queue before it spawns the
      orchestrator;
    • §3's unknown-drop scenario: its strikes and its eviction now pass the ownership rule first.
  The rest of #911's behaviour is specified in `features/per-issue/feature-911.feature`.

  How these scenarios observe the system. Every assertion targets a runtime artefact:
    • the verdict the probe returns (`clear` / `limited` / `unknown`), which is its output;
    • the Claude CLI invocation recorded at the probe's exec seam: what the system asked of its
      dependency, not what a source file says;
    • the `rateLimited` outcome of an agent run fed the same output;
    • the pause-queue state file the scanner writes (entry present or gone, its `probeFailures`);
    • the relaunch the resume path performs;
    • the comments the scanner posts, as recorded by the mock GitHub API.
  No scenario reads, greps or parses a source file. For that reason two parts of the fix are
  deliberately left without a scenario: correcting the false "same as agentProcessHandler" comment
  (Fix 3) and adding the session-limit text to `adws/known_issues.md` (Fix 4). Both are source or
  documentation text, and asserting on them would be exactly the rot the Rot-Detection Rubric
  forbids.

  AC5 ("existing pause/resume scenarios stay green") is carried by the regular `@regression` run
  of `features/regression/smoke/pause_resume_rate_limit.feature`. That file is not re-tagged here:
  the regression suite is human-curated.

  Notes for the step definitions:

    • NEVER SPAWN THE REAL CLAUDE CLI. "the Claude CLI answers the rate-limit probe with exit code
      N and <stream>:" stubs the CLI in one of two ways. Either use the probe's injectable exec
      seam (AC4), or point `CLAUDE_CODE_PATH` at a throwaway script that writes the docstring,
      plus a trailing newline as the real CLI does, to the named stream and exits N. Either way
      the stub records the invocation it received; §1's request assertions read that record. The
      same stub serves the probe on its own (§1, §2) and inside the scanner (§3). A later
      "answers" step replaces the earlier reply.
    • "the pause-queue scanner runs N probe cycle(s)" means N probing scans: `scanPauseQueue` is
      invoked on N successive cycle counts that are multiples of `PROBE_INTERVAL_CYCLES`, so every
      invocation probes. 36 cycles is three hours of production probing (36 × 5 min).
    • `PAUSE_QUEUE_PATH` is cwd-relative (`agents/paused_queue.json`). A step must never clobber
      a live queue on an operator checkout: save and restore any pre-existing file, or run against
      a throwaway directory. Clean up everything a scan writes under `agents/`.
    • The target repository `acme/widgets` is deliberately fictional, so a mis-wired step can
      never post a real "Manual restart required" comment on the real incident issues. The scanner
      posts through a launch boundary built for the entry's own `--target-repo`. Route those posts
      to the mock GitHub API, and give the process no real GitHub App credentials. Mock setup is
      scoped to `@regression`, so initialise it in a `Before` hook scoped to `@adw-902`. Every
      scenario that asserts zero comment posts also carries the registered "accept issue comments"
      Given, which fails fast on an uninitialised mock. The journey's recorded resumed comment and
      the drop scenario's recorded error comment are the positive controls that prove the scanner's
      posts reach the mock at all.
    • The resume path has preconditions that the paused-workflow Given must seed:
        – the entry's worktree exists;
        – a top-level state file for its adwId carries the same adwId (the canonical-claim check);
        – the per-issue spawn lock is free.
      The entry's orchestrator script must be a FIXTURE, never a real orchestrator. It records its
      launch arguments and stays alive past the resume path's 2-second readiness window. Kill it in
      an `After` hook.
    • §2's agent run feeds the stubbed stdout through `handleAgentProcess` on a fake child process.
      "ends rate-limited" is the `rateLimited` flag on the result it resolves.
    • Cross-check, not a flag: #812's tick-guard scenario spawns a real cron against
      `test/mocks/claude-cli-stub.ts`. It relies on this probe classifying the stub's clean
      stream-json reply as `clear`, so keep it green.

  Vocabulary note. These registered phrases from `features/regression/vocabulary.md` are reused:
    • G18 `the ADW codebase is checked out`
    • G20 `a workflow for issue {int} is paused in the rate-limit queue for the target repository {string}`
    • G1 `the mock GitHub API is configured to accept issue comments`
    • T2 `the mock GitHub API recorded a comment on issue {int}`
    • T3 `the mock GitHub API recorded a comment containing the text {string}`
    • T14 `the mock harness recorded zero comment posts on issue {int}`
    • T22 `the ADW TypeScript type-check passes`
  W13 `the pause-queue resume scan runs` is deliberately NOT reused. It is registered as invoking
  `resumeWorkflow` directly, with no probe, and every scenario here needs the probe in the loop.
  The registry has no phrase for any of the following, so novel phrasing is introduced for them:
    • stubbing the probe's CLI reply;
    • running the probe on its own, or reading its verdict and its request;
    • feeding the same output through an agent run;
    • running probing scan cycles;
    • asserting pause-queue entry presence, failure counts and the relaunch.

  Background:
    Given the ADW codebase is checked out

  @adw-902 @adw-0uxemg-pause-queue-probe-mi @adw-907
  Scenario Outline: A rejected rate_limit_event makes the probe report "limited" whatever the text says and whatever the exit code
    Given the Claude CLI answers the rate-limit probe with exit code <exit> and stdout:
      """
      {"type":"system","subtype":"init","session_id":"probe-902"}
      {"type":"rate_limit_event","rate_limit_info":{"status":"rejected","rateLimitType":"five_hour"}}
      {"type":"assistant","message":{"content":[{"type":"text","text":"<text>"}]}}
      {"type":"result","subtype":"success","is_error":true,"result":"<text>"}
      """
    When the rate-limit probe runs
    Then the rate-limit probe reports "limited"

    Examples:
      | exit | text                                                              |
      | 1    | You've hit your session limit · resets 1:50pm (Europe/Amsterdam) |
      | 1    | Session capacity reached · back at 1:50pm                         |
      | 0    | You've hit your session limit · resets 1:50pm (Europe/Amsterdam) |

  @adw-902 @adw-0uxemg-pause-queue-probe-mi @adw-907
  Scenario Outline: Non-JSON failure output carrying the limit wording makes the probe report "unknown" — #907 deleted the text fallback
    Given the Claude CLI answers the rate-limit probe with exit code 1 and <stream>:
      """
      <text>
      """
    When the rate-limit probe runs
    Then the rate-limit probe reports "unknown"

    Examples:
      | stream | text                                                              |
      | stderr | You've hit your session limit · resets 1:50pm (Europe/Amsterdam) |
      | stdout | You've hit your session limit · resets 1:50pm (Europe/Amsterdam) |
      | stderr | You've hit your limit · resets 3pm (Europe/Amsterdam)             |
      | stderr | You're out of extra usage                                         |

  @adw-902 @adw-0uxemg-pause-queue-probe-mi @adw-907
  Scenario: A clean stream-json reply makes the probe report "clear"
    Given the Claude CLI answers the rate-limit probe with exit code 0 and stdout:
      """
      {"type":"system","subtype":"init","session_id":"probe-902"}
      {"type":"assistant","message":{"content":[{"type":"text","text":"pong"}]}}
      {"type":"result","subtype":"success","is_error":false,"result":"pong"}
      """
    When the rate-limit probe runs
    Then the rate-limit probe reports "clear"

  @adw-902 @adw-0uxemg-pause-queue-probe-mi @adw-907
  Scenario Outline: A rate_limit_event that was not rejected does not hold the probe as limited
    Given the Claude CLI answers the rate-limit probe with exit code 0 and stdout:
      """
      {"type":"system","subtype":"init","session_id":"probe-902"}
      <event>
      {"type":"assistant","message":{"content":[{"type":"text","text":"pong"}]}}
      {"type":"result","subtype":"success","is_error":false,"result":"pong"}
      """
    When the rate-limit probe runs
    Then the rate-limit probe reports "clear"

    Examples:
      | event                                                                                                   |
      | {"type":"rate_limit_event","rate_limit_info":{"status":"allowed_warning","rateLimitType":"five_hour"}} |
      | {"type":"rate_limit_event","rate_limit_info":{"status":"allowed","overageStatus":"rejected"}}          |

  @adw-902 @adw-0uxemg-pause-queue-probe-mi @adw-907
  Scenario Outline: A failed probe with neither a pause-worthy event nor limit wording still reports "unknown"
    Given the Claude CLI answers the rate-limit probe with exit code 1 and <stream>:
      """
      <output>
      """
    When the rate-limit probe runs
    Then the rate-limit probe reports "unknown"

    Examples:
      | stream | output                                                                                                              |
      | stderr | Error: Claude Code process exited unexpectedly                                                                      |
      | stdout | {"type":"result","subtype":"error_during_execution","is_error":true,"result":"API Error: 400 invalid_request_error"} |

  @adw-902 @adw-0uxemg-pause-queue-probe-mi
  Scenario: The probe asks the Claude CLI for the verbose stream-json output the agents' detector reads
    Given the Claude CLI answers the rate-limit probe with exit code 0 and stdout:
      """
      {"type":"result","subtype":"success","is_error":false,"result":"pong"}
      """
    When the rate-limit probe runs
    Then the rate-limit probe requested "stream-json" output from the Claude CLI
    And the rate-limit probe requested verbose output from the Claude CLI

  @adw-902 @adw-0uxemg-pause-queue-probe-mi @adw-907
  Scenario Outline: Every stream event that ends an agent run rate-limited also makes the probe report "limited"
    Given the Claude CLI answers the rate-limit probe with exit code 1 and stdout:
      """
      {"type":"system","subtype":"init","session_id":"probe-902"}
      <event>
      {"type":"result","subtype":"success","is_error":true,"result":"Request failed"}
      """
    When the rate-limit probe runs
    And the same Claude CLI output is streamed through an agent run
    Then the agent run ends rate-limited
    And the rate-limit probe reports "limited"

    Examples:
      | event                                                                                           |
      | {"type":"rate_limit_event","rate_limit_info":{"status":"rejected","rateLimitType":"five_hour"}} |
      | {"type":"system","subtype":"api_retry","attempt":1,"error":"overloaded","error_status":529}     |
      | {"type":"system","subtype":"api_retry","attempt":2,"error":"api_error","error_status":500}      |

  @adw-902 @adw-0uxemg-pause-queue-probe-mi @adw-907 @adw-910 @adw-911
  Scenario: A workflow held by a session limit stays queued through three hours of probes and resumes on the first probe after the limit clears
    Given the mock GitHub API is configured to accept issue comments
    And a workflow for issue 871 is paused in the rate-limit queue for the target repository "acme/widgets"
    And the Claude CLI answers the rate-limit probe with exit code 1 and stdout:
      """
      {"type":"system","subtype":"init","session_id":"probe-902"}
      {"type":"rate_limit_event","rate_limit_info":{"status":"rejected","rateLimitType":"five_hour"}}
      {"type":"result","subtype":"success","is_error":true,"result":"You've hit your session limit · resets 1:50pm (Europe/Amsterdam)"}
      """
    When the pause-queue scanner runs 36 probe cycles
    Then the pause queue still holds the workflow for issue 871
    And the pause queue entry for issue 871 has not gained a probe failure
    And the mock harness recorded zero comment posts on issue 871
    When the Claude CLI answers the rate-limit probe with exit code 0 and stdout:
      """
      {"type":"system","subtype":"init","session_id":"probe-902"}
      {"type":"assistant","message":{"content":[{"type":"text","text":"pong"}]}}
      {"type":"result","subtype":"success","is_error":false,"result":"pong"}
      """
    And the pause-queue scanner runs 1 probe cycle
    Then the paused workflow for issue 871 is relaunched under its original adwId
    And the pause queue no longer holds the workflow for issue 871
    And the mock GitHub API recorded a comment on issue 871

  @adw-902 @adw-0uxemg-pause-queue-probe-mi @adw-907 @adw-910
  Scenario: A limited probe does not push a workflow already one failure short of the threshold over it
    Given the mock GitHub API is configured to accept issue comments
    And a workflow for issue 875 is paused in the rate-limit queue for the target repository "acme/widgets"
    And the paused workflow for issue 875 has already recorded 2 unknown probe failures
    And the Claude CLI answers the rate-limit probe with exit code 1 and stdout:
      """
      {"type":"system","subtype":"init","session_id":"probe-902"}
      {"type":"rate_limit_event","rate_limit_info":{"status":"rejected","resetsAt":1790250600,"rateLimitType":"five_hour"}}
      {"type":"result","subtype":"success","is_error":true,"api_error_status":429,"terminal_reason":"api_error","result":"You've hit your session limit · resets 1:50pm (Europe/Amsterdam)"}
      """
    When the pause-queue scanner runs 1 probe cycle
    Then the pause queue still holds the workflow for issue 875
    And the pause queue entry for issue 875 has not gained a probe failure
    And the mock harness recorded zero comment posts on issue 875

  @adw-902 @adw-0uxemg-pause-queue-probe-mi @adw-907 @adw-910
  Scenario: Replaying 2026-09-24 — six workflows paused on a session limit are all still queued after the three probe cycles that used to drop them
    Given a workflow for issue 871 is paused in the rate-limit queue for the target repository "acme/widgets"
    And a workflow for issue 872 is paused in the rate-limit queue for the target repository "acme/widgets"
    And a workflow for issue 874 is paused in the rate-limit queue for the target repository "acme/widgets"
    And a workflow for issue 875 is paused in the rate-limit queue for the target repository "acme/widgets"
    And a workflow for issue 876 is paused in the rate-limit queue for the target repository "acme/widgets"
    And a workflow for issue 877 is paused in the rate-limit queue for the target repository "acme/widgets"
    And the Claude CLI answers the rate-limit probe with exit code 1 and stdout:
      """
      {"type":"system","subtype":"init","session_id":"probe-902"}
      {"type":"rate_limit_event","rate_limit_info":{"status":"rejected","resetsAt":1790250600,"rateLimitType":"five_hour"}}
      {"type":"result","subtype":"success","is_error":true,"api_error_status":429,"terminal_reason":"api_error","result":"You've hit your session limit · resets 1:50pm (Europe/Amsterdam)"}
      """
    When the pause-queue scanner runs 3 probe cycles
    Then the pause queue still holds a workflow for each of these issues, none of which has gained a probe failure:
      | issue |
      | 871   |
      | 872   |
      | 874   |
      | 875   |
      | 876   |
      | 877   |

  @adw-902 @adw-0uxemg-pause-queue-probe-mi @adw-907 @adw-910 @adw-911
  Scenario: A genuinely unknown probe failure still counts, and the third one drops the workflow with a comment that names ## Retry as the recovery
    Given the mock GitHub API is configured to accept issue comments
    And a workflow for issue 876 is paused in the rate-limit queue for the target repository "acme/widgets"
    And the Claude CLI answers the rate-limit probe with exit code 1 and stderr:
      """
      Error: Claude Code process exited unexpectedly
      """
    When the pause-queue scanner runs 2 probe cycles
    Then the pause queue entry for issue 876 records 2 probe failures
    When the pause-queue scanner runs 1 probe cycle
    Then the pause queue no longer holds the workflow for issue 876
    And the mock GitHub API recorded a comment containing the text "failed to resume after 3 probe attempts"
    And the mock GitHub API recorded a comment containing the text "## Retry"

  @adw-902 @adw-0uxemg-pause-queue-probe-mi
  Scenario: TypeScript type-check passes after the probe moves onto the shared stream parser
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
