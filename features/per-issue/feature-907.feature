@adw-907 @adw-orkxdp-structured-rate-limi
Feature: Rate-limit decisions rest on structured stream-json facts end to end — the parser captures the limit type and reset time, the rate-limit error carries them, and the pause-queue probe classifies from documented signals with no text fallback

  Issue #907 is the detection slice of `specs/prd/rate-limit-indefinite-retry.md` (sections
  "Detection" and "Further Notes"). Two incidents motivate it:
    • 2026-09-22: issue #840's orchestrator hit a five-hour session limit at 11:57 UTC. The agent's
      own stream-json said when the limit would reset (12:50 UTC), and ADW threw that away. The
      pause-queue scanner evicted the entry at 12:06 UTC, 44 minutes before the reset, after three
      probe results it could not classify.
    • 2026-09-24: six workflows (#871, #872, #874–#877) were stranded because the probe
      matched the CLI's wording against a hand-kept string list, and the wording had changed
      (#902).
  #902 moved the probe onto the shared stream parser, but it kept and extended that string list. It
  also classified an authentication failure as `limited` and still discarded the reset time. The
  stream-json envelope has no stability guarantee. The only written contract is the documented
  `system`/`api_retry` message, with its `error` enum and its `error_status` HTTP code.

  What #907 changes, end to end (parser → `RateLimitError` → probe classifier):
    • The stream parser captures the limit type and the reset time from a rejected
      `rate_limit_event`. Both are optional, because the event is undocumented and may disappear.
    • The parser classifies `api_retry` by the documented enum (`rate_limit`, `overloaded`,
      `authentication_failed`) and by `error_status`. It also reads the `result` envelope's
      `api_error_status` as an independent signal: 429 is a rate limit, 529 is overloaded, 401 is
      an authentication failure, and any other 5xx is a server error.
    • Signals are ranked. The documented enum and HTTP codes decide on their own whether a run is
      rate-limited or auth-failed. The `rate_limit_event` is where the limit type and reset time
      come from. A rejected event still holds the probe as `limited`; the flagged feature-902
      scenarios keep pinning that.
    • `RateLimitError` carries `rateLimitType` and `resetsAt` when the parser captured them.
    • The probe classifier returns the reset facts alongside its verdict. Its text fallback is
      deleted: output with no parseable JSON is `unknown`, whatever it says. An authentication
      failure is a confirmed non-rate-limit failure, not `limited`.

  The labels below are the section numbers used for the scenario groups further down (§1–§5):

    §1  THE LIMIT FACTS TRAVEL (AC1, AC5, AC6). The output of the 2026-09-22 incident is replayed,
        and the same stubbed CLI output is fed to an agent command and to the probe. The rate-limit
        error and the probe's verdict must carry the same limit type and reset time, whatever the
        exit code. A seven-day limit arrives as a seven-day limit, because the type is read, not
        assumed. An event without a reset time yields no invented one.

    §2  THE DOCUMENTED SIGNALS DECIDE ON THEIR OWN (AC1 "absent", AC2, AC3, AC7). No
        `rate_limit_event` is present. Each documented `api_retry` signal fails the agent command
        with a rate-limit error and holds the probe as `limited`. That holds for the enum alone,
        the HTTP status alone, and both together. Each documented `result.api_error_status` does
        the same. Neither consumer reports a limit type or a reset time it was never given.

    §3  AN AUTHENTICATION FAILURE IS NOT A RATE LIMIT (AC4, AC8). Each documented auth signal ends
        the agent run as an authentication failure, never as rate-limited. The probe reports a
        confirmed failure, never `limited`. The consequence at the scanner: an expired login now
        accrues probe failures and is evicted with a comment. Under #902 it was probed silently
        forever.

    §4  NO JSON, NO VERDICT (AC9). Output with no JSON is `unknown`, on either stream and whatever
        the exit code. That includes every phrase the deleted string list used to match, and the
        typographic-apostrophe variant. This is the behavioural form of "no substring list remains
        in the module". An unknown result still leaves the tail of the CLI's output in the cron
        log, so the next unrecognised failure can be diagnosed.

    §5  TYPE-CHECK BACKSTOP (the `bun run test` half of AC11).

  How these scenarios observe the system. Every assertion targets a runtime artefact:
    • the classification the probe returns (verdict, limit type, reset time);
    • the error an agent command raises, and the facts that error carries;
    • the `rateLimited` / `authExpired` outcome of an agent run fed the same output;
    • the pause-queue state file the scanner writes, and the comments it posts, as recorded by the
      mock GitHub API;
    • the warning the probe logs.
  No scenario reads, greps or parses a source file. Some things are left to the unit tests the
  issue requires (AC10) and to the CI gates `bun run test:unit` and `bun run lint:git-guard`
  (AC11):
    • the parser's internal state fields;
    • whether the undocumented `overloaded_error` spelling is still accepted (the issue leaves that
      to a real fixture);
    • the name of the probe's confirmed-failure verdict;
    • the representation of `resetsAt`.

  Changes to feature-902. #907 reverses some of its scenarios and relies on others. Those
  scenarios now also carry `@adw-907`, and feature-902's description records the amendment:
    • inverted: the non-JSON outline now expects "unknown";
    • modified: the parity row uses the documented `overloaded` value, and the threshold and
      2026-09-24 replay scenarios answer with stream-json, because text-only output no longer holds
      a workflow as limited;
    • flagged but unchanged, as guards for the rewritten classifier: the rejected-event,
      clean-reply, not-rejected-event and unknown scenarios, the three-hour journey, and the
      unknown-drop scenario.
  The §4 rows here deliberately overlap the inverted feature-902 outline, so that this file
  specifies AC9 on its own.

  Notes for the step definitions:
    • REUSE #902's HARNESS (`feature-902.steps.ts`, `feature-902-queue.steps.ts`): the injectable
      probe stub, the agent-run fake child, and the pause-queue, mock GitHub and `gh`-shadow setup.
      Their hooks are scoped to `@adw-902`. Widen each existing hook to `@adw-902 or @adw-907`
      instead of adding a second `@adw-907` hook. The amended feature-902 scenarios carry both
      tags, and a second hook would initialise the mock infrastructure twice.
    • "the rate-limit probe reports {string}" compares the classification's verdict. Adapt the
      stored outcome to whatever `probeRateLimit` now returns.
    • "a {string} limit that resets at {string}" compares the limit type verbatim and the reset
      time as an instant. Normalise whatever the implementation carries (epoch seconds as the CLI
      emits them, epoch milliseconds, a `Date`, or an ISO-8601 string), then compare it with the
      given UTC timestamp. "with no reset time" and "no limit type" require the field to be absent.
      A defaulted value fails them.
    • "a confirmed non-rate-limit failure" asserts that the verdict is none of `clear`, `limited` or
      `unknown`. #907 reserves `unknown` for output with no JSON. The implementation chooses the
      verdict's name.
    • "an agent command runs against the same Claude CLI output" drives the real
      `runClaudeAgentWithCommand` against a throwaway executable. That executable writes the
      stubbed stdout and stderr, each with a trailing newline, and exits with the stubbed code.
      NEVER SPAWN THE REAL CLAUDE CLI.
        – Point `CLAUDE_CODE_PATH` at the executable AFTER the mock-infrastructure hook has run,
          because that hook points it at the claude-cli-stub.
        – Clear the cached CLI path before and after the run, and restore the env in an `After`
          hook.
        – Pass no statePath, and use a throwaway outputFile and cwd.
        – Capture the thrown error for the Then steps.
    • "the rate-limit probe logged a warning quoting {string}" reads the log output captured while
      "the rate-limit probe runs" executed. `log()` writes through `console.log`, and warn lines
      carry the ⚠️ prefix.
    • §3's scanner scenario reuses feature-902's scanner harness as it is. `acme/widgets` is
      fictional, so a mis-wired post can never reach a real issue.

  Vocabulary note. These registered phrases from `features/regression/vocabulary.md` are reused:
    • G18 `the ADW codebase is checked out`
    • G20 `a workflow for issue {int} is paused in the rate-limit queue for the target repository {string}`
    • G1 `the mock GitHub API is configured to accept issue comments`
    • T2 `the mock GitHub API recorded a comment on issue {int}`
    • T22 `the ADW TypeScript type-check passes`
  #902's phrases have step definitions but are not registered; they are reused as written. The
  following are novel, because the registry has nothing for them: the agent-command When, the
  rate-limit error assertions, the probe's limit-fact assertions, the confirmed-failure assertion,
  the agent-run authentication assertions, and the probe-log assertion.

  Background:
    Given the ADW codebase is checked out

  @adw-907 @adw-orkxdp-structured-rate-limi
  Scenario Outline: Replaying 2026-09-22 — the session limit that stranded #840 hands the same limit type and reset time to the rate-limit error and to the probe, whatever the exit code
    Given the Claude CLI answers the rate-limit probe with exit code <exit> and stdout:
      """
      {"type":"system","subtype":"init","session_id":"incident-840"}
      {"type":"rate_limit_event","rate_limit_info":{"status":"rejected","resetsAt":1790081400,"rateLimitType":"five_hour","overageStatus":"rejected","overageDisabledReason":"org_level_disabled","isUsingOverage":false},"session_id":"incident-840"}
      {"type":"assistant","message":{"content":[{"type":"text","text":"You've hit your session limit · resets 2:50pm (Europe/Amsterdam)"}]},"session_id":"incident-840"}
      {"type":"result","subtype":"success","is_error":true,"api_error_status":429,"terminal_reason":"api_error","result":"You've hit your session limit · resets 2:50pm (Europe/Amsterdam)","session_id":"incident-840"}
      """
    When the rate-limit probe runs
    And an agent command runs against the same Claude CLI output
    Then the rate-limit probe reports "limited"
    And the rate-limit probe reports a "five_hour" limit that resets at "2026-09-22T12:50:00Z"
    And the agent command fails with a rate-limit error
    And the rate-limit error carries a "five_hour" limit that resets at "2026-09-22T12:50:00Z"

    Examples:
      | exit |
      | 1    |
      | 0    |

  @adw-907 @adw-orkxdp-structured-rate-limi
  Scenario: A seven-day limit reaches the rate-limit error and the probe as a seven-day limit with its own reset time — the limit type is read, not assumed
    Given the Claude CLI answers the rate-limit probe with exit code 1 and stdout:
      """
      {"type":"system","subtype":"init","session_id":"probe-907"}
      {"type":"rate_limit_event","rate_limit_info":{"status":"rejected","resetsAt":1790578800,"rateLimitType":"seven_day"},"session_id":"probe-907"}
      {"type":"result","subtype":"success","is_error":true,"api_error_status":429,"terminal_reason":"api_error","result":"You've hit your weekly limit · resets Sep 28, 9am (Europe/Amsterdam)","session_id":"probe-907"}
      """
    When the rate-limit probe runs
    And an agent command runs against the same Claude CLI output
    Then the rate-limit probe reports "limited"
    And the rate-limit probe reports a "seven_day" limit that resets at "2026-09-28T07:00:00Z"
    And the agent command fails with a rate-limit error
    And the rate-limit error carries a "seven_day" limit that resets at "2026-09-28T07:00:00Z"

  @adw-907 @adw-orkxdp-structured-rate-limi
  Scenario: A rejected rate_limit_event that carries no reset time yields its limit type and no invented reset time
    Given the Claude CLI answers the rate-limit probe with exit code 1 and stdout:
      """
      {"type":"system","subtype":"init","session_id":"probe-907"}
      {"type":"rate_limit_event","rate_limit_info":{"status":"rejected","rateLimitType":"five_hour"},"session_id":"probe-907"}
      {"type":"result","subtype":"success","is_error":true,"api_error_status":429,"terminal_reason":"api_error","result":"You've hit your session limit","session_id":"probe-907"}
      """
    When the rate-limit probe runs
    And an agent command runs against the same Claude CLI output
    Then the rate-limit probe reports "limited"
    And the rate-limit probe reports a "five_hour" limit with no reset time
    And the agent command fails with a rate-limit error
    And the rate-limit error carries a "five_hour" limit with no reset time

  @adw-907 @adw-orkxdp-structured-rate-limi
  Scenario Outline: Every documented api_retry rate-limit or overload signal pauses the agent and holds the probe as "limited" on its own, with no rate_limit_event and so no limit facts
    Given the Claude CLI answers the rate-limit probe with exit code 1 and stdout:
      """
      {"type":"system","subtype":"init","session_id":"probe-907"}
      <api_retry>
      """
    When the rate-limit probe runs
    And an agent command runs against the same Claude CLI output
    Then the rate-limit probe reports "limited"
    And the rate-limit probe reports no limit type and no reset time
    And the agent command fails with a rate-limit error
    And the rate-limit error carries no limit type and no reset time

    Examples:
      | documented signal               | api_retry                                                                                                                          |
      | rate_limit enum with HTTP 429   | {"type":"system","subtype":"api_retry","attempt":1,"max_retries":10,"retry_delay_ms":600,"error_status":429,"error":"rate_limit"}  |
      | rate_limit enum, no HTTP status | {"type":"system","subtype":"api_retry","attempt":1,"max_retries":10,"retry_delay_ms":600,"error_status":null,"error":"rate_limit"} |
      | HTTP 429, unrecognised enum     | {"type":"system","subtype":"api_retry","attempt":1,"max_retries":10,"retry_delay_ms":600,"error_status":429,"error":"unknown"}     |
      | overloaded enum with HTTP 529   | {"type":"system","subtype":"api_retry","attempt":1,"max_retries":10,"retry_delay_ms":500,"error_status":529,"error":"overloaded"}  |
      | overloaded enum, no HTTP status | {"type":"system","subtype":"api_retry","attempt":1,"max_retries":10,"retry_delay_ms":500,"error_status":null,"error":"overloaded"} |
      | HTTP 529, unrecognised enum     | {"type":"system","subtype":"api_retry","attempt":1,"max_retries":10,"retry_delay_ms":500,"error_status":529,"error":"unknown"}     |

  @adw-907 @adw-orkxdp-structured-rate-limi
  Scenario Outline: A documented error status on the result envelope pauses the agent and holds the probe as "limited" on its own, with no rate_limit_event and so no limit facts
    Given the Claude CLI answers the rate-limit probe with exit code 1 and stdout:
      """
      {"type":"system","subtype":"init","session_id":"probe-907"}
      {"type":"result","subtype":"success","is_error":true,"api_error_status":<status>,"terminal_reason":"api_error","result":"<text>","session_id":"probe-907"}
      """
    When the rate-limit probe runs
    And an agent command runs against the same Claude CLI output
    Then the rate-limit probe reports "limited"
    And the rate-limit probe reports no limit type and no reset time
    And the agent command fails with a rate-limit error
    And the rate-limit error carries no limit type and no reset time

    Examples:
      | status | text                                                             |
      | 429    | You've hit your session limit · resets 1:50pm (Europe/Amsterdam) |
      | 529    | API Error: 529 Overloaded                                        |
      | 500    | API Error: 500 Internal server error                             |
      | 502    | 502 Bad Gateway                                                  |

  @adw-907 @adw-orkxdp-structured-rate-limi
  Scenario Outline: Every documented authentication signal ends the agent run as an authentication failure and makes the probe report a confirmed failure, never "limited"
    Given the Claude CLI answers the rate-limit probe with exit code 1 and stdout:
      """
      {"type":"system","subtype":"init","session_id":"probe-907"}
      <line>
      """
    When the rate-limit probe runs
    And the same Claude CLI output is streamed through an agent run
    Then the agent run ends with an authentication failure
    And the agent run does not end rate-limited
    And the rate-limit probe reports a confirmed non-rate-limit failure

    Examples:
      | documented signal                          | line                                                                                                                                                              |
      | authentication_failed enum with HTTP 401   | {"type":"system","subtype":"api_retry","attempt":1,"max_retries":10,"retry_delay_ms":500,"error_status":401,"error":"authentication_failed"}                      |
      | authentication_failed enum, no HTTP status | {"type":"system","subtype":"api_retry","attempt":1,"max_retries":10,"retry_delay_ms":500,"error_status":null,"error":"authentication_failed"}                     |
      | HTTP 401, unrecognised enum                | {"type":"system","subtype":"api_retry","attempt":1,"max_retries":10,"retry_delay_ms":500,"error_status":401,"error":"unknown"}                                    |
      | result envelope with HTTP 401              | {"type":"result","subtype":"success","is_error":true,"api_error_status":401,"terminal_reason":"api_error","result":"OAuth token has expired · Please run /login"} |

  @adw-907 @adw-orkxdp-structured-rate-limi
  Scenario: An expired login no longer holds a paused workflow in the queue forever — each probe that meets it counts a failure, and the third drops the workflow with a comment
    Given the mock GitHub API is configured to accept issue comments
    And a workflow for issue 911 is paused in the rate-limit queue for the target repository "acme/widgets"
    And the Claude CLI answers the rate-limit probe with exit code 1 and stdout:
      """
      {"type":"system","subtype":"init","session_id":"probe-907"}
      {"type":"system","subtype":"api_retry","attempt":1,"max_retries":10,"retry_delay_ms":500,"error_status":401,"error":"authentication_failed","session_id":"probe-907"}
      {"type":"result","subtype":"success","is_error":true,"api_error_status":401,"terminal_reason":"api_error","result":"OAuth token has expired · Please run /login","session_id":"probe-907"}
      """
    When the pause-queue scanner runs 2 probe cycles
    Then the pause queue entry for issue 911 records 2 probe failures
    When the pause-queue scanner runs 1 probe cycle
    Then the pause queue no longer holds the workflow for issue 911
    And the mock GitHub API recorded a comment on issue 911

  @adw-907 @adw-orkxdp-structured-rate-limi
  Scenario Outline: Output containing no JSON makes the probe report "unknown" whatever the text says and whatever the exit code — the text fallback is gone
    Given the Claude CLI answers the rate-limit probe with exit code <exit> and <stream>:
      """
      <text>
      """
    When the rate-limit probe runs
    Then the rate-limit probe reports "unknown"
    And the rate-limit probe reports no limit type and no reset time

    Examples:
      | exit | stream | text                                                             |
      | 1    | stderr | You've hit your session limit · resets 1:50pm (Europe/Amsterdam) |
      | 1    | stdout | You've hit your session limit · resets 1:50pm (Europe/Amsterdam) |
      | 1    | stderr | You’ve hit your session limit · resets 1:50pm (Europe/Amsterdam) |
      | 1    | stderr | You've hit your limit · resets 3pm (Europe/Amsterdam)            |
      | 1    | stderr | You're out of extra usage                                        |
      | 1    | stderr | 502 Bad Gateway                                                  |
      | 1    | stderr | Invalid authentication credentials                               |
      | 0    | stdout | You've hit your session limit · resets 1:50pm (Europe/Amsterdam) |

  @adw-907 @adw-orkxdp-structured-rate-limi
  Scenario Outline: An unknown probe result leaves the tail of the Claude CLI's output in the cron log, so the next unrecognised failure can be diagnosed
    Given the Claude CLI answers the rate-limit probe with exit code 1 and <stream>:
      """
      <text>
      """
    When the rate-limit probe runs
    Then the rate-limit probe reports "unknown"
    And the rate-limit probe logged a warning quoting "<text>"

    Examples:
      | stream | text                                                             |
      | stderr | You've hit your session limit · resets 1:50pm (Europe/Amsterdam) |
      | stdout | Error: Claude Code process exited unexpectedly                   |

  @adw-907 @adw-orkxdp-structured-rate-limi
  Scenario: TypeScript type-check passes after the limit facts are threaded from the stream parser through the rate-limit error to the probe
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
