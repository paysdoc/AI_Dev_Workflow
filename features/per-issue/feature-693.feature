@adw-693 @adw-dojemb-gitcontext-migrate-v
Feature: GitContext worktree/branch probe migration — the residual VCS probe and branch reads/deletes route through the per-command-auth chokepoint, and the git/gh guard no longer exempts the five worktree-domain consumers

  Issue #693 (parent PRD `specs/prd/git-context-repo-authority.md`, see the
  **Enforcement** section and user stories 5, 16, 17) is the slice that drives the
  git/gh guard ALLOWLIST toward zero for the WORKTREE/BRANCH-probe surface — the
  last raw `git` reads/deletes that answer "what is the state of this worktree / which
  branches exist / is the tree dirty": `git rev-parse --git-dir`, `git symbolic-ref
  --short HEAD`, `git worktree list --porcelain`, `git branch --list`, `git branch -D`,
  and `git status --porcelain`. Five residual worktree-domain consumers still shell
  these out to raw `git`/`gh` and sit on the guard ALLOWLIST; this slice routes their
  reads/deletes through `GitContext` and removes them from the ratchet.

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
      open-issue list read.
    • #692 migrated the IDENTITY reads (`git remote get-url origin`, `gh api user`)
      and de-allowlisted their three consumers (`githubApi`, `repoContext`,
      `trigger_cron`), driving the same `checkGitGhGuard.ts` ALLOWLIST this slice
      shrinks further and extending the same `gitContext.ts` surface this slice grows.

  Why this slice is **Blocked by #692**:

    #693 and #692 drive the SAME two files — the `checkGitGhGuard.ts` ALLOWLIST (each
    removes entries) and the `gitContext.ts` method surface (each adds read methods).
    Sequencing #693 after #692 keeps the ratchet monotonic and avoids a collision on
    those two shared edit sites; #693 builds on the already-reduced ALLOWLIST #692 left.

  What this slice builds:

    • New worktree/branch PROBE methods on `GitContext`, each going through the
      existing `#run` chokepoint, covering the command shapes the five consumers need:
        – the git-dir resolve (`git rev-parse --git-dir`) and current-branch read
          (`git symbolic-ref --short HEAD`) the worktree probe needs to inspect an
          arbitrary worktree (story 16),
        – the worktree-list parse (`git worktree list --porcelain`) the probe, the
          main-repo-path lookup, and the branch-identity fallback all need (story 16),
        – the local-branch list (`git branch --list`) the branch-identity fallback
          needs and the force-delete (`git branch -D`) the worktree teardown needs
          (story 17),
        – the working-tree dirty check (`git status --porcelain`) the orchestrator
          library needs (story 17).
      Some of these shapes ALREADY have context methods from earlier slices
      (`deleteLocalBranch`, `hasUncommittedChanges`, `listWorktrees`, and the gh-side
      `defaultBranch`); this slice does not re-add those, it routes the last raw
      consumers onto them and adds only the genuinely-new probe reads. Which shapes are
      new methods versus reused is an implementer's choice (see Scope notes) — the
      scenarios pin the OBSERVABLE migration, not the method inventory.
    • The five residual consumers — `worktreeProbe`, `worktreeOperations`,
      `branchOperations`, `branchIdentityFallback`, `orchestratorLib` — stop shelling
      out to raw `git`/`gh` and route through the context instead. With their last raw
      `git`/`gh` call gone, each is REMOVED from the guard ALLOWLIST in
      `adws/checkGitGhGuard.ts`, so the guard scans them like any other file.

  Two consumers carry a DUAL raw call — the all-or-nothing-per-file trap:

    The guard is ALL-OR-NOTHING per file: a file removed from the ALLOWLIST is clean
    ONLY when EVERY raw `git`/`gh` call in it is gone. Two of the five consumers carry
    two distinct raw calls each, so de-allowlisting them forces BOTH onto the context
    in this slice:
      • `branchOperations` carries a gh-READ (`gh repo view … defaultBranchRef`, its
        default-branch helper) AND a git-WRITE (`git branch -D`, its force-delete
        helper). Both must migrate — the gh-read onto the pre-existing `defaultBranch`
        method, the delete onto the pre-existing `deleteLocalBranch` method.
      • `branchIdentityFallback` carries TWO git reads (`git worktree list --porcelain`
        AND `git branch --list`). Both must migrate — the worktree parse and the
        local-branch list.
    This is the same trap #692's `trigger_cron` set (a dual identity + open-issue read);
    here it is enforced the same way — only through §2's guard-clean assertion over the
    whole of each file, never by re-pinning each individual call in §1.

  Why this slice exists — the defect it forecloses:

    A worktree probe that shells out to raw `git` for `rev-parse`/`symbolic-ref`/
    `worktree list` runs under whatever cwd it happens to inherit and authenticates
    against whatever repo last wrote the process-global `GH_TOKEN`. The probe's whole
    job is to report the state of a SPECIFIC worktree path the orchestrator hands it; a
    read that drifts to the ambient process cwd inspects the WRONG directory and the
    reuse/recovery decision built on it is wrong — the precise wrong-base-repo shape the
    PRD mined ~13 times, now on the recovery path. While such a consumer sits on the
    ALLOWLIST, the guard also cannot catch a NEW raw `git`/`gh` call sneaking in beside
    it. Routing the reads through `#run` binds each command's auth + cwd to the call
    (the SUPPLIED worktree path, never the ambient cwd; no shared global to clobber),
    and de-allowlisting the file re-arms the guard so any future raw call in it is a
    build failure, not a silent regression. Behaviour is unchanged; only token/cwd
    APPLICATION (per-command + supplied-cwd vs process-global/ambient) and guard
    COVERAGE change.

  Contract pinned here (the OBSERVABLE behaviour, not the field/signature shape):

    • read goes through #run    → each probe/branch method spawns its command with a
                                  child env carrying the context's token + git
                                  author/committer, and an EXPLICIT cwd — the context
                                  base path when none is supplied, or the SUPPLIED
                                  worktree path when the consumer hands it one (§1;
                                  stories 16, 17).
    • supplied worktree honoured → a probe run against a given worktree path spawns its
                                  command with cwd = exactly that path, never the
                                  context base path and never the ambient process cwd —
                                  the distinctive worktree-probe contract this slice
                                  adds beyond the identity reads (§1a; story 16).
    • per-command auth           → running a probe read leaves the parent process
                                  environment byte-for-byte unchanged — no reintroduced
                                  global mutation on the last worktree/branch-read path
                                  (§1c; story 5).
    • consumer de-allowlisted    → the guard, run against each of the five migrated
                                  consumer files, SCANS the file (it is no longer
                                  exempt) and finds NO direct git/gh shell-out in it
                                  (§2; stories 5, 17).
    • guard still passes          → with the five files removed from the ALLOWLIST, the
                                  guard run across the whole repository reports zero
                                  violations — the de-allowlisting introduced no new
                                  violation, including both dual-call consumers; the
                                  ratchet simply sits lower (§3; story 5).

  Observability / rot-prevention note:

    Every assertion below targets a runtime OUTPUT of the system under test, never the
    static text of a source file. No step opens `worktreeProbe.ts`,
    `worktreeOperations.ts`, `branchOperations.ts`, `branchIdentityFallback.ts`,
    `orchestratorLib.ts`, `checkGitGhGuard.ts`, or the GitContext package as text,
    substring-matches its contents, or parses it as JSON/AST.

      • §1 runs each probe/branch method through a RECORDING RUNNER injected as the
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

    The file paths, owners/repos, tokens, authors, worktree paths, and op names in the
    steps are INPUT test data; the recorded `(cwd, env)`, the live `process.env`, the
    guard's `{ violations, scannedCount }`, and the type-check exit code are the
    system's OUTPUTS — exactly the artefact category the rubric permits. The recording
    runner means no real `git`/`gh` is spawned and no network or filesystem worktree is
    touched in §1, so those scenarios are hermetic.

  Scope notes:

    • This slice pins TWO observable contracts: (a) the probe/branch methods route
      their spawn through the per-command-auth `#run` chokepoint with the correct cwd
      (base path when none is supplied, the supplied worktree path otherwise) (§1), and
      (b) the five consumer files are now scanned by the guard and are violation-free
      (§2), with the whole-repo guard still passing (§3). Together these prove the
      worktree/branch reads moved off raw `git`/`gh` and onto the context: the consumers
      contain no raw `git`/`gh` (guard-clean, §2) and the context's methods that replace
      them carry per-command auth and the right cwd (§1).
    • The exact threading of a `GitContext` into each consumer (constructor param,
      function arg, or an injected dep's default — e.g. `worktreeProbe`'s `ProbeDeps`
      or `branchIdentityFallback`'s `BranchIdentityFallbackDeps`) is an implementer's
      choice and is deliberately NOT pinned, consistent with the sibling slices' "pin
      the decision, not the shape" stance (#658/#659/#663/#691/#692).
    • WHICH command shapes become NEW methods and which REUSE pre-existing ones
      (`deleteLocalBranch`, `hasUncommittedChanges`, `listWorktrees`, `defaultBranch`)
      is not pinned. The friendly op names in §1 map to whatever methods the
      implementer adds or reuses, inside the step definitions — exactly as #692's
      `remote-url`/`authenticated-user` mapped to one new and one pre-existing method.
    • `branchOperations`'s gh-side `gh repo view … defaultBranchRef` read migrates onto
      the EXISTING `defaultBranch` method (proven through `#run` by #659), so it is not
      re-pinned as a §1 recording-runner proof; its migration is enforced here ONLY by
      §2's guard-clean assertion over the whole of `branchOperations` (a file removed
      from the ALLOWLIST is clean only when EVERY raw git/gh call in it is gone — both
      the `gh repo view` read AND the `git branch -D` delete).
    • Parent-global isolation and two-context isolation for the `#run` spawn path are
      already proven exhaustively by #659 and #663; the probe/branch methods route
      through the SAME chokepoint, so this slice re-pins only ONE representative
      parent-env-unchanged check (§1c) — an anti-regression that the LAST
      worktree/branch readers do not reintroduce a global mutation — and does not
      restate the full isolation matrix.
    • Auth ACQUISITION is unchanged: token minting/refresh is untouched; only token
      APPLICATION (per-command vs process-global) changes. No scenario here drives the
      minting path, an orchestrator, or the cron poller as a subprocess.
    • Behaviour of the consumers themselves (the worktree-reuse signal derivation in
      `worktreeProbe`/`worktreeReuseGate`, the main-repo-path selection in
      `worktreeOperations`, the protected-branch refusal in `branchOperations`, the
      slug-agnostic branch matching and adwId reverse-lookup in `branchIdentityFallback`,
      the dirty-tree gate in `orchestratorLib`) is unchanged and already covered by their
      existing unit suites; this slice adds coverage for the read-path migration and the
      guard de-allowlisting, it does not relax those suites.
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

    Guard phrases reused VERBATIM from feature-691.steps.ts (globally registered there —
    generate_step_definitions must NOT redefine them):
      • `the git/gh guard scans the file {string}`
      • `the git/gh guard scanned that file`
      • `the git/gh guard reports no violation in that file`
      • `the git/gh guard is run across the repository`
      • `the git/gh guard reports no violations`

    Novel phrasing introduced here — the registry has no phrase for running a
    WORKTREE/BRANCH-probe method through the context. Phrased DISTINCTLY from #659's
    `read operation`, #663's `gh operation`, #691's `gh-read operation`, and #692's
    `identity-read operation` (this uses `vcs-probe operation`) so the step files do not
    collide as Cucumber loads them all globally. The umbrella `vcs-probe` spans worktree
    probes (`rev-parse`, `symbolic-ref`, `worktree list`), the local-branch list
    (`branch --list`), the force-delete (`branch -D`), and the working-tree status
    (`status --porcelain`) — one label per slice, matching the issue's "VCS probe/branch"
    framing; no `/` is used in any step phrase (Cucumber treats `/` as alternation).
    Surfaced to the maintainer in the agent Output:
      Running a worktree/branch probe method through the context:
        • `the {string} vcs-probe operation runs through the context`
        • `the {string} vcs-probe operation runs through the context for worktree path {string}`
      Asserting the supplied worktree path is honoured as the command cwd:
        • `the captured command ran with cwd equal to the supplied worktree path {string}`

    Step-definition note for the maintainer:
      • §1 steps phase-import `GitContext` and REUSE the shared `gitContextSharedWorld.ts`
        machinery (`makeFullOptions`, `makeSpyExec`, `makeNoOpFsDeps`, the shared `W`)
        exactly as `feature-691.steps.ts` / `feature-692.steps.ts` do, so #659's
        globally-registered assertion steps apply to the recorded calls without
        redefinition.
      • `the {string} vcs-probe operation runs through the context` adds a NEW dispatcher
        (parallel to #692's `identity-read operation` switch) over the probe/branch
        reads, invoked WITHOUT a worktree path so each defaults to the context base path:
          "resolve-git-dir"      → the new git-dir resolve  (`git rev-parse --git-dir`)
          "current-branch"       → the new current-branch read (`git symbolic-ref --short HEAD`)
          "worktree-list"        → the worktree-list parse  (`git worktree list --porcelain`)
          "list-local-branches"  → the new local-branch list (`git branch --list`)
          "delete-local-branch"  → the force-delete (`git branch -D`) — pass a NON-protected
                                   branch (e.g. "feature-issue-1-demo") so the method actually
                                   spawns rather than short-circuiting on the protected list
          "uncommitted-status"   → the dirty-tree check (`git status --porcelain`) — this
                                   method requires a worktree path, so pass `W.ctx.basePath`
                                   to keep the base-path-cwd assertion valid
        Construct the context via `makeFullOptions(owner, repo, token, authorName,
        authorEmail)` + `new GitContext(opts, { exec: makeSpyExec(W.responseMap).exec,
        fsDeps: makeNoOpFsDeps() })`, store it on `W.ctx` and the recorder's `calls` on
        `W.spyCalls` (the recording-runner Given already does this). Seed `W.responseMap`
        so the spy returns canned PARSEABLE output for each read (e.g. a `.git`-dir path
        for `rev-parse --git-dir`, a branch name for `symbolic-ref`, a `worktree …`
        porcelain block for `worktree list`, a branch line for `branch --list`) so the
        method completes; no real subprocess, no network, no fs. The token/author/cwd
        assertions are value-based comparisons against the recorded child `env`/`cwd`.
      • `the {string} vcs-probe operation runs through the context for worktree path
        {string}` is the same dispatcher but threads the supplied path as the method's
        `worktreePath`/`cwd` argument, so the recorded `cwd` is that path. Store the
        supplied path on the world (e.g. `W.suppliedWorktreePath`) for the assertion.
      • `the captured command ran with cwd equal to the supplied worktree path {string}`
        asserts `W.spyCalls.at(-1).cwd === <the path arg>` (value comparison against the
        literal path passed in the When step — NOT against `W.ctx.basePath`).
      • The guard steps (§2/§3) and the type-check step (§4) require NO new definitions —
        they resolve to feature-691.steps.ts (`scanFiles`) and feature-504.steps.ts (T22)
        respectively.

  Background:
    Given the ADW codebase is checked out

  # ═══════════════ §1  PROBE/BRANCH METHODS ROUTE THROUGH #run (stories 16, 17) ════
  #
  # Surface: each worktree/branch probe method actually spawns its command through the
  # private `#run` chokepoint. Its observable output is the command's launch
  # parameters — the cwd and the child environment the context handed the recording
  # runner. #659 proved this for the default-branch read; here it is the probe/branch
  # shapes the five worktree-domain consumers need.

  # ── §1a  The headline new probe honours the supplied worktree path as its cwd ──────
  #
  # The distinctive contract this slice adds beyond #692's identity reads. A worktree
  # probe's whole job is to inspect a SPECIFIC worktree the orchestrator hands it (the
  # candidate for resume/reuse). Routed through the context it spawns with the context's
  # token AND git author/committer in the child env, with cwd = exactly that supplied
  # worktree path — never the context base path, and never the ambient process cwd the
  # legacy `execSync('git rev-parse --git-dir', { cwd: worktreePath })` would inherit if
  # the cwd were ever dropped. This is the read whose drift to the ambient cwd would make
  # the worktree-reuse decision inspect the wrong directory.

  @adw-693 @adw-dojemb-gitcontext-migrate-v
  Scenario: A worktree probe run against a supplied worktree path spawns with the context token, git identity, and that exact path as cwd
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    When the "resolve-git-dir" vcs-probe operation runs through the context for worktree path "/srv/adw/repos/acme/webapp/.worktrees/feature-issue-1-probe-target"
    Then the captured command ran with auth token "token-acme" in its child environment
    And the captured command ran with git author "Acme Bot <bot@acme.dev>" in its child environment
    And the captured command ran with cwd equal to the supplied worktree path "/srv/adw/repos/acme/webapp/.worktrees/feature-issue-1-probe-target"

  # ── §1b  Every probe/branch method carries the context token + base-path cwd ───────
  #
  # Breadth proof across the worktree/branch-read surface: each method — invoked with no
  # explicit worktree path, so it defaults to the context base path — routes through the
  # per-command spawn path carrying the context token, with cwd = the context base path.
  # cwd = base path (not the ambient process cwd) is itself a strong migration signal:
  # the legacy reads ran under the caller-supplied / ambient process cwd; a migrated read
  # runs under an explicit context-owned cwd. Covers the worktree probes (rev-parse,
  # symbolic-ref, worktree list), the local-branch list, the force-delete, and the
  # working-tree status — the full git-side surface the five consumers migrate.

  @adw-693 @adw-dojemb-gitcontext-migrate-v
  Scenario Outline: Each GitContext worktree/branch probe method runs with the context token and the base-path cwd
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    When the "<op>" vcs-probe operation runs through the context
    Then the captured command ran with auth token "token-acme" in its child environment
    And the captured command ran with cwd equal to the context base path

    Examples:
      | op                  |
      | resolve-git-dir     |
      | current-branch      |
      | worktree-list       |
      | list-local-branches |
      | delete-local-branch |
      | uncommitted-status  |

  # ── §1c  A probe read does not reintroduce a process-global mutation ───────────────
  #
  # These five are the LAST raw worktree/branch readers. The whole epic exists to kill
  # the process-global `GH_TOKEN` bleed; a sloppy new probe method that wrote
  # `process.env.GH_TOKEN` would silently reopen it. Running the new read leaves the
  # parent environment byte-for-byte unchanged — the token rode the child env only.

  @adw-693 @adw-dojemb-gitcontext-migrate-v
  Scenario: A worktree probe read leaves the parent process environment byte-for-byte unchanged
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    And a baseline snapshot of the parent process environment is captured
    When the "resolve-git-dir" vcs-probe operation runs through the context
    Then the parent process environment matches the baseline snapshot

  # ═══════════════ §2  CONSUMERS DE-ALLOWLISTED AND GUARD-CLEAN (stories 5, 17) ═════
  #
  # The headline for this slice. The git/gh guard tool IS the system under test; its
  # observable output is the `{ violations, scannedCount }` it computes for a file. An
  # ALLOWLISTED file is SKIPPED — the guard never scans it, so `scannedCount` stays 0.
  # After this slice each consumer is removed from the ALLOWLIST, so the guard SCANS it
  # (`scannedCount` counts it) and, because its raw worktree/branch reads are gone, finds
  # NO violation. The "scanned" assertion is the de-allowlisting discriminator: RED
  # before this slice (the file is still exempt → not scanned), GREEN after. For the two
  # dual-call consumers the "no violation" assertion additionally proves BOTH raw calls
  # migrated — `branchOperations`'s `gh repo view` AND `git branch -D`, and
  # `branchIdentityFallback`'s `git worktree list` AND `git branch --list` — a file
  # removed from the ALLOWLIST is clean only when EVERY raw git/gh call in it is gone.

  # ── §2  Each migrated consumer is scanned by the guard and is free of raw git/gh ───

  @adw-693 @adw-dojemb-gitcontext-migrate-v
  Scenario Outline: The git/gh guard scans the migrated worktree/branch consumer (no longer allowlisted) and finds no direct git/gh shell-out
    Given the ADW codebase is checked out
    When the git/gh guard scans the file "<file>"
    Then the git/gh guard scanned that file
    And the git/gh guard reports no violation in that file

    Examples:
      | file                                    |
      | adws/vcs/worktreeProbe.ts               |
      | adws/vcs/worktreeOperations.ts          |
      | adws/vcs/branchOperations.ts            |
      | adws/phases/branchIdentityFallback.ts   |
      | adws/core/orchestratorLib.ts            |

  # ═══════════════ §3  WHOLE-REPO GUARD STILL PASSES (story 5) ═════════════════════
  #
  # The safe-de-allowlisting backstop. Removing the five files from the ALLOWLIST must
  # not surface a violation: each one's last raw worktree/branch read is genuinely gone,
  # including both dual-call consumers' second call. Running the guard across the whole
  # repository reports zero violations. This fails loudly if a consumer is de-allowlisted
  # while a raw git/gh call still lives in it — the precise incomplete-migration mistake
  # this guards against (and the exact trap `branchOperations`' and
  # `branchIdentityFallback`'s dual calls set).

  # ── §3  The git/gh guard reports no violations across the repository ───────────────

  @adw-693 @adw-dojemb-gitcontext-migrate-v
  Scenario: The git/gh guard passes across the whole repository after the worktree/branch consumers are de-allowlisted
    Given the ADW codebase is checked out
    When the git/gh guard is run across the repository
    Then the git/gh guard reports no violations

  # ═══════════════ §4  TYPE-CHECK BACKSTOP (registry T22) ══════════════════════════
  #
  # ── §4  The migrated worktree/branch surface keeps the ADW codebase type-clean ─────
  #
  # A backstop consistent with the sibling per-issue features (feature-659, feature-663,
  # feature-664, feature-691, feature-692): the new probe context methods and the now
  # raw-git/gh-free consumers compile within the ADW codebase's type-check.

  @adw-693 @adw-dojemb-gitcontext-migrate-v
  Scenario: The ADW TypeScript type-check passes with the migrated worktree/branch surface in place
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
