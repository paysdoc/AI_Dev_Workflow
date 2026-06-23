@adw-660 @adw-k2tkdn-gitcontext-boundary
Feature: GitContext boundary constructor — cron and standalone orchestrators build one context from their launch identity and thread it down, never re-deriving from cwd

  Issue #660 (parent PRD `specs/prd/git-context-repo-authority.md`, see
  **Boundary constructors**) is the boundary-constructor slice of the repo-context
  authority. The foundational package landed in #658: a `GitContext` deep module
  whose mandatory identity decides the base path in exactly one constructor, with no
  optional base path and no cwd fallback. #658 shipped the resolution authority but
  migrated NO call sites. #660 wires that authority into the process entry points and
  migrates the first two proof paths.

  What this slice builds:

    • Each cron / standalone-orchestrator entry point constructs EXACTLY ONE
      `GitContext` at startup from its launch identity — parsed `--target-repo`
      arguments (via `core/orchestratorCli.ts` `parseTargetRepoArgs` /
      `triggers/cronRepoResolver.ts` `resolveCronRepo`), falling back to the local git
      remote for self-host — and threads it down through phases and agents. Nothing
      downstream reconstructs the context from ambient `cwd`.
    • The merge orchestrator (`adwMerge.tsx`) and the cron repo resolution are
      migrated onto the context as the proof path: the takeover/cron process acts on
      an abandoned workflow using its own authoritative target identity, and the merge
      handoff resolves and merges against the correct repository.

  Why this slice exists — the defect it forecloses:

    Today `adwMerge`'s `main()` derives its filesystem base with
    `targetRepo ? ensureTargetRepoWorkspace(targetRepo) : process.cwd()` — the
    self-host branch silently falls back to the AMBIENT working directory, and the
    takeover/cron path that re-spawned merge re-derived the same base from `cwd`. When
    the takeover process (whose own `cwd` is the framework repo) computed an abandoned
    workflow's worktree, it resolved it UNDER THE FRAMEWORK REPO rather than the target
    workspace — the documented `spawnSync ... ENOENT` wrong-base-repo incident
    (vestmatic #187), which also stranded a real issue in an unrecoverable retry loop.
    Because the framework dogfoods itself, the `cwd` default is correct in the
    most-exercised path and only detonates against target repos, so the bug ships and
    then fails in production. This is the same shape the PRD mined ~13 times.

    Routing both paths through the single launch-boundary context makes the wrong base
    unrepresentable: the base path is the context's identity-determined `basePath`,
    never `process.cwd()`, so the takeover acts on the abandoned workflow under its own
    target identity and the merge resolves against the right repository.

  Contract pinned here (the OBSERVABLE behaviour, not the field/signature shape):

    • `--target-repo owner/repo` at launch → a TARGET context whose base path is the
      target-repos workspace for that `owner/repo` (AC1, AC5; stories 9, 10).
    • no `--target-repo` at launch → a SELF-HOST context whose base path is the
      injected framework repo root, with `owner/repo` taken from the local git remote
      (AC1, AC5; story 9).
    • takeover/cron acting on an abandoned workflow resolves that workflow's worktree
      under the launch context's base path — never under the process working directory
      (AC4; stories 3, 10).
    • `adwMerge` resolves and merges the PR against the launch context's repository and
      resolves its worktree under the launch context's base path — never
      `process.cwd()` (AC3; story 11).
    • the launch context is threaded downstream and is identity-determined: the
      worktree it resolves does not change with the process working directory (AC2;
      story 9).

  Observability / rot-prevention note:

    Every assertion below targets a runtime OUTPUT of the system under test, never a
    source file. No step reads `adwMerge.tsx`, `orchestratorCli.ts`,
    `cronRepoResolver.ts`, the GitContext package, or any module as text,
    substring-matches its contents, or parses it as JSON/AST.

      • §1 phase-imports the boundary constructor, builds a context from LAUNCH
        ARGUMENTS (the authoritative launch identity), and asserts the RETURN VALUES
        `basePath`, the self-host/target discriminator, and the resolved `owner/repo` —
        the construction-from-identity return-value pattern the acceptance criteria
        call for (mirroring `feature-658` and `providers/__tests__/repoContext.test.ts`).
        A resolved path / discriminator is an observable output, not a source property.
      • §2 and §4 assert the path the launch context resolves a worktree to — a pure
        path computation, the deterministic-path pattern of
        `vcs/__tests__/worktreeReset.test.ts`. The "not under the process working
        directory" assertion is the incident pin: the resolved path is identity-derived,
        not `cwd`-derived.
      • §3 phase-imports `executeMerge` (already dependency-injectable: see
        `adws/__tests__/adwMerge.test.ts`) with RECORDING deps and asserts the repo and
        base path the merge HANDS to its PR-lookup / merge / worktree dependencies —
        recorded calls (Observability Surface 2), not a source read.
      • §5 asserts the type-checker's verdict (registry T22).

    The injected framework / target-repos roots and the `--target-repo` argument are
    INPUT test data; the resolved base paths, discriminator, owner/repo, and recorded
    dependency arguments are the system's OUTPUT — exactly the artefact category the
    Rot-Detection Rubric permits. The sentinel roots ("/srv/adw/framework",
    "/srv/adw/repos") are pure construction inputs and `worktreePathFor` is a pure path
    join, so no real filesystem is touched.

  Vocabulary note:

    Reused registered phrases from `features/regression/vocabulary.md`:
      G18 `the ADW codebase is checked out`            (background)
      T22 `the ADW TypeScript type-check passes`        (backstop)

    Novel phrasing introduced here — the registry has no phrase for a boundary
    constructor that builds a context from launch arguments, a takeover acting on an
    abandoned workflow's worktree, or the merge orchestrator running under a boundary
    context. Phrased DISTINCTLY from `feature-658`'s globally-registered GitContext
    steps (e.g. "boundary context" not "context", "resolved through the boundary
    context" not "computed from two different working directories") so the two step
    files do not collide. Surfaced to the maintainer in the agent Output:
      Boundary construction:
        • `a launch boundary with framework root {string} and target-repos root {string}`
        • `the local git remote resolves to owner {string} repo {string}`
        • `a boundary GitContext is constructed from launch arguments {string}`
        • `a boundary GitContext is constructed with no target-repo argument`
        • `the boundary context is a target context`
        • `the boundary context is a self-host context`
        • `the boundary context base path is {string}`
        • `the boundary context targets owner {string} repo {string}`
      Takeover / cron acting on an abandoned workflow:
        • `an abandoned workflow on branch {string} awaits takeover`
        • `the takeover resolves the abandoned workflow's worktree`
        • `the resolved worktree path is {string}`
        • `the resolved worktree path is not under the cron process working directory`
      adwMerge migration:
        • `a workflow for adwId {string} on branch {string} is awaiting the merge handoff with an open pull request`
        • `the merge orchestrator runs under the boundary context for issue {int} and adwId {string}`
        • `the merge resolves the pull request against the repository {string}`
        • `the merge resolves the worktree under the base path {string}`
        • `the merge does not resolve the worktree under the cron process working directory`
      Threading / cwd-independence:
        • `the worktree for branch {string} is resolved through the boundary context from two different working directories`
        • `both resolutions through the boundary context return {string}`

    Step-definition note for the maintainer:
      • All steps phase-import production code; nothing spawns a subprocess and no step
        reads a source file. Construction steps import the boundary constructor that
        #660 introduces (expected near `core/orchestratorCli.ts` /
        `triggers/cronRepoResolver.ts`, e.g. a `gitContextFromLaunchArgs(args, config)`
        that composes `parseTargetRepoArgs` / `resolveCronRepo` with the `GitContext`
        constructor). The exact name/signature is the implementer's choice — pin only
        the OBSERVABLE outputs.
      • `a launch boundary with framework root {string} and target-repos root {string}`
        stashes the injected framework root + target-repos root plus a valid token and
        git identity on World (so construction succeeds), mirroring `feature-658`'s
        injected sentinels. In production the boundary passes `REPO_ROOT` and
        `TARGET_REPOS_DIR`; the tests pass sentinels so resolution is hermetic and
        global-free.
      • `the local git remote resolves to owner {string} repo {string}` injects the
        self-host fallback resolver (the `getRepoInfo()` seam) so the no-`--target-repo`
        path is hermetic and does not depend on the checkout's real remote.
      • `a boundary GitContext is constructed from launch arguments {string}` splits the
        string on whitespace and feeds it to the boundary constructor (so
        "--target-repo acme/webapp" yields a target context); the result is stashed on
        World. `... with no target-repo argument` feeds empty args, exercising the
        self-host fallback. Both succeed (construction-as-Given, like `feature-658` §1).
      • `the boundary context is a target/self-host context` asserts the resolved
        self-host discriminator; `the boundary context base path is {string}` asserts
        `ctx.basePath`; `the boundary context targets owner {string} repo {string}`
        asserts `ctx.owner`/`ctx.repo`. Target base ≡ `join(targetReposRoot, owner,
        repo)`; self-host base ≡ the injected framework root.
      • `an abandoned workflow on branch {string} awaits takeover` stores the branch;
        `the takeover resolves the abandoned workflow's worktree` calls
        `ctx.worktreePathFor(branch)` on the launch context; `the resolved worktree path
        is {string}` asserts the value; `... is not under the cron process working
        directory` asserts the resolved path does NOT start with `process.cwd()` (the
        framework checkout the legacy `cwd` default would have used) — the spawnSync
        ENOENT incident pin.
      • The merge steps phase-import `executeMerge` with RECORDING deps: a
        `readTopLevelState` returning an `awaiting_merge` state carrying the branch, a
        `findPRByBranch` returning an OPEN PR on that branch, and `ensureWorktree` /
        `mergeWithConflictResolution` that record the `repoInfo` / base-path arguments
        they receive. The migration sources `executeMerge`'s `repoInfo` and base path
        from the launch context, so `the merge resolves the pull request against the
        repository {string}` asserts the recorded merge/PR-lookup `repoInfo` equals
        `owner/repo`; `the merge resolves the worktree under the base path {string}`
        asserts the recorded `ensureWorktree` base equals `ctx.basePath`; and `the merge
        does not resolve the worktree under the cron process working directory` asserts
        that recorded base is not `process.cwd()`.
      • `the worktree for branch {string} is resolved through the boundary context from
        two different working directories` calls `ctx.worktreePathFor(branch)`, `chdir`s
        to `os.tmpdir()`, and calls it again; `both resolutions through the boundary
        context return {string}` asserts both equal the expected path. Restore cwd in an
        `After` hook.

  Scope notes:

    • Behaviour pinned here is the OBSERVABLE boundary resolution — the context a launch
      identity builds, the base path it threads into the takeover and the merge, and the
      cwd-independence of that resolution. The boundary constructor's name/signature,
      `executeMerge`'s post-migration parameter shape, and the persisted-state field
      names are an implementer's choice and are NOT pinned (consistent with the sibling
      features' "pin the decision, not the shape" stance).
    • AC1's "EXACTLY ONE context at startup, threaded down — nothing downstream
      re-derives from ambient `cwd`" is partly architectural. Its observable
      CONSEQUENCE is pinned: the takeover (§2) and the merge (§3) both resolve under the
      launch context's base path and never under `process.cwd()`, and that resolution is
      identity-determined, not cwd-determined (§4). A construction-count assertion would
      require reading source and is deliberately not attempted.
    • The webhook per-event boundary context (PRD story 12) is OUT of scope for this
      slice and owned by a later issue; no scenario here drives the webhook.
    • The GitContext package internals — base-path resolution, incomplete-identity
      failure, `worktreePathFor` layout — are owned by #658 and proven in
      `feature-658.feature`; this slice consumes that authority and does not re-pin it.
    • Per-command auth/env injection and token-bleed isolation (PRD story 7) are not in
      this slice's story set (3, 9, 10, 11) and are not pinned here.
    • Identity persistence as a cross-check (PRD stories 13, 14) is not in this slice's
      story set and is not pinned here.
    • The CI/lint guard banning raw `git`/`gh` (PRD story 8, AC) ships as a build rule
      the PRD explicitly does NOT unit-test; it is not asserted behaviourally.
    • The @regression maintenance sweep is SKIPPED for this issue: `.adw/scenarios.md`
      configures a `## Regression Scenario Directory`, so promotion is a deliberate
      human decision and the agent never auto-promotes.

  Background:
    Given the ADW codebase is checked out

  # ═══════════════════ §1  BOUNDARY CONSTRUCTION — launch identity decides the context ═══
  #
  # AC1 / AC5; stories 9, 10. The single context is built at the launch boundary from the
  # parsed `--target-repo` arguments, falling back to the local git remote for self-host.
  # Observable output: the resolved base path, the self-host/target discriminator, and the
  # owner/repo the context targets — all return values of the boundary constructor.

  # ── §1a  --target-repo → a TARGET context at the target-repos workspace (AC5, target half) ──
  #
  # A launch carrying `--target-repo owner/repo` builds a TARGET context whose base path
  # is the target-repos workspace for that owner/repo (join(root, owner, repo)). Two
  # distinct arguments under the same injected root resolve to two distinct base paths,
  # pinning that the decision is per-launch-identity, not ambient.

  @adw-660 @adw-k2tkdn-gitcontext-boundary
  Scenario Outline: A boundary context built from --target-repo resolves to the target workspace
    Given a launch boundary with framework root "/srv/adw/framework" and target-repos root "/srv/adw/repos"
    And a boundary GitContext is constructed from launch arguments "--target-repo <owner>/<repo>"
    Then the boundary context is a target context
    And the boundary context base path is "<basePath>"
    And the boundary context targets owner "<owner>" repo "<repo>"

    Examples:
      | owner     | repo        | basePath                            |
      | acme      | webapp      | /srv/adw/repos/acme/webapp          |
      | octo      | hello-world | /srv/adw/repos/octo/hello-world     |

  # ── §1b  No --target-repo → a SELF-HOST context at the framework repo root (AC5, self-host half) ──
  #
  # A launch with no `--target-repo` falls back to the local git remote for its identity
  # and resolves its base path to the injected framework repo root — so dogfooding
  # continues unchanged. The owner/repo come from the local remote, never from the args
  # (which carry none), and the base path is the framework root, never the target
  # workspace.

  @adw-660 @adw-k2tkdn-gitcontext-boundary
  Scenario: A boundary context built without --target-repo resolves to the framework repo root via the local git remote
    Given a launch boundary with framework root "/srv/adw/framework" and target-repos root "/srv/adw/repos"
    And the local git remote resolves to owner "paysdoc" repo "AI_Dev_Workflow"
    And a boundary GitContext is constructed with no target-repo argument
    Then the boundary context is a self-host context
    And the boundary context base path is "/srv/adw/framework"
    And the boundary context targets owner "paysdoc" repo "AI_Dev_Workflow"

  # ═══════════════════ §2  TAKEOVER / CRON acts on the abandoned workflow under its launch identity ═══
  #
  # AC4; stories 3, 10 — the spawnSync ENOENT incident (vestmatic #187). The takeover/cron
  # process resolves an abandoned workflow's worktree under ITS OWN launch context's base
  # path, never the framework working directory it happens to run from. Observable output:
  # the resolved worktree path.

  # ── §2a  The takeover resolves the abandoned worktree under the target workspace ──────

  @adw-660 @adw-k2tkdn-gitcontext-boundary
  Scenario: A cron takeover resolves an abandoned workflow's worktree under its launch target workspace
    Given a launch boundary with framework root "/srv/adw/framework" and target-repos root "/srv/adw/repos"
    And a boundary GitContext is constructed from launch arguments "--target-repo vestmatic/vestmatic"
    And an abandoned workflow on branch "feature-issue-187-x" awaits takeover
    When the takeover resolves the abandoned workflow's worktree
    Then the resolved worktree path is "/srv/adw/repos/vestmatic/vestmatic/.worktrees/feature-issue-187-x"

  # ── §2b  The takeover never resolves under the framework working directory (incident pin) ──
  #
  # The headline regression guard for the takeover path: even though the cron process's own
  # working directory is the framework repo, the abandoned workflow's worktree resolves
  # under the launch target identity — not `process.cwd()`. The legacy
  # `targetRepo ? ... : process.cwd()` derivation would have computed it under the
  # framework repo and detonated with `spawnSync ... ENOENT`.

  @adw-660 @adw-k2tkdn-gitcontext-boundary
  Scenario: A cron takeover does not resolve an abandoned workflow's worktree under the framework working directory
    Given a launch boundary with framework root "/srv/adw/framework" and target-repos root "/srv/adw/repos"
    And a boundary GitContext is constructed from launch arguments "--target-repo vestmatic/vestmatic"
    And an abandoned workflow on branch "feature-issue-187-x" awaits takeover
    When the takeover resolves the abandoned workflow's worktree
    Then the resolved worktree path is not under the cron process working directory

  # ═══════════════════ §3  adwMerge resolves and merges against the context's repository ═══
  #
  # AC3; story 11. The migrated merge orchestrator sources both its `gh` target repo and
  # its filesystem base path from the launch context, so the PR is looked up and merged
  # against the right repository and the merge worktree is resolved under the context's
  # base path — never `process.cwd()`. Observable output: the repoInfo and base path the
  # merge hands to its recording dependencies.

  # ── §3a  A target-context merge resolves and merges against the target repository ─────

  @adw-660 @adw-k2tkdn-gitcontext-boundary
  Scenario: The merge orchestrator resolves and merges against the launch context's target repository
    Given a launch boundary with framework root "/srv/adw/framework" and target-repos root "/srv/adw/repos"
    And a boundary GitContext is constructed from launch arguments "--target-repo acme/webapp"
    And a workflow for adwId "merge-adw-1" on branch "feature-issue-42-abc" is awaiting the merge handoff with an open pull request
    When the merge orchestrator runs under the boundary context for issue 42 and adwId "merge-adw-1"
    Then the merge resolves the pull request against the repository "acme/webapp"
    And the merge resolves the worktree under the base path "/srv/adw/repos/acme/webapp"
    And the merge does not resolve the worktree under the cron process working directory

  # ── §3b  A self-host merge resolves under the framework root, not the ambient cwd ─────
  #
  # The self-host half of the migration kills the literal `: process.cwd()` fallback: a
  # merge launched with no `--target-repo` resolves and merges against the framework repo
  # (from the local git remote) and resolves its worktree under the INJECTED framework
  # root, not whatever directory the process happens to be running in.

  @adw-660 @adw-k2tkdn-gitcontext-boundary
  Scenario: The merge orchestrator under a self-host context resolves under the framework repo root rather than the ambient working directory
    Given a launch boundary with framework root "/srv/adw/framework" and target-repos root "/srv/adw/repos"
    And the local git remote resolves to owner "paysdoc" repo "AI_Dev_Workflow"
    And a boundary GitContext is constructed with no target-repo argument
    And a workflow for adwId "merge-adw-2" on branch "feature-issue-77-xyz" is awaiting the merge handoff with an open pull request
    When the merge orchestrator runs under the boundary context for issue 77 and adwId "merge-adw-2"
    Then the merge resolves the pull request against the repository "paysdoc/AI_Dev_Workflow"
    And the merge resolves the worktree under the base path "/srv/adw/framework"
    And the merge does not resolve the worktree under the cron process working directory

  # ═══════════════════ §4  ONE launch context threaded down — identity-determined, not cwd-determined ═══
  #
  # AC2; story 9. The launch context is threaded from the entry point downward; downstream
  # resolution is a function of the context's identity ALONE, so changing the process
  # working directory between two resolutions through the SAME threaded context leaves the
  # result identical. This is the general proof that nothing downstream re-derives from
  # ambient cwd.

  @adw-660 @adw-k2tkdn-gitcontext-boundary
  Scenario: A worktree resolved through the threaded launch context does not change with the process working directory
    Given a launch boundary with framework root "/srv/adw/framework" and target-repos root "/srv/adw/repos"
    And a boundary GitContext is constructed from launch arguments "--target-repo acme/webapp"
    When the worktree for branch "feature-x" is resolved through the boundary context from two different working directories
    Then both resolutions through the boundary context return "/srv/adw/repos/acme/webapp/.worktrees/feature-x"

  # ═══════════════════ §5  TYPE-CHECK BACKSTOP (registry T22) ═══════════════════════════
  #
  # Consistent with the sibling per-issue features (feature-658 §7, feature-565 §4): the
  # boundary-constructor wiring and the migrated `adwMerge` / cron repo resolution compile
  # within the ADW codebase's type-check.

  @adw-660 @adw-k2tkdn-gitcontext-boundary
  Scenario: The ADW TypeScript type-check passes with the boundary constructor wired into cron and adwMerge
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
