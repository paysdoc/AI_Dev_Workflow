@adw-661 @adw-u01em3-migrate-worktree-ope
Feature: GitContext worktree-operation migration — create/remove/list and worktree-path lookup resolve under the context's base path, and the cwd-defaulting helper is gone

  Issue #661 (parent PRD `specs/prd/git-context-repo-authority.md`, see
  **Operation surface** and **Removal of the unsafe primitives**) is the
  worktree-operations slice of the repo-context authority. The foundational slice
  (#658) shipped the `GitContext` deep module — mandatory identity, the
  one-constructor base-path decision, and `worktreePathFor(branch)` as a pure
  path computation under the base path. The branch/commit/push slice (#662) routed
  the worktree-SCOPED git verbs (commit, push, fetch/reset, and the takeover
  `resetWorktree`) through the context's single spawn chokepoint with an explicit
  cwd = the worktree path and per-command identity/token.

  This slice migrates the remaining worktree-MANAGEMENT operations — create,
  remove, list, and worktree-path lookup — onto `GitContext` methods, and then
  DELETES the optional, defaulting base-path helper (`vcs/worktreeOperations.ts`
  `getWorktreesDir(baseRepoPath?)` / `getWorktreePath(branch, baseRepoPath?)` and
  the `createWorktree*` / `getWorktreeForBranch` optional-`baseRepoPath` chain) plus
  any cwd-defaulting worktree-path computation, so the previously-reachable wrong
  path no longer EXISTS. Unlike the worktree-scoped verbs in #662, these management
  verbs (`git worktree add` / `remove` / `list`) run from the PARENT repo with the
  worktree path supplied as an ARGUMENT — so the context decides BOTH the working
  directory they launch from (the base path) AND the worktree path they target
  (`worktreePathFor(branch)`, under the base path).

  Why this slice exists — the defect it forecloses:

    Today the worktree directory is computed by `getWorktreesDir(baseRepoPath?)` /
    `getWorktreePath(branch, baseRepoPath?)`, whose base-path parameter is OPTIONAL
    and silently defaults to the framework repo's working directory (`process.cwd()`
    via `getMainRepoPath()`). Any create/remove/list/lookup caller that forgets the
    target base resolves — and CREATES or REMOVES — worktrees under the WRONG repo:
    the framework cwd instead of the target workspace. Because the framework dogfoods
    itself, the default is correct in the most-exercised path and only detonates
    against target repos, so the bug ships and then fails in production. This PRD has
    mined ~13 fix episodes of that one shape over four months.

    Routing every worktree operation through the context makes the wrong path
    unrepresentable: the worktree path is `worktreePathFor(branch)` under the
    context's identity-resolved base path, the management commands launch with cwd =
    the base path, and there is no optional override and no cwd fallback. Deleting
    the defaulting helper removes the only code path that could have produced the
    wrong directory.

  Contract pinned here (the observable behaviour, not the field shape):

    • target-path authority   → a worktree create/remove targets the worktree path
                                 the context RESOLVES for the branch
                                 (`worktreePathFor`), under the context's base path —
                                 never a cwd-defaulted directory (AC; stories 1, 16).
    • target-workspace, not    → for a TARGET context, that resolved worktree path is
      framework cwd              under the target-repos workspace, NOT the framework
                                 repo root, REGARDLESS of the process working
                                 directory — the headline anti-regression for the
                                 deleted defaulting helper (AC; story 1).
    • base-path cwd authority  → every management command (`git worktree add` /
                                 `remove` / `list`) launches with cwd = the context's
                                 base path, never the ambient process working
                                 directory (AC; story 16).
    • per-command token         → a network-touching create (which fetches refs from
                                 origin) carries the context's token in its spawned
                                 child env, never via a process-global (story 7,
                                 inherited from #659/#662).
    • behaviour preserved       → create resolves an existing branch vs. creating a
                                 new branch from a base; create refuses a missing
                                 branch with no base and an empty branch name; remove
                                 forcibly removes the worktree then deletes its local
                                 branch; list returns only the `.worktrees/` entries
                                 and excludes the main repo — all intact when routed
                                 through the context methods (AC5).
    • two-context isolation      → two repo contexts each create their own worktree
                                 under their OWN target workspace; neither targets the
                                 other's workspace or carries the other's token (AC;
                                 stories 2, 7).

  Observability / rot-prevention note:

    Every assertion below targets a runtime OUTPUT of the system under test, never a
    source file. No step reads `worktreeOperations.ts`, `worktreeCreation.ts`,
    `worktreeQuery.ts`, `worktreeCleanup.ts`, or the GitContext package as text,
    substring-matches their contents, or parses them as JSON/AST. In particular, the
    central deliverable — "the defaulting helper is deleted so the wrong path no
    longer exists" — is NOT asserted as a source property (no step checks that a
    function is absent). It is proven through its OBSERVABLE CONSEQUENCE: a worktree
    operation run for a target context, while the process working directory is NOT
    the target workspace, still targets the worktree path under the target workspace
    and never the framework root — the wrong path is unreachable because the only
    route to a worktree path is the context's identity-resolved computation.

      • The create/remove/list scenarios run each op through a RECORDING RUNNER
        injected as the context's command boundary (the `ExecFn` Deps seam #659
        established — a fake spawn, the same recorder category as the registered
        `git-mock` / `mock server` collaborators in `vocabulary.md`, Surface 3 /
        pattern 3). The steps assert the RECORDED command string (e.g. a
        `git worktree add` whose worktree-path argument is `worktreePathFor(branch)`),
        the RECORDED `cwd`, the RECORDED child `env`, and the RECORDED ABSENCE of a
        command (e.g. no `git worktree add` when a missing-branch create refuses). A
        recorded invocation is a runtime artefact — the command the context actually
        launched — not a source property.
      • The behaviour scenarios program the recording runner to make a branch
        un-resolvable (a missing branch), or to report a worktree listing, and assert
        the op's observable OUTCOME — the thrown error on an unsatisfiable create, or
        the RETURN VALUE of `list` (only the `.worktrees/` entries) — exactly as the
        existing `vcs/__tests__` worktree suites do, now against the context methods.
      • The resolved-path assertions compare the recorded worktree-path argument
        against `ctx.worktreePathFor(branch)` and against the injected framework root
        and target-repos root sentinels — pure value comparisons over the context's
        own outputs, never a filesystem read of this repo.

    The owners/repos, tokens, branches, and op names in the steps are INPUT test
    data; the recorded `(command, cwd, env)`, the thrown error, and the returned
    worktree list are the system's OUTPUTS — exactly the artefact category the
    Rot-Detection Rubric permits. The recording runner means no real git is spawned
    and no real worktree is created or removed on disk, so the scenarios are hermetic.

  Scope notes:

    • RESET is already pinned by #662 (the takeover `resetWorktree` was migrated onto
      `GitContext.resetWorktree(worktreePath, branch)` and `worktreeReset.test.ts` was
      re-homed onto it). This slice does NOT restate reset; it adds the remaining
      management verbs — create, remove, list — and the worktree-path lookup, plus the
      DELETION of the defaulting helper.
    • The pure `worktreePathFor(branch)` computation (base-path-rootedness and
      cwd-independence) is already pinned by #658 §4/§5. This slice does NOT restate
      the computation; it pins that the OPERATIONS consume that computation — the
      create/remove commands target `worktreePathFor(branch)`, and a target op never
      lands under the framework root.
    • Behaviour pinned here is the OBSERVABLE operation surface — the command a verb
      launches, the cwd it launches with, the worktree path it targets, the token in
      its child env, the preserved create/remove/list semantics, and per-context
      isolation. The exact method NAMES, whether create takes an explicit base branch
      or resolves one, the fs-dependency shape, and whether a verb shells `git` once
      or several times are an implementer's choice and are NOT pinned (consistent with
      #658/#659/#662's "pin the decision, not the shape").
    • Call-site MIGRATION (threading the context through `workflowInit`,
      `prReviewPhase`, the cancel/takeover/devserver-janitor triggers, the promotion
      mover, `adwMerge` / `adwUpgrade` / `adwPromotionSweep`, and deleting the legacy
      defaulting helpers + the optional-`baseRepoPath` chain) IS in scope per the
      acceptance criteria ("all worktree call sites route through the context; no
      remaining optional-base-path callers"). No scenario here DRIVES an orchestrator
      or phase, though: the migration is proven through its OBSERVABLE CONSEQUENCE
      (the ops run with the context-resolved cwd + target path + per-command env, and
      two contexts never share a workspace/token) plus the type-check backstop.
    • AC4's "no context-free worktree free functions outside the package" is
      ARCHITECTURAL; the PRD enforces it via a CI/lint guard it explicitly does NOT
      unit-test. It is proven here only through its OBSERVABLE CONSEQUENCE: the ops run
      with the context-resolved cwd + target path (so they DID route through the
      context) and two co-resident contexts never share a workspace.
    • The @regression maintenance sweep is SKIPPED for this issue: `.adw/scenarios.md`
      configures a `## Regression Scenario Directory`, so promotion is a deliberate
      human decision and the agent never auto-promotes.

  Vocabulary note:

    Registered phrases reused (`features/regression/vocabulary.md`):
      G18 `the ADW codebase is checked out`
      T22 `the ADW TypeScript type-check passes`

    Established phrases reused from the #659/#662 shared harness
    (`gitContextSharedWorld.ts` + `feature-659.steps.ts`; not yet promoted into the
    registry — the step-def author should SHARE that harness, importing `W`,
    `makeSpyExec`, `makeFullOptions`, `parseAuthor`, and the `FRAMEWORK_ROOT` /
    `TARGET_REPOS_ROOT` sentinels):
      • `a GitContext for owner {string} repo {string} with auth token {string} and git author {string}`
      • `a GitContext for owner {string} repo {string} with auth token {string}`
      • `the context's git and gh commands are captured by a recording runner`
      • `each context's git and gh commands are captured by a recording runner`
      • `the process working directory is changed away from the context base path`
      • `every captured command carried auth token {string} in its child environment`
      • `the {string} command ran with auth token {string} in its child environment`
      • `the {string} command's child environment does not carry auth token {string}`

    Novel phrasing introduced here — the registry has no phrase for the worktree
    MANAGEMENT operations, the worktree-path-argument assertion, the target-workspace
    anti-regression, the base-path-cwd assertion, or the preserved create/remove/list
    behaviours. Surfaced to the maintainer:
      Op dispatch (single context):
        • `the {string} worktree operation for branch {string} runs through the context`
        • `a worktree for branch {string} is created from base {string} through the context`
        • `the worktrees are listed through the context`
      Op dispatch (two contexts):
        • `the {string} worktree operation for branch {string} runs through the {string} context`
      Runner-state Givens:
        • `the branch {string} does not exist locally or on origin`
        • `the runner reports a worktree listing with the main repository and two issue worktrees`
      Target-path / base-path-cwd assertions (single context):
        • `a recorded worktree command targets the worktree path for branch {string}`
        • `the recorded worktree path for branch {string} is under the target workspace, not the framework repo root`
        • `the captured commands ran with cwd equal to the context base path`
      Preserved-behaviour outcome assertions:
        • `a recorded worktree-add command for branch {string} targets its resolved worktree path`
        • `a recorded worktree-add command creates branch {string} from base {string}`
        • `the worktree operation fails loudly`
        • `a recorded worktree-remove command for branch {string} is issued`
        • `a recorded local-branch deletion for branch {string} is issued`
        • `the operation reports the worktree was removed`
        • `the listed worktrees are only the entries under the context's .worktrees directory`
        • `the main repository path is not among the listed worktrees`
      Two-context isolation assertions:
        • `the {string} context created its worktree for branch {string} under its own base path`
        • `the {string} context's worktree commands do not target the {string} context base path`

    Step-definition note for the maintainer:
      • Create `feature-661.steps.ts` that IMPORTS the shared world wholesale from
        `gitContextSharedWorld.ts` and REUSES `feature-659.steps.ts`'s construction,
        recording-runner, two-context-runner, and cwd-perturbation steps. This slice
        only ADDS the worktree-management op dispatch + the target-path / base-path /
        behaviour assertions. Do NOT redefine the shared setup steps.
      • Construct via the Deps idiom `new GitContext(options, { exec })` (and, where
        the migrated create/remove methods inject an fs dependency, a matching fs spy
        whose `existsSync` returns false so no real disk I/O occurs). The spy from
        `makeSpyExec` records every `(command, cwd, env)`.
      • Op dispatch maps the friendly op name to a context method, wrapping the call in
        try/catch and stashing the thrown error on `W.lastError` and any boolean
        return on a module-local `lastResult`:
          "create"  → the create-worktree method for an existing branch (records
                      `git worktree add "<worktreePathFor(branch)>" "<branch>"`).
          "remove"  → the remove-worktree method (records
                      `git worktree remove "<worktreePathFor(branch)>" --force` then a
                      local-branch deletion; returns whether it removed).
        `a worktree for branch {string} is created from base {string} ...` →
        the create-new-branch-from-base method (records
        `git worktree add -b "<branch>" "<worktreePathFor(branch)>" "origin/<base>"`).
        `the worktrees are listed through the context` → the list method; stash the
        returned `string[]` on a module-local for the list assertions.
      • The default `makeSpyExec` stdout (`'main\n'`) drives the happy "branch exists,
        not checked out elsewhere" path for "create" (the `git rev-parse --verify`
        probe succeeds and `git worktree list --porcelain` shows no match). The
        runner-state Given `the branch {string} does not exist locally or on origin`
        programs `responseMap` to THROW on `git rev-parse --verify "<branch>"`,
        `git rev-parse --verify "origin/<branch>"`, and `git fetch origin "<branch>"`
        so a baseless create has nothing to resolve and must throw. `the runner reports
        a worktree listing ...` programs `git worktree list --porcelain` to return a
        porcelain blob containing `ctx.basePath` (the main repo) plus two
        `ctx.basePath/.worktrees/...` entries.
      • `a recorded worktree command targets the worktree path for branch {string}`
        computes EXPECTED = `ctx.worktreePathFor(branch)` and asserts some recorded
        command string contains it — either shape (a `git worktree add` or `remove`)
        passes. `the recorded worktree path for branch {string} is under the target
        workspace, not the framework repo root` asserts EXPECTED starts with
        `ctx.basePath` (the target workspace for a target context) AND does NOT start
        with `FRAMEWORK_ROOT`, AND that a recorded command actually used EXPECTED —
        proving the op consumes the identity-resolved path, not a cwd-default.
      • `the captured commands ran with cwd equal to the context base path` asserts
        EVERY recorded invocation's `cwd === ctx.basePath` (the management verbs launch
        from the parent repo, never the ambient cwd). `the worktree operation fails
        loudly` asserts `W.lastError !== null`. `the operation reports the worktree was
        removed` asserts the stashed boolean return is true. The list assertions read
        the stashed `string[]`: every entry includes `.worktrees/` and none equals
        `ctx.basePath`.
      • The two-context steps reuse #659's keyed staging (`contextsByKey` by
        "owner/repo", each with its OWN recording runner). `the {string} context
        created its worktree for branch {string} under its own base path` looks up that
        context, finds a recorded `git worktree add` containing
        `ctx.worktreePathFor(branch)`, and asserts that path starts with `ctx.basePath`.
        `the {string} context's worktree commands do not target the {string} context
        base path` asserts none of the keyed context's recorded commands contain the
        OTHER context's base path. The token phrases are #659's verbatim.

  Background:
    Given the ADW codebase is checked out

  # ═══════════════ TARGET-PATH AUTHORITY (stories 1, 16) ══════════════════════
  #
  # The core new observable: a worktree create/remove targets the worktree path the
  # context RESOLVES for the branch — `worktreePathFor(branch)`, under the context's
  # base path — supplied as the command argument, never a cwd-defaulted directory.

  # ── §1 A management op targets the resolved worktree path ─────────────────────
  #
  # Both the create (`git worktree add <path> <branch>`) and the remove
  # (`git worktree remove <path> --force`) carry the context-resolved worktree path
  # as their target argument.

  @adw-661 @adw-u01em3-migrate-worktree-ope
  Scenario Outline: A worktree-management operation targets the context's resolved worktree path
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    When the "<op>" worktree operation for branch "feature-issue-661-x" runs through the context
    Then a recorded worktree command targets the worktree path for branch "feature-issue-661-x"

    Examples:
      | op     |
      | create |
      | remove |

  # ═══════════════ THE HEADLINE ANTI-REGRESSION (story 1) ══════════════════════
  #
  # The exact defect the deleted defaulting helper produced: a target-repo worktree
  # landing under the framework cwd instead of the target workspace. The resolved
  # worktree path a target op targets is under the target-repos workspace and NOT
  # under the framework repo root — and stays so when the process working directory
  # is moved away. This is the single most important regression guard for the class.

  # ── §2 A target op targets the target workspace, not the framework root ───────

  @adw-661 @adw-u01em3-migrate-worktree-ope
  Scenario: A worktree create for a target repo targets the target workspace, not the framework root, regardless of the process working directory
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    And the process working directory is changed away from the context base path
    When the "create" worktree operation for branch "feature-issue-661-x" runs through the context
    Then a recorded worktree command targets the worktree path for branch "feature-issue-661-x"
    And the recorded worktree path for branch "feature-issue-661-x" is under the target workspace, not the framework repo root

  # ═══════════════ BASE-PATH CWD AUTHORITY (story 16) ═════════════════════════
  #
  # The management verbs run from the PARENT repo's worktree registry, so every
  # command they spawn launches with cwd = the context's base path — never the
  # ambient process working directory. This is the wrong-cwd half of the bug class.

  # ── §3 Every management command launches under the base path ──────────────────

  @adw-661 @adw-u01em3-migrate-worktree-ope
  Scenario Outline: A worktree-management operation runs its commands under the context base path
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    When the "<op>" worktree operation for branch "feature-issue-661-x" runs through the context
    Then the captured commands ran with cwd equal to the context base path

    Examples:
      | op     |
      | create |
      | remove |

  # ── §4 The base-path cwd holds even when process.cwd() changes ────────────────
  #
  # Perturbing `process.cwd()` before the op leaves the launched commands' cwd
  # unchanged — the anti-regression against the wrong-cwd defect for management ops.

  @adw-661 @adw-u01em3-migrate-worktree-ope
  Scenario: A worktree create runs under the base path even when the process working directory changes
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    And the process working directory is changed away from the context base path
    When the "create" worktree operation for branch "feature-issue-661-x" runs through the context
    Then the captured commands ran with cwd equal to the context base path

  # ═══════════════ PER-COMMAND TOKEN (story 7, inherited) ══════════════════════
  #
  # A create resolves and fetches refs from origin, so it reaches the network and
  # needs auth. Every command it spawns carries the context's token in its child
  # env — the per-command auth that makes the legacy process-global bleed
  # unrepresentable for worktree ops too.

  # ── §5 A create carries the context's auth token ──────────────────────────────

  @adw-661 @adw-u01em3-migrate-worktree-ope
  Scenario: A worktree create through the context carries the context's auth token in its child environment
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    When the "create" worktree operation for branch "feature-issue-661-x" runs through the context
    Then every captured command carried auth token "token-acme" in its child environment

  # ═══════════════ BEHAVIOUR PRESERVATION (AC5) ═══════════════════════════════
  #
  # The legacy vcs worktree suites pin hard-won create/remove/list semantics.
  # Routed through the context methods, that behaviour must be intact — the cutover
  # safety net the acceptance criteria require (mirroring `worktreeReset.test.ts`).

  # ── §6 Create for an existing branch adds a worktree at the resolved path ─────
  #
  # When the branch already resolves locally or on origin, the create issues a
  # `git worktree add "<resolved worktree path>" "<branch>"` for the existing branch.

  @adw-661 @adw-u01em3-migrate-worktree-ope
  Scenario: Creating a worktree for an existing branch adds a worktree for that branch at its resolved path
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    When the "create" worktree operation for branch "feature-issue-661-x" runs through the context
    Then a recorded worktree-add command for branch "feature-issue-661-x" targets its resolved worktree path

  # ── §7 Create with a new branch from a base creates the branch from the base ──
  #
  # When the branch does not yet exist, a create-from-base issues a branch-creating
  # `git worktree add -b "<branch>" "<resolved path>" "origin/<base>"`.

  @adw-661 @adw-u01em3-migrate-worktree-ope
  Scenario: Creating a worktree with a new branch from a base creates the branch from the base ref
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    When a worktree for branch "feature-issue-661-new" is created from base "dev" through the context
    Then a recorded worktree-add command creates branch "feature-issue-661-new" from base "dev"

  # ── §8 Create refuses an unsatisfiable request (missing branch, no base) ──────
  #
  # The "mandatory steps throw" mirror: when the branch resolves nowhere and no base
  # branch is supplied, the create fails loudly and issues no `git worktree add`.

  @adw-661 @adw-u01em3-migrate-worktree-ope
  Scenario: Creating a worktree for a missing branch with no base branch fails loudly
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    And the branch "feature-issue-661-ghost" does not exist locally or on origin
    When the "create" worktree operation for branch "feature-issue-661-ghost" runs through the context
    Then the worktree operation fails loudly

  # ── §9 Create rejects an empty branch name ────────────────────────────────────
  #
  # The input-validation guard: an empty branch name is a hard error, never a
  # worktree at a degenerate path.

  @adw-661 @adw-u01em3-migrate-worktree-ope
  Scenario: Creating a worktree with an empty branch name fails loudly
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    When the "create" worktree operation for branch "" runs through the context
    Then the worktree operation fails loudly

  # ── §10 Remove forcibly removes the worktree then deletes its local branch ────
  #
  # The remove issues `git worktree remove "<resolved path>" --force`, then deletes
  # the now-orphaned local branch, and reports success.

  @adw-661 @adw-u01em3-migrate-worktree-ope
  Scenario: Removing a worktree forcibly removes it and then deletes its local branch
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    When the "remove" worktree operation for branch "feature-issue-661-x" runs through the context
    Then a recorded worktree-remove command for branch "feature-issue-661-x" is issued
    And a recorded local-branch deletion for branch "feature-issue-661-x" is issued
    And the operation reports the worktree was removed

  # ── §11 List returns only the `.worktrees/` entries, excluding the main repo ──
  #
  # Listing parses the worktree registry and returns only the worktrees under
  # `.worktrees/`, never the main repository path itself.

  @adw-661 @adw-u01em3-migrate-worktree-ope
  Scenario: Listing worktrees returns only the entries under the context's .worktrees directory
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    And the runner reports a worktree listing with the main repository and two issue worktrees
    When the worktrees are listed through the context
    Then the listed worktrees are only the entries under the context's .worktrees directory
    And the main repository path is not among the listed worktrees

  # ═══════════════ TWO-CONTEXT ISOLATION (stories 2, 7) ═══════════════════════
  #
  # The structural-impossibility-of-bleed proof for worktree management. Two
  # contexts for two repos each create their own worktree under their OWN target
  # workspace with their OWN token, exercised in one process — the wrong-workspace +
  # token-bleed class the whole PRD forecloses.

  # ── §12 Two contexts create worktrees under their own workspace and token ─────

  @adw-661 @adw-u01em3-migrate-worktree-ope
  Scenario: Two repo contexts each create a worktree under their own target workspace and token
    Given a GitContext for owner "acme" repo "alpha" with auth token "token-alpha"
    And a GitContext for owner "octo" repo "beta" with auth token "token-beta"
    And each context's git and gh commands are captured by a recording runner
    When the "create" worktree operation for branch "feature-a" runs through the "acme/alpha" context
    And the "create" worktree operation for branch "feature-b" runs through the "octo/beta" context
    Then the "acme/alpha" context created its worktree for branch "feature-a" under its own base path
    And the "octo/beta" context created its worktree for branch "feature-b" under its own base path
    And the "acme/alpha" context's worktree commands do not target the "octo/beta" context base path
    And the "acme/alpha" command ran with auth token "token-alpha" in its child environment
    And the "octo/beta" command ran with auth token "token-beta" in its child environment
    And the "acme/alpha" command's child environment does not carry auth token "token-beta"

  # ═══════════════ TYPE-CHECK BACKSTOP (registry T22) ══════════════════════════
  #
  # ── §13 The new operation surface keeps the ADW codebase type-clean ───────────
  #
  # A backstop consistent with the sibling per-issue features (feature-658 §7,
  # feature-662 §14): the migrated worktree create/remove/list/lookup methods, and
  # the removal of the defaulting helper and the optional-base-path chain, compile
  # within the ADW codebase's type-check.

  @adw-661 @adw-u01em3-migrate-worktree-ope
  Scenario: The ADW TypeScript type-check passes with the worktree operation surface in place
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
