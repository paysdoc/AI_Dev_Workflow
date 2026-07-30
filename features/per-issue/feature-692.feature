@adw-692 @adw-kzs5rm-gitcontext-migrate-g
Feature: GitContext identity-read migration — the residual git-remote / gh-api-user identity reads route through the per-command-auth chokepoint, and the git/gh guard no longer exempts their consumers

  Issue #692 (parent PRD `specs/prd/git-context-repo-authority.md`, see the
  **Enforcement** section) is the slice that drives the git/gh guard ALLOWLIST toward
  zero for the IDENTITY-read surface — the two reads that answer "who am I / which repo
  is this": `git remote get-url origin` (repo identity) and `gh api user` (actor
  identity). Three residual consumers still shell these out to raw `git`/`gh` and sit on
  the guard ALLOWLIST; this slice routes their reads through `GitContext` and removes
  them from the ratchet.

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
    • #691 migrated the residual gh-READ consumers (concurrency guard, webhook sweeps,
      docs self-check, takeover handler, per-issue scenario sweep) and, in doing so,
      added the parameterised open-issue list read — `listOpenIssues({ fields, limit })`
      — to `GitContext`, routed through `#run`. THIS slice reuses that method (see the
      `trigger_cron` note below), which is why #692 is **Blocked by #691**.

  What this slice builds:

    • A new REMOTE-URL read method on `GitContext`, going through the existing `#run`
      chokepoint, covering the `git remote get-url origin` shape the three identity
      consumers need to resolve owner/repo from a worktree's `origin`. The companion
      actor-identity read, `gh api user`, ALREADY exists as `authenticatedUser()`
      (added by an earlier slice; `gitContext.ts`); this slice does not re-add it, it
      routes the last raw `gh api user` consumer onto it.
    • The three residual consumers — `githubApi`, `repoContext`, `trigger_cron` — stop
      shelling out to raw `git`/`gh` for their identity reads and route through the
      context instead. With their last raw `git`/`gh` call gone, each is REMOVED from
      the guard ALLOWLIST in `adws/checkGitGhGuard.ts`, so the guard scans them like any
      other file.

  Why `trigger_cron` needs #691 (the dependency, made concrete):

    `trigger_cron` carries TWO raw reads: the identity read `git remote get-url origin`
    (its repo-identity fallback) AND the open-issue list read `gh issue list … --state
    open --json …` (its cron poll). The guard is ALL-OR-NOTHING per file: a file removed
    from the ALLOWLIST is clean ONLY when EVERY raw `git`/`gh` call in it is gone. So
    de-allowlisting `trigger_cron` forces BOTH reads onto the context in the same slice —
    the identity read onto this slice's new remote-URL method, and the open-issue list
    read onto #691's `listOpenIssues`. The first could not have shipped without the
    second, which is the dependency. This feature does not re-pin that `listOpenIssues`
    routes through `#run` (that is #691's contract, already proven); the guard-clean
    assertion over `trigger_cron` in §2 is what enforces its FULL migration here.

  Why this slice exists — the defect it forecloses:

    A consumer that shells out to raw `git`/`gh` for its identity read authenticates and
    resolves against whatever repo last wrote the process-global `GH_TOKEN` / inherited
    the ambient process cwd. An identity read is the WORST place for this: it is the read
    that decides "which owner/repo am I acting on," so a bled global here mis-attributes
    every downstream write — the precise "could not resolve to a repository" /
    wrong-base-repo shape the PRD mined ~13 times. While such a consumer sits on the
    ALLOWLIST, the guard also cannot catch a NEW raw `git`/`gh` read sneaking in beside
    it. Routing the reads through `#run` binds each read's auth + cwd to the command (no
    shared global to clobber, no ambient cwd to inherit), and de-allowlisting the file
    re-arms the guard so any future raw read in it is a build failure, not a silent
    regression. Behaviour is unchanged; only token/cwd APPLICATION (per-command vs
    process-global/ambient) and guard COVERAGE change.

  Contract pinned here (the OBSERVABLE behaviour, not the field/signature shape):

    • read goes through #run   → the new remote-URL read method spawns its command with
                                 cwd = the context base path and a child env carrying
                                 the context's token + git author/committer; the existing
                                 `gh api user` read does the same (AC1; story 5).
    • per-command auth          → an identity read method's auth token lives in the
                                 spawned child's environment; running it leaves the
                                 parent process environment byte-for-byte unchanged — no
                                 reintroduced global mutation on the last identity-read
                                 path (AC1; story 5).
    • consumer de-allowlisted   → the guard, run against each of the three migrated
                                 consumer files, SCANS the file (it is no longer exempt)
                                 and finds NO direct git/gh shell-out in it (AC2, AC3;
                                 story 8).
    • guard still passes        → with the three files removed from the ALLOWLIST, the
                                 guard run across the whole repository reports zero
                                 violations — the de-allowlisting introduced no new
                                 violation, including `trigger_cron`'s now-also-migrated
                                 open-issue list read; the ratchet simply sits lower
                                 (AC4; story 8).

  Observability / rot-prevention note:

    Every assertion below targets a runtime OUTPUT of the system under test, never the
    static text of a source file. No step opens `githubApi.ts`, `repoContext.ts`,
    `trigger_cron.ts`, `checkGitGhGuard.ts`, or the GitContext package as text,
    substring-matches its contents, or parses it as JSON/AST.

      • §1 runs each identity-read method through a RECORDING RUNNER injected as the
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
    means no real `git`/`gh` is spawned and no network is touched in §1, so those
    scenarios are hermetic.

  Scope notes:

    • This slice pins TWO observable contracts: (a) the identity-read methods route
      their spawn through the per-command-auth `#run` chokepoint (§1), and (b) the
      three consumer files are now scanned by the guard and are violation-free (§2),
      with the whole-repo guard still passing (§3). Together these prove the identity
      reads moved off raw `git`/`gh` and onto the context: the consumers contain no raw
      `git`/`gh` (guard-clean, §2) and the context's read methods that replace them
      carry per-command auth (§1). The exact threading of a `GitContext` into each
      consumer (constructor param, function arg, or an injected dep's default) is an
      implementer's choice and is deliberately NOT pinned, consistent with the sibling
      slices' "pin the decision, not the shape" stance (#658/#659/#663/#691).
    • The new remote-URL method's NAME and the shape it returns (raw URL string vs a
      parsed `{ owner, repo }`; whether the `gh api user` consumer reuses
      `authenticatedUser()` directly or via a thin `.login`-extracting wrapper) are NOT
      pinned — the friendly op names in §1 map to whatever methods the implementer adds,
      inside the step definitions.
    • `trigger_cron`'s residual open-issue list read (`gh issue list … --state open …`)
      migrates onto #691's `listOpenIssues` as a NECESSARY consequence of de-allowlisting
      the file (see the dependency note above). That migration is enforced here ONLY by
      §2's guard-clean assertion over `trigger_cron`, not re-pinned as a §1 `#run` proof
      — #691 already owns the proof that `listOpenIssues` routes through `#run`.
    • Parent-global isolation and two-context isolation for the `#run` spawn path are
      already proven exhaustively by #659 and #663; the identity-read methods route
      through the SAME chokepoint, so this slice re-pins only ONE representative
      parent-env-unchanged check (§1c) — an anti-regression that the LAST identity-read
      consumers do not reintroduce a global mutation — and does not restate the full
      isolation matrix.
    • Auth ACQUISITION is unchanged: token minting/refresh is untouched; only token
      APPLICATION (per-command vs process-global) changes. No scenario here drives the
      minting path, an orchestrator, or the cron poller as a subprocess.
    • Behaviour of the consumers themselves (the owner/repo parse, the remote-mismatch
      validation in `repoContext`, the actor-login lookup in `githubApi`, the cron
      poll's issue selection) is unchanged and already covered by their existing unit
      suites; this slice adds coverage for the identity-read-path migration and the
      guard de-allowlisting, it does not relax those suites.
    • The @regression maintenance sweep is SKIPPED for this issue: `.adw/scenarios.md`
      configures a `## Regression Scenario Directory`, so promotion is a deliberate
      human decision and the agent never auto-promotes.

  Vocabulary note:

    Registered phrases reused (`features/regression/vocabulary.md`):
      G18 `the ADW codebase is checked out`              (background + §2/§3 + type-check)
      T22 `the ADW TypeScript type-check passes`          (backstop, via feature-504.steps.ts)

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

    Guard phrases reused VERBATIM from feature-691.steps.ts (globally registered there —
    generate_step_definitions must NOT redefine them, or Cucumber raises a duplicate
    step definition):
      • `the git/gh guard scans the file {string}`
      • `the git/gh guard scanned that file`
      • `the git/gh guard reports no violation in that file`
      • `the git/gh guard is run across the repository`
      • `the git/gh guard reports no violations`

    Novel phrasing introduced here — the registry has no phrase for running an IDENTITY
    read method through the context. Phrased DISTINCTLY from #659's `read operation`,
    #663's `gh operation`, and #691's `gh-read operation` (this uses `identity-read
    operation`) so the step files do not collide as Cucumber loads them all globally.
    `git remote get-url origin` is a GIT command and `gh api user` is a GH command, so
    the umbrella term "identity-read" — not "gh-read" — is the accurate one. Surfaced to
    the maintainer in the agent Output:
      Running an identity read method through the context:
        • `the {string} identity-read operation runs through the context`

    Step-definition note for the maintainer:
      • §1 steps phase-import `GitContext` and REUSE the shared `gitContextSharedWorld.ts`
        machinery (`makeFullOptions`, `makeSpyExec`, `makeNoOpFsDeps`, the shared `W`)
        exactly as `feature-691.steps.ts` / `feature-662.steps.ts` do, so #659's
        globally-registered assertion steps (`the captured command ran with auth token …`,
        `… git author …`, `… cwd equal to the context base path`, `a baseline snapshot …`,
        `… matches the baseline snapshot`) apply to the recorded calls without redefinition.
      • `the {string} identity-read operation runs through the context` adds a NEW
        dispatcher (parallel to #691's `gh-read operation` switch) over the identity
        reads:
          "remote-url"         → the new remote-URL read method (`git remote get-url origin`)
          "authenticated-user" → the existing `authenticatedUser()` method (`gh api user`)
        Construct the context via `makeFullOptions(owner, repo, token, authorName,
        authorEmail)` + `new GitContext(opts, { exec: makeSpyExec(W.responseMap).exec,
        fsDeps: makeNoOpFsDeps() })`, store it on `W.ctx` and the recorder's `calls` on
        `W.spyCalls`. Seed `W.responseMap` so the spy returns canned PARSEABLE output
        for each read (e.g. a `git@github.com:acme/webapp.git` URL for `remote get-url`,
        a `{"login":"acme-bot"}` JSON for `api user`) so the method completes; no real
        subprocess, no network. The token/author/cwd assertions are value-based
        comparisons against the recorded child `env`/`cwd`
        (`recorded.env.GH_TOKEN === token`, `recorded.cwd === ctx.basePath`).
      • The guard steps (§2/§3) and the type-check step (§4) require NO new definitions —
        they resolve to feature-691.steps.ts (`scanFiles`) and feature-504.steps.ts (T22)
        respectively.

  Background:
    Given the ADW codebase is checked out

  # ═══════════════ §1  IDENTITY-READ METHODS ROUTE THROUGH #run (AC1; story 5) ═════
  #
  # Surface: each identity read method actually spawns its command through the private
  # `#run` chokepoint. Its observable output is the command's launch parameters — the
  # cwd and the child environment the context handed the recording runner. #659 proved
  # this for the default-branch read; here it is the identity read shapes the migrated
  # consumers need: the repo-identity read (`git remote get-url origin`) and the
  # actor-identity read (`gh api user`).

  # ── §1a  The new remote-URL read carries token + git identity + base-path cwd ──────
  #
  # The headline NEW method this slice adds. `repoContext`, `githubApi`, and
  # `trigger_cron` all need the `git remote get-url origin` shape to resolve owner/repo
  # from a worktree's `origin`; routed through the context it spawns with the context's
  # token AND git author/committer in the child env, with cwd = the context base path —
  # never the ambient process cwd the legacy `execSync(..., { cwd })` inherited.

  @adw-692 @adw-kzs5rm-gitcontext-migrate-g
  Scenario: A new remote-URL read supplies the context token, git identity, and base-path cwd to its child command
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    When the "remote-url" identity-read operation runs through the context
    Then the captured command ran with auth token "token-acme" in its child environment
    And the captured command ran with git author "Acme Bot <bot@acme.dev>" in its child environment
    And the captured command ran with cwd equal to the context base path

  # ── §1b  Both identity reads carry the context token + base-path cwd ───────────────
  #
  # Breadth proof across the identity-read surface: the new repo-identity read AND the
  # pre-existing actor-identity read (`authenticatedUser()`, the method `githubApi`'s
  # `gh api user` consumer migrates onto) both route through the per-command spawn path.
  # cwd = base path is itself a strong migration signal — the legacy reads ran under the
  # caller-supplied / ambient process cwd; a migrated read runs under the context base
  # path.

  @adw-692 @adw-kzs5rm-gitcontext-migrate-g
  Scenario Outline: Each GitContext identity-read method runs with the context token and the base-path cwd
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    When the "<op>" identity-read operation runs through the context
    Then the captured command ran with auth token "token-acme" in its child environment
    And the captured command ran with cwd equal to the context base path

    Examples:
      | op                  |
      | remote-url          |

  # `authenticated-user` (`gh api user`) is a repo-API read (issue #775): it moved off
  # the outline above into its own scenario because its cwd is now the framework
  # repository root, not the context base path — the only row of the former outline
  # this fix affects. `remote-url` is a git op and is unaffected, so it stays above.

  @adw-692 @adw-kzs5rm-gitcontext-migrate-g
  Scenario: The authenticated-user identity-read method runs with the context token and the framework repository root cwd
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    When the "authenticated-user" identity-read operation runs through the context
    Then the captured command ran with auth token "token-acme" in its child environment
    And the captured command ran with cwd equal to the framework repository root

  # ── §1c  A new identity read does not reintroduce a process-global mutation ────────
  #
  # These three are the LAST raw identity readers. The whole epic exists to kill the
  # process-global `GH_TOKEN` bleed; a sloppy new remote-URL method that wrote
  # `process.env.GH_TOKEN` would silently reopen it. Running the new read leaves the
  # parent environment byte-for-byte unchanged — the token rode the child env only.

  @adw-692 @adw-kzs5rm-gitcontext-migrate-g
  Scenario: A new remote-URL read leaves the parent process environment byte-for-byte unchanged
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    And a baseline snapshot of the parent process environment is captured
    When the "remote-url" identity-read operation runs through the context
    Then the parent process environment matches the baseline snapshot

  # ═══════════════ §2  CONSUMERS DE-ALLOWLISTED AND GUARD-CLEAN (AC2, AC3; story 8) ═
  #
  # The headline for this slice. The git/gh guard tool IS the system under test; its
  # observable output is the `{ violations, scannedCount }` it computes for a file. An
  # ALLOWLISTED file is SKIPPED — the guard never scans it, so `scannedCount` stays 0.
  # After this slice each consumer is removed from the ALLOWLIST, so the guard SCANS it
  # (`scannedCount` counts it) and, because its raw identity read is gone, finds NO
  # violation. The "scanned" assertion is the de-allowlisting discriminator: RED before
  # this slice (the file is still exempt → not scanned), GREEN after. For `trigger_cron`
  # the "no violation" assertion additionally proves its `gh issue list` read migrated
  # onto #691's `listOpenIssues` — a file removed from the ALLOWLIST is clean only when
  # EVERY raw git/gh call in it is gone.

  # ── §2  Each migrated consumer is scanned by the guard and is free of raw git/gh ───

  @adw-692 @adw-kzs5rm-gitcontext-migrate-g
  Scenario Outline: The git/gh guard scans the migrated identity-read consumer (no longer allowlisted) and finds no direct git/gh shell-out
    Given the ADW codebase is checked out
    When the git/gh guard scans the file "<file>"
    Then the git/gh guard scanned that file
    And the git/gh guard reports no violation in that file

    Examples:
      | file                            |
      | adws/github/githubApi.ts        |
      | adws/providers/repoContext.ts   |
      | adws/triggers/trigger_cron.ts   |

  # ═══════════════ §3  WHOLE-REPO GUARD STILL PASSES (AC4; story 8) ════════════════
  #
  # The safe-de-allowlisting backstop. Removing the three files from the ALLOWLIST must
  # not surface a violation: each one's last raw identity read is genuinely gone, and
  # `trigger_cron`'s open-issue list read moved onto #691's `listOpenIssues` too.
  # Running the guard across the whole repository reports zero violations. This fails
  # loudly if a consumer is de-allowlisted while a raw git/gh call still lives in it —
  # the precise incomplete-migration mistake this AC guards against (and the exact trap
  # `trigger_cron`'s dual read sets).

  # ── §3  The git/gh guard reports no violations across the repository ───────────────

  @adw-692 @adw-kzs5rm-gitcontext-migrate-g
  Scenario: The git/gh guard passes across the whole repository after the identity-read consumers are de-allowlisted
    Given the ADW codebase is checked out
    When the git/gh guard is run across the repository
    Then the git/gh guard reports no violations

  # ═══════════════ §4  TYPE-CHECK BACKSTOP (registry T22) ══════════════════════════
  #
  # ── §4  The migrated identity-read surface keeps the ADW codebase type-clean ───────
  #
  # A backstop consistent with the sibling per-issue features (feature-659, feature-663,
  # feature-664, feature-691): the new remote-URL context method and the now
  # raw-git/gh-free consumers compile within the ADW codebase's type-check.

  @adw-692 @adw-kzs5rm-gitcontext-migrate-g
  Scenario: The ADW TypeScript type-check passes with the migrated identity-read surface in place
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
