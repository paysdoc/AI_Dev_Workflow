@adw-661 @adw-ycu7a3-migrate-worktree-ope
Feature: Worktree operations route through GitContext — create / remove / reset / list always resolve under the context base path, never the framework cwd

  Issue #661 (parent PRD `specs/prd/git-context-repo-authority.md`, see
  **Operation surface** and **Removal of the unsafe primitives**) is the worktree
  migration slice of the repo-context authority. Issue #658 shipped the resolution
  authority — a `GitContext` whose mandatory identity decides the base path, plus a
  `worktreePathFor(branch)` accessor computed under that base path with no cwd
  fallback. This slice moves the worktree OPERATIONS themselves — create, remove,
  reset, list, and worktree-path lookup — onto the context, routes every call site
  through it, and DELETES the optional defaulting base-path helper so the previously
  reachable wrong path no longer exists.

  Why this slice exists — the defect it forecloses:

    Today create/remove/reset/list compute their target through
    `getWorktreePath(branch, baseRepoPath?)` → `getWorktreesDir(baseRepoPath?)`,
    whose base-path parameter is OPTIONAL and silently defaults to the framework
    repo's working directory (`getMainRepoPath()` over `process.cwd()`). Any worktree
    operation whose caller forgets the target base therefore acts under the WRONG
    repo. Because ADW dogfoods itself, the default is correct in the most-exercised
    self-host path and only detonates against target repos — the bug ships, then
    fails in production (the ~13-episode wrong-base class the PRD mines).

    Once every worktree operation is a `GitContext` method, the path each operation
    acts on is `<context base path>/.worktrees/<branch>` — derived from the
    constructor's single base-path decision, never from ambient cwd. With the
    optional, defaulting helper and the cwd-defaulting path computation removed, the
    wrong path is no longer representable.

  Operation contract pinned here (observable behaviour, not call structure):

    • create  → the worktree is materialised at `<base>/.worktrees/<branch>`; the
                operation's returned path is the context's worktree path for that
                branch (AC1, story 16).
    • list    → enumerates the worktrees under the base path and excludes the main
                repository root (AC1, story 16).
    • reset   → returns the worktree to an exact copy of its branch on origin,
                discarding all local work, and fails loudly when the remote
                operation cannot complete (AC5, mirroring
                `vcs/__tests__/worktreeReset.test.ts`).
    • remove  → tears the worktree down from under the base path and reports
                whether anything was removed (AC1, story 16).
    • target  → for a target identity, every operation acts under the target-repos
                workspace even when the process working directory is the framework
                repo (AC4, story 1) — the headline regression guard.

  Observability / rot-prevention note:

    Every assertion below targets a runtime OUTPUT of the system under test — a git
    artefact (a worktree directory git actually tracks, the `git worktree list`
    enumeration, a worktree's working-tree cleanliness, its HEAD relative to origin)
    or a thrown error. No step reads `worktreeOperations.ts`, `worktreeCreation.ts`,
    `worktreeCleanup.ts`, `worktreeReset.ts`, `worktreeQuery.ts`, the GitContext
    package, or any other source file as text, substring-matches their contents, or
    parses them as JSON/AST.

      • §1–§4 phase-import the package's `GitContext`, construct it from an injected
        identity whose base path is a REAL temporary git repository, drive the
        worktree operation as a context method, and assert against the resulting git
        artefacts — the "git artefacts produced by the system under test" surface
        (vocabulary registry surface #3) and the deterministic git-operation pattern
        of `vcs/__tests__/worktreeReset.test.ts`. A materialised worktree, an empty
        `git status`, and a HEAD that equals `origin/<branch>` are observable
        outputs, not source properties.
      • §3's failure scenario drives reset against an unreachable origin and asserts
        the operation THROWS — the "mandatory steps throw on failure" mirror of
        `worktreeReset.test.ts`. The thrown error is observable behaviour.
      • §5 asserts the type-checker's verdict (registry T22).

    The temporary git repositories, owner/repo, and branch names are INPUT test data;
    the worktree directories, list output, working-tree state, and thrown errors are
    the system's OUTPUT — exactly the artefact category the Rot-Detection Rubric
    permits, NOT a read of this repo's source files.

  Scope notes:

    • Behaviour pinned here is the OBSERVABLE result of each operation: WHERE the
      worktree is materialised/removed/listed (under the context base path), the
      reset end-state (pristine at origin), and the loud failure on a broken remote.
      The context method NAMES, the package module path, and the operations' internal
      git command sequence are an implementer's choice and are NOT pinned (consistent
      with feature-658's "pin the decision, not the shape" stance).
    • AC2 ("all worktree call sites route through the context; no remaining
      optional-base-path callers") and AC3 ("the optional, defaulting base-path
      helper and cwd-defaulting worktree-path computation are removed") are
      ARCHITECTURAL invariants. The PRD enforces routing via a CI/lint guard it
      explicitly does NOT unit-test, and a function's removal is a source property
      that the rubric forbids asserting by reading source. They are proven here only
      through their OBSERVABLE CONSEQUENCE: every operation resolves under the context
      base path and ignores the process working directory (§2). If a defaulting,
      cwd-reachable path still existed, §2 would fail.
    • Path-lookup AC: feature-658 already pins the COMPUTED worktree path
      (`worktreePathFor`) and its cwd-independence. This slice does not re-pin that
      computation; §1 instead asserts the create operation's returned path EQUALS the
      context's worktree path and that an existing worktree is discoverable through
      the context — the path-lookup operating as a context method that the operations
      consume.
    • Branch / commit / push, issue / PR / comment, and per-command auth-env
      injection are owned by sibling slices and are NOT pinned here; this slice owns
      the worktree operation surface only.
    • The @regression maintenance sweep is SKIPPED for this issue: `.adw/scenarios.md`
      configures a `## Regression Scenario Directory`, so promotion is a deliberate
      human decision and the agent never auto-promotes.

  Vocabulary note:

    Registered phrases reused (`features/regression/vocabulary.md`):
      G18 `the ADW codebase is checked out`
      T22 `the ADW TypeScript type-check passes`

    Novel phrasing introduced here — the registry has no phrase for worktree
    operations driven through a GitContext. Distinct from feature-658's
    sentinel-path construction phrases on purpose: those build hermetic contexts for
    pure path assertions (no filesystem); these bind the context to a REAL temporary
    git repository so the operations produce git artefacts. Surfaced to the
    maintainer in the agent Output:
      Construction & cwd setup (Given):
        • `a GitContext whose base path is a fresh temporary git repository`
        • `a target GitContext for owner {string} repo {string} rooted at a temporary target-repos workspace`
        • `a GitContext whose base path is a temporary git repository with an origin remote`
        • `the process working directory is a separate framework git repository`
        • `the process working directory is changed to an unrelated temporary directory`
      Worktree preconditions (Given):
        • `a worktree has been created through the context for branch {string}`
        • `a worktree created through the context for branch {string} whose branch exists on origin`
        • `the worktree for branch {string} has uncommitted changes and an unpushed local commit`
        • `the origin remote for branch {string} has become unreachable`
      Operations (When):
        • `a worktree is created through the context for branch {string}`
        • `the worktrees are listed through the context`
        • `the worktree for branch {string} is reset to its remote through the context`
        • `the worktree for branch {string} is removed through the context`
      Artefact assertions (Then):
        • `a git worktree exists under the context base path for branch {string}`
        • `no git worktree exists under the context base path for branch {string}`
        • `the created worktree path equals the context's worktree path for branch {string}`
        • `looking up the worktree for branch {string} through the context returns its path under the base path`
        • `the listed worktrees include the worktree for branch {string}`
        • `the listed worktrees exclude the main repository root`
        • `no worktree directory exists under the process working directory for branch {string}`
        • `the worktree for branch {string} has no uncommitted changes`
        • `the worktree for branch {string} matches its branch on origin`
        • `the worktree reset through the context fails loudly`
        • `the context reports that no worktree was removed`

    Step-definition note for the maintainer:
      • All operation steps phase-import `GitContext` from the package landed by
        feature-658 (`adws/gitContext/`) and drive the worktree operation as a context
        method. The exact method names are the implementer's choice — pin only the
        observable artefacts. Mirror the construction shape of
        `features/per-issue/step_definitions/feature-658.steps.ts`
        (`{ owner, repo, selfHost, token, gitIdentity, frameworkRepoRoot,
        targetReposDir }`), but set the injected roots to REAL temp directories so the
        operations touch a real git repo.
      • `a GitContext whose base path is a fresh temporary git repository`: create a
        temp dir, `git init` it with an initial commit on the default branch, then
        construct a SELF-HOST context with `frameworkRepoRoot` = that temp dir (so
        `ctx.basePath` is the temp repo). Track every temp dir on World and remove it
        in an `After` hook.
      • `a target GitContext ... rooted at a temporary target-repos workspace`: create
        a temp target-repos root, `git init` the repo at `<root>/<owner>/<repo>` with
        an initial commit, then construct a TARGET context with `targetReposDir` =
        that root and the given `owner`/`repo` (so `ctx.basePath` =
        `join(root, owner, repo)`, the materialised repo).
      • `with an origin remote`: additionally `git init --bare` a temp origin, add it
        as `origin`, and push the default branch — so reset's `git fetch origin
        <branch>` / `git reset --hard origin/<branch>` have a remote to target.
      • `a worktree created ... whose branch exists on origin`: create the worktree
        through the context (new branch), then push that branch to origin so
        `origin/<branch>` exists for reset to converge on.
      • `has uncommitted changes and an unpushed local commit`: in the worktree, write
        an untracked/modified file AND commit a divergent local commit on top of
        origin — both must be gone after reset.
      • `the origin remote for branch {string} has become unreachable`: point `origin`
        at a non-existent path (or remove the bare origin) so the reset's fetch fails;
        the When step must capture the thrown error into World, and
        `the worktree reset through the context fails loudly` asserts a non-null
        capture (mirror of feature-658's `the GitContext construction fails with a
        loud error`).
      • `the process working directory is a separate framework git repository` /
        `... changed to an unrelated temporary directory`: `process.chdir(...)` to a
        DIFFERENT temp git repo / temp dir before the operation, capturing the
        original cwd and restoring it in the `After` hook (as feature-658 does). The
        worktree must still land under `ctx.basePath`, and
        `no worktree directory exists under the process working directory for branch
        {string}` asserts `<cwd>/.worktrees/<branch>` is absent — the headline
        anti-regression against the old cwd-defaulting computation.
      • `a git worktree exists under the context base path for branch {string}`:
        assert `<ctx.basePath>/.worktrees/<sanitised branch>` exists on disk AND
        appears in `git worktree list --porcelain` run in `ctx.basePath`.
      • `the listed worktrees ...`: drive the context's list operation and assert
        membership of the branch's worktree path / absence of the main repo root.
      • `matches its branch on origin`: assert `git rev-parse HEAD` in the worktree
        equals `git rev-parse origin/<branch>` (or the pushed origin tip).
      • `the context reports that no worktree was removed`: the remove operation
        returns a falsey "nothing removed" result for an absent branch (today's
        `removeWorktree` returns `false`); pin the reported outcome, not the type.

  Background:
    Given the ADW codebase is checked out

  # ═══════════════════════ CREATE / LIST / PATH-LOOKUP (AC1, story 16) ══════════
  #
  # The create, list, and worktree-path-lookup operations are now GitContext
  # methods. Their observable output is a git artefact materialised under the
  # context's base path and enumerable through the context.

  # ── §1 Create materialises the worktree under the base path and the lookup agrees
  #
  # Creating a worktree through the context produces a real git worktree at
  # `<base>/.worktrees/<branch>`, and the operation's returned path is exactly the
  # context's worktree path for that branch — the create operation consuming the
  # path-lookup authority feature-658 shipped, rather than any ambient computation.

  @adw-661 @adw-ycu7a3-migrate-worktree-ope
  Scenario: Creating a worktree through the context materialises it under the context base path
    Given a GitContext whose base path is a fresh temporary git repository
    When a worktree is created through the context for branch "feature-issue-661-create"
    Then a git worktree exists under the context base path for branch "feature-issue-661-create"
    And the created worktree path equals the context's worktree path for branch "feature-issue-661-create"
    And looking up the worktree for branch "feature-issue-661-create" through the context returns its path under the base path

  # ── §1b List enumerates worktrees under the base path, excluding the main repo ──

  @adw-661 @adw-ycu7a3-migrate-worktree-ope
  Scenario: Listing worktrees through the context reports the worktrees under its base path
    Given a GitContext whose base path is a fresh temporary git repository
    And a worktree has been created through the context for branch "feature-issue-661-list"
    When the worktrees are listed through the context
    Then the listed worktrees include the worktree for branch "feature-issue-661-list"
    And the listed worktrees exclude the main repository root

  # ═══════════════════════ TARGET WORKSPACE, NOT FRAMEWORK CWD (AC4, story 1) ═══
  #
  # The headline regression guard. A target identity's worktree operations act
  # under the target-repos workspace, never the process working directory — even
  # when that working directory is itself a perfectly usable framework git repo
  # (the exact condition under which the old optional-base-path default silently
  # resolved the wrong repo). This is also the OBSERVABLE CONSEQUENCE that proves
  # AC2/AC3: no defaulting, cwd-reachable path survives.

  # ── §2 A target context creates under the target workspace despite a framework cwd

  @adw-661 @adw-ycu7a3-migrate-worktree-ope
  Scenario: A target context creates worktrees under the target workspace even when the working directory is the framework repo
    Given a target GitContext for owner "acme" repo "webapp" rooted at a temporary target-repos workspace
    And the process working directory is a separate framework git repository
    When a worktree is created through the context for branch "feature-issue-661-target"
    Then a git worktree exists under the context base path for branch "feature-issue-661-target"
    And no worktree directory exists under the process working directory for branch "feature-issue-661-target"

  # ── §2b Operations ignore the process working directory entirely ───────────────
  #
  # The direct anti-regression against the removed cwd-defaulting computation: with
  # the working directory pointed at an unrelated location, the worktree still lands
  # under the context base path and nothing appears under the working directory.

  @adw-661 @adw-ycu7a3-migrate-worktree-ope
  Scenario: Worktree creation through the context ignores the process working directory
    Given a GitContext whose base path is a fresh temporary git repository
    And the process working directory is changed to an unrelated temporary directory
    When a worktree is created through the context for branch "feature-issue-661-cwd"
    Then a git worktree exists under the context base path for branch "feature-issue-661-cwd"
    And no worktree directory exists under the process working directory for branch "feature-issue-661-cwd"

  # ═══════════════════════ RESET (AC5 — mirror worktreeReset.test.ts) ═══════════
  #
  # The reset operation, now a context method, returns the worktree under the base
  # path to an exact copy of its branch on origin — discarding staged, unstaged,
  # untracked, and unpushed-commit work — and fails loudly when the remote
  # operation cannot complete. The end-state and the thrown error are the
  # observable outputs the existing worktree-reset behaviour tests assert.

  # ── §3 Reset discards all local work and matches origin ────────────────────────

  @adw-661 @adw-ycu7a3-migrate-worktree-ope
  Scenario: Resetting a dirty worktree through the context discards all local work and matches origin
    Given a GitContext whose base path is a temporary git repository with an origin remote
    And a worktree created through the context for branch "feature-issue-661-reset" whose branch exists on origin
    And the worktree for branch "feature-issue-661-reset" has uncommitted changes and an unpushed local commit
    When the worktree for branch "feature-issue-661-reset" is reset to its remote through the context
    Then the worktree for branch "feature-issue-661-reset" has no uncommitted changes
    And the worktree for branch "feature-issue-661-reset" matches its branch on origin

  # ── §3b Reset fails loudly when the remote operation cannot complete ───────────

  @adw-661 @adw-ycu7a3-migrate-worktree-ope
  Scenario: Resetting through the context fails loudly when the origin remote is unreachable
    Given a GitContext whose base path is a temporary git repository with an origin remote
    And a worktree created through the context for branch "feature-issue-661-reset-fail" whose branch exists on origin
    And the origin remote for branch "feature-issue-661-reset-fail" has become unreachable
    When the worktree for branch "feature-issue-661-reset-fail" is reset to its remote through the context
    Then the worktree reset through the context fails loudly

  # ═══════════════════════ REMOVE (AC1, story 16) ══════════════════════════════
  #
  # The remove operation, now a context method, tears the worktree down from under
  # the base path and reports whether anything was removed.

  # ── §4 Remove deletes the worktree from under the base path ────────────────────

  @adw-661 @adw-ycu7a3-migrate-worktree-ope
  Scenario: Removing a worktree through the context deletes it from under the base path
    Given a GitContext whose base path is a fresh temporary git repository
    And a worktree has been created through the context for branch "feature-issue-661-remove"
    When the worktree for branch "feature-issue-661-remove" is removed through the context
    Then no git worktree exists under the context base path for branch "feature-issue-661-remove"
    And the listed worktrees exclude the worktree for branch "feature-issue-661-remove"

  # ── §4b Removing an absent worktree reports that nothing was removed ────────────

  @adw-661 @adw-ycu7a3-migrate-worktree-ope
  Scenario: Removing a worktree that was never created reports that nothing was removed
    Given a GitContext whose base path is a fresh temporary git repository
    When the worktree for branch "feature-issue-661-absent" is removed through the context
    Then the context reports that no worktree was removed

  # ═══════════════════════ TYPE-CHECK BACKSTOP (registry T22) ═══════════════════
  #
  # ── §5 The migrated operation surface keeps the ADW codebase type-clean ─────────
  #
  # A backstop consistent with feature-658 §7 and the sibling per-issue features:
  # the worktree operations on the context compile within the ADW type-check.

  @adw-661 @adw-ycu7a3-migrate-worktree-ope
  Scenario: The ADW TypeScript type-check passes with worktree operations on the context
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
