@adw-658 @adw-oqb76h-gitcontext-package-m
Feature: GitContext package — mandatory identity decides the base path, with no optional override and no cwd fallback

  Issue #658 (parent PRD `specs/prd/git-context-repo-authority.md`) is the
  foundational slice of the repo-context authority: a new standalone, importable
  package whose public surface is a `GitContext` deep module built from an explicit
  identity — `owner`, `repo`, a self-host/target discriminator, the auth token, and
  the git author/committer identity. A `GitContext` is the single place that decides
  "which repo's filesystem," and this slice ships the resolution authority (a base
  path accessor and a `worktreePathFor(branch)` method) plus its hard-failure
  contract. It does NOT migrate call sites — that is later slices — but the package
  is verifiable standalone, which is exactly what these scenarios pin.

  Why this slice exists — the defect it forecloses:

    Today the worktree base path is computed by `getWorktreesDir(baseRepoPath?)` /
    `getWorktreePath(branchName, baseRepoPath?)`, whose base-path parameter is
    OPTIONAL and silently defaults to the framework repo's working directory
    (`process.cwd()` via `getMainRepoPath()`). Any caller that forgets the target
    base resolves worktrees under the WRONG repo — and because the framework
    dogfoods itself, the default is correct in the most-exercised path and only
    detonates against target repos, so the bug ships and then fails in production.
    This PRD has mined ~13 fix episodes of that one shape over four months.

    `GitContext` makes the wrong path unrepresentable: identity is MANDATORY, the
    base-path decision lives in exactly one constructor, there is NO optional base
    path and NO cwd fallback, and an incomplete identity is a hard construction
    error. `worktreePathFor(branch)` is computed under the context's base path, never
    from ambient cwd.

  Resolution contract pinned here (the observable behaviour, not the field shape):

    • self-host identity      → base path resolves to the injected framework repo root
                                (story 21).
    • target identity         → base path resolves to the target-repos workspace for
                                that `owner/repo`, mirroring
                                `core/targetRepoManager.ts`'s
                                `getTargetRepoWorkspacePath` (story 22).
    • worktreePathFor(branch) → computed UNDER the resolved base path, independent of
                                the process working directory (AC6).
    • incomplete identity     → construction fails loudly; no silent fall-through to
                                the working directory (story 23).

    The framework root and the target-repos root are INJECTED at construction — the
    package depends on no ADW-specific globals, so another project can import it and
    get the same guarantees (stories 19, 20). The scenarios therefore inject sentinel
    roots and assert resolution against them, which doubles as the proof that no
    ambient global is consulted.

  Observability / rot-prevention note:

    Every assertion below targets a runtime OUTPUT of the system under test, never a
    source file. No step reads the new GitContext package, `worktreeOperations.ts`,
    `targetRepoManager.ts`, or `environment.ts` as text, substring-matches their
    contents, or parses them as JSON/AST.

      • §1, §2, §4, §5, §6 phase-import the package's `GitContext`, construct it from
        an injected identity, and assert the RETURN VALUES `basePath` and
        `worktreePathFor(branch)` — the construction-from-identity return-value
        pattern the acceptance criteria call for (mirroring
        `providers/__tests__/repoContext.test.ts`) and the deterministic
        path-computation pattern of `vcs/__tests__/worktreeReset.test.ts`. A resolved
        path is an observable output, not a source property.
      • §3 constructs with a deliberately incomplete identity and asserts the
        construction THROWS — the "mandatory steps throw on failure" mirror of
        `worktreeReset.test.ts`. The thrown error is an observable behaviour.
      • §7 asserts the type-checker's verdict (registry T22).

    The injected roots, owner/repo, and branch names in the steps are INPUT test data
    and the resolved paths are the system's OUTPUT — exactly the artefact category the
    Rot-Detection Rubric permits, NOT a read of this repo's source files. The sentinel
    roots (e.g. "/srv/adw/framework") are pure construction inputs; `basePath` and
    `worktreePathFor` are pure path computations, so no real filesystem is touched.

  Scope notes:

    • Behaviour pinned here is the OBSERVABLE resolution — the base path a given
      identity resolves to, the worktree path under it, and the loud failure on
      incomplete identity. The constructor's exact field names, the package's module
      path, the error class, and the gate's internal reason string are an
      implementer's choice and are NOT pinned (consistent with the sibling features'
      "pin the decision, not the shape" stance).
    • AC1's "no context-free git/`gh` free functions" and AC5/story-6's "base-path
      resolution exists in exactly ONE place — no other code re-derives it" are
      ARCHITECTURAL invariants. The PRD enforces the former via a CI/lint guard that
      it explicitly does NOT unit-test, and the latter is a single-source-of-truth
      property. Neither can be asserted behaviourally without reading source (which
      the rubric forbids), so they are proven here only through their OBSERVABLE
      CONSEQUENCE: resolution is fully identity-determined and cwd-independent (§4,
      §5), and two co-resident contexts resolve independently (§6). The positive of
      AC1 — the package's public surface IS the `GitContext` constructed from identity
      — is exercised by every scenario in this file.
    • Call-site MIGRATION (cron/orchestrator/webhook boundary constructors, threading
      the context through phases, removing the legacy `getWorktreePath` defaulting
      param) is explicitly OUT of scope for this slice and owned by later issues; no
      scenario here drives an orchestrator or phase.
    • Per-command auth/env injection and token isolation (PRD story 7) are NOT part of
      this slice's story set (6, 19, 20, 21, 22, 23) and are deliberately not pinned
      here; this slice owns identity + base-path authority only. The §6 isolation
      scenario asserts BASE-PATH independence between two contexts, not token
      isolation.
    • The @regression maintenance sweep is SKIPPED for this issue: `.adw/scenarios.md`
      configures a `## Regression Scenario Directory`, so promotion is a deliberate
      human decision and the agent never auto-promotes.

  Vocabulary note:

    Registered phrases reused (`features/regression/vocabulary.md`):
      G18 `the ADW codebase is checked out`
      T22 `the ADW TypeScript type-check passes`

    Novel phrasing introduced here — the registry has no phrase for the GitContext
    package, its base-path resolution, or its worktree-path computation. Surfaced to
    the maintainer in the agent Output:
      Construction & base-path resolution:
        • `a GitContext is constructed for a self-host identity with framework root {string}`
        • `a GitContext is constructed for target owner {string} repo {string} with target-repos root {string}`
        • `the context base path is {string}`
      Incomplete-identity failure:
        • `a GitContext is constructed with {string} omitted from an otherwise-complete identity`
        • `a GitContext is constructed for a target identity with no target-repos root supplied`
        • `the process working directory is a usable git repository`
        • `the GitContext construction fails with a loud error`
      Worktree-path resolution:
        • `a GitContext whose resolved base path is {string}`
        • `the worktree path for branch {string} is under the context base path`
        • `the worktree path for branch {string} is {string}`
        • `the worktree path for branch {string} is computed from two different working directories`
        • `both worktree-path computations return {string}`
      Two-context isolation:
        • `a self-host GitContext with framework root {string}`
        • `a target GitContext for owner {string} repo {string} with target-repos root {string}`
        • `the self-host context base path is {string}`
        • `the target context base path is {string}`

    Step-definition note for the maintainer:
      • All construction steps phase-import `GitContext` from the new package
        (expected to land as a standalone module, e.g. `adws/gitContext/` or a
        top-level `packages/git-context/`) and build it from an injected identity:
        `{ owner, repo, selfHost, token, author/committer, frameworkRoot,
        targetReposRoot }`. The exact field names are the implementer's choice — pin
        only the resolved outputs. The framework root and target-repos root are
        INJECTED construction inputs (no ADW globals); in production the boundary
        constructor passes `REPO_ROOT` and `TARGET_REPOS_DIR`, but the tests pass
        sentinels so resolution is hermetic and global-free.
      • `the context base path is {string}` asserts `ctx.basePath` equals the value.
        Self-host → the injected framework root verbatim; target →
        `join(targetReposRoot, owner, repo)` (mirrors `getTargetRepoWorkspacePath`).
      • §3 builds an otherwise-complete TARGET identity and deletes the named field
        before constructing; `the git author/committer identity` row drops the author
        name/email, `the self-host/target discriminator` row drops the selfHost flag.
        Assert the constructor THROWS (any error) — do not pin the message. "no
        target-repos root supplied" omits the injected root specifically: the
        constructor must throw rather than fall back to cwd (the exact PRD defect).
        `the process working directory is a usable git repository` is satisfied by the
        test running inside the ADW checkout (cwd is already a repo); it exists so the
        no-fallback scenario is unmistakable.
      • §4/§5 reuse `a GitContext whose resolved base path is {string}` — build a
        self-host context with framework root = that value (self-host base ≡ framework
        root) and call `ctx.worktreePathFor(branch)`. `is under the context base path`
        asserts the result starts with the base path; the exact-value assertion pins
        the `<basePath>/.worktrees/<branch>` layout (the compatibility contract that
        lets later slices still find existing worktrees). §5 computes once, `chdir`s
        to a different directory (e.g. `os.tmpdir()`), computes again, and asserts
        both equal the same expected path — the anti-regression against the old
        `process.cwd()/.worktrees` derivation. Restore cwd afterwards.
      • §6 constructs BOTH a self-host and a target context in the same process and
        asserts each resolves its own base path independently — the importable /
        injected-config / per-identity proof (stories 19, 20).

  Background:
    Given the ADW codebase is checked out

  # ═══════════════════════ BASE-PATH RESOLUTION (the constructor authority) ═════
  #
  # Surface 1: the single place that decides "which repo's filesystem." Its
  # observable output is the resolved `basePath` — a return value, the registry's
  # construction-from-identity / phase-import pattern.

  # ── §1 Self-host identity → framework repo root (AC4; story 21) ───────────────
  #
  # A self-hosted run (ADW operating on its own repo) resolves its base path to the
  # injected framework repo root, so dogfooding continues unchanged. The root is an
  # injected construction input, not an ADW global — proving the package carries no
  # dependency on ambient configuration (stories 19, 20).

  @adw-658 @adw-oqb76h-gitcontext-package-m
  Scenario: A self-host GitContext resolves its base path to the framework repo root
    Given a GitContext is constructed for a self-host identity with framework root "/srv/adw/framework"
    Then the context base path is "/srv/adw/framework"

  # ── §2 Target identity → target-repos workspace for owner/repo (AC4; story 22) ─
  #
  # A target run resolves its base path to the target-repos workspace for its
  # `owner/repo`, mirroring `getTargetRepoWorkspacePath` — `join(root, owner, repo)`.
  # Two distinct identities under the SAME injected root resolve to two DISTINCT
  # base paths, pinning that the decision is per-identity, not ambient.

  @adw-658 @adw-oqb76h-gitcontext-package-m
  Scenario Outline: A target GitContext resolves its base path to the target-repos workspace for its owner and repo
    Given a GitContext is constructed for target owner "<owner>" repo "<repo>" with target-repos root "/srv/adw/repos"
    Then the context base path is "<basePath>"

    Examples:
      | owner | repo        | basePath                         |
      | acme  | webapp      | /srv/adw/repos/acme/webapp       |
      | octo  | hello-world | /srv/adw/repos/octo/hello-world  |

  # ═══════════════════════ INCOMPLETE-IDENTITY FAILURE (story 23) ══════════════
  #
  # Surface 2: the hard-failure contract. Identity is MANDATORY and there is no
  # optional base path and no cwd fallback, so any incomplete identity must surface
  # loudly at construction instead of silently resolving the wrong repo. The
  # observable output is the thrown error — the "mandatory steps throw" mirror of
  # `worktreeReset.test.ts`.

  # ── §3 Each missing identity field fails loudly (AC2, AC3) ────────────────────
  #
  # Every field the constructor requires — `owner`, `repo`, the self-host/target
  # discriminator, the auth token, and the git author/committer identity — is
  # mandatory. Dropping any one from an otherwise-complete identity is a hard
  # construction error, never a default.

  @adw-658 @adw-oqb76h-gitcontext-package-m
  Scenario Outline: Constructing a GitContext with an incomplete identity fails loudly
    When a GitContext is constructed with "<missing field>" omitted from an otherwise-complete identity
    Then the GitContext construction fails with a loud error

    Examples:
      | missing field                      |
      | owner                              |
      | repo                               |
      | the self-host/target discriminator |
      | the auth token                     |
      | the git author/committer identity  |

  # ── §3b No silent cwd fallback — the headline anti-regression (AC2; story 23) ──
  #
  # The exact defect this PRD forecloses: the legacy helper's optional base path
  # silently defaulted to the working directory. The GitContext constructor must
  # instead FAIL when it cannot resolve a base path — even when the process working
  # directory is itself a perfectly usable git repository, it does NOT fall back to
  # it. This is the single most important regression guard for the whole class.

  @adw-658 @adw-oqb76h-gitcontext-package-m
  Scenario: Constructing a context with no base-path config fails loudly instead of defaulting to the working directory
    Given the process working directory is a usable git repository
    When a GitContext is constructed for a target identity with no target-repos root supplied
    Then the GitContext construction fails with a loud error

  # ═══════════════════════ WORKTREE-PATH AUTHORITY (worktreePathFor) ═══════════
  #
  # Surface 3: the worktree path a branch maps to is computed UNDER the context's
  # base path, never from ambient cwd. Observable output: the returned path.

  # ── §4 worktreePathFor(branch) is computed under the base path (AC6) ──────────
  #
  # For any resolved base path — self-host root or target workspace — the worktree
  # path for a branch sits under that base path, following the established
  # `<basePath>/.worktrees/<branch>` layout (the compatibility contract that lets
  # later migration slices still discover existing worktrees).

  @adw-658 @adw-oqb76h-gitcontext-package-m
  Scenario Outline: The worktree path for a branch is computed under the context base path
    Given a GitContext whose resolved base path is "<basePath>"
    Then the worktree path for branch "<branch>" is under the context base path
    And the worktree path for branch "<branch>" is "<worktreePath>"

    Examples:
      | basePath                   | branch              | worktreePath                                          |
      | /srv/adw/framework         | feature-issue-658-x | /srv/adw/framework/.worktrees/feature-issue-658-x     |
      | /srv/adw/repos/acme/webapp | feature-x           | /srv/adw/repos/acme/webapp/.worktrees/feature-x       |

  # ── §5 worktreePathFor is cwd-independent — kills the process.cwd() defect (AC6) ─
  #
  # The behavioural heart of the slice. The worktree path is a function of the
  # context's base path ALONE, so changing the process working directory between two
  # computations leaves the result identical. The old `process.cwd()/.worktrees`
  # derivation would have moved with cwd; this asserts it cannot.

  @adw-658 @adw-oqb76h-gitcontext-package-m
  Scenario: The worktree path for a branch does not change with the process working directory
    Given a GitContext whose resolved base path is "/srv/adw/repos/acme/webapp"
    When the worktree path for branch "feature-x" is computed from two different working directories
    Then both worktree-path computations return "/srv/adw/repos/acme/webapp/.worktrees/feature-x"

  # ═══════════════════════ TWO-CONTEXT ISOLATION (stories 19, 20, 6) ═══════════
  #
  # The deep-module / reusability proof. Because identity and config are injected
  # and base-path resolution lives only in the constructor, two contexts for two
  # different identities can be exercised in the same process and each resolves its
  # own base path independently — no shared global, no cross-contamination.

  # ── §6 Two co-resident contexts resolve independent base paths ────────────────

  @adw-658 @adw-oqb76h-gitcontext-package-m
  Scenario: Two GitContexts for different identities resolve independent base paths in one process
    Given a self-host GitContext with framework root "/srv/adw/framework"
    And a target GitContext for owner "acme" repo "webapp" with target-repos root "/srv/adw/repos"
    Then the self-host context base path is "/srv/adw/framework"
    And the target context base path is "/srv/adw/repos/acme/webapp"

  # ═══════════════════════ TYPE-CHECK BACKSTOP (registry T22) ══════════════════
  #
  # ── §7 The new package keeps the ADW codebase type-clean ──────────────────────
  #
  # A backstop consistent with the sibling per-issue features (feature-638 §8,
  # feature-639 §6): the standalone GitContext package and its public surface
  # compile within the ADW codebase's type-check.

  @adw-658 @adw-oqb76h-gitcontext-package-m
  Scenario: The ADW TypeScript type-check passes with the GitContext package in place
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
