@adw-695 @adw-0p8lxe-gitcontext-migrate-l
Feature: GitContext label / board / secret migration — the residual label, project-board, and Actions-secret gh ops route through the per-command-auth chokepoint, and the git/gh guard no longer exempts their three consumers

  Issue #695 (parent PRD `specs/prd/git-context-repo-authority.md`, see the
  **Operation surface**, the **Auth model**, and the **Enforcement** section, and
  user stories 5 and 18) is the slice that drives the git/gh guard ALLOWLIST toward
  zero for the last three gh-OPERATION consumers still shelling out raw: the
  six-label provisioner (`labelManager`, `gh label create` + `gh issue edit
  --add-label`), the Projects-V2 board manager (`githubBoardManager`, a residual `gh
  api graphql --input -` for the one mutation whose complex array variables the
  existing `runGraphQL` could not carry), and the dep-audit Actions-secret
  propagator (`depauditSetup`, `gh secret set`). Most of the gh-op surface these
  consumers need already lives on `GitContext`; this slice adds the ONE method that
  does not — `setSecret` — and routes all three consumers onto context methods, then
  removes them from the ratchet.

  Earlier slices established the machinery this one consumes:

    • #658 shipped the `GitContext` deep module — mandatory identity, the
      one-constructor base-path decision, `worktreePathFor(branch)`, and the
      `commandEnv()` per-command env overlay carrying the token + git
      author/committer.
    • #659 routed a representative READ op (default-branch) through the private
      `#run` chokepoint, proving the spawn path end to end: a command launches with
      cwd = base path and a child env carrying the token, the parent global
      untouched. It also registered the recording-runner machinery (`makeSpyExec`,
      the shared `W`, the token/author/cwd assertions) that every later GitContext
      per-issue slice reuses.
    • #663 migrated the full gh-OPERATION surface — issue/PR/comment AND the
      label-apply and project-board move-status ops — and ALREADY ADDED the
      `createLabel`, `applyLabel`, `runGraphQL`, and `moveIssueToStatus` methods this
      slice's `labelManager` and `githubBoardManager` consumers route through.
      Crucially #663 proved those methods route through `#run` (`label-apply`,
      `board-move` are in its `gh operation` dispatcher); this slice does NOT
      re-prove that — it migrates the residual CONSUMERS onto the already-proven
      methods and adds the one method (`setSecret`) #663 did not.
    • #691/#692/#693/#694 each shrank the SAME `checkGitGhGuard.ts` ALLOWLIST this
      slice shrinks further and registered the guard step definitions (`the git/gh
      guard scans the file …`, the whole-repo run) this slice reuses verbatim. #694,
      the immediately-preceding slice, removed the five phase-level git-READ
      consumers; this slice removes the three remaining gh-OPERATION consumers.

  Why this slice is **Blocked by #694**:

    #695 and #694 drive the SAME ratchet file — the `checkGitGhGuard.ts` ALLOWLIST —
    each removing a disjoint set of entries (#694 the five phase-level git-read
    consumers; #695 the three label/board/secret gh-op consumers). Sequencing #695
    after #694 keeps the ratchet monotonic and avoids a collision on that one shared
    edit site: #695 removes its three entries from the already-reduced ALLOWLIST #694
    left behind. (The two slices touch different consumer files and a disjoint slice
    of `gitContext.ts` — #694 added git-read methods, #695 adds the gh `setSecret`
    method — so the only true overlap is the ALLOWLIST, which the ordering
    serialises.)

  What this slice builds:

    • ONE NEW gh-operation method on `GitContext` — `setSecret` — going through the
      existing `#run` chokepoint, covering the command shape `depauditSetup` needs
      (`gh secret set <NAME> --repo <owner>/<repo> --body -`, the secret value handed
      to the child on stdin) (story 18). Unlike #663 (which added the whole
      issue/PR/comment/label/board surface) and #694 (four new read methods), this
      slice adds exactly ONE new method, because the label and board surfaces ALREADY
      exist on the context (`createLabel`/`applyLabel`/`runGraphQL`/`moveIssueToStatus`,
      added by #663). The exact `setSecret` signature (whether it takes
      `(name, value)` and pipes the value to stdin, whether it returns void or a
      status) is an implementer's choice (see Scope notes); the scenarios pin the
      OBSERVABLE migration — token, identity, and cwd on the recorded command — not
      the signature.
    • The three residual consumers — `labelManager`, `githubBoardManager`,
      `depauditSetup` — stop shelling out to raw `gh` and route through the context
      instead:
        – `labelManager` routes its `gh label create` and `gh issue edit --add-label`
          call sites onto the pre-existing `createLabel` / `applyLabel` (or
          `addIssueLabel`) methods (story 18),
        – `githubBoardManager` routes its residual `gh api graphql --input -`
          mutation — the one whose complex array variables `runGraphQL` could not
          previously carry — through the context's GraphQL path (story 18). Its other
          GraphQL calls already go through `this.ctx.runGraphQL`; only the
          stdin-piped mutation remains raw,
        – `depauditSetup` routes its `gh secret set` call onto the new `setSecret`
          method (story 18).
      With their last raw `gh` call gone, each is REMOVED from the guard ALLOWLIST in
      `adws/checkGitGhGuard.ts` (the three "residual" entries), so the guard scans
      them like any other file (story 5).

  One consumer carries a DUAL raw call site — the all-or-nothing-per-file trap:

    The guard is ALL-OR-NOTHING per file: a file removed from the ALLOWLIST is clean
    ONLY when EVERY raw `git`/`gh` call in it is gone. `labelManager` shells two
    distinct `gh` commands from two helpers — `gh label create` (its label
    provisioner) AND `gh issue edit --add-label` (its issue-labeller); BOTH call
    sites must route onto context methods before the file can leave the ALLOWLIST
    clean. This is the same trap #694's `worktreeSetup` (dual `ls-files`) and #693's
    `branchOperations` set; here it is enforced the same way — only through §2's
    guard-clean assertion over the whole of `labelManager`, never by re-pinning each
    individual call in §1.

  Why this slice exists — the defect it forecloses:

    A consumer that shells out to raw `gh secret set` / `gh label create` / `gh api
    graphql` authenticates against whatever repo last wrote the process-global
    `GH_TOKEN`, gated by the module-global `activeRepo`. The board manager's own
    source has long warned its ops "must run sequential … concurrent instances in
    the same process would race on process.env.GH_TOKEN"; `depauditSetup` propagates
    a Socket/Slack secret to "the target repo" — but a token-bleed makes it propagate
    to whichever repo the global last pointed at, writing a SECRET into the WRONG
    repository, the precise wrong-repo class the PRD mined ~13 times, now on the
    secret-propagation path. While any of these consumers sits on the ALLOWLIST, the
    guard also cannot catch a NEW raw `git`/`gh` call sneaking in beside it. Routing
    each op through `#run` binds its auth to the call (the token rides the child env,
    no shared global to clobber), and de-allowlisting the file re-arms the guard so
    any future raw call in it is a build failure, not a silent regression. Behaviour
    is unchanged; only token APPLICATION (per-command vs process-global) and guard
    COVERAGE change.

  Contract pinned here (the OBSERVABLE behaviour, not the field/signature shape):

    • new method goes through #run → the `setSecret` method spawns its command with a
                                    child env carrying the context's token + git
                                    author/committer, and cwd = the context base path
                                    (§1a; story 18).
    • per-command auth            → running `setSecret` leaves the parent process
                                    environment byte-for-byte unchanged — no
                                    reintroduced global mutation on the last new
                                    gh-op method (§1b; story 18).
    • consumer de-allowlisted     → the guard, run against each of the three migrated
                                    consumer files, SCANS the file (it is no longer
                                    exempt) and finds NO direct git/gh shell-out in it
                                    (§2; story 5).
    • guard still passes          → with the three files removed from the ALLOWLIST,
                                    the guard run across the whole repository reports
                                    zero violations — the de-allowlisting introduced
                                    no new violation, including `labelManager`'s dual
                                    call sites; the ratchet simply sits lower (§3;
                                    story 5).

  Observability / rot-prevention note:

    Every assertion below targets a runtime OUTPUT of the system under test, never
    the static text of a source file. No step opens `gitContext.ts`,
    `labelManager.ts`, `githubBoardManager.ts`, `depauditSetup.ts`, or
    `checkGitGhGuard.ts` as text, substring-matches its contents, or parses it as
    JSON/AST.

      • §1 runs `setSecret` through a RECORDING RUNNER injected as the context's
        command boundary (the `GitContextDeps.exec` seam #659 established — the same
        recorder category as the registered `git-mock`/`mock server` collaborators in
        `vocabulary.md`) and asserts the RECORDED `cwd` and child `env` the context
        handed that runner. The recorded `(cwd, env)` is the command's actual launch
        parameters — a runtime artefact, not a source read. The "parent env
        unchanged" step compares the LIVE `process.env` before and after the op;
        `process.env` is live runtime state, the canonical observable for "was the
        global mutated," which the Rot-Detection Rubric permits.
      • §2 and §3 assert the GUARD'S VERDICT, where the guard tool IS the system
        under test. The guard's exported `scanFiles` returns a `{ violations,
        scannedCount }` result — a value computed at runtime, the guard's OUTPUT — and
        the steps assert that result. This is the SAME artefact category as registry
        T22 ("the ADW TypeScript type-check passes"), which runs `tsc` over the whole
        source tree and asserts its verdict: the analyzer reads source, but the
        SCENARIO asserts the analyzer's OUTPUT, never source text. Critically,
        "removed from the ALLOWLIST" is NOT asserted by grepping `checkGitGhGuard.ts`
        for the path — it is proven only through its OBSERVABLE CONSEQUENCE: the guard
        now SCANS the file (its `scannedCount` counts it; an allowlisted file is
        skipped and never counted), and finds it violation-free. A refactor that
        renames a consumer or restructures the guard leaves these assertions valid as
        long as the BEHAVIOUR holds — the file is scanned and clean.

    The file paths, owners/repos, tokens, authors, and op names in the steps are
    INPUT test data; the recorded `(cwd, env)`, the live `process.env`, the guard's
    `{ violations, scannedCount }`, and the type-check exit code are the system's
    OUTPUTS — exactly the artefact category the rubric permits. The recording runner
    means no real `gh` is spawned and no network is touched in §1, so those scenarios
    are hermetic.

  Scope notes:

    • This slice pins TWO observable contracts: (a) the ONE new gh-op method
      (`setSecret`) routes its spawn through the per-command-auth `#run` chokepoint
      with the context token and base-path cwd (§1), and (b) the three consumer files
      are now scanned by the guard and are violation-free (§2), with the whole-repo
      guard still passing (§3). Together these prove the label/board/secret gh ops
      moved off raw `gh` and onto the context: the consumers contain no raw `git`/`gh`
      (guard-clean, §2) and the one new method that replaces the raw secret call
      carries per-command auth and the right cwd (§1).
    • §1 deliberately proves ONLY `setSecret`. The label and board surfaces
      (`createLabel`/`applyLabel`/`runGraphQL`/`moveIssueToStatus`) already exist and
      #663 ALREADY proved they route through `#run` (its `gh operation` dispatcher
      covers `label-apply` and `board-move`); re-pinning them here would duplicate
      #663 and collide with its globally-loaded steps. The `labelManager` and
      `githubBoardManager` migrations are CONSUMER changes onto those already-proven
      methods, and their observable is §2 (guard-clean) — that is where the routing is
      verified, not §1.
    • The exact threading of a `GitContext` into each consumer (constructor param,
      injected dep's default, or — for `githubBoardManager`, which already holds
      `this.ctx` via `gitContextForRepo` — its existing context handle) is an
      implementer's choice and is deliberately NOT pinned, consistent with the sibling
      slices' "pin the decision, not the shape" stance (#658/#659/#663/#691/.../#694).
      How `githubBoardManager` carries the one mutation's complex array variables
      (extend `runGraphQL` to accept a stdin body, or a new input-capable GraphQL
      method) is likewise the implementer's choice — the scenario pins only that the
      file ends up guard-clean.
    • `setSecret` is the ONLY new method; it does not reuse a pre-existing context
      method. The friendly op name `"set-secret"` in §1 maps to that method inside the
      step definitions — exactly as #694's `ls-files`/`head-short` mapped to its read
      methods. The secret value is handed to the child on stdin (the legacy `--body -`
      shape, a security property so the secret never appears in argv); that stdin
      behaviour is `depauditSetup`'s own concern, preserved unchanged and covered by
      its existing unit suite, and is NOT re-pinned here (the recording runner records
      command/cwd/env, not stdin) — §1 pins the migration observable (token, identity,
      base-path cwd), and §1b that the new method introduces no global mutation.
    • `labelManager`'s TWO `gh` call sites (`gh label create`, `gh issue edit
      --add-label`) both migrate onto context methods; that completeness is enforced
      here ONLY by §2's guard-clean assertion over the whole of `labelManager` (a file
      removed from the ALLOWLIST is clean only when EVERY raw gh call in it is gone),
      not re-pinned as separate §1 proofs.
    • Parent-global isolation and two-context isolation for the `#run` spawn path are
      already proven exhaustively by #659 and #663; the `setSecret` method routes
      through the SAME chokepoint, so this slice re-pins only ONE representative
      parent-env-unchanged check (§1b) — an anti-regression that the LAST new gh-op
      method does not reintroduce a global mutation — and does not restate the full
      isolation matrix.
    • Auth ACQUISITION is unchanged: token minting/refresh is untouched; only token
      APPLICATION (per-command vs process-global) changes. No scenario here drives the
      minting path, an orchestrator, or the cron poller as a subprocess.
    • Behaviour of the consumers themselves (the idempotent six-label provisioning and
      lazy-create-on-not-found retry in `labelManager`, the board column merge/insert
      logic in `githubBoardManager`, the secret-skip-when-unset and warning aggregation
      in `depauditSetup`) is unchanged and already covered by their existing unit
      suites; this slice adds coverage for the op-path migration and the guard
      de-allowlisting, it does not relax those suites.
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

    Novel phrasing introduced here — the registry has no phrase for running the new
    SECRET gh-op method through the context. Phrased DISTINCTLY from #659's `read
    operation`, #663's `gh operation`, #691's `gh-read operation`, #692's
    `identity-read operation`, #693's `vcs-probe operation`, and #694's `git-read
    operation` (this uses `secret operation`) so the step files do not collide as
    Cucumber loads them all globally. The label and board ops deliberately get NO new
    §1 phrase — they reuse #663's already-registered `gh operation` machinery and are
    verified here only at the guard surface (§2). No `/` is used in any step phrase
    (Cucumber treats `/` as alternation). Surfaced to the maintainer in the agent
    Output:
      Running the new secret gh-op method through the context:
        • `the {string} secret operation runs through the context`

    Step-definition note for the maintainer:
      • §1 steps phase-import `GitContext` and REUSE the shared `gitContextSharedWorld.ts`
        machinery (`makeFullOptions`, `makeSpyExec`, `makeNoOpFsDeps`, the shared `W`)
        exactly as `feature-691.steps.ts` / `feature-692.steps.ts` / `feature-693.steps.ts`
        / `feature-694.steps.ts` do, so #659's globally-registered assertion steps apply
        to the recorded calls without redefinition.
      • `the {string} secret operation runs through the context` adds a NEW dispatcher
        (parallel to #694's `git-read operation` switch) over the one new method,
        invoked WITHOUT a worktree path so it defaults to the context base path cwd:
          "set-secret" → the new `setSecret` method (`gh secret set <NAME> --repo …
                         --body -`) — seed `W.responseMap` for `secret set` with an
                         empty/ok string so the call returns without throwing, then
                         call `W.ctx.setSecret("SOCKET_API_TOKEN", "s3cr3t-value")`
                         (name + value; the value rides stdin, not asserted).
        Construct the context via `makeFullOptions(owner, repo, token, authorName,
        authorEmail)` + `new GitContext(opts, { exec: makeSpyExec(W.responseMap).exec,
        fsDeps: makeNoOpFsDeps() })`, store it on `W.ctx` and the recorder's `calls` on
        `W.spyCalls` (the recording-runner Given already does this). No real subprocess,
        no network, no fs — the token/author/cwd assertions are value-based comparisons
        against the recorded child `env`/`cwd`.
      • The guard steps (§2/§3) require NO new definitions — they resolve to
        feature-691.steps.ts (`scanFiles`). The type-check step (§4) resolves to
        feature-504.steps.ts (T22).

  Background:
    Given the ADW codebase is checked out

  # ═══════════════ §1  THE NEW setSecret METHOD ROUTES THROUGH #run (story 18) ════
  #
  # Surface: the one genuinely-new gh-op method this slice adds actually spawns its
  # command through the private `#run` chokepoint. Its observable output is the
  # command's launch parameters — the cwd and the child environment the context
  # handed the recording runner. #663 already proved the label-apply and board-move
  # methods route this way; here it is the secret-set method #663 did not add.

  # ── §1a  The new secret-set method carries token + git identity + base-path cwd ───
  #
  # The headline for the new surface. `depauditSetup` propagates a Socket/Slack secret
  # to the TARGET repo; a token-bleed would write that secret into whatever repo the
  # process-global last pointed at. Routed through the context, `setSecret` spawns its
  # `gh secret set` command with the context's token AND git author/committer in the
  # child env (commandEnv always overlays the git identity, gh op or not), with cwd =
  # the context base path — never the ambient process cwd the legacy
  # `execWithRetry('gh secret set …')` inherited. cwd = base path (not the ambient
  # cwd) is itself a strong migration signal even though `--repo` makes the operation
  # repo-targeted: the legacy call ran under the ambient process cwd; a migrated call
  # runs under an explicit context-owned cwd.

  @adw-695 @adw-0p8lxe-gitcontext-migrate-l
  Scenario: The new setSecret method supplies the context token, git identity, and base-path cwd to its child command
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    When the "set-secret" secret operation runs through the context
    Then the captured command ran with auth token "token-acme" in its child environment
    And the captured command ran with git author "Acme Bot <bot@acme.dev>" in its child environment
    And the captured command ran with cwd equal to the context base path

  # ── §1b  The new secret-set method does not reintroduce a process-global mutation ─
  #
  # `setSecret` is the LAST new gh-op method the epic adds. The whole epic exists to
  # kill the process-global `GH_TOKEN` bleed; a sloppy new method that wrote
  # `process.env.GH_TOKEN` would silently reopen it. Running the new method leaves the
  # parent environment byte-for-byte unchanged — the token rode the child env only.

  @adw-695 @adw-0p8lxe-gitcontext-migrate-l
  Scenario: A secret-set op leaves the parent process environment byte-for-byte unchanged
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    And a baseline snapshot of the parent process environment is captured
    When the "set-secret" secret operation runs through the context
    Then the parent process environment matches the baseline snapshot

  # ═══════════════ §2  CONSUMERS DE-ALLOWLISTED AND GUARD-CLEAN (story 5) ══════════
  #
  # The headline for this slice. The git/gh guard tool IS the system under test; its
  # observable output is the `{ violations, scannedCount }` it computes for a file. An
  # ALLOWLISTED file is SKIPPED — the guard never scans it, so `scannedCount` stays 0.
  # After this slice each consumer is removed from the ALLOWLIST, so the guard SCANS it
  # (`scannedCount` counts it) and, because its raw label/board/secret calls are gone,
  # finds NO violation. The "scanned" assertion is the de-allowlisting discriminator:
  # RED before this slice (the file is still exempt → not scanned), GREEN after. For
  # `labelManager` the "no violation" assertion additionally proves BOTH the `gh label
  # create` and `gh issue edit` call sites migrated — a file removed from the ALLOWLIST
  # is clean only when EVERY raw gh call in it is gone.

  # ── §2  Each migrated consumer is scanned by the guard and free of raw git/gh ─────

  @adw-695 @adw-0p8lxe-gitcontext-migrate-l
  Scenario Outline: The git/gh guard scans the migrated label/board/secret consumer (no longer allowlisted) and finds no direct git/gh shell-out
    Given the ADW codebase is checked out
    When the git/gh guard scans the file "<file>"
    Then the git/gh guard scanned that file
    And the git/gh guard reports no violation in that file

    Examples:
      | file                                        |
      | adws/github/labelManager.ts                 |
      | adws/providers/github/githubBoardManager.ts |
      | adws/phases/depauditSetup.ts                |

  # ═══════════════ §3  WHOLE-REPO GUARD STILL PASSES (story 5) ═════════════════════
  #
  # The safe-de-allowlisting backstop. Removing the three files from the ALLOWLIST
  # must not surface a violation: each one's last raw gh call is genuinely gone,
  # including `labelManager`'s second call site. Running the guard across the whole
  # repository reports zero violations. This fails loudly if a consumer is
  # de-allowlisted while a raw gh call still lives in it — the precise
  # incomplete-migration mistake this guards against (and the exact trap
  # `labelManager`'s dual call sites set).

  # ── §3  The git/gh guard reports no violations across the repository ──────────────

  @adw-695 @adw-0p8lxe-gitcontext-migrate-l
  Scenario: The git/gh guard passes across the whole repository after the label/board/secret consumers are de-allowlisted
    Given the ADW codebase is checked out
    When the git/gh guard is run across the repository
    Then the git/gh guard reports no violations

  # ═══════════════ §4  TYPE-CHECK BACKSTOP (registry T22) ══════════════════════════
  #
  # ── §4  The migrated label/board/secret surface keeps the ADW codebase type-clean ─
  #
  # A backstop consistent with the sibling per-issue features (feature-659, feature-663,
  # feature-691, feature-692, feature-693, feature-694): the new `setSecret` context
  # method and the now raw-gh-free consumers compile within the ADW codebase's
  # type-check.

  @adw-695 @adw-0p8lxe-gitcontext-migrate-l
  Scenario: The ADW TypeScript type-check passes with the migrated label/board/secret surface in place
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
