@adw-939 @adw-3lva71-bug-the-conformance
Feature: The envelope-conformance run fails, naming the secret, when the repository has no ANTHROPIC_API_KEY secret; with the secret set, the live probe runs against the pinned Claude CLI and decides the run

  Issue #939 resolves item 1 of the `## Divergence` section of ADR-0055
  (`specs/adr/0055-rate-limit-structured-signals-two-tier-wait.md`). That item is the
  specification. The live leg of the envelope conformance gate, `bun run jsonl:probe:check`
  against the pinned Claude CLI, runs only when the secret `ANTHROPIC_API_KEY` is set. The
  repository has no such secret (`gh secret list`, 2026-09-29), so every run skips the leg with a
  warning and ends green. Ruling (owner, 2026-10-01): the live probe is the decision; the secret
  is added, and a missing secret must fail the run and not warn.

  The workflow today (`.github/workflows/envelope-conformance.yml`). The job sets
  `HAS_ANTHROPIC_KEY` from `secrets.ANTHROPIC_API_KEY != ''`, because GitHub offers no `secrets`
  context to an `if:`. With it `true`, the step "Live envelope check against the pinned CLI" runs
  the live check with the secret in its environment. With it `false`, the step "Live envelope
  check skipped" echoes a `::warning` annotation that names the secret, and the run succeeds.

  The labels below are the section numbers used for the scenario groups further down (§1–§4):

    §1  NO SECRET, NO GREEN RUN (AC1). The repository has no `ANTHROPIC_API_KEY` secret. The run
        fails, reports an error that names the secret, and raises no warning that names it.

    §2  WITH THE SECRET, THE LIVE PROBE RUNS (AC2). The pinned Claude CLI is asked for the live
        probe and receives the secret's value as its API key. Its answer conforms to the
        committed schema and carries no rate-limit event, as no answer to a probe authenticated
        by API key does, and the run is green. That is the known limit the issue keeps: the
        rate-limit event is covered only by the committed capture, which `bun run jsonl:check`
        checks (#909), never by the live leg.

    §3  THE LIVE PROBE DECIDES THE RUN. With the secret set, an answer that has lost a field the
        committed schema requires fails the run, and the error names the field.

    §4  BACKSTOP. The type-check.

  Each row is written to fail for a specific wrong implementation:
    • §1 is RED today: the run is green, with a warning. The row also fails for a fix that only
      drops the condition from the live step: without a key the probe fails on its own, but its
      error ("Claude CLI produced no output. Check authentication …") does not name the secret.
      It fails for a fix that raises the annotation from warning to error but lets the step exit
      0, and for one that keeps the warning beside the new failure;
    • §2 is GREEN today and must stay green. It fails for a fix that inverts the condition, for
      one that hands the probe the secret under another name, and for one that tests `secrets`
      in an `if:`: GitHub rejects that workflow, and every run fails, with the secret or without
      it. It also fails for a live check that demands the rate-limit event, which an API-key
      probe never sees: every run would be red;
    • §3 is GREEN today and must stay green. It fails for a fix that makes the live leg advisory,
      with `continue-on-error`, `|| true` or a warning in place of the failure.

  ── WHY SOME CRITERIA GET NO SCENARIO OF THEIR OWN ──────────────────────────────────────────
  AC3 (the Divergence section of ADR-0055 replaced by a one-line note of the known limit under
  More Information) is a documentation change. A scenario asserting a document's sections would
  assert a file's contents, which the Rot-Detection Rubric forbids, so the review checks it. §2
  pins the behaviour the note describes. The human step, the owner adding the secret before
  approving, is not system behaviour. The pull request's own check runs are its evidence: red and
  naming the secret while the secret is absent, green with the live probe once it exists.

  ── FINDINGS THE ISSUE BODY DOES NOT CARRY ──────────────────────────────────────────────────

  F1  DEPENDABOT'S PULL REQUESTS GET NO ACTIONS SECRET.
      A run that Dependabot triggers receives Dependabot secrets, not Actions secrets, and a pull
      request from a fork receives neither. `.github/dependabot.yml` opens a weekly
      `@paysdoc/devplatform` bump against `dev`. Once a missing secret fails the run, those pull
      requests show a red envelope-conformance check unless the key is also added as a Dependabot
      secret. That is the ruling working as written; adding the second secret is the owner's
      call. The repository has no required status checks (ADR-0055, Confirmation), so the red
      check blocks no merge.

  F2  A KEY THE API REJECTS STILL PASSES THE LIVE LEG.
      While these scenarios were written, `bun run jsonl:probe:check` reached the host's real
      Claude CLI (2.1.287, not the pinned 2.1.282) once with a made-up `ANTHROPIC_API_KEY`. The
      CLI retried for about three minutes (`system/api_retry`), then answered with an assistant
      message carrying `error` and `is_api_error_message`, and with a `result/success` message.
      The check printed "Live envelope check passed": those messages carry every field the schema
      requires. A revoked, expired or mistyped secret would therefore leave the run green without
      a successful probe. The issue's title says the gate fails when its live probe cannot run,
      but its criteria name only the absent secret, so no row pins the rejected key. That is the
      owner's call.

  Notes for the step definitions:
    • NEVER SPAWN THE REAL CLAUDE CLI, AND NEVER LET THE RUN INSTALL ANYTHING. The only Claude CLI
      the run can reach is the stand-in described below.
    • RUN THE WORKFLOW; NEVER READ IT FOR AN ASSERTION. "the envelope-conformance workflow runs
      for a pull request" executes `.github/workflows/envelope-conformance.yml` as a GitHub runner
      would, so editing the workflow changes the outcome, as feature-936's change detection does
      for the deploy workflow. No step asserts on the workflow's text or structure, which the
      Rot-Detection Rubric forbids. Only the shapes listed here are understood; anything else
      throws, so an unexpected edit fails loudly instead of being misread. A throw is a scenario
      error, never a failed run.
    • The runner:
        – the workflow's `on:` must list `pull_request`, with no filter;
        – every job runs, in file order, with its `if:` evaluated and its `needs:` honoured. The
          run fails when a job fails;
        – `env` is layered workflow, then job, then step, each value expanded with `${{ }}`. A
          boolean expands to `true` or `false`;
        – contexts are available where GitHub offers them. `secrets` is offered to `env` and
          `run`, never to an `if:`: a workflow that tests it there is invalid, and the run fails
          before any step, with an error, as GitHub's does. A secret the repository lacks
          expands to an empty string, as does a missing `env` or `vars` name. The runner supplies
          `github.event_name` (`pull_request`) and `github.workspace`; any other `github`
          property throws;
        – expressions: literals, `!`, `==`, `!=`, `&&`, `||`, parentheses, `success()`,
          `failure()`, `always()` and `cancelled()`, with GitHub's rules: strings compare
          case-insensitively, operands of different types compare as numbers, and `false`, `0`,
          `''` and `null` are falsy. A step's default condition is `success()`;
        – a `run:` step without `shell:` runs as `bash -e <script file>`, and one with
          `shell: bash` as `bash --noprofile --norc -eo pipefail <script file>`, as on GitHub's
          Linux runners. The script is expanded with `${{ }}` first and runs in its
          `working-directory` or the checkout root. It fails on a non-zero exit, and
          `continue-on-error: true` keeps that failure from failing the job;
        – a `uses:` step of `actions/checkout`, `oven-sh/setup-bun` or `actions/setup-node` is a
          no-op that succeeds. Any other action, `strategy`, `container`, `services`, `defaults`
          and any other `shell:` throw. `name`, `runs-on`, `permissions`, `concurrency` and
          `timeout-minutes` are ignored;
        – a stdout line `::error …::message` or `::warning …::message` is an annotation; its
          title and message both count. `$GITHUB_ENV` and `$GITHUB_OUTPUT` are honoured for
          `NAME=value` lines, `$GITHUB_PATH` for one directory per line, and
          `steps.<id>.outputs`, `.outcome` and `.conclusion` resolve. Each step's stdout and
          stderr are kept;
        – a step that runs longer than 60 seconds is killed and fails. A whole run takes a few
          seconds on the ADW host.
    • The checkout. GitHub checks out the change and nothing else, so the run happens in a
      throwaway directory holding every file `git ls-files --cached --others --exclude-standard`
      lists, as it stands in the working tree, and no ignored file. `node_modules` is a link to
      the ADW checkout's own, so `bun install` must not run in it: shadow `bun` on PATH so that
      `bun install` succeeds without doing anything and every other `bun` command runs the real
      one. Remove the directory after each scenario.
      The ADW checkout itself will not do. `adws/core/environment.ts` calls `dotenv.config()` when
      it is imported, and a host's env file may set `CLAUDE_CODE_PATH`, which sends the probe to
      the host's real Claude CLI, or `ANTHROPIC_API_KEY`, which hands a run without the secret
      the host's key. The first happened while these scenarios were written.
    • The environment is built from nothing, never from the cucumber process: PATH (the
      stand-in's directory first, then the shadows, then the directories of the real `bun` and
      `node`, then `/usr/bin:/bin`), a throwaway HOME and RUNNER_TEMP, `CI=true`,
      `GITHUB_ACTIONS=true`, `GITHUB_WORKSPACE` and `GITHUB_EVENT_NAME=pull_request`. Nothing
      else comes from the host: no `ANTHROPIC_API_KEY`, no `CLAUDE_CODE_PATH`, no `MOCK_*`.
    • The pinned Claude CLI is a throwaway `claude` on PATH, and `npm` is shadowed beside it.
      `npm install -g @anthropic-ai/claude-code@<version>` records the version and succeeds; the
      stand-in answers `--version` with `<version> (Claude Code)`. Any other call is a probe
      request: the stand-in records its argv and the `ANTHROPIC_API_KEY` it received, an empty
      value counting as none. With no key it answers like a CLI with no credentials, whatever its
      scripted answer: nothing on stdout, `Not logged in · Please run /login` on stderr, exit 1.
      With a key it writes its scripted answer and exits 0. The probe starts it through
      `getSafeSubprocessEnv()`, which keeps PATH and ANTHROPIC_API_KEY but drops names outside
      its list, so the record path is written into the script and never passed in a variable.
    • "a one-turn session that conforms to the committed schema" is built from committed real
      captures, one message per line: the `system/init` line of
      `adws/jsonl/fixtures/session-rate-limited.jsonl` with its `claude_code_version` set to the
      installed version, then `assistant-text.jsonl`, then `result-success.jsonl`. It has no
      `rate_limit_event`. A stand-in whose scenario names no answer scripts this one.
    • "except that its "<message>" message no longer carries the field "<field>"" deletes that
      top-level field from every line of that `type` in the answer.
    • "reports an error naming X" holds when an `::error` annotation, or the stdout or stderr of
      a step that failed, contains X. A step's script is not its output and never counts.
      "raises no warning naming X" holds when no `::warning` annotation contains X.
    • "was asked for the live probe" holds when the stand-in recorded a call other than
      `--version`. "received X as its ANTHROPIC_API_KEY for the live probe" checks the key that
      call received.
    • "succeeds" and "fails" assert the run's conclusion, showing every step's conclusion,
      annotations and output on failure.
    • These phrases are defined elsewhere:
        – "the ADW codebase is checked out" in
          `features/step_definitions/ensureCronOnEveryEventSteps.ts`;
        – "the ADW TypeScript type-check passes" in
          `features/regression/step_definitions/thenSteps.ts`.

  Vocabulary note. These registered phrases from `features/regression/vocabulary.md` are reused:
    • G18 `the ADW codebase is checked out`
    • T22 `the ADW TypeScript type-check passes`
  These registered phrases are deliberately NOT reused:
    • G3 and G9 load a manifest or a payload into the regression suite's Claude CLI stub. The
      workflow never calls that stub; it calls `claude` from PATH, as CI does.
  feature-909's "the Claude CLI answers the schema probe with:" is not reused either. It points
  `CLAUDE_CODE_PATH` at a script and drives the probe in-process, while here the run must find
  the CLI the way CI does. The registry has no phrase for the following, so novel phrasing is
  introduced for them: the repository's secret; the envelope-conformance workflow and its run;
  the run's conclusion, errors and warnings; the pinned Claude CLI's answer to the live probe;
  and the call and key the live probe made.

  # ── §1 NO SECRET, NO GREEN RUN ─────────────────────────────────────────────────────────────────

  @adw-939 @adw-3lva71-bug-the-conformance
  Scenario: With no ANTHROPIC_API_KEY secret in the repository, the envelope-conformance run fails with an error that names the secret, and raises no warning in its place
    Given the repository has no "ANTHROPIC_API_KEY" secret
    When the envelope-conformance workflow runs for a pull request
    Then the workflow run fails
    And the workflow run reports an error naming "ANTHROPIC_API_KEY"
    And the workflow run raises no warning naming "ANTHROPIC_API_KEY"

  # ── §2 WITH THE SECRET, THE LIVE PROBE RUNS ────────────────────────────────────────────────────

  @adw-939 @adw-3lva71-bug-the-conformance
  Scenario: With the ANTHROPIC_API_KEY secret set, the live probe runs against the pinned Claude CLI on that key, and a conforming answer without a rate-limit event leaves the run green
    Given the repository's "ANTHROPIC_API_KEY" secret holds "adw-939-made-up-key"
    And the pinned Claude CLI answers the live probe with a one-turn session that conforms to the committed schema and carries no rate-limit event
    When the envelope-conformance workflow runs for a pull request
    Then the pinned Claude CLI was asked for the live probe
    And the pinned Claude CLI received "adw-939-made-up-key" as its ANTHROPIC_API_KEY for the live probe
    And the workflow run succeeds

  # ── §3 THE LIVE PROBE DECIDES THE RUN ──────────────────────────────────────────────────────────

  @adw-939 @adw-3lva71-bug-the-conformance
  Scenario: With the ANTHROPIC_API_KEY secret set, a live probe whose answer has lost a field the committed schema requires fails the run, naming the field
    Given the repository's "ANTHROPIC_API_KEY" secret holds "adw-939-made-up-key"
    And the pinned Claude CLI answers the live probe with a one-turn session that conforms to the committed schema, except that its "result" message no longer carries the field "is_error"
    When the envelope-conformance workflow runs for a pull request
    Then the pinned Claude CLI was asked for the live probe
    And the workflow run fails
    And the workflow run reports an error naming "is_error"

  # ── §4 BACKSTOP ────────────────────────────────────────────────────────────────────────────────

  @adw-939 @adw-3lva71-bug-the-conformance
  Scenario: TypeScript type-check passes with the conformance gate's live probe made mandatory
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
