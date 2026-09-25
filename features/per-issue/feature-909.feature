@adw-909 @adw-uk9ams-stream-json-envelope
Feature: The stream-json envelope conformance gate comes back to life — green on its own fixtures, one of them captured from a real rate limit; red when a field the pause path reads drifts — and the Claude CLI stub answers rate-limited on demand

  Issue #909 revives ADW's only contract with the Claude CLI's stream-json output. Anthropic has
  declined to publish a stable schema for it (claude-code#53516), yet the parent PRD
  (`specs/prd/rate-limit-indefinite-retry.md`, "Envelope conformance gate") builds the whole
  indefinite-retry path on that envelope. The path reads three things from it:
    • the `rate_limit_event` a paused agent is detected by;
    • the error fields of the `result` envelope;
    • the documented `system`/`api_retry` message.
  Later slices will also read `resetsAt` and the limit type from it. A change to that envelope must
  fail a pull request instead of stranding workflows, as happened on 2026-09-22 (#840) and on
  2026-09-24 (#871, #872, #874–#877).

  The machinery is already in the repo: `bun run jsonl:probe`, `jsonl:check` and `jsonl:update`,
  all under `adws/jsonl/`. Nothing runs it. On this checkout (2026-09-25) it is dead in three
  separate ways:

    1. The gate is red on its own fixtures. `bun run jsonl:check` fails all four of them, with
       "assistant message did not increment turnCount" and "result message did not set lastResult".
       The cause is in the gate's parser check. It passes each fixture line to `parseJsonlOutput`
       with no trailing newline, and the parser holds an unterminated segment back as a partial line
       instead of parsing it. `rateLimitProbe.ts` works around the same trap with
       `withTrailingNewline`. The fix belongs in the gate, because this slice must not touch the
       stream parser.
    2. The schema is stale.
         • It is stamped `probedAt` 2026-03-24.
         • It knows only `assistant`, `result` and `system`.
         • It has no `rate_limit_event`, and no `api_error_status` or `terminal_reason` on `result`.
         • It requires the camelCase `isError`, where the CLI emits `is_error` / `session_id`.
       Its camelCase names match ADW's own `ClaudeCodeResultMessage` type, not anything the CLI
       emits. Both committed result fixtures follow those stale names.
    3. The probe cannot re-probe. `jsonl:probe` runs `claude --print --output-format stream-json`
       without `--verbose`. The CLI installed on this host (2.1.282) rejects that combination with
       "Error: When using --print, --output-format=stream-json requires --verbose".

  The labels below are the section numbers used for the scenario groups further down (§1–§5):

    §1  THE GATE IS GREEN ON WHAT IS COMMITTED (AC2, AC3, and the local half of AC4). The gate is
        run exactly as CI runs it, through `bun run jsonl:check`. It must exit 0 with no failing
        fixture. The fixture set must include two things:
          • the stream captured from a real limit (the 2026-09-22 `q7t0yb` patch-agent JSONL,
            which the human supplies);
          • the corrected error fixture.

    §2  DRIFT IN A FIELD THE PAUSE PATH READS FAILS THE GATE (AC1, AC3). Each scenario starts from
        a known-good baseline and changes exactly one field, which is how a CLI change arrives. The
        gate must then fail and name that field. Working by mutation means no scenario has to guess
        the full field set a fresh probe will record. The baselines are:
          • the real rate-limited capture, for `rate_limit_event` / `rate_limit_info` and the
            `result` error fields;
          • the corrected error fixture, for the stale camelCase names it used to carry;
          • the `api_retry` message as the Claude CLI documents it (code.claude.com/docs/en/headless,
            "Handle API retries"). The PRD calls that message the only written contract, so the
            gate must accept the documented shape and must fail when a field the parser reads is
            missing from it.
        Today every one of these mutations passes the gate:
          • `rate_limit_event` has "no schema coverage";
          • `system` requires only `type` and `subtype`;
          • `result` demands `isError`, not `is_error`.
        `resetsAt` and `rateLimitType` are absent from the drift rows on purpose. The CLI's own
        validation of the event treats both as optional, while `status` is not optional there.
        §2 also pins that the gate KNOWS the fields of the real capture's `rate_limit_event` and the
        error fields of its `result`. An optional field such as `api_error_status` cannot fail the
        gate by being absent, so the gate's coverage of it is observed as "not flagged as unknown".

    §3  THE TOOLS AROUND THE GATE SPEAK THE REAL NAMES. When the gate fails, its report tells the
        maintainer to run `bun run jsonl:update`. That updater hard-codes the stale camelCase
        envelope names, so it would leave a drifted result fixture failing. The schema probe must
        be able to re-probe the pinned CLI, which means asking it for `--verbose` stream-json.

    §4  THE CLAUDE CLI STUB ANSWERS RATE-LIMITED ON DEMAND (AC5). When asked, the regression suite's
        stub answers with a `rate_limit_event` that rejects the request and names a reset time that
        has not yet passed, followed by a `result` carrying `api_error_status: 429`.
          • The response conforms to the same schema as the real capture, so the stub cannot drift
            from the CLI it stands in for.
          • The real capture and the stub's response look the same to the two unchanged pause
            detectors. An agent run fed either one ends rate-limited, and the pause-queue probe
            reports "limited". That is what later slices need to drive pause, wait and resume
            hermetically.
          • Unless asked, the stub answers exactly as before, and the probe reports "clear" against
            it. #812's tick-guard scenario relies on that.

    §5  BACKSTOPS (AC7). `bun run test` is `tsc --noEmit`. `bun run lint:git-guard` is the git/gh
        guard.

  Deliberately left without a scenario:
    • The CI workflow and its pinned CLI version (the CI half of AC4). A workflow file is
      configuration, and asserting on its YAML is the rot the Rot-Detection Rubric forbids. The
      evidence is this PR's own check run going green. The human chooses the pin and the bump
      policy.
    • A fresh `probedAt` (AC1). That is a property of a committed file, not an output of the
      system. §3 pins the probe's ability to re-probe instead.
    • The overloaded `api_retry` enum finding (AC6). That is a comment on the issue, not a system
      behaviour, and the parser stays unchanged. For the comment's context: the published docs list
      `overloaded` among the `error` values, while the parser matches `overloaded_error`. The
      comment must report what the CLI actually emits. No scenario pins either value, and the
      `api_retry` examples below use `server_error`.
    • "The existing pause/resume smoke scenario still passes" (AC5). The `@regression` run of
      `features/regression/smoke/pause_resume_rate_limit.feature` carries that. The file is not
      re-tagged here, because the regression suite is human-curated.

  Surfaced while writing these scenarios, outside this slice. ADW's result type
  (`ClaudeCodeResultMessage`) and `agentProcessHandler` read `isError` / `sessionId` off the result
  envelope. Those are the same stale names this slice corrects in the fixtures. Against real
  snake_case output:
    • `success` is `!undefined`, so it is true on every exit-0 run that produced a result;
    • `sessionId` is always undefined.
  The gate as scoped checks fixtures against the schema and, of ADW's parsing, only that a
  `result` sets `lastResult`, so it will not catch this. It belongs in the finding reported on the
  issue alongside AC6.

  Notes for the step definitions:

    • NEVER SPAWN THE REAL CLAUDE CLI. Every CLI in these scenarios is either the regression suite's
      stub (`test/mocks/claude-cli-stub.ts`) or a throwaway script.
    • "the envelope conformance gate is run through its package script entry point" runs
      `bun run jsonl:check` in the repo root and captures its exit code and stdout. It mirrors
      #810's docs-index gate step.
    • "a copy of …" copies the named input into a throwaway directory. Committed fixtures are never
      modified.
    • "checks that copy" runs the gate's check of that directory against the COMMITTED schema.
      Calling `checkConformance(schemaPath, dir)` in-process is fine.
    • "the committed JSONL fixture captured from a real rate limit" is the human-supplied stream,
      trimmed to the messages around the limit, one message per line. The step binds to whichever
      file the implementation commits.
    • "the committed JSONL error-result fixture" is the corrected `result-error.jsonl`, or whatever
      it is renamed to.
    • A "<message>" selector is the envelope's `type`. A field is a dot-path inside that message. A
      mutation applies to every message of that type in the copy.
    • "reports X missing from the Y message" matches the gate's missing-required-field dot-path for
      that message. A line or message prefix added by the implementation is fine.
    • "flags … as unknown" refers to the gate's informational output: extra fields, or "no schema
      coverage".
    • `updateFixtureEnvelopes(schemaPath, dir)` serves "the fixture updater runs over that copy".
    • `probeClaudeJsonlSchema` writes `adws/jsonl/schema.json` in place. A step must never leave the
      committed schema clobbered. Save and restore it, or point the probe at a throwaway path if
      the implementation makes the path injectable.
    • "the Claude CLI answers the schema probe with:" points `CLAUDE_CODE_PATH` at a throwaway
      script that records its argv and prints the docstring. The probe spawns through
      `getSafeSubprocessEnv()`, which drops `MOCK_*` names, so the record path must not travel in
      a `MOCK_*` variable.
    • These phrases are REUSED from `feature-902.steps.ts`, not redefined, because a second
      registration would be ambiguous:
        – "the rate-limit probe runs";
        – "the same Claude CLI output is streamed through an agent run";
        – "the agent run ends rate-limited";
        – "the rate-limit probe reports {string}".
    • The new "the Claude CLI answers the rate-limit probe with …" Givens install their reply into
      #902's exported `probeStub.result`:
        – the real capture as stdout, with exit code 1;
        – the stub's response with the stub's own exit code.
      Register them as literal phrases. A catch-all `{}` would collide with #902's
      "… with exit code {int} and {word}:". #902's reset hook is scoped to `@adw-902`, so add an
      `@adw-909`-scoped Before that calls the exported `resetFeature902ProbeState()`.
    • "the Claude CLI stub is asked for its rate-limited response" uses whichever on-demand switch
      the implementation adds to the stub. Later slices will reach the stub through orchestrator
      and agent spawns, whose environment also passes through `getSafeSubprocessEnv()`. The
      existing manifest / `.adw-stub-manifest.json` marker route survives that; an env-only
      `MOCK_*` switch would not.
    • "the Claude CLI stub is run" spawns the stub the way an agent spawns the CLI, and captures
      its stdout and exit code.
    • "has not yet passed" compares `resetsAt` in the same unit the real capture uses.
    • These phrases are defined elsewhere:
        – "the git/gh guard …" and "the ADW TypeScript type-check passes" in
          `feature-844.steps.ts`;
        – "the ADW codebase is checked out" in
          `features/step_definitions/ensureCronOnEveryEventSteps.ts`.

  Vocabulary note. These registered phrases from `features/regression/vocabulary.md` are reused:
    • G18 `the ADW codebase is checked out`
    • T22 `the ADW TypeScript type-check passes`
  G3 and G9 are not reused. They load a manifest or a payload into the stub, but say nothing about
  a rate-limited response.
  The registry has no phrase for any of the following, so novel phrasing is introduced:
    • the envelope conformance gate;
    • input copies and their single-field mutations;
    • the fixture updater;
    • the schema probe;
    • the stub's rate-limited response.
  Phrasing also borrowed from earlier issues:
    • the gate phrasing mirrors #810's docs-index gate;
    • the probe and agent-run phrases are #902's;
    • the git/gh guard phrases are #844's.

  @adw-909 @adw-uk9ams-stream-json-envelope
  Scenario: The envelope conformance gate exits 0 over every committed fixture when run through its package script entry point
    Given the ADW codebase is checked out
    When the envelope conformance gate is run through its package script entry point
    Then the envelope conformance gate exits 0
    And the envelope conformance gate reports no failing fixture

  @adw-909 @adw-uk9ams-stream-json-envelope
  Scenario Outline: A field the pause path reads going missing from the real rate-limited capture fails the gate, naming that field
    Given a copy of the committed JSONL fixture captured from a real rate limit
    And in that copy the "<message>" message no longer carries the field "<field>"
    When the envelope conformance gate checks that copy
    Then the envelope conformance gate fails
    And the envelope conformance gate reports "<field>" missing from the "<message>" message

    Examples:
      | message          | field                  |
      | rate_limit_event | rate_limit_info        |
      | rate_limit_event | rate_limit_info.status |
      | result           | is_error               |
      | result           | subtype                |

  @adw-909 @adw-uk9ams-stream-json-envelope
  Scenario Outline: Reverting the error fixture to a stale camelCase name fails the gate, naming the field the Claude CLI actually emits
    Given a copy of the committed JSONL error-result fixture
    And in that copy the "result" message carries "<field>" under its stale name "<stale>"
    When the envelope conformance gate checks that copy
    Then the envelope conformance gate fails
    And the envelope conformance gate reports "<field>" missing from the "result" message

    Examples:
      | field      | stale     |
      | is_error   | isError   |
      | session_id | sessionId |

  @adw-909 @adw-uk9ams-stream-json-envelope
  Scenario: The gate knows every field of the real capture's rate_limit_event and the error fields of its result
    Given a copy of the committed JSONL fixture captured from a real rate limit
    When the envelope conformance gate checks that copy
    Then the envelope conformance gate passes
    And the envelope conformance gate flags no field of the "rate_limit_event" message as unknown
    And the envelope conformance gate flags none of these fields of the "result" message as unknown:
      | field            |
      | is_error         |
      | api_error_status |
      | terminal_reason  |
      | subtype          |

  @adw-909 @adw-uk9ams-stream-json-envelope
  Scenario: The api_retry system message as the Claude CLI documents it passes the gate
    Given a copy of the api_retry system message the Claude CLI documents:
      """
      {"type":"system","subtype":"api_retry","attempt":2,"max_retries":10,"retry_delay_ms":1150,"error_status":500,"error":"server_error","uuid":"0b9e2c4a-7d1f-4e36-9a58-c3f1d2e4b5a6","session_id":"session-909"}
      """
    When the envelope conformance gate checks that copy
    Then the envelope conformance gate passes

  @adw-909 @adw-uk9ams-stream-json-envelope
  Scenario Outline: An api_retry system message missing a field the parser reads fails the gate, naming that field
    Given a copy of the api_retry system message the Claude CLI documents:
      """
      {"type":"system","subtype":"api_retry","attempt":2,"max_retries":10,"retry_delay_ms":1150,"error_status":500,"error":"server_error","uuid":"0b9e2c4a-7d1f-4e36-9a58-c3f1d2e4b5a6","session_id":"session-909"}
      """
    And in that copy the "system" message no longer carries the field "<field>"
    When the envelope conformance gate checks that copy
    Then the envelope conformance gate fails
    And the envelope conformance gate reports "<field>" missing from the "system" message

    Examples:
      | field        |
      | error        |
      | error_status |
      | attempt      |

  @adw-909 @adw-uk9ams-stream-json-envelope
  Scenario: The fixture updater the gate's report points to restores a missing result field under the Claude CLI's real name and keeps the fixture's payload
    Given a copy of the committed JSONL error-result fixture
    And in that copy the "result" message no longer carries the field "session_id"
    When the fixture updater runs over that copy
    And the envelope conformance gate checks that copy
    Then the envelope conformance gate passes
    And that copy's "result" message keeps its original "result" value

  @adw-909 @adw-uk9ams-stream-json-envelope
  Scenario: The schema probe asks the Claude CLI for the verbose stream-json output the current CLI insists on, so it can re-probe the pinned version
    Given the Claude CLI answers the schema probe with:
      """
      {"type":"system","subtype":"init","session_id":"probe-909","model":"claude-haiku-4-5"}
      {"type":"assistant","message":{"id":"msg_probe_909","model":"claude-haiku-4-5","usage":{"input_tokens":12,"output_tokens":4},"content":[{"type":"text","text":"Hello!"}]},"session_id":"probe-909"}
      {"type":"result","subtype":"success","is_error":false,"result":"Hello!","session_id":"probe-909"}
      """
    When the schema probe runs
    Then the schema probe requested "stream-json" output from the Claude CLI
    And the schema probe requested verbose output from the Claude CLI

  @adw-909 @adw-uk9ams-stream-json-envelope
  Scenario: Asked for its rate-limited response, the Claude CLI stub rejects the request with a rate_limit_event naming a future reset time, then a 429 result
    Given the Claude CLI stub is asked for its rate-limited response
    When the Claude CLI stub is run
    Then the stub's output carries a rate_limit_event that rejects the request
    And the stub's rate_limit_event names a reset time that has not yet passed
    And the stub's output ends with a result whose api_error_status is 429 and whose is_error is true

  @adw-909 @adw-uk9ams-stream-json-envelope
  Scenario: The stub's rate-limited response passes the envelope conformance gate, like the real capture it stands in for
    Given a copy of the Claude CLI stub's rate-limited response
    When the envelope conformance gate checks that copy
    Then the envelope conformance gate passes

  @adw-909 @adw-uk9ams-stream-json-envelope
  Scenario Outline: The real rate-limited capture and the stub's rate-limited response both end an agent run rate-limited and make the pause-queue probe report "limited"
    Given the Claude CLI answers the rate-limit probe with <reply>
    When the rate-limit probe runs
    And the same Claude CLI output is streamed through an agent run
    Then the agent run ends rate-limited
    And the rate-limit probe reports "limited"

    Examples:
      | reply                                                       |
      | the committed JSONL fixture captured from a real rate limit |
      | the Claude CLI stub's rate-limited response                 |

  @adw-909 @adw-uk9ams-stream-json-envelope
  Scenario: Unless asked for its rate-limited response, the Claude CLI stub still answers cleanly and the pause-queue probe reports "clear"
    Given the Claude CLI answers the rate-limit probe with the Claude CLI stub's default response
    When the rate-limit probe runs
    Then the rate-limit probe reports "clear"

  @adw-909 @adw-uk9ams-stream-json-envelope
  Scenario: TypeScript type-check passes with the revived conformance gate and the stub's rate-limited response
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes

  @adw-909 @adw-uk9ams-stream-json-envelope
  Scenario: The git/gh guard passes across the repository with the conformance gate wired into CI
    Given the ADW codebase is checked out
    When the git/gh guard is run across the repository
    Then the git/gh guard reports no violations
