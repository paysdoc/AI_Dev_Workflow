@adw-767 @adw-70ggo9-bdd-docker-regressio
Feature: The BDD mock harness sets up in a read-only workspace and never leaks a mock server when setup fails — so the Docker regression run finishes in seconds instead of hanging for hours

  Issue #767 is a P1 in the BDD test harness itself (`test/mocks/test-harness.ts`).
  The daily `Regression Scenarios` workflow ran for 6 hours and was killed by
  GitHub's 360-minute job timeout, even though the tests themselves take under a
  second. Two independent defects combined to produce the runaway:

    BUG 1 — the git-wrapper directory is created INSIDE the read-only mount.
      `test/docker-run.sh` mounts the repo at `/workspace` read-only (by design).
      `createGitMockDir` builds the mock `git` wrapper at
      `join(process.cwd(), '.tmp-git-mock')` — i.e. inside `/workspace` — so every
      one of the 53 Docker scenarios fails in the `Before` hook with
      `EROFS: read-only file system, mkdir '/workspace/.tmp-git-mock'`. The
      Dockerfile already provisions `/tmp/bdd` as writable scratch space for
      exactly this, but the harness never uses it. THE FIX writes the wrapper to a
      writable location (`mkdtemp` under `os.tmpdir()`, or `/tmp/bdd` when
      `TEST_RUNTIME=docker`) instead of the working tree.

    BUG 2 — a setup that fails after the mock server starts LEAKS the server.
      `setupMockInfrastructure` starts the GitHub API mock server (a listening
      HTTP socket) BEFORE it creates the git-wrapper directory, and only sets its
      `isSetUp` guard AFTER. When `createGitMockDir` throws, `isSetUp` stays false,
      so `teardownMockInfrastructure` (which begins `if (!isSetUp) return;`) never
      stops the already-listening server. The open socket keeps the Bun event loop
      alive: cucumber prints its summary but the process never exits, `docker run`
      never returns, and the job hangs until GitHub cancels it. THE FIX makes setup
      crash-safe: any failure after the server has started stops the server before
      rethrowing (equivalently, the server handle is tracked independently of
      `isSetUp` so teardown always closes it).

  The behavioural contract pinned below:

    1. (Bug 1, mechanism) A normal setup installs its mock `git` wrapper on PATH
       from a directory OUTSIDE the working tree, and that directory is writable —
       so a read-only working tree can never make the wrapper un-creatable.
    2. (Bug 1, incident) Setup COMPLETES SUCCESSFULLY when the working directory is
       read-only, the exact condition of the read-only `/workspace` mount — no
       read-only-filesystem error is raised.
    3. (Bug 2, mechanism) When a setup step AFTER the mock server has started fails,
       tearing the infrastructure down leaves NO mock server listening — the
       leaked-socket root cause is gone.
    4. (Bug 2, symptom) A process that sets up and then tears down the mock
       infrastructure across such a failure TERMINATES ON ITS OWN instead of
       hanging — the 6-hour runaway can no longer occur.
    5. TypeScript still type-checks with the crash-safe, writable-scratch harness
       wired in.

  Observability / rot-prevention note:

    Every assertion below targets an artefact the harness PRODUCES AT RUNTIME —
    never the text, shape, or existence of a source file:

      • §1 asserts the runtime location of the git-wrapper directory the harness
        actually creates and prepends to `PATH` (a mutated environment value plus a
        directory created on disk during the run), and that the directory is
        writable (an `access(…, W_OK)` probe). It never reads `test-harness.ts` as
        text and never asserts a source path exists.
      • §2 asserts only that the setup call RETURNS rather than THROWS a
        read-only-filesystem error when driven with a read-only working directory —
        a runtime control-flow signal, not a file assertion.
      • §3 asserts a runtime socket state: whether a TCP connection to the port the
        mock server opened is refused after teardown. An open/closed listening
        socket is a runtime artefact of the system under test, not a source file.
      • §4 asserts a subprocess's termination status — that it exits on its own and
        is not killed by a watchdog timeout — which is Observability Surface #4
        (exit codes) / #5 (subprocess) from the vocabulary registry.

    No step reads a source file's contents, substring-matches them, or parses them
    as JSON/AST; the created directory, the environment value, the listening
    socket, and the process exit status are the behavioural signals, exactly as the
    framework Rot-Prevention rule and the `features/regression/vocabulary.md`
    Rot-Detection Rubric require.

  How the scenarios drive the system under test:

    These scenarios drive the harness itself as an in-process module (the
    phase-import pattern), importing `setupMockInfrastructure` /
    `teardownMockInfrastructure` from `test/mocks/test-harness.ts` and calling
    them directly. Because they are tagged `@adw-767` (not `@regression`), the
    global `@regression` `Before`/`After` hooks in
    `features/regression/support/hooks.ts` — which themselves call
    `setupMockInfrastructure` — DO NOT fire for them, so each scenario owns the
    full setup/teardown lifecycle with no double-setup conflict. Each scenario MUST
    start from and restore a clean harness state (no server left listening; PATH,
    the working directory, and `TMPDIR` restored) so these harness-under-test
    scenarios never perturb one another or the wider suite.

    The failure in §3 and §4 is injected at a step that fails EVEN AFTER the Bug 1
    fix — the writable-scratch base is made unwritable (e.g. by pointing the
    resolved temp base at a read-only directory) so `createGitMockDir` still throws
    after the mock server is listening. This keeps §3/§4 RED until the Bug 2
    crash-safety fix lands, rather than passing vacuously once Bug 1 alone is fixed.
    §3 pins the mock server on a known port via the setup config so the post-
    teardown probe knows which port to check. §4 lets the process reach the natural
    end of its main function WITHOUT calling `process.exit`, so a leaked handle is
    what keeps it alive — the whole point of the assertion.

  Scope notes:

    • The issue's third fix — adding `timeout-minutes` to the `regression` job in
      `.github/workflows/regression.yml` — is a CI safety-net, not a behaviour of
      the system under test. Its only observable is "GitHub cancels the job after N
      minutes", which cannot be exercised inside a BDD scenario, and the sole way
      to assert it in-repo would be to parse or substring-match the workflow YAML —
      precisely the structural-source-file / file-content assertions the
      Rot-Prevention rule forbids. It is therefore intentionally left uncovered
      here and surfaced to the maintainer in the agent Output; §3 and §4 cover the
      root cause the timeout only backstops.
    • The out-of-scope observation in the issue (11 of 53 host scenarios pass, 42
      are pending on undefined steps) is unrelated to this harness breakage and is
      not addressed here.
    • The exact writable base the fix chooses (`os.tmpdir()` on the host vs
      `/tmp/bdd` under `TEST_RUNTIME=docker`) is an implementation choice. §1
      therefore pins the observable invariant — the wrapper directory lives OUTSIDE
      the working tree and is writable — rather than a hardcoded path, so it does
      not break when the implementer picks a particular base. These scenarios run
      on the host (they are per-issue `@adw-767`, not `@regression`), where the
      read-only mount is simulated by a read-only working directory.

  Vocabulary note:

    None of the phrases registered in `features/regression/vocabulary.md` cover the
    mock harness's own setup/teardown lifecycle — the registry is scoped to
    orchestrator / phase / mock-query behaviours (spawned orchestrators, executed
    phases, recorded GitHub/git calls). Per the vocabulary-preference rule, the two
    phrases that DO fit are reused — `the ADW codebase is checked out` (G18,
    Background) and `the ADW TypeScript type-check passes` (T22, §5) — and novel
    Gherkin phrasing is introduced for the harness-lifecycle steps, with the gap
    surfaced to the maintainer in the agent Output.

  Background:
    Given the ADW codebase is checked out

  # ── §1  Bug 1 mechanism — the git wrapper is relocated out of the working tree ─

  @adw-767 @adw-70ggo9-bdd-docker-regressio
  Scenario: A normal setup installs the mock git wrapper from a writable directory outside the working tree
    When the ADW mock infrastructure is set up
    Then the mock git wrapper it installs on PATH resides outside the working tree
    And the mock git wrapper directory is writable
    And the ADW mock infrastructure is torn down

  # ── §2  Bug 1 incident — setup survives a read-only working directory ──────────
  # This is the exact Docker condition: the repo mounted read-only at /workspace.
  # Before the fix this raised EROFS from mkdir '/workspace/.tmp-git-mock'.

  @adw-767 @adw-70ggo9-bdd-docker-regressio
  Scenario: Setting up the mock infrastructure succeeds when the working directory is read-only
    Given the working directory is a read-only mount
    When the ADW mock infrastructure is set up
    Then the mock infrastructure setup completes without a read-only-filesystem error
    And the ADW mock infrastructure is torn down

  # ── §3  Bug 2 mechanism — a failed setup leaves no listening server ────────────

  @adw-767 @adw-70ggo9-bdd-docker-regressio
  Scenario: A setup failure after the mock server has started leaves no mock server listening
    Given creating the git wrapper directory will fail after the mock server has started
    When the ADW mock infrastructure setup is attempted and fails
    And the ADW mock infrastructure is torn down
    Then no mock server is left listening on the port the setup opened

  # ── §4  Bug 2 symptom — the run terminates instead of hanging ──────────────────
  # The 6-hour runaway reproduced and pinned: a leaked listening socket kept the
  # Bun event loop alive so the process never exited. Post-fix it exits on its own.

  @adw-767 @adw-70ggo9-bdd-docker-regressio
  Scenario: A process that sets up and tears down the mock infrastructure across a setup failure terminates on its own
    Given creating the git wrapper directory will fail after the mock server has started
    When a process sets up and then tears down the mock infrastructure across the failure
    Then the process terminates on its own instead of hanging

  # ── §5  Type-check ─────────────────────────────────────────────────────────────

  @adw-767 @adw-70ggo9-bdd-docker-regressio
  Scenario: TypeScript type-check passes with the crash-safe, writable-scratch harness
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
