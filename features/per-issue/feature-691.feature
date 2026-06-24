@adw-691 @adw-96qtfe-gitcontext-migrate-g
Feature: GitContext gh-read migration — the residual issue/PR read consumers route through the per-command-auth chokepoint, and the git/gh guard no longer exempts them

  Issue #691 (parent PRD `specs/prd/git-context-repo-authority.md`, see the
  **Enforcement** section) is the slice that drives the git/gh guard ALLOWLIST toward
  zero for the read surface. The guard shipped as a RATCHET, not the spec'd invariant:
  a handful of residual gh-READ consumers were parked on the ALLOWLIST while the write
  surface migrated (#663) and the launch/webhook boundary constructors landed (#660,
  #664). This slice removes the read consumers from that ratchet.

  Earlier slices established the machinery this one consumes:

    • #658 shipped the `GitContext` deep module — mandatory identity, the
      one-constructor base-path decision, `worktreePathFor(branch)`, and the
      `commandEnv()` per-command env overlay BUILDER carrying the token + git
      author/committer.
    • #659 routed a representative READ op (default-branch) through the private
      `#run` chokepoint, proving the spawn path end to end: a command launches with
      cwd = base path and a child env carrying the token, the parent global untouched.
    • #663 migrated the full gh-OPERATION surface (issue/PR/comment/label/board) onto
      context methods, all through `#run`.

  What this slice builds:

    • New gh-READ method(s) on `GitContext`, going through the existing `#run`
      chokepoint, covering the read shapes the residual consumers still need:
        – an open-issue list read (the `gh issue list --state open --json …` shape
          used by the concurrency guard, the webhook dependency-unblock/abandon
          sweeps, and the docs self-check refactor-issue lookup),
        – a single-issue comments read (the `gh issue view N --json comments` shape
          the takeover handler uses to resolve the latest adwId from comments),
        – a merged-PR list read (the `gh pr list --state merged --json …` shape the
          per-issue scenario sweep uses to date a feature file's linked merge).
      `fetchPRList` (open PRs) already exists; the merged-PR read is the only PR-list
      shape still missing.
    • The five residual consumers — `concurrencyGuard`, `webhookGatekeeper`,
      `docsSelfCheck`, `takeoverHandler`, `perIssueScenarioSweep` — stop shelling out
      to raw `gh` and route their reads through the context instead. With their last
      raw `gh` call gone, each is REMOVED from the guard ALLOWLIST in
      `adws/checkGitGhGuard.ts`, so the guard scans them like any other file.

  Why this slice exists — the defect it forecloses:

    A consumer that shells out to raw `gh` authenticates against whatever repo last
    wrote the process-global `GH_TOKEN`. While such a consumer sits on the ALLOWLIST,
    the guard cannot catch a NEW raw `gh` read sneaking in beside it, and the read
    itself rides the bleeding global rather than a per-command token — the exact
    "could not resolve to a repository" shape the PRD mined ~13 times. Routing the
    reads through `#run` binds each read's auth to the command (no shared global to
    clobber), and de-allowlisting the file re-arms the guard so any future raw `gh`
    read in it is a build failure, not a silent regression. Behaviour is unchanged;
    only token APPLICATION (per-command vs process-global) and guard COVERAGE change.

  Contract pinned here (the OBSERVABLE behaviour, not the field/signature shape):

    • read goes through #run   → each new gh-read method spawns its command with
                                 cwd = the context base path and a child env carrying
                                 the context's token + git author/committer (AC1).
    • per-command auth          → a new read method's auth token lives in the spawned
                                 child's environment; running it leaves the parent
                                 process environment byte-for-byte unchanged — no
                                 reintroduced global mutation on the last read path
                                 (AC1; stories 5, 18).
    • consumer de-allowlisted   → the guard, run against each of the five migrated
                                 consumer files, SCANS the file (it is no longer
                                 exempt) and finds NO direct git/gh shell-out in it
                                 (AC2, AC3; story 8).
    • guard still passes        → with the five files removed from the ALLOWLIST, the
                                 guard run across the whole repository reports zero
                                 violations — the de-allowlisting introduced no new
                                 violation, the ratchet simply sits lower (AC4;
                                 story 8).

  Observability / rot-prevention note:

    Every assertion below targets a runtime OUTPUT of the system under test, never the
    static text of a source file. No step opens `concurrencyGuard.ts`,
    `webhookGatekeeper.ts`, `docsSelfCheck.ts`, `takeoverHandler.ts`,
    `perIssueScenarioSweep.ts`, `checkGitGhGuard.ts`, or the GitContext package as
    text, substring-matches its contents, or parses it as JSON/AST.

      • §1 runs each new read method through a RECORDING RUNNER injected as the
        context's command boundary (the `GitContextDeps.exec` seam #659 established —
        the same recorder category as the registered `git-mock`/`mock server`
        collaborators in `vocabulary.md`) and asserts the RECORDED `cwd` and child
        `env` the context handed that runner. The recorded `(cwd, env)` is the
        command's actual launch parameters — a runtime artefact, not a source read.
        The "parent env unchanged" step compares the LIVE `process.env` before and
        after the read; `process.env` is live runtime state, the canonical observable
        for "was the global mutated," which the Rot-Detection Rubric permits.
      • §2 and §3 assert the GUARD'S VERDICT, where the guard tool IS the system under
        test. The guard's exported scan returns a `{ violations, scannedCount }`
        result — a value computed at runtime, the guard's OUTPUT — and the steps
        assert that result. This is the SAME artefact category as registry T22 ("the
        ADW TypeScript type-check passes"), which runs `tsc` over the whole source
        tree and asserts its verdict: the analyzer reads source, but the SCENARIO
        asserts the analyzer's OUTPUT, never source text. Critically, "removed from
        the ALLOWLIST" is NOT asserted by grepping `checkGitGhGuard.ts` for the path —
        it is proven only through its OBSERVABLE CONSEQUENCE: the guard now SCANS the
        file (its `scannedCount` counts it; an allowlisted file is skipped and never
        counted), and finds it violation-free. A refactor that renames a consumer or
        restructures the guard leaves these assertions valid as long as the BEHAVIOUR
        holds — the file is scanned and clean.

    The file paths, owners/repos, tokens, authors, and op names in the steps are INPUT
    test data; the recorded `(cwd, env)`, the live `process.env`, the guard's
    `{ violations, scannedCount }`, and the type-check exit code are the system's
    OUTPUTS — exactly the artefact category the rubric permits. The recording runner
    means no real `gh` is spawned and no network is touched in §1, so those scenarios
    are hermetic.

  Scope notes:

    • This slice pins TWO observable contracts: (a) the new gh-read methods route
      their spawn through the per-command-auth `#run` chokepoint (§1), and (b) the
      five consumer files are now scanned by the guard and are violation-free (§2),
      with the whole-repo guard still passing (§3). Together these prove the reads
      moved off raw `gh` and onto the context: the consumers contain no raw `gh`
      (guard-clean, §2) and the context's read methods that replace them carry
      per-command auth (§1). The exact threading of a `GitContext` into each consumer
      (constructor param, function arg, or an injected dep's default) is an
      implementer's choice and is deliberately NOT pinned, consistent with the sibling
      slices' "pin the decision, not the shape" stance (#658/#659/#663). Re-asserting
      the per-consumer call wiring would require coupling to signatures the issue
      leaves open and would rot on a harmless refactor.
    • The new read methods' NAMES and decomposition (one parameterised `listOpenIssues`
      vs several; whether the merged-PR read is a new method or the existing
      `fetchAllPRs` filtered; whether the takeover comments read reuses `fetchIssue`)
      are NOT pinned — the friendly op names in §1 map to whatever methods the
      implementer adds, inside the step definitions.
    • Parent-global isolation and two-context isolation for the `#run` spawn path are
      already proven exhaustively by #659 (§3–§5) and #663 (§2–§4); the new read
      methods route through the SAME chokepoint, so this slice re-pins only ONE
      representative parent-env-unchanged check (§1c) — an anti-regression that the
      LAST read consumers do not reintroduce a global mutation — and does not restate
      the full isolation matrix.
    • Auth ACQUISITION is unchanged: token minting/refresh is untouched; only token
      APPLICATION (per-command vs process-global) changes. No scenario here drives the
      minting path, an orchestrator, or the webhook as a subprocess.
    • Behaviour of the consumers themselves (the concurrency count, the staleness
      retention window, the takeover decision tree, the docs-bloat routing) is
      unchanged and already covered by their existing unit suites; this slice adds
      coverage for the read-path migration and the guard de-allowlisting, it does not
      relax those suites.
    • The @regression maintenance sweep is SKIPPED for this issue: `.adw/scenarios.md`
      configures a `## Regression Scenario Directory`, so promotion is a deliberate
      human decision and the agent never auto-promotes.

  Vocabulary note:

    Registered phrases reused (`features/regression/vocabulary.md`):
      G18 `the ADW codebase is checked out`              (background + §2/§3 + type-check)
      T22 `the ADW TypeScript type-check passes`          (backstop)

    Phrases reused verbatim from the GitContext per-issue corpus (established by
    feature-659, globally registered via `gitContextSharedWorld.ts`, NOT yet in the
    registry) so the §1 step definitions share #659's recording-runner and parent-env
    machinery:
      • `a GitContext for owner {string} repo {string} with auth token {string} and git author {string}`
      • `the context's git and gh commands are captured by a recording runner`
      • `a baseline snapshot of the parent process environment is captured`
      • `the captured command ran with auth token {string} in its child environment`
      • `the captured command ran with git author {string} in its child environment`
      • `the captured command ran with cwd equal to the context base path`
      • `the parent process environment matches the baseline snapshot`

    Novel phrasing introduced here — the registry has no phrase for running a NEW
    gh-read method through the context, nor for asserting the git/gh guard's scan
    verdict. Phrased DISTINCTLY from #659's `read operation` and #663's `gh operation`
    runner phrases (this uses `gh-read operation`) so the step files do not collide as
    Cucumber loads them all globally. Surfaced to the maintainer in the agent Output:
      Running a new read method through the context:
        • `the {string} gh-read operation runs through the context`
      Guard scan verdict:
        • `the git/gh guard scans the file {string}`
        • `the git/gh guard scanned that file`
        • `the git/gh guard reports no violation in that file`
        • `the git/gh guard is run across the repository`
        • `the git/gh guard reports no violations`

    Step-definition note for the maintainer:
      • §1 steps phase-import `GitContext` and REUSE the shared `gitContextSharedWorld.ts`
        machinery (`makeFullOptions`, `makeSpyExec`, the shared `W`) exactly as
        `feature-662.steps.ts` does, so #659's globally-registered assertion steps
        (`the captured command ran with auth token …`, `… git author …`, `… cwd equal
        to the context base path`, `a baseline snapshot …`, `… matches the baseline
        snapshot`) apply to the recorded calls without redefinition.
      • `the {string} gh-read operation runs through the context` extends the shared
        `runOpOnContext(ctx, opName)` dispatcher with the new read methods:
          "list-open-issues"    → the new open-issue list read method
          "view-issue-comments" → the new single-issue comments read method
          "list-merged-prs"     → the merged-PR list read (new method, or existing
                                  `fetchAllPRs` filtered to merged — both route via #run)
        Construct the context via `makeFullOptions(owner, repo, token, authorName,
        authorEmail)` + `new GitContext(opts, { exec: makeSpyExec(W.responseMap).exec,
        fsDeps: makeNoOpFsDeps() })`, store it on `W.ctx` and the recorder's `calls`
        on `W.spyCalls`. Seed `W.responseMap` so the spy returns canned PARSEABLE
        output for each read (e.g. `[]` for the list reads) so the method completes;
        no real subprocess, no network. The token/author/cwd assertions are
        value-based comparisons against the recorded child `env`/`cwd`
        (`recorded.env.GH_TOKEN === token`, `recorded.cwd === ctx.basePath`).
      • `the git/gh guard scans the file {string}` phase-imports the EXPORTED pure
        `scanFiles(relPaths, repoRoot)` from `adws/checkGitGhGuard.ts` and calls
        `scanFiles([path], process.cwd())`, storing the returned `{ violations,
        scannedCount }` on the World. `the git/gh guard scanned that file` asserts
        `scannedCount === 1` (the file is NOT on the ALLOWLIST — an allowlisted file is
        skipped and `scannedCount` stays 0; this is the de-allowlisting discriminator,
        RED before this slice because the file is still exempt). `the git/gh guard
        reports no violation in that file` asserts `violations.length === 0` (no raw
        git/gh). Both reference only the returned value — never source text.
      • `the git/gh guard is run across the repository` runs the guard over the whole
        tree and captures its verdict — either by spawning `bun run lint:git-guard`
        (= `bunx tsx adws/checkGitGhGuard.ts`) with `cwd: process.cwd()` and capturing
        the exit code + stdout (registry surfaces 4 + 5), or by re-walking the tree and
        calling `scanFiles`. `the git/gh guard reports no violations` asserts the run
        reported a clean result (exit 0 / PASS, or `violations.length === 0`). This is
        the safe-de-allowlisting backstop: it fails if a file is removed from the
        ALLOWLIST while a raw git/gh call still lives in it.

  Background:
    Given the ADW codebase is checked out

  # ═══════════════ §1  NEW gh-READ METHODS ROUTE THROUGH #run (AC1; stories 5, 18) ═
  #
  # Surface: each new read method actually spawns its `gh` command through the private
  # `#run` chokepoint. Its observable output is the command's launch parameters — the
  # cwd and the child environment the context handed the recording runner. #659 proved
  # this for the default-branch read; here it is the residual read shapes the migrated
  # consumers need (open-issue list, single-issue comments, merged-PR list).

  # ── §1a  A new open-issue list read carries token + git identity + base-path cwd ──
  #
  # The headline read op. The concurrency guard / webhook sweeps / docs self-check all
  # need the `gh issue list --state open --json …` shape; routed through the context it
  # spawns with the context's token AND git author/committer in the child env, with
  # cwd = the context base path — never the ambient process cwd the legacy
  # `execSync`/`execWithRetry` inherited.

  @adw-691 @adw-96qtfe-gitcontext-migrate-g
  Scenario: A new open-issue list read supplies the context token, git identity, and base-path cwd to its child command
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    When the "list-open-issues" gh-read operation runs through the context
    Then the captured command ran with auth token "token-acme" in its child environment
    And the captured command ran with git author "Acme Bot <bot@acme.dev>" in its child environment
    And the captured command ran with cwd equal to the context base path

  # ── §1b  Every new gh-read method carries the context token + base-path cwd ────────
  #
  # Breadth proof across the residual read surface: each read the five consumers needed
  # now routes through the per-command spawn path. cwd = base path is itself a strong
  # migration signal — the legacy reads ran under the ambient process cwd; a migrated
  # read runs under the context base path.

  @adw-691 @adw-96qtfe-gitcontext-migrate-g
  Scenario Outline: Each new GitContext gh-read method runs with the context token and the base-path cwd
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    When the "<op>" gh-read operation runs through the context
    Then the captured command ran with auth token "token-acme" in its child environment
    And the captured command ran with cwd equal to the context base path

    Examples:
      | op                  |
      | list-open-issues    |
      | view-issue-comments |
      | list-merged-prs     |

  # ── §1c  A new read method does not reintroduce a process-global mutation ──────────
  #
  # These five are the LAST raw-`gh` readers. The whole epic exists to kill the
  # process-global `GH_TOKEN` bleed; a sloppy new read method that wrote
  # `process.env.GH_TOKEN` would silently reopen it. Running a representative new read
  # leaves the parent environment byte-for-byte unchanged — the token rode the child
  # env only.

  @adw-691 @adw-96qtfe-gitcontext-migrate-g
  Scenario: A new open-issue list read leaves the parent process environment byte-for-byte unchanged
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    And a baseline snapshot of the parent process environment is captured
    When the "list-open-issues" gh-read operation runs through the context
    Then the parent process environment matches the baseline snapshot

  # ═══════════════ §2  CONSUMERS DE-ALLOWLISTED AND GUARD-CLEAN (AC2, AC3; story 8) ═
  #
  # The headline for this slice. The git/gh guard tool IS the system under test; its
  # observable output is the `{ violations, scannedCount }` it computes for a file. An
  # ALLOWLISTED file is SKIPPED — the guard never scans it, so `scannedCount` stays 0.
  # After this slice each consumer is removed from the ALLOWLIST, so the guard SCANS it
  # (`scannedCount` counts it) and, because its raw `gh` read is gone, finds NO
  # violation. The "scanned" assertion is the de-allowlisting discriminator: RED before
  # this slice (the file is still exempt → not scanned), GREEN after.

  # ── §2  Each migrated consumer is scanned by the guard and is free of raw git/gh ───

  @adw-691 @adw-96qtfe-gitcontext-migrate-g
  Scenario Outline: The git/gh guard scans the migrated consumer (no longer allowlisted) and finds no direct git/gh shell-out
    Given the ADW codebase is checked out
    When the git/gh guard scans the file "<file>"
    Then the git/gh guard scanned that file
    And the git/gh guard reports no violation in that file

    Examples:
      | file                                    |
      | adws/triggers/concurrencyGuard.ts       |
      | adws/triggers/webhookGatekeeper.ts      |
      | adws/phases/docsSelfCheck.ts            |
      | adws/triggers/takeoverHandler.ts        |
      | adws/triggers/perIssueScenarioSweep.ts  |

  # ═══════════════ §3  WHOLE-REPO GUARD STILL PASSES (AC4; story 8) ════════════════
  #
  # The safe-de-allowlisting backstop. Removing the five files from the ALLOWLIST must
  # not surface a violation: each one's last raw `gh` read is genuinely gone. Running
  # the guard across the whole repository reports zero violations. This fails loudly if
  # a consumer is de-allowlisted while a raw git/gh call still lives in it — the precise
  # incomplete-migration mistake this AC guards against.

  # ── §3  The git/gh guard reports no violations across the repository ───────────────

  @adw-691 @adw-96qtfe-gitcontext-migrate-g
  Scenario: The git/gh guard passes across the whole repository after the read consumers are de-allowlisted
    Given the ADW codebase is checked out
    When the git/gh guard is run across the repository
    Then the git/gh guard reports no violations

  # ═══════════════ §4  TYPE-CHECK BACKSTOP (registry T22) ══════════════════════════
  #
  # ── §4  The migrated read surface keeps the ADW codebase type-clean ────────────────
  #
  # A backstop consistent with the sibling per-issue features (feature-659 §6,
  # feature-663 §5, feature-664 §6): the new gh-read context methods and the now
  # raw-`gh`-free consumers compile within the ADW codebase's type-check.

  @adw-691 @adw-96qtfe-gitcontext-migrate-g
  Scenario: The ADW TypeScript type-check passes with the migrated gh-read surface in place
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
