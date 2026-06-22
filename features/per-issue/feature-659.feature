@adw-659 @adw-6phrv4-gitcontext-per-comma
Feature: GitContext per-command auth/env injection — token and cwd are bound to each spawned command, never to a process global

  Issue #659 (parent PRD `specs/prd/git-context-repo-authority.md`, see **Auth
  model** and **Testing Decisions §1**) is the auth-isolation slice of the
  repo-context authority. The foundational slice (#658) shipped the `GitContext`
  deep module — mandatory identity, the one-constructor base-path decision, a
  `worktreePathFor(branch)` accessor, and the `commandEnv()` overlay BUILDER that
  carries the token + git author/committer. #658 deliberately did NOT make any
  operation actually spawn a command, and it deliberately deferred token isolation
  to PRD story 7 (this issue): its §6 isolation scenario asserted only BASE-PATH
  independence, never token isolation.

  This slice closes that gap. It routes at least one representative operation (a
  read op — default-branch and issue read) through the context so the spawn path
  is proven end to end: every operation method spawns its underlying git/`gh`
  command with an explicit `cwd` (the base path) and an explicit child-process
  environment carrying the auth token and the git author/committer identity. The
  parent process's global environment is NEVER mutated for auth on the operation
  hot path, and two contexts for two different repos exercised in the same process
  never observe each other's `cwd` or token — the bleed becomes structurally
  impossible.

  Why this slice exists — the defect it forecloses:

    Today the GitHub token is applied by MUTATING a process-global environment
    variable (`process.env.GH_TOKEN = ...` in `github/githubAppAuth.ts`), gated by
    a module-global `activeRepo` "currently-authed repo." A long-lived, concurrent
    multi-repo process (the webhook server; the pause-queue resume path) overwrites
    that global mid-flight, so an in-flight `gh` call for repo A authenticates with
    repo B's token and intermittently reports "could not resolve to a repository."
    The history records repeated episodes of exactly this token-bleed shape.

    `GitContext` makes the bleed unrepresentable: the token and git identity ride
    ON the context and are injected PER COMMAND into the spawned child's
    environment. There is no shared process-global to overwrite, so two contexts in
    one process — even with interleaved async work — cannot clobber each other's
    auth. Auth becomes a property of the command, not of the process.

  Contract pinned here (the observable behaviour, not the field shape):

    • representative op       → spawns its git/`gh` command with cwd = the context
                                base path and a child env carrying the context's
                                token + git author/committer (AC1, AC3; story 7).
    • explicit cwd            → the command's cwd is the base path REGARDLESS of the
                                process working directory — no ambient-cwd
                                inheritance (AC1).
    • parent env untouched    → running an operation leaves the parent process
                                environment byte-for-byte unchanged; a pre-existing
                                global auth token is never overwritten (AC2, AC4;
                                story 7).
    • two-context isolation   → two contexts for two repos run their commands with
                                their OWN token + cwd; neither command's child env
                                carries the other's token (AC5; stories 2, 7).
    • interleaved isolation   → even when operations on the two contexts are
                                interleaved in one process, each command carries its
                                own token and the parent global stays untouched —
                                the precise concurrency case the legacy
                                process-global failed (story 2, 7).

  Observability / rot-prevention note:

    Every assertion below targets a runtime OUTPUT of the system under test, never
    a source file. No step reads the GitContext package, `githubAppAuth.ts`, or any
    other module as text, substring-matches its contents, or parses it as JSON/AST.

      • The PRD's Testing Decisions name the observable explicitly: "assert
        external, observable behaviour — THE CWD AND ENVIRONMENT A CONTEXT ACTUALLY
        RUNS COMMANDS WITH ... not internal call structure." These scenarios assert
        exactly that. Each representative op is run with a RECORDING RUNNER injected
        as the context's command boundary (a fake spawn, the same recorder category
        as the registered `git-mock`/`mock server` collaborators in
        `vocabulary.md`); the steps assert the RECORDED `cwd` and the RECORDED child
        `env` the context handed that runner. The recorded `(cwd, env)` is a runtime
        artefact — the command's actual launch parameters — not a source property.
      • The "parent env untouched" steps read the LIVE `process.env` before and
        after an operation. `process.env` is live runtime state, the canonical
        observable for "was the global mutated"; comparing it across an operation is
        the artefact category the Rot-Detection Rubric permits, NOT a source read.
      • §6 asserts the type-checker's verdict (registry T22).

    The owners/repos, tokens, authors, and op names in the steps are INPUT test
    data; the recorded `cwd`/`env`, the live `process.env`, and the type-check exit
    code are the system's OUTPUTS — exactly the artefact category the rubric
    permits. The recording runner means no real git/`gh` is spawned and no network
    is touched, so the scenarios are hermetic.

  Scope notes:

    • These pin the OPERATION's spawn path end to end — a representative op actually
      runs a command with cwd = base path and the per-command auth env. The
      `commandEnv()` overlay builder in isolation (purity, distinct tokens per
      context) is already covered by #658's unit tests; these scenarios do not
      restate that, they prove an operation METHOD routes its spawn through it.
    • Behaviour pinned here is the OBSERVABLE injection — the cwd and env a command
      is launched with, the untouched parent global, and per-context token
      isolation. The exact auth env-var name (`GH_TOKEN` vs `GITHUB_TOKEN`), the
      runner's injection seam, the operation method names, and whether the
      representative op shells `git` or `gh` under the hood are an implementer's
      choice and are NOT pinned (consistent with #658's "pin the decision, not the
      shape" stance).
    • AC1's "no context-free git/`gh`" and the "auth applied per command, not via a
      process-global" invariant are ARCHITECTURAL; the PRD enforces the former via a
      CI/lint guard it explicitly does NOT unit-test, and the latter is proven here
      only through its OBSERVABLE CONSEQUENCE: the parent global is never mutated
      (§3, §5) and two co-resident contexts never share a token (§4, §5).
    • Call-site MIGRATION (cron/orchestrator/webhook boundary constructors,
      removing the legacy `process.env.GH_TOKEN` mutation and the module-global
      `activeRepo` gate from `githubAppAuth.ts`, threading the context through
      phases) is OUT of scope for this slice and owned by later issues; no scenario
      here drives an orchestrator, phase, or the legacy auth module. The legacy
      auth path and its regression coverage (registry T23/T24,
      `pause_resume_rate_limit.feature`) are intentionally left untouched until
      those migration slices land.
    • The @regression maintenance sweep is SKIPPED for this issue: `.adw/scenarios.md`
      configures a `## Regression Scenario Directory`, so promotion is a deliberate
      human decision and the agent never auto-promotes.

  Vocabulary note:

    Registered phrases reused (`features/regression/vocabulary.md`):
      G18 `the ADW codebase is checked out`
      T22 `the ADW TypeScript type-check passes`

    Novel phrasing introduced here — the registry has no phrase for per-command
    auth/env injection, the recording-runner command boundary, or parent-env
    isolation. Surfaced to the maintainer in the agent Output:
      Construction & runner setup:
        • `a GitContext for owner {string} repo {string} with auth token {string} and git author {string}`
        • `a GitContext for owner {string} repo {string} with auth token {string}`
        • `the context's git and gh commands are captured by a recording runner`
        • `each context's git and gh commands are captured by a recording runner`
        • `the process working directory is changed away from the context base path`
      Parent-environment fixture:
        • `the parent process environment has auth token {string}`
        • `the parent process environment has no auth token set`
        • `a baseline snapshot of the parent process environment is captured`
      Running the representative op:
        • `the {string} read operation runs through the context`
        • `the {string} read operation runs through the {string} context`
        • `an operation on the {string} context and an operation on the {string} context are interleaved in one process`
      Single-context assertions:
        • `the captured command ran with auth token {string} in its child environment`
        • `the captured command ran with git author {string} in its child environment`
        • `the captured command ran with cwd equal to the context base path`
      Parent-environment assertions:
        • `the parent process environment still has auth token {string}`
        • `the parent process environment still has no auth token set`
        • `the parent process environment matches the baseline snapshot`
      Two-context isolation assertions:
        • `the {string} command ran with auth token {string} in its child environment`
        • `the {string} command ran with cwd equal to the {string} context base path`
        • `the {string} command's child environment does not carry auth token {string}`

    Step-definition note for the maintainer:
      • All steps phase-import `GitContext` from `adws/gitContext/index.ts` and
        construct it from a full injected identity (the `baseOptions()` shape used by
        `feature-658.steps.ts`: `{ owner, repo, selfHost:false, token, gitIdentity,
        frameworkRepoRoot, targetReposDir }`), overriding `owner`/`repo`/`token` and
        `gitIdentity.author*` per the step args. `git author "Name <email>"` parses
        into `authorName`/`authorEmail`; reuse the same pair for committer unless a
        scenario says otherwise. The target-repos root is a fixed sentinel (e.g.
        `/srv/adw/repos`) so each context's base path is `join(root, owner, repo)`.
      • THE COMMAND BOUNDARY IS INJECTED. This slice must give `GitContext` a way to
        run its underlying git/`gh` command through an injectable runner (a fake
        `spawn`) so the test can capture what the op launched. The exact seam —
        constructor option, per-op parameter, or a settable runner — is the
        implementer's choice; pin only the captured `(command, args, cwd, env)`. The
        recording runner records each invocation and returns canned success output
        so NO real subprocess and NO network is touched. (A real subprocess that
        echoes its `cwd`/`env` back on stdout is an equally valid, stronger seam; if
        used, assert against that stdout instead — both are runtime artefacts.)
      • `the {string} read operation runs through the context` maps the friendly op
        name to a context method: `"default-branch"` → the default-branch read,
        `"issue"` → the issue read (supply a canned issue number inside the step;
        the assertion is about the launched cwd/env, not the issue number). The op
        runs via the injected recording runner; store the single recorded invocation
        on the scenario world.
      • `... ran with auth token {string} in its child environment` asserts the
        recorded `env` carries the token VALUE as its auth entry (e.g.
        `recorded.env.GH_TOKEN === token`). `... git author {string} ...` asserts
        `recorded.env.GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL` equal the parsed
        name/email (committer mirrors). `... cwd equal to the context base path`
        asserts `recorded.cwd === ctx.basePath`. Value-based, never a source read.
      • The two-context steps store each context keyed by `"{owner}/{repo}"` (e.g.
        `"acme/alpha"`), each with its OWN recording runner; the keyed assertions
        look up that context's recorded invocation. `... does not carry auth token
        {string}` asserts the other context's token value is absent from this
        command's recorded env (scan the recorded env values).
      • `the process working directory is changed away from the context base path`
        does `process.chdir(os.tmpdir())`; an `After` hook restores the original cwd
        (mirror `feature-658.steps.ts`). The assertion that the command still ran
        with cwd = base path is the anti-regression against ambient-cwd inheritance.
      • `the parent process environment has auth token {string}` sets
        `process.env.GH_TOKEN` to the sentinel and an `After` hook restores the
        original; `... has no auth token set` deletes it (restore after). `a baseline
        snapshot ...` deep-clones `process.env`; `... matches the baseline snapshot`
        deep-equals the live `process.env` against that clone.
      • `... interleaved in one process` runs the op on context A, then the op on
        context B, capturing each context's recorded invocation independently — the
        per-command env means each capture carries its own token with no shared
        global involved; assert both, plus the parent baseline still matches.

  Background:
    Given the ADW codebase is checked out

  # ═══════════════════════ SPAWN-WITH-ENV PATH (AC1, AC3; story 7) ═════════════
  #
  # Surface 1: a representative operation actually spawns its git/`gh` command. Its
  # observable output is the command's launch parameters — the cwd and the child
  # environment the context handed the runner. These prove the per-command auth/env
  # injection path end to end, not the env-overlay builder in isolation.

  # ── §1 The default-branch read op carries token + git identity + base-path cwd ─
  #
  # The headline representative op (story 7, AC1, AC3). A git read routed through
  # the context spawns its command with the context's token AND git
  # author/committer in the child environment, with cwd = the context base path.

  @adw-659 @adw-6phrv4-gitcontext-per-comma
  Scenario: A read operation supplies the context token, git identity, and base-path cwd to its child command
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    When the "default-branch" read operation runs through the context
    Then the captured command ran with auth token "token-acme" in its child environment
    And the captured command ran with git author "Acme Bot <bot@acme.dev>" in its child environment
    And the captured command ran with cwd equal to the context base path

  # ── §1b The gh issue-read op also routes through the spawn-with-env path (AC1) ─
  #
  # AC1 spans BOTH git AND `gh`, and story 2 is specifically about `gh` auth. A `gh`
  # read carries the context's token to its child environment with cwd = base path,
  # proving the gh-side of the contract — the auth that historically bled.

  @adw-659 @adw-6phrv4-gitcontext-per-comma
  Scenario: A gh read operation supplies the context token and base-path cwd to its child command
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    When the "issue" read operation runs through the context
    Then the captured command ran with auth token "token-acme" in its child environment
    And the captured command ran with cwd equal to the context base path

  # ── §2 The command cwd is the base path regardless of the process cwd (AC1) ────
  #
  # "Explicit cwd" means the op passes cwd = base path, never inheriting the ambient
  # process working directory. Perturbing `process.cwd()` before the op leaves the
  # launched command's cwd unchanged — the anti-regression against the wrong-cwd
  # half of the bug class.

  @adw-659 @adw-6phrv4-gitcontext-per-comma
  Scenario: The operation's command runs under the base path even when the process working directory changes
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    And the process working directory is changed away from the context base path
    When the "default-branch" read operation runs through the context
    Then the captured command ran with cwd equal to the context base path

  # ═══════════════════════ PARENT GLOBAL NEVER MUTATED (AC2, AC4; story 7) ═════
  #
  # Surface 2: the live `process.env`. The legacy path mutated the process-global
  # `GH_TOKEN`; the context must not. Observable output: the parent environment
  # before vs after an operation.

  # ── §3a No auth token leaks into the parent environment ───────────────────────
  #
  # When the parent has no auth token, running an operation must not introduce one —
  # the token lives only in the child env, never the parent global.

  @adw-659 @adw-6phrv4-gitcontext-per-comma
  Scenario: Running an operation does not introduce an auth token into the parent environment
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    And the parent process environment has no auth token set
    When the "default-branch" read operation runs through the context
    Then the parent process environment still has no auth token set

  # ── §3b A pre-existing parent auth token is never overwritten (the headline) ───
  #
  # The exact legacy defect: a process-global token, overwritten per call. Here the
  # parent already holds a sentinel auth token; running an operation whose context
  # carries a DIFFERENT token must leave the parent's sentinel untouched — the op
  # injected its token into the child only.

  @adw-659 @adw-6phrv4-gitcontext-per-comma
  Scenario: An operation does not overwrite a pre-existing auth token in the parent environment
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    And the parent process environment has auth token "sentinel-parent-token"
    When the "default-branch" read operation runs through the context
    Then the parent process environment still has auth token "sentinel-parent-token"

  # ── §3c The parent environment is byte-for-byte unchanged across an operation ──
  #
  # The strongest form of AC4: a full-snapshot comparison. Nothing about the parent
  # environment changes when an operation runs.

  @adw-659 @adw-6phrv4-gitcontext-per-comma
  Scenario: The parent process environment is unchanged after an operation runs
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    And a baseline snapshot of the parent process environment is captured
    When the "default-branch" read operation runs through the context
    Then the parent process environment matches the baseline snapshot

  # ═══════════════════════ TWO-CONTEXT ISOLATION (AC5; stories 2, 7) ═══════════
  #
  # The structural-impossibility-of-bleed proof, complementing #658 §6 (which
  # asserted base-path isolation only). Two contexts for two repos, exercised in one
  # process, each launch their commands with their own token + cwd.

  # ── §4 Two contexts never observe each other's token or cwd ───────────────────

  @adw-659 @adw-6phrv4-gitcontext-per-comma
  Scenario: Two contexts for two repos run their commands with their own token and cwd
    Given a GitContext for owner "acme" repo "alpha" with auth token "token-alpha"
    And a GitContext for owner "octo" repo "beta" with auth token "token-beta"
    And each context's git and gh commands are captured by a recording runner
    When the "default-branch" read operation runs through the "acme/alpha" context
    And the "default-branch" read operation runs through the "octo/beta" context
    Then the "acme/alpha" command ran with auth token "token-alpha" in its child environment
    And the "acme/alpha" command ran with cwd equal to the "acme/alpha" context base path
    And the "octo/beta" command ran with auth token "token-beta" in its child environment
    And the "octo/beta" command ran with cwd equal to the "octo/beta" context base path
    And the "acme/alpha" command's child environment does not carry auth token "token-beta"
    And the "octo/beta" command's child environment does not carry auth token "token-alpha"

  # ── §5 Interleaved operations across two repo contexts keep their own auth ─────
  #
  # The concurrency case the legacy process-global FAILED (the webhook / pause-queue
  # bleed): operations on the two contexts interleave in one long-lived process.
  # With per-command auth there is no shared global to clobber, so each command
  # still carries its own token and the parent global stays untouched.

  @adw-659 @adw-6phrv4-gitcontext-per-comma
  Scenario: Interleaved operations across two repo contexts each carry their own auth with no parent mutation
    Given a GitContext for owner "acme" repo "alpha" with auth token "token-alpha"
    And a GitContext for owner "octo" repo "beta" with auth token "token-beta"
    And each context's git and gh commands are captured by a recording runner
    And a baseline snapshot of the parent process environment is captured
    When an operation on the "acme/alpha" context and an operation on the "octo/beta" context are interleaved in one process
    Then the "acme/alpha" command ran with auth token "token-alpha" in its child environment
    And the "octo/beta" command ran with auth token "token-beta" in its child environment
    And the "acme/alpha" command's child environment does not carry auth token "token-beta"
    And the "octo/beta" command's child environment does not carry auth token "token-alpha"
    And the parent process environment matches the baseline snapshot

  # ═══════════════════════ TYPE-CHECK BACKSTOP (registry T22) ══════════════════
  #
  # ── §6 The new operation surface keeps the ADW codebase type-clean ────────────
  #
  # A backstop consistent with the sibling per-issue features (feature-638 §8,
  # feature-639 §6, feature-658 §7): the representative operation methods and the
  # injected runner seam compile within the ADW codebase's type-check.

  @adw-659 @adw-6phrv4-gitcontext-per-comma
  Scenario: The ADW TypeScript type-check passes with the per-command auth/env operation surface in place
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
