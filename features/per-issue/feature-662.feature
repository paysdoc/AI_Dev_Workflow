@adw-662 @adw-h7t8lq-migrate-branch-commi
Feature: GitContext branch + commit/push migration — worktree-scoped git verbs run under the context's resolved cwd with per-command identity, never the ambient working directory

  Issue #662 (parent PRD `specs/prd/git-context-repo-authority.md`, see
  **Operation surface** and **Testing Decisions §1**) is the branch-and-commit/push
  slice of the repo-context authority. The foundational slice (#658) shipped the
  `GitContext` deep module — mandatory identity, the one-constructor base-path
  decision, `worktreePathFor(branch)`, and the `commandEnv()` overlay builder. The
  auth slice (#659) routed ONE representative READ op (default-branch) through the
  context's single spawn chokepoint, proving per-command token/identity injection,
  parent-env immutability, and two-context isolation — but only for a base-path
  read.

  This slice extends that proven spawn path to the WRITE/SYNC operations the
  worktree workflow actually runs against a per-issue worktree: branch
  create/checkout/delete (`vcs/branchOperations.ts`), commit and push
  (`vcs/commitOperations.ts`), and fetch / reset-to-remote
  (`vcs/worktreeReset.ts`). Each becomes a context method that spawns its git/`gh`
  command with an EXPLICIT cwd — the worktree path the context RESOLVES for the
  branch — and the per-command git author/committer + token in the child
  environment. The parent process global is never mutated, and two contexts for two
  repos never observe each other's cwd or token.

  Why this slice exists — the two defects it forecloses:

    1. WRONG-CWD WRITES. Today every branch/commit/push helper takes an OPTIONAL
       `cwd` that callers compute ad hoc and can omit; an omitted `cwd` inherits the
       ambient `process.cwd()`, so a commit/push meant for a target worktree runs
       in whatever directory the process happens to sit in — the exact wrong-base
       class the PRD mines ~13 times. Routing through the context makes the cwd the
       context's RESOLVED worktree path, never ambient.

    2. TOKEN BLEED ON WRITES. push / remote-delete / fetch reach the network and
       need auth; the legacy path applied the token by mutating a process-global,
       which interleaved multi-repo work overwrote mid-flight. Per-command env
       injection makes that bleed unrepresentable for write ops too.

    The slice ALSO preserves the hard-won behaviour the existing vcs unit suites
    pin: push uses safe `--force-with-lease` semantics and surfaces an actionable,
    NON-resumable error when the remote moved underneath ADW (the force-with-lease
    fix); a first push tolerates a missing remote ref; fetch-and-reset issues the
    fetch before the hard reset and throws (skipping the reset) when the fetch
    fails; and deletion refuses the protected branches.

  Contract pinned here (the observable behaviour, not the field shape):

    • worktree-cwd authority   → a worktree-scoped op (commit, push, fetch/reset)
                                  spawns its command(s) with cwd = the context's
                                  resolved worktree path for the branch, REGARDLESS
                                  of the process working directory (AC1, AC2;
                                  story 17).
    • per-command identity      → a commit's command carries the context's git
                                  author/committer in its child env; a
                                  network-touching op (push, fetch/reset) carries
                                  the context's token (AC2; story 17).
    • parent env untouched      → running write ops leaves the parent process
                                  environment byte-for-byte unchanged (AC2/AC4
                                  extended from #659's read op to write ops).
    • behaviour preserved       → push safe-force + actionable lease refusal +
                                  first-push tolerance; fetch-then-reset order +
                                  throw-on-fetch-failure; commit no-op on a clean
                                  worktree; protected-branch deletion refusal — all
                                  intact when routed through context methods (AC5).
    • two-context isolation      → two repo contexts each push their own branch
                                  under their OWN worktree path with their OWN
                                  token; neither command carries the other's token
                                  (AC; stories 2, 7, 17).

  Observability / rot-prevention note:

    Every assertion below targets a runtime OUTPUT of the system under test, never a
    source file. No step reads `branchOperations.ts`, `commitOperations.ts`,
    `worktreeReset.ts`, or the GitContext package as text, substring-matches their
    contents, or parses them as JSON/AST.

      • The cwd/env/command-shape scenarios run each op through a RECORDING RUNNER
        injected as the context's command boundary (the `ExecFn` Deps seam #659
        established — a fake spawn, the same recorder category as the registered
        `git-mock`/`mock server` collaborators in `vocabulary.md`, T4/T11). The
        steps assert the RECORDED `cwd`, the RECORDED child `env`, the RECORDED
        command sequence (e.g. fetch-before-reset), and the RECORDED ABSENCE of a
        command (e.g. no deletion for a protected branch). A recorded invocation is
        a runtime artefact — the command the context actually launched — not a
        source property (vocabulary Surface 3 / pattern 3).
      • The behaviour scenarios program the recording runner to THROW on a chosen
        call (a stale-info push rejection, a missing-remote-ref fetch, a fetch
        failure) and assert the op's observable OUTCOME — the thrown error's
        actionable wording, or that the op completed — exactly as the existing
        `commitOperations.test.ts` / `fetchAndResetToRemote.test.ts` suites do, now
        against the context method.
      • The "parent env untouched" steps read the LIVE `process.env` before and
        after an operation (vocabulary's permitted live-runtime-state artefact),
        reusing #659's snapshot harness.
      • §type-check asserts the type-checker's verdict (registry T22).

    The owners/repos, tokens, authors, branches, and op names in the steps are INPUT
    test data; the recorded `(command, cwd, env)`, the recorded command sequence,
    the thrown error, the live `process.env`, and the type-check exit code are the
    system's OUTPUTS — exactly the artefact category the Rot-Detection Rubric
    permits. The recording runner means no real git/`gh` is spawned and no network
    is touched, so the scenarios are hermetic.

  Scope notes:

    • DEFAULT-BRANCH is already pinned by #659 (the representative read op: cwd =
      base path, token injected). This slice does NOT restate it; it adds the
      remaining branch verbs (delete, and the worktree-cwd contract that
      checkout/create inherit) plus commit/push and fetch/reset.
    • BRANCH CREATE is performed via `git worktree add` and is owned by the worktree
      operations slice (story 16); CHECKOUT against a per-issue worktree is largely
      vestigial. Neither gets a bespoke scenario here — both, where still invoked,
      inherit the SAME worktree-cwd + per-command-identity contract the
      representative write ops (commit, push, fetch/reset) pin below. This mirrors
      #659's "a representative op proves the spawn path end to end" stance.
    • What is pinned is the OBSERVABLE injection — the cwd a command launches with,
      the child env, the command sequence, the preserved behaviour, the untouched
      parent global, and per-context isolation. The exact method NAMES, whether a
      method takes a branch (resolving `worktreePathFor` internally) or an explicit
      worktree path, the auth env-var name, and whether an op shells `git` or `gh`
      are an implementer's choice and are NOT pinned (consistent with #658/#659's
      "pin the decision, not the shape").
    • AC4's "no direct `execSync` of these verbs outside the package" is
      ARCHITECTURAL; the PRD enforces it via a CI/lint guard it explicitly does NOT
      unit-test. It is proven here only through its OBSERVABLE CONSEQUENCE: the ops
      run with the context-resolved cwd + per-command env (so they DID route through
      the context), the parent global is never mutated, and two co-resident contexts
      never share a token/cwd.
    • Call-site MIGRATION (threading the context through phases / orchestrators /
      cron-takeover / webhook, and deleting the legacy optional-`cwd` helpers) is
      OUT of scope for this slice and owned by later issues; no scenario here drives
      an orchestrator or phase. The legacy `vcs/__tests__` unit suites stay green
      against the new context methods (the behaviour-preservation AC) — that is the
      cutover safety net, asserted behaviourally here.
    • The @regression maintenance sweep is SKIPPED for this issue: `.adw/scenarios.md`
      configures a `## Regression Scenario Directory`, so promotion is a deliberate
      human decision and the agent never auto-promotes.

  Vocabulary note:

    Registered phrases reused (`features/regression/vocabulary.md`):
      G18 `the ADW codebase is checked out`
      T22 `the ADW TypeScript type-check passes`

    Established phrases reused from #659's harness (`feature-659.steps.ts`; not yet
    promoted into the registry — the step-def author should SHARE that harness):
      • `a GitContext for owner {string} repo {string} with auth token {string} and git author {string}`
      • `a GitContext for owner {string} repo {string} with auth token {string}`
      • `the context's git and gh commands are captured by a recording runner`
      • `each context's git and gh commands are captured by a recording runner`
      • `the process working directory is changed away from the context base path`
      • `a baseline snapshot of the parent process environment is captured`
      • `the parent process environment matches the baseline snapshot`
      • `the {string} command ran with auth token {string} in its child environment`
      • `the {string} command's child environment does not carry auth token {string}`

    Novel phrasing introduced here — the registry has no phrase for worktree-scoped
    write/sync ops, the worktree-path cwd assertion, the recorded-command-sequence
    assertions, or the preserved push/fetch behaviours. Surfaced to the maintainer:
      Recording-runner state (program the fake spawn per call):
        • `the worktree for branch {string} has uncommitted changes`
        • `the worktree for branch {string} is clean`
        • `the remote has advanced beyond ADW for branch {string}`
        • `the branch {string} has no remote-tracking ref yet`
        • `fetching origin for branch {string} fails`
      Running an op:
        • `the {string} operation for branch {string} runs through the context`
        • `the {string} operation for branch {string} runs through the {string} context`
      Worktree-cwd / identity / token assertions (single context):
        • `the captured commands ran with cwd equal to the worktree path for branch {string}`
        • `every captured command carried git author {string} in its child environment`
        • `every captured command carried auth token {string} in its child environment`
      Two-context worktree-cwd assertion:
        • `the {string} command ran with cwd equal to the worktree path for branch {string}`
      Preserved-behaviour outcome assertions:
        • `the operation fails with an actionable, non-resumable push error`
        • `the operation completes without error`
        • `no commit command is recorded`
        • `the fetch is recorded before the hard reset`
        • `the operation fails and no hard reset command is recorded`
        • `no branch-deletion command is recorded`
        • `a branch-deletion command for branch {string} is recorded`

    Step-definition note for the maintainer:
      • REUSE `feature-659.steps.ts`'s harness wholesale: the `makeSpyExec()`
        recording runner, the `makeFullOptions()` identity builder, the
        pending-args/contexts-by-key staging, and the `After` hook that restores
        cwd + `GH_TOKEN`. This slice only EXTENDS `runOp()` with the new ops and adds
        the worktree-cwd / sequence / outcome assertions. Construct via the Deps
        idiom `new GitContext(options, { exec })` so the spy captures every spawn.
      • `the {string} operation for branch {string} runs through the context` maps
        the friendly op name to a context method:
          "commit"          → the commit method (stages + commits)
          "push"            → the push method (fetch + force-with-lease push)
          "fetch-and-reset" → the fetch/reset-to-remote method
          "delete-branch"   → the branch-delete method
        The op runs via the injected recording runner; store ALL recorded
        invocations for the op on the scenario world. How the method receives the
        worktree target (a branch arg it resolves via `worktreePathFor`, or an
        explicit path the caller computes from it) is the implementer's choice —
        the step computes EXPECTED = `ctx.worktreePathFor(branch)` and asserts the
        recorded cwd against that, so either shape passes.
      • `the captured commands ran with cwd equal to the worktree path for branch
        {string}` asserts EVERY recorded invocation's `cwd === ctx.worktreePathFor(branch)`
        (commit/push/fetch-reset each spawn ≥1 command; all must run under the
        worktree). `every captured command carried git author {string} ...` /
        `... auth token {string} ...` assert that EVERY recorded invocation's child
        env carries the parsed `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL` (committer
        mirrors) / the token value — the context injects `commandEnv` uniformly, so
        the strong "every command" form holds. Value-based, never a source read.
      • Runner-state Givens program the spy per command string:
          "... has uncommitted changes" → the spy returns non-empty `git status
            --porcelain` output so the commit proceeds to `git commit`.
          "... is clean" → the spy returns empty status output so the commit
            short-circuits (no `git commit` / `git add` recorded).
          "the remote has advanced beyond ADW for branch X" → the spy THROWS on the
            `git push` call with an error whose stderr contains "stale info" (the
            force-with-lease rejection marker).
          "the branch X has no remote-tracking ref yet" → the spy THROWS on the
            pre-push `git fetch` (the push must still proceed and succeed).
          "fetching origin for branch X fails" → the spy THROWS on the
            fetch-and-reset's `git fetch` (the reset must NOT then run).
      • Outcome assertions: `the operation fails with an actionable, non-resumable
        push error` catches the thrown error and asserts its message matches the
        force-with-lease wording (e.g. /force-with-lease/ AND /moved underneath|manual/)
        — the anti-auto-resume guard. `the operation completes without error`
        asserts no throw. `no commit command is recorded` / `the fetch is recorded
        before the hard reset` / `the operation fails and no hard reset command is
        recorded` / `no branch-deletion command is recorded` / `a branch-deletion
        command for branch {string} is recorded` inspect the RECORDED command
        sequence (by verb substring) — a runtime artefact, not a source read.
      • The two-context steps reuse #659's keyed staging (`contextsByKey` by
        "owner/repo", each with its OWN recording runner). `the {string} command ran
        with cwd equal to the worktree path for branch {string}` looks up that
        context, computes its `worktreePathFor(branch)`, and asserts the keyed
        context's last recorded invocation ran there; the token phrases are #659's
        verbatim.

  Background:
    Given the ADW codebase is checked out

  # ═══════════════ WORKTREE-CWD AUTHORITY (AC1, AC2; story 17) ═════════════════
  #
  # The core new observable: a worktree-scoped op spawns its command(s) with cwd =
  # the context's RESOLVED worktree path for the branch — never the ambient
  # process working directory, never the bare base path. This is the wrong-cwd
  # write half of the bug class the whole PRD exists to foreclose.

  # ── §1 Every worktree-scoped op runs under the resolved worktree path ─────────
  #
  # commit, push, and fetch/reset each launch their git command(s) under the
  # context-resolved worktree path for the branch.

  @adw-662 @adw-h7t8lq-migrate-branch-commi
  Scenario Outline: A worktree-scoped operation runs its commands under the context's resolved worktree path
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    When the "<op>" operation for branch "feature-issue-662-x" runs through the context
    Then the captured commands ran with cwd equal to the worktree path for branch "feature-issue-662-x"

    Examples:
      | op              |
      | commit          |
      | push            |
      | fetch-and-reset |

  # ── §2 The worktree cwd is the resolved path even when process.cwd() changes ───
  #
  # "Explicit cwd" means the op passes the resolved worktree path, never inheriting
  # the ambient working directory. Perturbing `process.cwd()` before the op leaves
  # the launched command's cwd unchanged — the anti-regression against the wrong-cwd
  # write defect.

  @adw-662 @adw-h7t8lq-migrate-branch-commi
  Scenario: A commit runs under the resolved worktree path even when the process working directory changes
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    And the worktree for branch "feature-issue-662-x" has uncommitted changes
    And the process working directory is changed away from the context base path
    When the "commit" operation for branch "feature-issue-662-x" runs through the context
    Then the captured commands ran with cwd equal to the worktree path for branch "feature-issue-662-x"

  # ═══════════════ PER-COMMAND IDENTITY & TOKEN (AC2; story 17) ════════════════
  #
  # Extends #659's per-command env injection from the read op to the write ops. A
  # commit carries the context's git author/committer; a network op carries the
  # context's token — in the spawned child env, never via a process-global.

  # ── §3 A commit carries the context's git author/committer (the headline) ─────
  #
  # The "commit ... with correct git author/committer" acceptance criterion. With a
  # dirty worktree the commit proceeds to `git commit`, whose child env must carry
  # the context's author and committer identity.

  @adw-662 @adw-h7t8lq-migrate-branch-commi
  Scenario: A commit through the context carries the context's git author and committer in its child environment
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    And the worktree for branch "feature-issue-662-x" has uncommitted changes
    When the "commit" operation for branch "feature-issue-662-x" runs through the context
    Then every captured command carried git author "Acme Bot <bot@acme.dev>" in its child environment

  # ── §4 Network-touching ops carry the context's auth token ────────────────────
  #
  # push and fetch/reset reach origin and need auth. Every command they spawn
  # carries the context's token in its child env — the per-command auth that makes
  # the legacy process-global bleed unrepresentable for write ops.

  @adw-662 @adw-h7t8lq-migrate-branch-commi
  Scenario Outline: A network-touching operation carries the context's auth token in its child environment
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    When the "<op>" operation for branch "feature-issue-662-x" runs through the context
    Then every captured command carried auth token "token-acme" in its child environment

    Examples:
      | op              |
      | push            |
      | fetch-and-reset |

  # ═══════════════ BEHAVIOUR PRESERVATION (AC5) ═══════════════════════════════
  #
  # The legacy vcs unit suites pin hard-won behaviour. Routed through the context
  # methods, that behaviour must be byte-for-byte intact — the cutover safety net.

  # ── §5 Push keeps safe-force semantics: an out-from-under-ADW remote is refused ─
  #
  # The force-with-lease fix. When the remote advanced to a commit ADW never had,
  # the push must FAIL with a distinct, actionable, non-resumable error (guiding a
  # manual remedy) rather than clobbering the remote or resuming `pr_creating` into
  # the same push indefinitely.

  @adw-662 @adw-h7t8lq-migrate-branch-commi
  Scenario: A push whose remote moved underneath ADW fails with an actionable, non-resumable error
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    And the remote has advanced beyond ADW for branch "feature-issue-662-x"
    When the "push" operation for branch "feature-issue-662-x" runs through the context
    Then the operation fails with an actionable, non-resumable push error

  # ── §6 A first push tolerates a missing remote-tracking ref ───────────────────
  #
  # The pre-push fetch refreshes the lease ref; a first push has no remote ref to
  # fetch, so a fetch failure is swallowed and the push proceeds and succeeds.

  @adw-662 @adw-h7t8lq-migrate-branch-commi
  Scenario: A first push tolerates a missing remote-tracking ref and still completes
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    And the branch "feature-issue-662-x" has no remote-tracking ref yet
    When the "push" operation for branch "feature-issue-662-x" runs through the context
    Then the operation completes without error

  # ── §7 Fetch/reset issues the fetch before the hard reset ─────────────────────
  #
  # The order is load-bearing: refs must be fetched before the working tree is reset
  # hard to the remote tip.

  @adw-662 @adw-h7t8lq-migrate-branch-commi
  Scenario: A fetch-and-reset issues the fetch before the hard reset
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    When the "fetch-and-reset" operation for branch "feature-issue-662-x" runs through the context
    Then the fetch is recorded before the hard reset

  # ── §8 Fetch/reset throws on a fetch failure and never resets ─────────────────
  #
  # A failed fetch is critical — resetting hard against a stale ref would discard
  # work to the wrong tip — so the op throws and the hard reset is never issued.

  @adw-662 @adw-h7t8lq-migrate-branch-commi
  Scenario: A fetch-and-reset whose fetch fails throws and issues no hard reset
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    And fetching origin for branch "feature-issue-662-x" fails
    When the "fetch-and-reset" operation for branch "feature-issue-662-x" runs through the context
    Then the operation fails and no hard reset command is recorded

  # ── §9 A commit on a clean worktree issues no commit command ──────────────────
  #
  # The no-op-on-clean guard: with nothing staged or unstaged, the commit method
  # short-circuits and never spawns `git commit`.

  @adw-662 @adw-h7t8lq-migrate-branch-commi
  Scenario: A commit on a clean worktree issues no commit command
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    And the worktree for branch "feature-issue-662-x" is clean
    When the "commit" operation for branch "feature-issue-662-x" runs through the context
    Then no commit command is recorded

  # ── §10 Branch deletion refuses the protected branches ────────────────────────
  #
  # main / master / develop must never be deleted; the delete method refuses them
  # and spawns no deletion command at all.

  @adw-662 @adw-h7t8lq-migrate-branch-commi
  Scenario Outline: Deleting a protected branch is refused and issues no deletion command
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    When the "delete-branch" operation for branch "<protected>" runs through the context
    Then no branch-deletion command is recorded

    Examples:
      | protected |
      | main      |
      | master    |
      | develop   |

  # ── §11 Deleting a non-protected branch routes through the context with auth ───
  #
  # A non-protected branch IS deleted, and (remote deletion reaching origin) the
  # deletion command carries the context's token — proving the delete routes
  # through the context rather than a context-free `execSync`.

  @adw-662 @adw-h7t8lq-migrate-branch-commi
  Scenario: Deleting a non-protected branch issues a deletion command carrying the context token
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    When the "delete-branch" operation for branch "feature-issue-662-x" runs through the context
    Then a branch-deletion command for branch "feature-issue-662-x" is recorded
    And every captured command carried auth token "token-acme" in its child environment

  # ═══════════════ PARENT GLOBAL NEVER MUTATED (AC2, AC4) ══════════════════════
  #
  # Extends #659 §3/§5 from the read op to the write ops: running write operations
  # leaves the parent process environment byte-for-byte unchanged. The token and
  # identity live only in the spawned child env, never in the parent global.

  # ── §12 Running write ops does not mutate the parent environment ──────────────

  @adw-662 @adw-h7t8lq-migrate-branch-commi
  Scenario: Running a commit and a push leaves the parent process environment unchanged
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    And the worktree for branch "feature-issue-662-x" has uncommitted changes
    And a baseline snapshot of the parent process environment is captured
    When the "commit" operation for branch "feature-issue-662-x" runs through the context
    And the "push" operation for branch "feature-issue-662-x" runs through the context
    Then the parent process environment matches the baseline snapshot

  # ═══════════════ TWO-CONTEXT ISOLATION (stories 2, 7, 17) ════════════════════
  #
  # The structural-impossibility-of-bleed proof for WRITE ops. #659 proved it for
  # the base-path read op; here two contexts for two repos each push their own
  # branch under their OWN worktree path with their OWN token, exercised in one
  # process — the wrong-worktree + token-bleed class the whole PRD forecloses.

  # ── §13 Two contexts push their own branch under their own worktree and token ──

  @adw-662 @adw-h7t8lq-migrate-branch-commi
  Scenario: Two repo contexts push their own branches under their own worktree paths and tokens
    Given a GitContext for owner "acme" repo "alpha" with auth token "token-alpha"
    And a GitContext for owner "octo" repo "beta" with auth token "token-beta"
    And each context's git and gh commands are captured by a recording runner
    When the "push" operation for branch "feature-a" runs through the "acme/alpha" context
    And the "push" operation for branch "feature-b" runs through the "octo/beta" context
    Then the "acme/alpha" command ran with auth token "token-alpha" in its child environment
    And the "octo/beta" command ran with auth token "token-beta" in its child environment
    And the "acme/alpha" command's child environment does not carry auth token "token-beta"
    And the "octo/beta" command's child environment does not carry auth token "token-alpha"
    And the "acme/alpha" command ran with cwd equal to the worktree path for branch "feature-a"
    And the "octo/beta" command ran with cwd equal to the worktree path for branch "feature-b"

  # ═══════════════ TYPE-CHECK BACKSTOP (registry T22) ══════════════════════════
  #
  # ── §14 The new operation surface keeps the ADW codebase type-clean ───────────
  #
  # A backstop consistent with the sibling per-issue features (feature-658 §7,
  # feature-659 §6): the migrated branch/commit/push/fetch-reset operation methods
  # compile within the ADW codebase's type-check.

  @adw-662 @adw-h7t8lq-migrate-branch-commi
  Scenario: The ADW TypeScript type-check passes with the branch/commit/push operation surface in place
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
