@adw-694 @adw-alilj4-gitcontext-migrate-p
Feature: GitContext phase-level git-read migration — the residual phase-boundary git reads (ls-files / rev-parse --short HEAD / diff / log) route through the per-command-auth chokepoint, and the git/gh guard no longer exempts their five consumers

  Issue #694 (parent PRD `specs/prd/git-context-repo-authority.md`, see the
  **Enforcement** section and user stories 5 and 8) is the slice that drives the
  git/gh guard ALLOWLIST toward zero for the PHASE-LEVEL git-READ surface — the
  last raw `git` reads run at phase boundaries that answer "what does this worktree
  contain right now": `git ls-files "<prefix>"` (which framework assets are already
  tracked), `git rev-parse --short HEAD` (the ADW version stamp), `git diff
  <defaultBranch>...HEAD` (the branch diff the regression verdict is built on), and
  `git log "<branch>" --format=… --no-merges` (the last-ADW-commit timestamp). Five
  residual consumers still shell these out to raw `git` and sit on the guard
  ALLOWLIST; this slice adds four read methods to `GitContext` and routes the
  consumers through them, then removes the five files from the ratchet.

  Earlier slices established the machinery this one consumes:

    • #658 shipped the `GitContext` deep module — mandatory identity, the
      one-constructor base-path decision, `worktreePathFor(branch)`, and the
      `commandEnv()` per-command env overlay carrying the token + git
      author/committer.
    • #659 routed a representative READ op (default-branch) through the private
      `#run` chokepoint, proving the spawn path end to end: a command launches with
      cwd = base path (or an explicitly supplied cwd) and a child env carrying the
      token, the parent global untouched. It also registered the recording-runner
      machinery (`makeSpyExec`, the shared `W`, the token/author/cwd assertions) that
      every later GitContext per-issue slice reuses.
    • #663 migrated the full gh-OPERATION surface (issue/PR/comment/label/board).
    • #691 migrated the residual gh-READ consumers and added the parameterised
      open-issue list read, and registered the guard step definitions
      (`the git/gh guard scans the file …`, the whole-repo run) this slice reuses.
    • #692 migrated the IDENTITY reads (`git remote get-url origin`, `gh api user`).
    • #693 migrated the worktree/branch PROBE reads (`git rev-parse --git-dir`,
      `git symbolic-ref --short HEAD`, `git worktree list --porcelain`, `git branch
      --list`/`-D`, `git status --porcelain`) and de-allowlisted their five
      worktree-domain consumers, driving the same `checkGitGhGuard.ts` ALLOWLIST this
      slice shrinks further and extending the same `gitContext.ts` surface this slice
      grows. It also registered the supplied-worktree-path cwd assertion this slice
      reuses verbatim.

  Why this slice is **Blocked by #693**:

    #694 and #693 drive the SAME two files — the `checkGitGhGuard.ts` ALLOWLIST (each
    removes entries) and the `gitContext.ts` method surface (each adds read methods).
    Sequencing #694 after #693 keeps the ratchet monotonic and avoids a collision on
    those two shared edit sites; #694 builds on the already-reduced ALLOWLIST #693 left
    and adds its four read methods beside the probe methods #693 added.

  What this slice builds:

    • Four NEW phase-level git-read methods on `GitContext`, each going through the
      existing `#run` chokepoint, covering the command shapes the five consumers need
      (the issue names them `lsFiles` / `headShort` / `diff` / `log`):
        – `lsFiles` — the tracked-file list (`git ls-files "<prefix>"`) the worktree
          setup needs to decide which copied `.claude` assets are already committed,
          and the unprefixed `git ls-files` the living-docs index gate needs to list
          the whole tracked tree (story 5),
        – `headShort` — the short-HEAD read (`git rev-parse --short HEAD`) the workflow
          init writes into its ADW version log line (story 5),
        – `diff` — the branch diff (`git diff <defaultBranch>...HEAD`) the diff
          evaluation phase feeds to the regression evaluator (story 5),
        – `log` — the commit-history read (`git log "<branch>" --format=… --no-merges`)
          the PR-comment detector scans for the last ADW commit timestamp (story 5).
      Unlike #693 (which reused several pre-existing context methods), ALL FOUR shapes
      here are genuinely NEW methods — the context has no `lsFiles`/`headShort`/`diff`/
      `log` today. The exact method signatures (whether `lsFiles` takes a prefix and an
      optional cwd, whether `diff` takes the default-branch ref as an argument, etc.)
      are an implementer's choice (see Scope notes); the scenarios pin the OBSERVABLE
      migration — token, identity, and cwd on the recorded command — not the signature.
    • The five residual consumers — `worktreeSetup`, `workflowInit`,
      `diffEvaluationPhase`, `prCommentDetector`, `checkLivingDocsIndex` — stop shelling
      out to raw `git` and route through the context instead. With their last raw `git`
      call gone, each is REMOVED from the guard ALLOWLIST in `adws/checkGitGhGuard.ts`,
      so the guard scans them like any other file. (`checkLivingDocsIndex` sat in the
      ALLOWLIST's *diagnostic* category rather than the *residual* one; this slice
      migrates it all the same, so the diagnostic exemption shrinks too.)

  One consumer carries a DUAL raw call site — the all-or-nothing-per-file trap:

    The guard is ALL-OR-NOTHING per file: a file removed from the ALLOWLIST is clean
    ONLY when EVERY raw `git`/`gh` call in it is gone. `worktreeSetup` shells `git
    ls-files` from TWO distinct helpers (its tracked-basenames lookup AND its
    tracked-top-dirs lookup); BOTH call sites must route onto the `lsFiles` method
    before the file can leave the ALLOWLIST clean. This is the same trap #693's
    `branchOperations` and `branchIdentityFallback` set; here it is enforced the same
    way — only through §2's guard-clean assertion over the whole of `worktreeSetup`,
    never by re-pinning each individual call in §1.

  Why this slice exists — the defect it forecloses:

    A phase that shells out to raw `git diff <defaultBranch>...HEAD` for its regression
    verdict runs under whatever cwd it happens to inherit and authenticates against
    whatever repo last wrote the process-global `GH_TOKEN`. The diff evaluation phase's
    whole job is to diff the SPECIFIC worktree the orchestrator hands it (`config.
    worktreePath`) and decide `safe` versus `regression_possible`; a read that drifts to
    the ambient process cwd diffs the WRONG repository — the ADW framework checkout, say,
    instead of the target worktree — and the auto-merge safety decision built on it is
    wrong, the precise wrong-base-repo shape the PRD mined ~13 times, now on the
    merge-safety path. The same drift turns `worktreeSetup`'s `ls-files` into the wrong
    tracked-file set (wrong gitignore policy for copied assets) and `prCommentDetector`'s
    `git log` into the wrong branch's history. While such a consumer sits on the
    ALLOWLIST, the guard also cannot catch a NEW raw `git`/`gh` call sneaking in beside
    it. Routing the reads through `#run` binds each command's auth + cwd to the call (the
    SUPPLIED worktree path, never the ambient cwd; no shared global to clobber), and
    de-allowlisting the file re-arms the guard so any future raw call in it is a build
    failure, not a silent regression. Behaviour is unchanged; only token/cwd APPLICATION
    (per-command + supplied-cwd vs process-global/ambient) and guard COVERAGE change.

  Contract pinned here (the OBSERVABLE behaviour, not the field/signature shape):

    • read goes through #run    → each git-read method spawns its command with a child
                                  env carrying the context's token + git author/
                                  committer, and an EXPLICIT cwd — the context base path
                                  when none is supplied, or the SUPPLIED worktree path
                                  when the consumer hands it one (§1; story 5).
    • supplied worktree honoured → a branch diff run against a given worktree path spawns
                                  its command with cwd = exactly that path, never the
                                  context base path and never the ambient process cwd —
                                  the read whose drift to the ambient cwd would make the
                                  merge-safety verdict diff the wrong repository
                                  (§1a; story 5).
    • per-command auth           → running a git-read leaves the parent process
                                  environment byte-for-byte unchanged — no reintroduced
                                  global mutation on the last phase-level read path
                                  (§1c; story 5).
    • consumer de-allowlisted    → the guard, run against each of the five migrated
                                  consumer files, SCANS the file (it is no longer
                                  exempt) and finds NO direct git/gh shell-out in it
                                  (§2; story 8).
    • guard still passes          → with the five files removed from the ALLOWLIST, the
                                  guard run across the whole repository reports zero
                                  violations — the de-allowlisting introduced no new
                                  violation, including `worktreeSetup`'s dual ls-files
                                  call sites; the ratchet simply sits lower (§3; story 8).

  Observability / rot-prevention note:

    Every assertion below targets a runtime OUTPUT of the system under test, never the
    static text of a source file. No step opens `worktreeSetup.ts`, `workflowInit.ts`,
    `diffEvaluationPhase.ts`, `prCommentDetector.ts`, `checkLivingDocsIndex.ts`,
    `checkGitGhGuard.ts`, or the GitContext package as text, substring-matches its
    contents, or parses it as JSON/AST.

      • §1 runs each git-read method through a RECORDING RUNNER injected as the
        context's command boundary (the `GitContextDeps.exec` seam #659 established —
        the same recorder category as the registered `git-mock`/`mock server`
        collaborators in `vocabulary.md`) and asserts the RECORDED `cwd` and child
        `env` the context handed that runner. The recorded `(cwd, env)` is the
        command's actual launch parameters — a runtime artefact, not a source read.
        The "parent env unchanged" step compares the LIVE `process.env` before and
        after the read; `process.env` is live runtime state, the canonical observable
        for "was the global mutated," which the Rot-Detection Rubric permits.
      • §2 and §3 assert the GUARD'S VERDICT, where the guard tool IS the system under
        test. The guard's exported `scanFiles` returns a `{ violations, scannedCount }`
        result — a value computed at runtime, the guard's OUTPUT — and the steps assert
        that result. This is the SAME artefact category as registry T22 ("the ADW
        TypeScript type-check passes"), which runs `tsc` over the whole source tree and
        asserts its verdict: the analyzer reads source, but the SCENARIO asserts the
        analyzer's OUTPUT, never source text. Critically, "removed from the ALLOWLIST"
        is NOT asserted by grepping `checkGitGhGuard.ts` for the path — it is proven
        only through its OBSERVABLE CONSEQUENCE: the guard now SCANS the file (its
        `scannedCount` counts it; an allowlisted file is skipped and never counted), and
        finds it violation-free. A refactor that renames a consumer or restructures the
        guard leaves these assertions valid as long as the BEHAVIOUR holds — the file is
        scanned and clean.

    The file paths, owners/repos, tokens, authors, worktree paths, branches, and op
    names in the steps are INPUT test data; the recorded `(cwd, env)`, the live
    `process.env`, the guard's `{ violations, scannedCount }`, and the type-check exit
    code are the system's OUTPUTS — exactly the artefact category the rubric permits.
    The recording runner means no real `git` is spawned and no network or filesystem
    worktree is touched in §1, so those scenarios are hermetic.

  Scope notes:

    • This slice pins TWO observable contracts: (a) the four git-read methods route
      their spawn through the per-command-auth `#run` chokepoint with the correct cwd
      (base path when none is supplied, the supplied worktree path otherwise) (§1), and
      (b) the five consumer files are now scanned by the guard and are violation-free
      (§2), with the whole-repo guard still passing (§3). Together these prove the
      phase-level git reads moved off raw `git` and onto the context: the consumers
      contain no raw `git`/`gh` (guard-clean, §2) and the context's methods that replace
      them carry per-command auth and the right cwd (§1).
    • The exact threading of a `GitContext` into each consumer (constructor param,
      function arg, or an injected dep's default) is an implementer's choice and is
      deliberately NOT pinned, consistent with the sibling slices' "pin the decision,
      not the shape" stance (#658/#659/#663/#691/#692/#693). `checkLivingDocsIndex` is a
      standalone diagnostic script with a top-level `run()`; how it obtains a context
      (a launch-boundary build, an injected dep) is likewise the implementer's choice —
      the scenario pins only that the file ends up guard-clean.
    • All four command shapes become NEW methods (`lsFiles`/`headShort`/`diff`/`log`);
      none reuse a pre-existing context method. The friendly op names in §1 map to those
      methods inside the step definitions — exactly as #693's `resolve-git-dir`/
      `worktree-list` mapped to its probe methods. `lsFiles` is shared by two consumers
      with DIFFERENT cwd semantics (`worktreeSetup`, which hands it a worktree path, and
      `checkLivingDocsIndex`, which reads at the base path); the method's optional-cwd
      shape (base path when none supplied) carries both, and §1 exercises both forms.
    • `worktreeSetup`'s TWO `git ls-files` call sites both migrate onto the `lsFiles`
      method; that completeness is enforced here ONLY by §2's guard-clean assertion over
      the whole of `worktreeSetup` (a file removed from the ALLOWLIST is clean only when
      EVERY raw git call in it is gone), not re-pinned as separate §1 proofs.
    • Parent-global isolation and two-context isolation for the `#run` spawn path are
      already proven exhaustively by #659 and #663; the git-read methods route through
      the SAME chokepoint, so this slice re-pins only ONE representative
      parent-env-unchanged check (§1c) — an anti-regression that the LAST phase-level
      readers do not reintroduce a global mutation — and does not restate the full
      isolation matrix.
    • Auth ACQUISITION is unchanged: token minting/refresh is untouched; only token
      APPLICATION (per-command vs process-global) changes. No scenario here drives the
      minting path, an orchestrator, or the cron poller as a subprocess.
    • Behaviour of the consumers themselves (the gitignore policy in `worktreeSetup`, the
      version-log line in `workflowInit`, the `safe`/`regression_possible` verdict and
      fail-safe in `diffEvaluationPhase`, the last-ADW-commit detection in
      `prCommentDetector`, the bijection/overlap checks in `checkLivingDocsIndex`) is
      unchanged and already covered by their existing unit suites; this slice adds
      coverage for the read-path migration and the guard de-allowlisting, it does not
      relax those suites.
    • The @regression maintenance sweep is SKIPPED for this issue: `.adw/scenarios.md`
      configures a `## Regression Scenario Directory`, so promotion is a deliberate
      human decision and the agent never auto-promotes.

  Vocabulary note:

    Registered phrases reused (`features/regression/vocabulary.md`):
      G18 `the ADW codebase is checked out`              (background + §2/§3 + type-check)
      T22 `the ADW TypeScript type-check passes`          (backstop, via feature-504.steps.ts)

    Phrases reused VERBATIM from the GitContext per-issue corpus (established by
    feature-659, globally registered via `gitContextSharedWorld.ts` / feature-659.steps.ts,
    NOT yet in the registry) so the §1 step definitions share #659's recording-runner and
    parent-env machinery — generate_step_definitions must NOT redefine them, or Cucumber
    raises a duplicate step definition:
      • `a GitContext for owner {string} repo {string} with auth token {string} and git author {string}`
      • `the context's git and gh commands are captured by a recording runner`
      • `a baseline snapshot of the parent process environment is captured`
      • `the captured command ran with auth token {string} in its child environment`
      • `the captured command ran with git author {string} in its child environment`
      • `the captured command ran with cwd equal to the context base path`
      • `the parent process environment matches the baseline snapshot`

    Phrase reused VERBATIM from feature-693.steps.ts (the supplied-worktree-path cwd
    assertion #693 introduced and globally registered — generate_step_definitions must
    NOT redefine it):
      • `the captured command ran with cwd equal to the supplied worktree path {string}`

    Guard phrases reused VERBATIM from feature-691.steps.ts (globally registered there —
    generate_step_definitions must NOT redefine them):
      • `the git/gh guard scans the file {string}`
      • `the git/gh guard scanned that file`
      • `the git/gh guard reports no violation in that file`
      • `the git/gh guard is run across the repository`
      • `the git/gh guard reports no violations`

    Novel phrasing introduced here — the registry has no phrase for running a
    PHASE-LEVEL git-READ method through the context. Phrased DISTINCTLY from #659's
    `read operation`, #663's `gh operation`, #691's `gh-read operation`, #692's
    `identity-read operation`, and #693's `vcs-probe operation` (this uses `git-read
    operation`) so the step files do not collide as Cucumber loads them all globally.
    The umbrella `git-read` spans the tracked-file list (`ls-files`), the short-HEAD
    stamp (`rev-parse --short HEAD`), the branch diff (`diff`), and the commit history
    (`log`) — one label per slice, matching the issue's "phase-level git reads" framing;
    no `/` is used in any step phrase (Cucumber treats `/` as alternation).
    Surfaced to the maintainer in the agent Output:
      Running a phase-level git-read method through the context:
        • `the {string} git-read operation runs through the context`
        • `the {string} git-read operation runs through the context for worktree path {string}`

    Step-definition note for the maintainer:
      • §1 steps phase-import `GitContext` and REUSE the shared `gitContextSharedWorld.ts`
        machinery (`makeFullOptions`, `makeSpyExec`, `makeNoOpFsDeps`, the shared `W`)
        exactly as `feature-691.steps.ts` / `feature-692.steps.ts` / `feature-693.steps.ts`
        do, so #659's globally-registered assertion steps apply to the recorded calls
        without redefinition.
      • `the {string} git-read operation runs through the context` adds a NEW dispatcher
        (parallel to #693's `vcs-probe operation` switch) over the four new read methods,
        invoked WITHOUT a worktree path so each defaults to the context base path:
          "ls-files"   → the new tracked-file list (`git ls-files`) — seed `W.responseMap`
                         for `ls-files` with a parseable newline-delimited path list
          "head-short" → the new short-HEAD read (`git rev-parse --short HEAD`) — seed a
                         short hash so the method returns without throwing
          "diff"       → the new branch diff (`git diff <ref>...HEAD`) — this method needs
                         a worktree path, so pass `W.ctx.basePath` (and a default-branch
                         ref, e.g. "main") to keep the base-path-cwd assertion valid; seed
                         a small unified-diff string
          "log"        → the new commit-history read (`git log "<branch>" …`) — pass a
                         branch (e.g. "feature-issue-1-demo"); seed a parseable `%aI %s`
                         line so the timestamp parse completes
        Construct the context via `makeFullOptions(owner, repo, token, authorName,
        authorEmail)` + `new GitContext(opts, { exec: makeSpyExec(W.responseMap).exec,
        fsDeps: makeNoOpFsDeps() })`, store it on `W.ctx` and the recorder's `calls` on
        `W.spyCalls` (the recording-runner Given already does this). No real subprocess,
        no network, no fs — the token/author/cwd assertions are value-based comparisons
        against the recorded child `env`/`cwd`.
      • `the {string} git-read operation runs through the context for worktree path
        {string}` is the same dispatcher but threads the supplied path as the method's
        `worktreePath`/`cwd` argument (for "diff", as the worktree the diff runs in), so
        the recorded `cwd` is that path. The assertion resolves to feature-693.steps.ts's
        `the captured command ran with cwd equal to the supplied worktree path {string}`.
      • The guard steps (§2/§3) require NO new definitions — they resolve to
        feature-691.steps.ts (`scanFiles`). The type-check step (§4) resolves to
        feature-504.steps.ts (T22).

  Background:
    Given the ADW codebase is checked out

  # ═══════════════ §1  GIT-READ METHODS ROUTE THROUGH #run (story 5) ══════════════
  #
  # Surface: each phase-level git-read method actually spawns its command through the
  # private `#run` chokepoint. Its observable output is the command's launch
  # parameters — the cwd and the child environment the context handed the recording
  # runner. #659 proved this for the default-branch read; here it is the four read
  # shapes the five phase-level consumers need.

  # ── §1a  The headline read honours the supplied worktree path as its cwd ───────────
  #
  # The highest-stakes read this slice migrates. The diff evaluation phase's whole job
  # is to diff the SPECIFIC worktree the orchestrator hands it and decide `safe` versus
  # `regression_possible` (which gates auto-merge). Routed through the context it spawns
  # with the context's token AND git author/committer in the child env, with cwd =
  # exactly that supplied worktree path — never the context base path, and never the
  # ambient process cwd the legacy `execSync('git diff …', { cwd: worktreePath })` would
  # inherit if the cwd were ever dropped. This is the read whose drift to the ambient cwd
  # would make the merge-safety verdict diff the WRONG repository.

  @adw-694 @adw-alilj4-gitcontext-migrate-p
  Scenario: A branch diff run against a supplied worktree path spawns with the context token, git identity, and that exact path as cwd
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    When the "diff" git-read operation runs through the context for worktree path "/srv/adw/repos/acme/webapp/.worktrees/feature-issue-1-diff-target"
    Then the captured command ran with auth token "token-acme" in its child environment
    And the captured command ran with git author "Acme Bot <bot@acme.dev>" in its child environment
    And the captured command ran with cwd equal to the supplied worktree path "/srv/adw/repos/acme/webapp/.worktrees/feature-issue-1-diff-target"

  # ── §1b  Every git-read method carries the context token + base-path cwd ───────────
  #
  # Breadth proof across the phase-level read surface: each method — invoked with no
  # explicit worktree path, so it defaults to the context base path — routes through the
  # per-command spawn path carrying the context token, with cwd = the context base path.
  # cwd = base path (not the ambient process cwd) is itself a strong migration signal:
  # the legacy reads ran under the caller-supplied / ambient process cwd; a migrated read
  # runs under an explicit context-owned cwd. Covers the tracked-file list, the short-HEAD
  # stamp, the branch diff, and the commit-history read — the full git-side surface the
  # five consumers migrate.

  @adw-694 @adw-alilj4-gitcontext-migrate-p
  Scenario Outline: Each GitContext phase-level git-read method runs with the context token and the base-path cwd
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    When the "<op>" git-read operation runs through the context
    Then the captured command ran with auth token "token-acme" in its child environment
    And the captured command ran with cwd equal to the context base path

    Examples:
      | op         |
      | ls-files   |
      | head-short |
      | diff       |
      | log        |

  # ── §1c  A git-read does not reintroduce a process-global mutation ─────────────────
  #
  # These four reads are the LAST raw phase-level readers. The whole epic exists to kill
  # the process-global `GH_TOKEN` bleed; a sloppy new read method that wrote
  # `process.env.GH_TOKEN` would silently reopen it. Running the new read leaves the
  # parent environment byte-for-byte unchanged — the token rode the child env only.

  @adw-694 @adw-alilj4-gitcontext-migrate-p
  Scenario: A branch-diff read leaves the parent process environment byte-for-byte unchanged
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    And a baseline snapshot of the parent process environment is captured
    When the "diff" git-read operation runs through the context
    Then the parent process environment matches the baseline snapshot

  # ═══════════════ §2  CONSUMERS DE-ALLOWLISTED AND GUARD-CLEAN (story 8) ════════════
  #
  # The headline for this slice. The git/gh guard tool IS the system under test; its
  # observable output is the `{ violations, scannedCount }` it computes for a file. An
  # ALLOWLISTED file is SKIPPED — the guard never scans it, so `scannedCount` stays 0.
  # After this slice each consumer is removed from the ALLOWLIST, so the guard SCANS it
  # (`scannedCount` counts it) and, because its raw phase-level reads are gone, finds NO
  # violation. The "scanned" assertion is the de-allowlisting discriminator: RED before
  # this slice (the file is still exempt → not scanned), GREEN after. For `worktreeSetup`
  # the "no violation" assertion additionally proves BOTH `git ls-files` call sites
  # migrated — a file removed from the ALLOWLIST is clean only when EVERY raw git call in
  # it is gone.

  # ── §2  Each migrated consumer is scanned by the guard and is free of raw git/gh ───

  @adw-694 @adw-alilj4-gitcontext-migrate-p
  Scenario Outline: The git/gh guard scans the migrated phase-level read consumer (no longer allowlisted) and finds no direct git/gh shell-out
    Given the ADW codebase is checked out
    When the git/gh guard scans the file "<file>"
    Then the git/gh guard scanned that file
    And the git/gh guard reports no violation in that file

    Examples:
      | file                                |
      | adws/phases/worktreeSetup.ts        |
      | adws/phases/workflowInit.ts         |
      | adws/phases/diffEvaluationPhase.ts  |
      | adws/github/prCommentDetector.ts    |
      | adws/checkLivingDocsIndex.ts        |

  # ═══════════════ §3  WHOLE-REPO GUARD STILL PASSES (story 8) ═════════════════════
  #
  # The safe-de-allowlisting backstop. Removing the five files from the ALLOWLIST must
  # not surface a violation: each one's last raw phase-level read is genuinely gone,
  # including `worktreeSetup`'s second `ls-files` call site. Running the guard across the
  # whole repository reports zero violations. This fails loudly if a consumer is
  # de-allowlisted while a raw git call still lives in it — the precise
  # incomplete-migration mistake this guards against (and the exact trap
  # `worktreeSetup`'s dual ls-files call sites set).

  # ── §3  The git/gh guard reports no violations across the repository ───────────────

  @adw-694 @adw-alilj4-gitcontext-migrate-p
  Scenario: The git/gh guard passes across the whole repository after the phase-level read consumers are de-allowlisted
    Given the ADW codebase is checked out
    When the git/gh guard is run across the repository
    Then the git/gh guard reports no violations

  # ═══════════════ §4  TYPE-CHECK BACKSTOP (registry T22) ══════════════════════════
  #
  # ── §4  The migrated phase-level read surface keeps the ADW codebase type-clean ────
  #
  # A backstop consistent with the sibling per-issue features (feature-659, feature-663,
  # feature-691, feature-692, feature-693): the four new read context methods and the now
  # raw-git-free consumers compile within the ADW codebase's type-check.

  @adw-694 @adw-alilj4-gitcontext-migrate-p
  Scenario: The ADW TypeScript type-check passes with the migrated phase-level read surface in place
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
