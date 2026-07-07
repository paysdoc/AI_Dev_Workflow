@adw-729 @adw-5o6zmy-bug-adwupgrade-regen
Feature: adwUpgrade regen commit is ignore-safe when an excluded path is also gitignored

  Issue #729 fixes a crash in the framework self-upgrade lane. When `adwUpgrade`
  commits the regenerated `.adw/`, it excludes the runtime-copied command file
  `.claude/commands/adw_init.md` (the scoped-commit mechanism added by #685 §D).
  But `copyAdwInitCommandToWorktree` (`adws/phases/worktreeSetup.ts`) ALSO gitignores
  that same path in the upgrade worktree — so the path is doubly excluded: once by
  `.gitignore`, once by the `:(exclude)` pathspec `commitChanges` builds.

  Naming a gitignored path in an explicit pathspec promotes `git add -A` to an
  explicit-pathspec add, and git then rejects the ignored path with exit 1:

      git add -A -- '.' ':(exclude).claude/commands/adw_init.md'
      The following paths are ignored by one of your .gitignore files:
      .claude/commands/adw_init.md

  This crash is uncaught and strands the upgrade (vestmatic #200 on 2026-06-24;
  adwId `72nhdz` on 2026-07-07 — a recurrence, because the 2026-06-24 fix was left
  uncommitted and evaporated). The `git status --porcelain` probe at the top of
  `commitChanges` uses the SAME pathspec but silently omits the ignored path, so the
  status check passes and the failure surfaces only at the `git add` line.

  THE FIX (`adws/gitContext/commitOps.ts`): before building the exclude pathspec,
  filter out any `excludePaths` entry that is already gitignored in `cwd` (probe with
  `git check-ignore`; when it reports the path ignored, drop it — `git add -A` skips
  ignored files anyway). Where the excluded path is TRACKED (the self-host case, where
  `adw_init.md` is a committed file), it is not ignored, so the exclude survives and
  still does real work. The mechanism is kept; only the double-exclusion crash is removed.

  Observability / rot-prevention note:

    Both scenarios below assert against a GIT ARTEFACT produced by the system under
    test — the tree of the commit that `commitChanges` records over a REAL temporary
    git repository (registry observability surface #3). No step reads
    `adws/gitContext/commitOps.ts`, `adws/phases/worktreeSetup.ts`, or `adws/adwUpgrade.tsx`
    as text, substring-matches its contents, or parses it as JSON/AST. In particular the
    scenarios do NOT assert the exact `git add` pathspec string the implementer emits, nor
    file-on-disk existence — they assert WHICH paths land in the recorded commit and
    whether the commit is recorded at all. Per the issue's Tests §2 and the Rot-Detection
    Rubric, the assertion target is the produced commit's tree, not a source file. The
    path strings in the steps (`.claude/commands/adw_init.md`, `.adw/project.md`) are the
    exact values `adwUpgrade.tsx` reads/writes — INPUT/OUTPUT test data naming a documented
    production value, the artefact category the Rubric permits, exactly as #685 §D pinned
    the committed file set.

    • §1 drives the REAL `copyAdwInitCommandToWorktree` to gitignore
      `.claude/commands/adw_init.md` in a temp worktree, then drives the REAL
      `GitContext.commitChanges` with the exact production `excludePaths` and asserts the
      recorded commit's tree (`git show --name-only HEAD`). The copied `adw_init.md`, the
      seeded `.adw/project.md`, and the `.gitignore` the helper writes are INPUT/artefact
      fixtures the step constructs under the test tmp dir — the worktree-fixture category
      the Rubric permits — NOT source files of this repo.
    • §2 drives the same `commitChanges` over a worktree where the excluded path is a
      TRACKED, modified file (never gitignored) and asserts the same surface.

  Relationship to #685 §D (the mechanism this fix hardens):

    • #685 §D introduced `excludePaths` / the `:(exclude)` pathspec and pinned three
      cases: a tracked-modified exclude is held out (§D1), no-opts is byte-identical to
      `git add -A` (§D2), and an UNTRACKED-BUT-NOT-IGNORED exclude is a harmless no-op
      (§D3). #685 §D3 is the gap: it exercised an untracked path that was NOT gitignored,
      so it never tripped the "paths are ignored" rejection. #729 §1 closes exactly that
      gap — an untracked path that IS gitignored (the real upgrade-worktree state).
    • #729 §2 re-pins #685 §D1's tracked-exclude-still-works behaviour under the new
      ignore-safe filter, as a guard against an over-correcting fix that unconditionally
      drops every exclude (which would let `adw_init.md` back into the self-host commit).
      #685 §D1's own scenario remains owned by #685 and is not edited here.

  Scope notes:

    • §1 is the RED driver: before the fix `commitChanges` THROWS at the `git add` line,
      so no commit is recorded and "the regen commit is recorded on the worktree branch"
      fails. After the fix it is GREEN. §2 is a regression GUARD that is GREEN both before
      and after the fix (the tracked/self-host path never crashed); it fails only if the
      fix neuters the exclude mechanism.
    • This feature pins the BEHAVIOURAL surface (the recorded commit's tree). The unit
      test called for by the issue's Tests §1 — that the emitted `git add` command OMITS
      the `:(exclude)` token for an ignored path and RETAINS it otherwise — is an
      implementation-level assertion on the command string and is owned by the build
      agent under `adws/gitContext/__tests__/`, not by a scenario here (asserting the
      pathspec string would couple the scenario to the implementation, exactly as #685 §D
      declined to do).
    • The @regression maintenance sweep is SKIPPED for this issue: `.adw/scenarios.md`
      configures a `## Regression Scenario Directory`, so promotion to `@regression`
      (and registration of these phrases in `features/regression/vocabulary.md`) is a
      deliberate human decision and the agent never auto-promotes. The issue's Tests §2
      requests a `@regression` scenario + vocabulary registration; that promotion request
      is surfaced to the maintainer in the agent Output rather than self-applied here.

  Vocabulary note:

    Registered phrase reused (`features/regression/vocabulary.md`):
      G18 `the ADW codebase is checked out`  (Background no-op)

    Novel phrasing introduced here — the registry has no phrase for a gitignored-exclude
    regen commit or a commit-tree assertion (the #685 §D commit phrases are bound to
    #685's own step-def module state, so reusing them would cross-wire state under the
    globally-loaded step defs, and re-declaring them would be a duplicate-step-definition
    error). All novel phrasing is surfaced to the maintainer in the agent Output:
      • `an upgrade regen worktree whose command file ".claude/commands/adw_init.md" is gitignored by the real copy-init-command step`
      • `an upgrade regen worktree with a tracked, modified ".claude/commands/adw_init.md" that is not gitignored`
      • `the worktree has a pending regen change to {string}`
      • `the framework upgrade commits the regen excluding {string}`
      • `the regen commit is recorded on the worktree branch`
      • `the recorded commit's tree includes {string}`
      • `the recorded commit's tree excludes {string}`

    Step-definition note for the maintainer (feature-729.steps.ts, module-scoped state;
    do NOT re-declare #685 §D's commit phrases):
      • Both Givens init a REAL temp git repo under the test tmp dir (mirroring
        feature-685 §D's `initGitRepo` / `execSync` helpers), create and COMMIT a baseline
        `.adw/project.md`, then leave a pending modification to it (the "pending regen
        change").
      • §1's Given additionally calls the REAL
        `copyAdwInitCommandToWorktree(worktreePath, frameworkRepoRoot)` from
        `adws/phases/worktreeSetup.ts`, with `frameworkRepoRoot` set to the ADW repo root
        (the checkout — it holds the real `.claude/commands/adw_init.md` used purely as
        COPY INPUT). That call copies `adw_init.md` into the worktree (untracked) AND
        writes the `.gitignore` entries — leaving the path untracked-AND-gitignored, the
        production double-exclusion state.
      • §2's Given instead creates, COMMITS, and then modifies `.claude/commands/adw_init.md`
        as a tracked file, and writes NO `.gitignore` entry for it.
      • The When drives the REAL `GitContext.commitChanges(message, worktreePath,
        { excludePaths: [<path>] })` (construct `new GitContext(opts)` with the default
        real exec so it shells out to git in the temp worktree; equivalently drive
        `commitOps.commitChanges(realRun, ...)` as feature-685 §D did). Wrap the call in
        try/catch and record any thrown error plus the pre-call HEAD.
      • `the regen commit is recorded on the worktree branch` asserts the When did NOT
        throw AND HEAD advanced past the baseline (a new commit exists). This is the
        RED/GREEN pivot for §1.
      • `the recorded commit's tree includes/excludes {string}` asserts membership in
        `git show --name-only --format= HEAD` (the same git-artefact read feature-685 §D
        used). Guard the assertion so a §1 RED throw yields a clear failure rather than an
        assertion against a stale HEAD.

  Background:
    Given the ADW codebase is checked out

  # ════════════════════════════════════════════════════════════════════════════════
  # §1 The fix: a gitignored excluded path no longer crashes the regen commit (RED→GREEN)
  # ════════════════════════════════════════════════════════════════════════════════
  #
  # The production double-exclusion. The real `copyAdwInitCommandToWorktree` has already
  # gitignored `.claude/commands/adw_init.md` in the upgrade worktree; `commitChanges` is
  # then asked to exclude that same path. Before the fix, `git add -A -- '.' ':(exclude)…'`
  # rejects the ignored path with exit 1 and the upgrade crashes uncaught — so no commit is
  # recorded. After the ignore-safe filter drops the already-ignored path, the commit is
  # recorded: the genuine `.adw/` regen change lands and the gitignored command file stays
  # out of the tree (as `git add -A` would skip it anyway).

  @adw-729 @adw-5o6zmy-bug-adwupgrade-regen
  Scenario: A regen commit whose excluded command file is gitignored is recorded and carries the genuine .adw/ change
    Given an upgrade regen worktree whose command file ".claude/commands/adw_init.md" is gitignored by the real copy-init-command step
    And the worktree has a pending regen change to ".adw/project.md"
    When the framework upgrade commits the regen excluding ".claude/commands/adw_init.md"
    Then the regen commit is recorded on the worktree branch
    And the recorded commit's tree includes ".adw/project.md"
    And the recorded commit's tree excludes ".claude/commands/adw_init.md"

  # ════════════════════════════════════════════════════════════════════════════════
  # §2 Guard: a tracked, non-ignored excluded path is still held out (mechanism preserved)
  # ════════════════════════════════════════════════════════════════════════════════
  #
  # The self-host case, and the anti-over-correction guard. Where `adw_init.md` is a
  # TRACKED, modified file (never gitignored), `git check-ignore` reports nothing ignored,
  # so the exclude survives and still does real work: the regen change commits while the
  # tracked command file is held out of the tree. Green before AND after the fix — it fails
  # only if the ignore-safe filter wrongly drops a non-ignored exclude and lets the command
  # file back into the commit (the #685 §D1 behaviour, re-pinned under the new filter).

  @adw-729 @adw-5o6zmy-bug-adwupgrade-regen
  Scenario: A regen commit still holds out a tracked, non-ignored command file via the exclude
    Given an upgrade regen worktree with a tracked, modified ".claude/commands/adw_init.md" that is not gitignored
    And the worktree has a pending regen change to ".adw/project.md"
    When the framework upgrade commits the regen excluding ".claude/commands/adw_init.md"
    Then the regen commit is recorded on the worktree branch
    And the recorded commit's tree includes ".adw/project.md"
    And the recorded commit's tree excludes ".claude/commands/adw_init.md"
