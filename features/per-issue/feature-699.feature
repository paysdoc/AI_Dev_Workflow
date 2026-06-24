@adw-699 @adw-yimifh-gitcontext-route-hea
Feature: GitContext health-check diagnostics via a self-host context — the diagnostic scripts' git/gh probes route through a self-host GitContext at the framework repo root, and the git/gh guard no longer exempts the two diagnostic files

  Issue #699 (parent PRD `specs/prd/git-context-repo-authority.md`, see the
  **Enforcement** section — "no exemption outside the package, diagnostics
  included" — and user stories 5 and 8) is the slice that drives the git/gh guard
  ALLOWLIST's *diagnostic* category to zero. Two health-check scripts still shell
  raw `git`/`gh` to answer "is this checkout healthy": `healthCheckChecks.ts`
  (current branch via `git rev-parse --abbrev-ref HEAD`, the remote list via `git
  remote`, the dirty-tree probe via `git status --porcelain`, the committer
  identity via `git config user.name`/`user.email`, the `gh auth status` probe, and
  the `gh issue view … --json` accessibility check) and `healthCheck.tsx` (the
  repository URL via `gh repo view --json url`). Both sit on the guard ALLOWLIST in
  the `diagnostic` category. This slice constructs a SELF-HOST `GitContext` in the
  diagnostics, routes every probe through it, and removes the two files from the
  ratchet — emptying the diagnostic category entirely.

  Why a SELF-HOST context (the thing this slice is fundamentally about):

    Unlike every sibling GitContext slice, which migrates operations that act on a
    TARGET repo (base path under `targetReposDir/<owner>/<repo>`), the health-check
    diagnostics operate on the HOST checkout — the framework repo ADW is running
    from. The constructor's `selfHost: true` discriminator resolves the base path to
    the injected `frameworkRepoRoot` (not a target workspace), so a self-host
    context's probes launch under the framework repo root. #658 proved that
    base-path resolution at construction time; this slice is the first to route a
    self-host context's COMMANDS through the `#run` chokepoint and prove their launch
    parameters (token, identity, framework-root cwd) at the recording boundary.

  Earlier slices established the machinery this one consumes:

    • #658 shipped the `GitContext` deep module — mandatory identity, the
      one-constructor base-path decision (self-host → the injected framework repo
      root; target → `join(targetReposDir, owner, repo)`), `worktreePathFor(branch)`,
      and the `commandEnv()` per-command env overlay carrying the token + git
      author/committer. It also globally registered the self-host construction
      vocabulary (`a self-host GitContext with framework root …`, `the self-host
      context base path is …`) — this slice does NOT re-prove construction-time base
      path; it proves the self-host context's COMMAND launch parameters.
    • #659 routed a representative op (default-branch) through the private `#run`
      chokepoint and registered the recording-runner machinery (`makeSpyExec`, the
      shared `W`, the token/author/cwd assertions, the parent-env snapshot, and the
      `the process working directory is changed away from the context base path`
      perturbation) that every later GitContext per-issue slice — including this one
      — reuses. #659 proved cwd = base path is INDEPENDENT of `process.cwd()`; this
      slice reuses that exact perturbation to prove a self-host probe never falls back
      to the ambient cwd.
    • #663/#691/#692/#693/#694/#695 each migrated a disjoint operation family
      (gh-operation, gh-read, identity-read, worktree/branch-probe, phase-level
      git-read, label/board/secret) and each shrank the SAME `checkGitGhGuard.ts`
      ALLOWLIST this slice shrinks further. #694 emptied the *residual* phase-level
      read entries and migrated `checkLivingDocsIndex` (the previous lone occupant of
      the diagnostic category); #695 removed the last three gh-operation consumers.
      This slice reuses the guard step definitions (`the git/gh guard scans the file
      …`, the whole-repo run) #691 registered, verbatim.

  Why this slice is **Blocked by #695**:

    #699 and #695 drive the SAME ratchet file — the `checkGitGhGuard.ts` ALLOWLIST —
    each removing a disjoint set of entries (#695 the three label/board/secret
    gh-operation consumers; #699 the two diagnostic scripts). Sequencing #699 after
    #695 keeps the ratchet monotonic and avoids a collision on that one shared edit
    site: #699 removes its two `diagnostic`-category entries from the already-reduced
    ALLOWLIST #695 left behind. (The two slices touch different consumer files — #695
    the label/board/secret consumers, #699 the two health-check scripts — and a
    disjoint slice of the context surface — #695 added the gh `setSecret` method,
    #699 routes diagnostics through a self-host context — so the only true overlap is
    the ALLOWLIST, which the ordering serialises.)

  What this slice builds:

    • A SELF-HOST `GitContext` constructed inside the diagnostic scripts (base path =
      the framework repo root via `selfHost: true`), through which every git/gh probe
      in `healthCheckChecks.ts` and `healthCheck.tsx` is routed instead of the legacy
      bare `execSync(command)` (which inherited the ambient `process.cwd()` and the
      process-global `GH_TOKEN`) (story 5). Whether each probe maps to a NEW context
      method (e.g. a current-branch read, a remote-list read, a git-user-config read,
      a `gh auth status` probe, a repo-URL read) or REUSES a pre-existing method
      (some shapes — `git status --porcelain`, `gh issue view` — already exist on the
      context from #693/#663) is an implementer's choice (see Scope notes); the
      scenarios pin the OBSERVABLE migration — a self-host context whose probe spawns
      with the context token, the git identity, and the framework-root cwd — not the
      method signatures.
    • How the diagnostics OBTAIN a self-host context — a launch-boundary build (the
      `launchGitContext`/`gitContextFactory` seam), an injected dependency, or a
      direct construction at the script's entry — is likewise an implementer's choice
      and is deliberately NOT pinned, consistent with the sibling slices' "pin the
      decision, not the shape" stance. `healthCheck.tsx` has a top-level `main()` and
      `healthCheckChecks.ts` exposes pure check functions; how each receives its
      context is the implementer's concern. The scenario pins only that the files end
      up guard-clean (§2) and that a self-host probe carries the right launch
      parameters (§1).
    • With their last raw `git`/`gh` call gone, BOTH files are REMOVED from the guard
      ALLOWLIST in `adws/checkGitGhGuard.ts` (the two `diagnostic`-category entries),
      so the guard scans them like any other file and the diagnostic category empties
      (story 8).

  The all-or-nothing-per-file trap — both files carry MANY raw call sites:

    The guard is ALL-OR-NOTHING per file: a file removed from the ALLOWLIST is clean
    ONLY when EVERY raw `git`/`gh` call in it is gone. `healthCheckChecks.ts` shells
    SEVEN distinct git/gh commands across three check functions (current branch,
    remote list, dirty-tree, two `git config` identity reads, `gh auth status`, `gh
    issue view`); EVERY one must route onto a context method before the file can leave
    the ALLOWLIST clean. This is the same trap #694's `worktreeSetup` (dual
    `ls-files`) and #695's `labelManager` (dual `gh` commands) set; here it is
    enforced the same way — only through §2's guard-clean assertion over the whole of
    each file, never by re-pinning each individual call in §1. The generic
    `execCommand`/`commandExists` helpers (which run non-git/gh commands such as
    `which gh` and `<claude> --version`) carry no git/gh string literal and are not
    themselves guard violations; they may remain.

  Why this slice exists — the defect it forecloses:

    A diagnostic that shells out to bare `execSync('git status --porcelain')` /
    `execSync('gh auth status')` runs under whatever cwd it happens to inherit and
    authenticates against whatever repo last wrote the process-global `GH_TOKEN`.
    Worse, a SELF-HOST consumer that silently falls back to the ambient working
    directory resolves against the WRONG checkout — the precise self-host-ambient-cwd
    drift the PRD mined (a takeover process whose own cwd is the framework repo
    computing a target workflow's worktree UNDER the framework repo and detonating
    with `spawnSync … ENOENT`). A health check that reports the branch, remote, and
    dirty-tree state of whatever directory it happened to inherit — rather than the
    framework checkout it is meant to diagnose — gives a green "healthy" verdict for
    the wrong repository. While these scripts sit on the ALLOWLIST, the guard also
    cannot catch a NEW raw `git`/`gh` call sneaking in beside them. Routing each probe
    through a self-host context's `#run` binds the command's auth to the call (the
    token rides the child env, no shared global to clobber) and its cwd to the
    framework repo root (never the ambient cwd), and de-allowlisting the files re-arms
    the guard so any future raw call in them is a build failure, not a silent
    regression. Behaviour is unchanged; only token/cwd APPLICATION (per-command +
    framework-root cwd vs process-global/ambient) and guard COVERAGE change.

  Contract pinned here (the OBSERVABLE behaviour, not the field/signature shape):

    • self-host probe goes through #run → a self-host context's probe spawns its
                                  command with a child env carrying the context's token
                                  + git author/committer, and cwd = the framework repo
                                  root (the self-host base path) (§1; story 5).
    • framework root, not ambient cwd → a self-host probe launched while the process
                                  working directory has moved AWAY from the base path
                                  still spawns with cwd = the framework repo root —
                                  the drift whose fall-through to the ambient cwd would
                                  diagnose the wrong checkout (§1a; story 5).
    • per-command auth            → running a self-host probe leaves the parent process
                                  environment byte-for-byte unchanged — no reintroduced
                                  global mutation on the diagnostic path (§1c; story 5).
    • files de-allowlisted        → the guard, run against each of the two migrated
                                  diagnostic files, SCANS the file (it is no longer
                                  exempt) and finds NO direct git/gh shell-out in it
                                  (§2; story 8).
    • guard still passes          → with both files removed from the ALLOWLIST, the
                                  guard run across the whole repository reports zero
                                  violations — the de-allowlisting introduced no new
                                  violation, including every one of
                                  `healthCheckChecks.ts`'s seven call sites; the
                                  ratchet simply sits lower (§3; story 8).

  Observability / rot-prevention note:

    Every assertion below targets a runtime OUTPUT of the system under test, never
    the static text of a source file. No step opens `healthCheckChecks.ts`,
    `healthCheck.tsx`, `gitContext.ts`, or `checkGitGhGuard.ts` as text,
    substring-matches its contents, or parses it as JSON/AST.

      • §1 runs a self-host probe through a RECORDING RUNNER injected as the context's
        command boundary (the `GitContextDeps.exec` seam #659 established — the same
        recorder category as the registered `git-mock`/`mock server` collaborators in
        `vocabulary.md`) and asserts the RECORDED `cwd` and child `env` the context
        handed that runner. The recorded `(cwd, env)` is the command's actual launch
        parameters — a runtime artefact, not a source read. The framework-root cwd is
        proven against a SENTINEL framework root that is NOT the test's real working
        directory, so a recorded cwd equal to it can only come from the context's
        explicit base-path cwd, never an ambient fall-through. The "parent env
        unchanged" step compares the LIVE `process.env` before and after the probe;
        `process.env` is live runtime state, the canonical observable for "was the
        global mutated," which the Rot-Detection Rubric permits.
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
        finds it violation-free. A refactor that renames a check function or
        restructures the guard leaves these assertions valid as long as the BEHAVIOUR
        holds — the file is scanned and clean.

    The file paths, owner/repo, token, author, framework root, and probe names in the
    steps are INPUT test data; the recorded `(cwd, env)`, the live `process.env`, the
    guard's `{ violations, scannedCount }`, and the type-check exit code are the
    system's OUTPUTS — exactly the artefact category the rubric permits. The recording
    runner means no real `git`/`gh` is spawned and no network or filesystem is touched
    in §1, so those scenarios are hermetic.

  Scope notes:

    • This slice pins TWO observable contracts: (a) a self-host context's probe routes
      its spawn through the per-command-auth `#run` chokepoint with the context token,
      the git identity, and the framework-root cwd — even when the ambient working
      directory has moved (§1), and (b) the two diagnostic files are now scanned by the
      guard and are violation-free (§2), with the whole-repo guard still passing (§3).
      Together these prove the diagnostics moved off raw `git`/`gh` and onto a self-host
      context: the files contain no raw `git`/`gh` (guard-clean, §2) and a self-host
      probe carries per-command auth and the framework-root cwd (§1).
    • §1 deliberately exercises a REPRESENTATIVE set of probes (a pure-cwd git read, a
      repo-less gh probe, and a repo-targeted gh probe) spanning both command families,
      NOT an exhaustive enumeration of all seven sites. Completeness — that EVERY raw
      call in each file migrated — is enforced at §2's guard-clean assertion over the
      whole file (a file removed from the ALLOWLIST is clean only when every raw call in
      it is gone), exactly as #694/#695 verified their dual-call-site completeness at the
      guard surface rather than re-pinning each call in §1.
    • Construction-time self-host base-path resolution (`selfHost: true` → the framework
      repo root) is already proven exhaustively by #658; this slice does NOT re-prove
      it. §1 proves the next step — that a self-host context's COMMAND actually launches
      with that base path as its cwd and the context token/identity in its child env.
    • The exact probe-to-method mapping is an implementer's choice. Some shapes are NEW
      methods (current branch, remote list, `git config` user identity, `gh auth
      status`, repo URL); others may REUSE pre-existing methods (`git status
      --porcelain` already routes through `hasUncommittedChanges`/the probe reads #693
      added; `gh issue view` overlaps `fetchIssue`/`issueState` from #659/#663). The
      friendly probe names in §1 map to whichever methods the implementer wires inside
      the step definitions — exactly as #694's `ls-files`/`head-short` mapped to its
      read methods.
    • Parent-global isolation and two-context isolation for the `#run` spawn path are
      already proven exhaustively by #659/#663; the self-host probes route through the
      SAME chokepoint, so this slice re-pins only ONE representative parent-env-unchanged
      check (§1c) — an anti-regression that the diagnostic path does not reintroduce a
      global mutation — and does not restate the full isolation matrix.
    • Auth ACQUISITION is unchanged: token minting/refresh is untouched; only token
      APPLICATION (per-command vs process-global) changes. No scenario here drives the
      minting path, an orchestrator, or the cron poller as a subprocess.
    • Behaviour of the diagnostics themselves (which env vars are required, the
      pass/warn/fail verdict structure, the `healthCheck.jsonl` output, the issue-number
      validation) is unchanged and already covered by their existing unit suites and by
      feature-535 (which exercises `checkEnvironmentVariables` for token-leak coverage,
      a non-git/gh check this slice leaves untouched); this slice adds coverage for the
      probe-path migration and the guard de-allowlisting, it does not relax those suites.
    • The @regression maintenance sweep is SKIPPED for this issue: `.adw/scenarios.md`
      configures a `## Regression Scenario Directory`, so promotion is a deliberate
      human decision and the agent never auto-promotes.

  Vocabulary note:

    Registered phrases reused (`features/regression/vocabulary.md`):
      G18 `the ADW codebase is checked out`              (background + §2/§3 + type-check)
      T22 `the ADW TypeScript type-check passes`          (backstop, via feature-504.steps.ts)

    Phrases reused VERBATIM from the GitContext per-issue corpus (established by
    feature-659, globally registered via `gitContextSharedWorld.ts` / feature-659.steps.ts,
    NOT yet in the registry) so the §1 step definitions share #659's recording-runner,
    perturbation, and parent-env machinery — generate_step_definitions must NOT redefine
    them, or Cucumber raises a duplicate step definition:
      • `the process working directory is changed away from the context base path`
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

    Novel phrasing introduced here — the registry and the corpus have no phrase for
    constructing a SELF-HOST recording-runner context, nor for running a DIAGNOSTIC
    probe through it. The shared `the context's git and gh commands are captured by a
    recording runner` Given (#659) builds a TARGET context (`selfHost: false`) only, so
    a self-host variant is genuinely new. The probe-dispatcher phrase is worded
    DISTINCTLY from #659's `read operation`, #663's `gh operation`, #691's `gh-read
    operation`, #692's `identity-read operation`, #693's `vcs-probe operation`, #694's
    `git-read operation`, and #695's `secret operation` (this uses `self-host probe`) so
    the step files do not collide as Cucumber loads them all globally. No `/` is used in
    any step phrase (Cucumber treats `/` as alternation). Surfaced to the maintainer in
    the agent Output:
      Constructing a self-host recording-runner context:
        • `a self-host GitContext for owner {string} repo {string} with auth token {string} and git author {string} and framework root {string} whose git and gh commands are captured by a recording runner`
      Running a diagnostic probe through the self-host context:
        • `the {string} self-host probe runs through the context`

    Step-definition note for the maintainer:
      • The self-host construction-with-recorder Given builds the context on the SHARED
        `W` (from `gitContextSharedWorld.ts`) so #659's globally-registered assertion
        steps (token / git author / cwd-equal-base-path / parent-env-snapshot) and the
        `the process working directory is changed away from the context base path`
        perturbation apply WITHOUT redefinition. Build it as the self-host analog of
        `makeFullOptions` — `{ owner, repo, selfHost: true, token, gitIdentity:{author/
        committer = the parsed author}, frameworkRepoRoot: <given>, targetReposDir:
        TARGET_REPOS_ROOT }` — then `new GitContext(opts, { exec:
        makeSpyExec(W.responseMap).exec, fsDeps: makeNoOpFsDeps() })`, storing the
        context on `W.ctx` and the recorder's `calls` on `W.spyCalls`. (A
        `makeSelfHostOptions(...)` helper alongside `makeFullOptions` in
        `gitContextSharedWorld.ts` keeps this DRY.) Because the framework root is a
        sentinel (e.g. "/srv/adw/framework") that differs from the test's real
        `process.cwd()`, the reused `the captured command ran with cwd equal to the
        context base path` assertion proves the cwd is the framework root and not an
        ambient fall-through. Do NOT add a new `After` hook — #659.steps.ts's `After`
        already resets the shared `W`, restores `process.cwd()`, and restores
        `GH_TOKEN`.
      • `the {string} self-host probe runs through the context` adds a NEW dispatcher
        (parallel to #694's `git-read operation` switch) over the representative probes,
        each invoked with no explicit cwd so it defaults to the context base path (the
        framework root). Seed `W.responseMap` so each call returns without throwing:
          "current-branch" → the current-branch read (`git rev-parse --abbrev-ref HEAD`)
                             — seed `rev-parse --abbrev-ref` with a branch name (e.g.
                             "main\n")
          "gh-auth"        → the auth-status probe (`gh auth status`) — seed `auth
                             status` with a benign status string; a repo-LESS gh probe,
                             so the framework-root cwd is its only repo signal
          "gh-issue-view"  → the issue-accessibility read (`gh issue view <n> --json
                             number,title,state`) — seed `issue view` with a parseable
                             JSON object (e.g. `{"number":1,"title":"x","state":"OPEN"}`)
                             so any JSON parse in the probe completes
        Map each friendly name to whichever method the implementer wires (new or
        reused); the assertions are value-based comparisons against the recorded child
        `env`/`cwd`. No real subprocess, no network, no fs.
      • The guard steps (§2/§3) require NO new definitions — they resolve to
        feature-691.steps.ts (`scanFiles`). The type-check step (§4) resolves to
        feature-504.steps.ts (T22). The background `the ADW codebase is checked out`
        resolves to ensureCronOnEveryEventSteps.ts (G18).

  Background:
    Given the ADW codebase is checked out

  # ═══════════════ §1  SELF-HOST DIAGNOSTIC PROBES ROUTE THROUGH #run (story 5) ════
  #
  # Surface: a self-host GitContext's probe actually spawns its command through the
  # private `#run` chokepoint, with cwd = the framework repo root (the self-host base
  # path) and the context token + git identity in the child env. #658 proved self-host
  # base-path resolution at construction; #659 proved a TARGET context's command
  # routes through `#run`. This is the first proof that a SELF-HOST context's command
  # launches under the framework root — the exact contract "route health-check
  # diagnostics through a self-host context" demands.

  # ── §1a  A self-host probe launches under the framework root, not the ambient cwd ──
  #
  # The headline. The legacy diagnostics ran bare `execSync(command)` with no cwd, so
  # they inherited `process.cwd()` — and a self-host consumer that drifts to the
  # ambient cwd diagnoses the WRONG checkout (the takeover-process-cwd defect the PRD
  # mined). Routed through a self-host context, the probe spawns with cwd = exactly the
  # framework repo root EVEN WHEN the process working directory has been moved away —
  # the context owns the cwd, the ambient process state cannot leak in. The framework
  # root sentinel differs from the test's real cwd, so a recorded cwd equal to it can
  # only be the context's explicit base-path cwd.

  @adw-699 @adw-yimifh-gitcontext-route-hea
  Scenario: A self-host diagnostic probe spawns under the framework repo root even when the process working directory has moved away
    Given a self-host GitContext for owner "paysdoc" repo "AI_Dev_Workflow" with auth token "token-selfhost" and git author "ADW Bot <bot@adw.dev>" and framework root "/srv/adw/framework" whose git and gh commands are captured by a recording runner
    And the process working directory is changed away from the context base path
    When the "current-branch" self-host probe runs through the context
    Then the captured command ran with auth token "token-selfhost" in its child environment
    And the captured command ran with git author "ADW Bot <bot@adw.dev>" in its child environment
    And the captured command ran with cwd equal to the context base path

  # ── §1b  Each representative diagnostic probe carries the token + framework-root cwd ─
  #
  # Breadth across the diagnostic surface: a pure-cwd git read, a repo-less gh probe,
  # and a repo-targeted gh probe each route through the per-command spawn path carrying
  # the context token, with cwd = the framework repo root (the self-host base path).
  # cwd = base path (not the ambient process cwd) is itself a strong migration signal:
  # the legacy probes ran under the ambient process cwd; a migrated probe runs under an
  # explicit context-owned cwd. This is a REPRESENTATIVE spread, not an exhaustive
  # enumeration — completeness across all the file's call sites is enforced by §2.

  @adw-699 @adw-yimifh-gitcontext-route-hea
  Scenario Outline: Each self-host diagnostic probe runs with the context token and the framework-root cwd
    Given a self-host GitContext for owner "paysdoc" repo "AI_Dev_Workflow" with auth token "token-selfhost" and git author "ADW Bot <bot@adw.dev>" and framework root "/srv/adw/framework" whose git and gh commands are captured by a recording runner
    When the "<probe>" self-host probe runs through the context
    Then the captured command ran with auth token "token-selfhost" in its child environment
    And the captured command ran with cwd equal to the context base path

    Examples:
      | probe          |
      | current-branch |
      | gh-auth        |
      | gh-issue-view  |

  # ── §1c  A self-host probe does not reintroduce a process-global mutation ──────────
  #
  # The whole epic exists to kill the process-global `GH_TOKEN` bleed; a diagnostic
  # that wrote `process.env.GH_TOKEN` would silently reopen it. Running a self-host
  # probe leaves the parent environment byte-for-byte unchanged — the token rode the
  # child env only.

  @adw-699 @adw-yimifh-gitcontext-route-hea
  Scenario: A self-host diagnostic probe leaves the parent process environment byte-for-byte unchanged
    Given a self-host GitContext for owner "paysdoc" repo "AI_Dev_Workflow" with auth token "token-selfhost" and git author "ADW Bot <bot@adw.dev>" and framework root "/srv/adw/framework" whose git and gh commands are captured by a recording runner
    And a baseline snapshot of the parent process environment is captured
    When the "gh-auth" self-host probe runs through the context
    Then the parent process environment matches the baseline snapshot

  # ═══════════════ §2  DIAGNOSTIC FILES DE-ALLOWLISTED AND GUARD-CLEAN (story 8) ════
  #
  # The headline for this slice. The git/gh guard tool IS the system under test; its
  # observable output is the `{ violations, scannedCount }` it computes for a file. An
  # ALLOWLISTED file is SKIPPED — the guard never scans it, so `scannedCount` stays 0.
  # After this slice each diagnostic file is removed from the ALLOWLIST, so the guard
  # SCANS it (`scannedCount` counts it) and, because its raw git/gh probes are gone,
  # finds NO violation. The "scanned" assertion is the de-allowlisting discriminator:
  # RED before this slice (the file is still exempt → not scanned), GREEN after. For
  # `healthCheckChecks.ts` the "no violation" assertion additionally proves ALL SEVEN
  # call sites migrated — a file removed from the ALLOWLIST is clean only when EVERY
  # raw git/gh call in it is gone.

  # ── §2  Each migrated diagnostic file is scanned by the guard and free of raw git/gh ─

  @adw-699 @adw-yimifh-gitcontext-route-hea
  Scenario Outline: The git/gh guard scans the migrated diagnostic script (no longer allowlisted) and finds no direct git/gh shell-out
    Given the ADW codebase is checked out
    When the git/gh guard scans the file "<file>"
    Then the git/gh guard scanned that file
    And the git/gh guard reports no violation in that file

    Examples:
      | file                      |
      | adws/healthCheckChecks.ts |
      | adws/healthCheck.tsx      |

  # ═══════════════ §3  WHOLE-REPO GUARD STILL PASSES (story 8) ═════════════════════
  #
  # The safe-de-allowlisting backstop. Removing the two files from the ALLOWLIST must
  # not surface a violation: every raw git/gh probe in each is genuinely gone,
  # including all seven of `healthCheckChecks.ts`'s call sites. Running the guard
  # across the whole repository reports zero violations. This fails loudly if a file is
  # de-allowlisted while a raw git/gh call still lives in it — the precise
  # incomplete-migration mistake this guards against (and the exact trap
  # `healthCheckChecks.ts`'s many call sites set). This is the `lint:git-guard` gate.

  # ── §3  The git/gh guard reports no violations across the repository ──────────────

  @adw-699 @adw-yimifh-gitcontext-route-hea
  Scenario: The git/gh guard passes across the whole repository after the diagnostic scripts are de-allowlisted
    Given the ADW codebase is checked out
    When the git/gh guard is run across the repository
    Then the git/gh guard reports no violations

  # ═══════════════ §4  TYPE-CHECK BACKSTOP (registry T22) ══════════════════════════
  #
  # ── §4  The migrated diagnostic surface keeps the ADW codebase type-clean ─────────
  #
  # A backstop consistent with the sibling per-issue features (feature-659, feature-663,
  # feature-691, feature-692, feature-693, feature-694, feature-695): the self-host
  # context construction in the diagnostics and the now raw-git/gh-free check functions
  # compile within the ADW codebase's type-check.

  @adw-699 @adw-yimifh-gitcontext-route-hea
  Scenario: The ADW TypeScript type-check passes with the migrated diagnostic surface in place
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
