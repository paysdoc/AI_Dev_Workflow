@adw-790 @adw-q46zy4-promote-gitcontext-s
Feature: The GitContext spawn chokepoint is a public, forge-neutral executor — command in, working-directory class chosen by the caller, credentials handed over per command, and nothing about GitHub in the signature

  Issue #790 is the first slice of the GitContext forge-agnostic refactor
  (`specs/prd/gitcontext-forge-agnostic-refactor.md`). It promotes the package's private spawn
  chokepoint — `GitContext.#run` (`adws/gitContext/gitContext.ts:168`) and `#runRepoApi` (`:192`) —
  to the core's PUBLIC primitive, so that every later slice (TokenProvider port #791, GitHub forge
  adapter #792, caller migration #796/#797) is built on one named, reviewed entry rather than on a
  private method reachable only from inside the class.

  Today the chokepoint takes `(command, {cwd?, input?, usePat?})`. Three of those four inputs are
  fine for a forge-neutral core; `usePat` is not — it names a GitHub concept (Personal Access Token
  versus App installation token) and it makes the executor *choose* a credential rather than *carry*
  one. The PRD's shape for this slice:

      command  +  working-directory class  +  per-command credential environment  +  optional stdin

  "Working-directory class" is the load-bearing phrase. It is not a free path: it is the CALLER's
  declaration of which directory family the command belongs to — the target workspace (optionally
  narrowed to an explicit worktree beneath it) or the framework root. That distinction is exactly the
  contract #775 established and this slice must carry forward unchanged: repo-independent commands
  run from the injected framework repository root, which exists on every host whether or not a
  workspace was ever cloned; workspace-scoped commands run from the workspace or from the supplied
  worktree.

  Two properties travel with the promotion:

    • THE MISSING-WORKING-DIRECTORY REWRAP STAYS INSIDE (#777, `workingDirectoryGuard.ts`). A spawn
      that fails because its working directory does not exist becomes an error naming the path and
      the repository identity, preserving `code: 'ENOENT'`. Because the rewrap sits in the executor,
      a caller of the PUBLIC entry gets it too — it is not a property of the internal call sites.
    • NO FORGE SEMANTICS. The executor must not know what the command means. It does not read the
      command string to decide where to run it, it does not select a credential, and it does not
      rewrite what it was given.

  `usePat` remains FUNCTIONAL in this slice — it leaves in the TokenProvider slice — but it must not
  appear in the new public signature. Both halves are pinned below: internal PAT-requiring operations
  keep working (§7), and the flag has no purchase on the public entry (§8).

  The behavioural contract pinned below:

     1. ONE PUBLIC ENTRY THAT RUNS WHAT IT IS GIVEN (AC1). An arbitrary, non-forge command executes
        through the public executor; the command that reaches the spawn seam is its own text, and the
        seam's output comes back to the caller (trimmed, as all 83 existing call sites require).
        RED before — there is no public entry to call today.
     2. THE CALLER PICKS THE WORKING-DIRECTORY CLASS; THE EXECUTOR NEVER INFERS IT (AC1, "no forge
        semantics"). The rows are deliberately CROSSED against the package's own conventions — a gh
        command asked to run in the workspace, a git command asked to run in the framework root —
        because a chokepoint that classified by sniffing the command string would pass an uncrossed
        test and fail these. That implementation is the one this slice must foreclose: it looks
        correct while GitHub is the only forge and silently misroutes the first `glab`, `jira` or
        `hg` command a later adapter hands it. RED before.
     3. THE FRAMEWORK-ROOT CLASS IS THE INJECTED ROOT (AC2, preserving #775). It resolves to the
        injected `frameworkRepoRoot` — not to the context base path, and not to `process.cwd()`,
        which is the fallback the GitContext PRD bans and the root of the wrong-base-repo class.
     4. THE WORKSPACE CLASS IS THE WORKSPACE, AND AN EXPLICIT WORKTREE NARROWS IT (AC2). The other
        half of the existing cwd contract. Worktree-scoped commands are a large fraction of the
        package's git surface — `branchOps`, `commitOps`, `worktreeProbeOps` and `gitReadOps` all
        take an explicit directory — so a cwd class that could only express "the workspace" could not
        carry them.
     5. EXISTING OPERATIONS KEEP THEIR WORKING DIRECTORIES THROUGH THE PROMOTED EXECUTOR (AC2, AC4).
        The refactor is meant to be operationally invisible, and the working directory is where an
        invisible refactor would most easily become visible. Asserted across a repo-API read, a
        stdin-carrying write, a PAT-requiring write, the repo-free identity probe, the board query
        and three workspace-git reads. GREEN before and after — it fails the moment the promotion
        collapses the two classes into one default.
     6. THE CREDENTIAL ENVIRONMENT IS PER COMMAND AND CALLER-SUPPLIED (AC1). Two executions with two
        different credentials produce two child environments carrying their own, and neither is
        replaced by the context's own token — the difference between an executor that CARRIES a
        credential and one that CHOOSES one. This is the seam the TokenProvider slice plugs into.
        The same scenario pins the other direction: the caller supplies an OVERLAY, so `PATH` is
        still inherited. An executor that treated the parameter as the whole environment would ship
        children with no `PATH`, and the first adapter call site that forgot to spread `process.env`
        would be the one to find out.
     7. PAT SELECTION STAYS FUNCTIONAL FOR INTERNAL OPERATIONS (issue: "remains functional in this
        slice"). GitHub forbids an App identity from approving a PR and gates Projects V2 behind a
        PAT, so `approvePR` genuinely needs the PAT while an ordinary read needs the installation
        token. A slice that cleaned the signature by deleting the behaviour would break PR approval
        in production and pass every other scenario here. GREEN before and after.
     8. …BUT THE FLAG HAS NO PURCHASE ON THE PUBLIC ENTRY (AC1). A caller that hands the public entry
        both a credential and a PAT-selection flag gets the credential it supplied — the flag cannot
        reach through and swap in the context's PAT. RED before.
     9. OPTIONAL STANDARD INPUT (AC1). Supplied stdin reaches the child; omitted stdin stays omitted
        (`defaultExec` branches on `input !== undefined`, `gitContext.ts:63-71`, and passes
        `stdio: ['pipe','pipe','pipe']` only when stdin is supplied, so an executor that always
        forwarded an empty string would change how every stdin-free command is spawned); and the nine
        repo-API writes that carry their payload on stdin — issue comments, issue creation, body
        updates, PR comments, PR creation, secrets, the GraphQL-input mutation — still deliver it
        through the promoted entry.
    10. EVERY INTERNAL OPERATION REACHES THE SEAM THROUGH THE PUBLIC EXECUTOR (AC4). The routing half
        of "all internal git/gh operations route through it", observed by wrapping the context's own
        public executor with a pass-through observer and asserting that nothing reached the spawn
        seam around it.
    11. THE MISSING-WORKING-DIRECTORY REWRAP STAYS INSIDE THE EXECUTOR (AC3). A PUBLIC execution
        whose working directory does not exist raises the actionable #777 error — recognisable by its
        error code, naming the directory and naming the repository. Asserted through the public entry
        precisely because that is what "stays inside" means: not re-implemented at the call sites.
    12. EVERY OTHER FAILURE REACHES THE CALLER UNWRAPPED (AC3 guard). The rewrap is a diagnosis, never
        a blanket wrap. The sharp row is an ENOENT raised while the working directory DOES exist — a
        missing binary, not a missing directory. Rewrapping it would relabel "gh is not installed" as
        "this workspace was never cloned" and send the reader looking for the wrong problem. GREEN
        before and after.
    13. NO PROCESS-ENVIRONMENT MUTATION (AC5). Per-command credentials are only safe because they
        never become process-global: the ~13-incident GH_TOKEN-bleed class (vestmatic #143/#181/#187)
        was exactly a token pinned on `process.env` by one repo's work and read by another's. Both
        credential paths are exercised — a caller-supplied credential through the public entry, and
        the internal PAT selection — because either could be implemented by assigning to `process.env`
        and would then pass every other assertion in this file.
    14. TYPE-CHECK BACKSTOP (T22), which is also where the signature claim is enforced — see the
        scope note below.

  Mapping onto the issue's acceptance criteria:
    AC1 (public executor accepts command + cwd-class + credential env + optional stdin; no
        GitHub-specific parameters in its signature) → §1, §2, §6, §8, §9 behaviourally; §14 for the
        signature itself
    AC2 (repo-independent commands still run from the framework root; existing repoApiCwd behaviour
        unchanged) → §3, §4, §5
    AC3 (ENOENT rewrap still produces the actionable error naming path and repo identity) → §11, §12
    AC4 (all existing GitContext operations route through the executor) → §10, with §5 as the
        behavioural half. The "full unit suite green" half of AC4 is a plan VALIDATION command
        (`bun run test:unit`), not a scenario — a scenario shelling out to the whole unit suite would
        be slow, circular, and would assert nothing this file does not already assert.
    AC5 (extended tests assert executed command, env and cwd via the injected exec fake; no
        process.env mutation) → every scenario here asserts against the injected seam's recorded
        `(command, cwd, env, stdin)`; the no-mutation half is §13. The "extended tests" wording names
        the unit suites (`gitContext.test.ts`, `repoApiCwd.test.ts` — both in Touched Files); these
        scenarios are the behavioural mirror, not a replacement.

  Observability / rot-prevention note:

    Every assertion targets an artefact the system PRODUCES: the `(command, cwd, env, stdin)` tuple
    the context hands its injected spawn seam (vocabulary surface #2, recorded calls — the same
    surface feature-659 / feature-663 / feature-691 / feature-775 use), the value a public method
    returns, the error a public method raises, and the type-checker's exit status (surface #4). No
    step reads `gitContext.ts`, `types.ts` or any other framework source as text, substring-matches
    its contents, or parses it as JSON/AST.

  Scope notes:

    • THE PLAN FOR THIS ISSUE IS ALREADY WRITTEN AND THESE SCENARIOS ARE ALIGNED TO IT:
      `specs/issue-790-adw-q46zy4-promote-gitcontext-s-sdlc_planner-forge-neutral-executor.md`
      (committed on this branch before this file). It settles the signature as
      `exec(command: string, options: ExecOptions): string` with
      `ExecOptions = { cwd: ExecWorkingDirectory; env: NodeJS.ProcessEnv; input?: string }` and
      `ExecWorkingDirectory = { kind: 'workspace'; path?: string } | { kind: 'frameworkRoot' }`;
      `#run` and `#runRepoApi` survive as three-line classifiers over the public `exec`, keeping
      `usePat` private. The Gherkin below deliberately does NOT name that shape — it says "the
      framework root directory" and "the target workspace directory", never `{kind: 'frameworkRoot'}`
      — so that a HITL reviewer who reshapes the signature invalidates one helper in the step
      definitions rather than thirty scenarios.
    • WHY §14 CARRIES THE "NO GITHUB-SPECIFIC PARAMETERS IN ITS SIGNATURE" CLAIM AND NO SCENARIO DOES.
      That criterion is the one with no runtime shadow: a signature is a compile-time fact, and the
      only honest witness is the type-checker. The plan's step 10 puts a `@ts-expect-error` case on
      `ExecOptions` carrying `usePat: true` into `gitContext.test.ts`; because `adws/tsconfig.json`
      globs `./**/*.ts`, that file is type-checked by the very command §14 runs, so re-adding a
      forge-specific parameter turns the `@ts-expect-error` unused and fails §14. Writing a scenario
      that authored its own probe file and shelled out to `tsc` was considered and rejected: it would
      add ~20s per scenario, hard-code the literal options shape this file otherwise avoids, and
      duplicate a check the type-checker already performs. THE RESIDUAL GAP IS REAL AND WORTH SAYING
      OUT LOUD: if the implementer omits the `@ts-expect-error` case, §14 passes vacuously. §8 is the
      behavioural backstop — it holds whatever the type declares — and the plan's AC10 is where the
      compile-time half is contracted.
    • §10 FORECLOSES A "PUBLIC FAÇADE OVER A RETAINED PRIVATE CHOKEPOINT", deliberately. The shape it
      rules out is `exec()` public, delegating to a private `#spawn()` that the 83 internal call sites
      keep calling directly: that satisfies "there is a public executor" while leaving TWO entries, so
      the public one is never exercised by the code that matters and can drift from it silently —
      which is the failure mode this slice exists to prevent ("this API is the foundation every later
      slice builds on"). The committed plan chose the INVERSE and correct shape — private classifiers
      delegating to the public executor — so §10 passes under it. It is still the most contestable
      assertion in the file and the one HITL review should look at first: if the reviewer prefers the
      façade, §10 is the scenario to strike.
    • `commandEnv(base, usePat)` IS NOT THE EXECUTOR AND IS DELIBERATELY NOT PINNED HERE. It is a
      separate public method whose `usePat` parameter is equally GitHub-specific, but it is consumed
      OUTSIDE the package — `adws/phases/buildPhase.ts:157`, `:235` and
      `adws/phases/scenarioFixPhase.ts:131` pass `gitCtx.commandEnv()` into agent subprocess
      environments — and the issue scopes the cleanup to "the new public signature", i.e. the
      executor's. Narrowing `commandEnv` is #791's business. Flagged because an implementer reading
      AC1 as "purge `usePat` from every public signature" would break three phase call sites for no
      acceptance criterion.
    • WHAT THIS FILE DOES NOT RE-PIN. #775 owns the full repo-API cwd surface (12 operations) and #777
      owns the full missing-directory error surface (workspace, worktree, self-host, ensure-flow,
      takeover probe, worktree listing). Both stay green and UNMODIFIED — they are the regression net
      for the behaviour this refactor must preserve, and duplicating them here would double the
      maintenance cost of the next change to that contract. §5 and §11 re-pin a representative slice
      only, and re-pin it THROUGH THE PROMOTED ENTRY, which is the thing that is actually new.
    • THE PLAN'S TWO NEW GUARD CLAUSES — empty command, empty explicit worktree path — ARE NOT PINNED
      HERE ON PURPOSE. They are plan-invented hardening (a real hole: `opts.cwd ?? basePath` treats
      `''` as a directory because `''` is not nullish), not issue acceptance criteria, and the plan
      covers them in the unit suite where a two-line `expect(...).toThrow(/GitContext/)` says
      everything a scenario would say at a fraction of the cost.
    • `usePat` HAS EXACTLY SEVEN INTERNAL CALL SITES — `approvePR` (`gitContext.ts:562`), `runGraphQL`
      (`:598`), `runGraphQLInput` (`:603`) and the four `moveIssueToStatus` queries (`:615`, `:622`,
      `:632`, `:641`). All seven are repo-API. §7 pins `approvePR` as the representative; the unit
      suite covers the rest (`gitContextOperations.test.ts:911`, `repoApiCwd.test.ts:263`).
    • THE PAT FALLBACK IS PART OF THE CONTRACT: `(usePat && this.#pat) ? this.#pat : this.#token`, so
      a context with no PAT configured falls back to the primary token. §7 and §8 must construct the
      context WITH a PAT or they would pass vacuously — `makeFullOptions` in the shared world does not
      set one (see the step-definition note).
    • THE @regression MAINTENANCE SWEEP IS SKIPPED for this issue: `.adw/scenarios.md` configures a
      `## Regression Scenario Directory`, so promotion is a deliberate human decision and this agent
      never auto-promotes.

  Vocabulary note:

    Registered phrases reused (`features/regression/vocabulary.md`):
      G18  `the ADW codebase is checked out`
      T22  `the ADW TypeScript type-check passes`

    Novel phrasing introduced here. The registry has no phrase for a public command executor, a
    working-directory class or a caller-supplied credential overlay, and the GitContext cwd families
    live in per-issue step definitions rather than in the registry. Every phrase below is deliberately
    DISTINCT from the existing GitContext families — feature-775's `… runs through the context` /
    `the recorded repo-API command …` / `the recorded workspace-git command …`, feature-777's
    `… is issued for the repository` / `the failure names …`, and feature-659's `the captured command
    ran with cwd equal to …` — so feature-790.steps.ts can be self-contained with zero
    AmbiguousStepDefinition risk under the globally-loaded per-issue step definitions (`cucumber.js`
    imports `features/per-issue/step_definitions/**/*.ts`). Every Then phrase is prefixed
    `the executor …`, `the recorded executor command …` or `the recorded command for the … context
    method` to keep that separation legible. Surfaced to the maintainer in the agent Output:
      • `a git context for target repository {string}`
      • `the context is configured with the primary token {string} and the personal access token {string}`
      • `the context's spawn seam records every command`
      • `the context's spawn seam records every command and answers {string}`
      • `the context's spawn seam raises {string}`
      • `the context's public executor is wrapped with a pass-through observer`
      • `the process working directory is moved outside both the framework root and the workspace`
      • `the command {string} is executed through the public executor in the {string} directory`
      • `the command {string} is executed through the public executor in the worktree directory for branch {string}`
      • `the command {string} is executed through the public executor in the {string} directory carrying the credential token {string}`
      • `the command {string} is executed through the public executor in the {string} directory carrying the standard-input payload {string}`
      • `the command {string} is executed through the public executor in the {string} directory with a PAT-selection flag set and the credential token {string}`
      • `the {string} context method is invoked`
      • `the {string} context method is invoked for the worktree of branch {string}`
      • `the executor returns the trimmed output {string}`
      • `the recorded executor command is exactly {string}`
      • `the recorded executor command ran in the {string} directory`
      • `the recorded executor command ran in the worktree directory for branch {string}`
      • `the recorded executor command carried the credential token {string} in its child environment`
      • `the recorded executor command inherited the process environment's PATH`
      • `the recorded executor commands carried the credential tokens {string} and {string} in order`
      • `the recorded executor command carried the standard-input payload {string}`
      • `the recorded executor command carried no standard input`
      • `the recorded command for the {string} context method ran in the {string} directory`
      • `the recorded command for the {string} context method carried the credential token {string} in its child environment`
      • `the recorded command for the {string} context method carried the standard-input payload {string}`
      • `every recorded spawn command passed through the public executor`
      • `the executor failure is recognisable by the missing-working-directory error code`
      • `the executor failure names the working directory that could not be entered`
      • `the executor failure names the repository {string}`
      • `the executor failure is the spawn seam's own failure, unwrapped`
      • `no process environment variable was modified by the run`

    Step-definition note for the maintainer (feature-790.steps.ts):

      • REUSE `gitContextSharedWorld.ts`, per the committed plan's step 12 — `FRAMEWORK_ROOT`,
        `TARGET_REPOS_ROOT`, `makeFullOptions`, `makeNoOpFsDeps` — and do NOT build a second world.
        Nothing here spawns a real process or touches a real directory: every scenario drives the real
        `GitContext` in-process with an injected `deps.exec`, which is what the PRD's Testing
        Decisions prescribe and what makes the shared world's imaginary `/srv/adw/…` sentinels
        perfectly serviceable. THREE ADJUSTMENTS ARE NEEDED, all additive:
          (a) `makeFullOptions` sets no `pat`, so §7/§8/§10 must spread `{...makeFullOptions(...),
              pat: 'token-pat'}` — the PAT fallback would otherwise make them pass vacuously.
          (b) `makeSpyExec`'s `SpyCall` records `{command, cwd, env}` but NOT `input`, so §9 cannot
              assert stdin through it. Widen `SpyCall` with `input?: string` and record
              `options.input` in `makeSpyExec` — additive and safe, since `feature-659.steps.ts`
              (`:126`, `:138`) and `feature-699.steps.ts` (`:46`) are its only current consumers and
              neither reads it. (The shared world's own module header names feature-662 as a
              consumer; that is stale — feature-662 imports only `W` and `parseAuthor`.)
          (c) `makeNoOpFsDeps` hardcodes `existsSync: () => false`, which is what §11 needs but the
              opposite of what §12's second row needs. Pass a local `{...makeNoOpFsDeps(),
              existsSync: () => true}` for that row rather than changing the shared factory.
      • THE ONE BINDING POINT. Every step reaches the new API through a single module-private helper,
        e.g. `runThroughExecutor(ctx, command, cwdClass, env?, stdin?)`, which is the only place that
        knows the literal shape (`ctx.exec(command, {cwd: {kind: 'frameworkRoot'}, env, input})`). If
        HITL review reshapes the signature, exactly one helper changes.
      • `the recorded executor command ran in the {string} directory` MAPS: `framework root` →
        `FRAMEWORK_ROOT`; `target workspace` → `path.join(TARGET_REPOS_ROOT, 'acme', 'webapp')` (what
        `resolveBasePath` computes for the non-self-host fixture). The same two values are the second
        argument of the `… is executed through the public executor in the {string} directory` When
        steps. The worktree form resolves through `ctx.worktreePathFor(branch)` so the scenario never
        hard-codes `.worktrees/`. Assert against the MOST RECENT recorded call, except in
        `… carried the credential tokens {string} and {string} in order`, which compares the first two.
      • `the executor returns the trimmed output {string}` is driven by `… records every command and
        answers {string}`: have the seam answer a payload with a trailing newline and assert the
        trimmed form comes back. That pins the `.trim()` every one of the 83 existing call sites
        depends on, without a separate scenario for it.
      • `the context's spawn seam raises {string}` MAPS: `a missing-directory failure while the
        working directory is absent` → throw `Object.assign(new Error('spawnSync /bin/sh ENOENT'),
        {code: 'ENOENT', syscall: 'spawnSync /bin/sh', path: '/bin/sh'})` with
        `existsSync: () => false`; `a missing-file failure raised while the working directory is
        present` → the SAME shaped error with `existsSync: () => true`; `a plain failure carrying no
        error code` → `new Error('gh: unauthenticated')`, no `code`. Keep the thrown object as a
        module-private sentinel: `the executor failure is the spawn seam's own failure, unwrapped`
        asserts IDENTITY (`caught === sentinel`), not message equality.
      • ASSERT THE ERROR CODE, NEVER THE MESSAGE, for `… is recognisable by the missing-working-
        directory error code`. Verified on darwin: node says `spawnSync /bin/sh ENOENT`, bun says
        `ENOENT: no such file or directory, posix_spawn '/bin/sh'` — `code === 'ENOENT'` is stable
        across both. The other two §11 assertions DO read the message, which is correct: they assert
        the rewrap's OWN message (`describeMissingWorkingDirectory`, `workingDirectoryGuard.ts:41`),
        which this repo authors — `names the working directory that could not be entered` → the
        message contains the resolved base path; `names the repository {string}` → it contains
        `acme/webapp`.
      • CONTEXT-METHOD NAME MAP (`the {string} context method is invoked`): `fetch-issue-comments` →
        `fetchIssueComments(28)`; `issue-comment` → `commentOnIssue(28, 'issue comment body')`;
        `approve-pr` → `approvePR(7)`; `authenticated-user` → `authenticatedUser()`;
        `board-status-move` → `moveIssueToStatus(28, 'In Progress')`; `remote-url` → `remoteUrl()`;
        `local-branches` → `localBranches()`; `head-short` → `headShort()`; and for the worktree form
        `current-branch` → `getCurrentBranch(ctx.worktreePathFor(branch))`. `board-status-move`
        swallows parse failures and returns `false`, so against a canned seam answer it stops after
        its first command (`projectQueryCmd`) — which is the one whose cwd and routing are under test.
      • THE PASS-THROUGH OBSERVER (§10) shadows the public executor on the INSTANCE: capture
        `const original = ctx.exec.bind(ctx)`, assign an own property that records its arguments and
        delegates, and count. Instance own-properties shadow the prototype method, so the classifiers'
        internal `this.exec(...)` dispatches hit it. `every recorded spawn command passed through the
        public executor` compares the seam recorder's call count with the observer's — equal means
        nothing bypassed; MORE seam calls than observer calls means a command reached the spawn seam
        around the public entry. Delete the own property in `After`.
      • `the process working directory is moved outside both the framework root and the workspace`
        must `process.chdir` to a real temp dir (both sentinels are imaginary, so any real directory
        outside them qualifies) and restore the original cwd in `After` — feature-769 and feature-775
        precedent. Nothing spawns, so the moved cwd only ever shows up as a recorded value.
      • `no process environment variable was modified by the run` snapshots `{...process.env}` in the
        Given and compares key-by-key in the Then, both directions (no key added, changed or removed).
        The pattern already exists as `parentEnvSnapshot` in `gitContextSharedWorld.ts` and in
        `gitContext.test.ts:210`, `:279`, `:353`.
      • `the recorded executor command inherited the process environment's PATH` asserts
        `recorded.env.PATH === process.env.PATH` — the overlay-not-whole-environment contract, whose
        unit-test counterpart is `gitContextOperations.test.ts:91-95`.
      • T22 (`the ADW TypeScript type-check passes`) is reused, not redefined — redefining it would be
        an AmbiguousStepDefinition. It lives in `feature-504.steps.ts:1126`; G18 lives in
        `features/step_definitions/ensureCronOnEveryEventSteps.ts:8`.

  Background:
    Given the ADW codebase is checked out

  # ── §1 ONE PUBLIC ENTRY THAT RUNS WHAT IT IS GIVEN (AC1) ────────────────────────────────
  #
  # The headline: the chokepoint is reachable from outside the class, and it is a plain command
  # runner. A command with no forge meaning whatsoever goes in; its own text is what reaches the
  # spawn seam — not a rewritten, wrapped or prefixed variant — and the seam's output comes back
  # trimmed, the contract every existing call site already depends on. RED before: there is no public
  # entry to call today.

  @adw-790 @adw-q46zy4-promote-gitcontext-s
  Scenario: An arbitrary non-forge command runs through the public executor and returns its output
    Given a git context for target repository "acme/webapp"
    And the context's spawn seam records every command and answers "executor-passthrough\n"
    When the command "printf '%s' 'no-forge-meaning'" is executed through the public executor in the "target workspace" directory
    Then the recorded executor command is exactly "printf '%s' 'no-forge-meaning'"
    And the executor returns the trimmed output "executor-passthrough"

  # ── §2 THE CALLER PICKS THE WORKING-DIRECTORY CLASS (AC1, "no forge semantics") ─────────
  #
  # The executor must not know what the command means. The rows are deliberately CROSSED against the
  # package's own conventions — a gh command asked to run in the workspace, a git command asked to run
  # in the framework root — because a chokepoint that classified by sniffing the command string would
  # pass an uncrossed test and fail these. RED before.

  @adw-790 @adw-q46zy4-promote-gitcontext-s
  Scenario Outline: The executor honours the working directory it was given rather than inferring one from the command
    Given a git context for target repository "acme/webapp"
    And the context's spawn seam records every command
    When the command "<command>" is executed through the public executor in the "<directory>" directory
    Then the recorded executor command ran in the "<directory>" directory
    And the recorded executor command is exactly "<command>"

    Examples:
      | command                            | directory        |
      | gh api repos/acme/webapp/issues/28 | target workspace |
      | git status --porcelain             | framework root   |
      | glab mr list                       | framework root   |
      | printf '%s' 'no-forge-at-all'      | target workspace |

  # ── §3 THE FRAMEWORK-ROOT CLASS IS THE INJECTED ROOT (AC2, preserving #775) ─────────────
  #
  # #775's contract, carried through the promoted entry. The perturbation that could break it is
  # applied: the process working directory is moved somewhere unrelated, so an ambient-cwd
  # implementation would record the wrong path. The recorded directory must be the INJECTED framework
  # root — mandatory construction config, never derived at call time — and it is not the context base
  # path, which for a target repository is a different directory entirely.

  @adw-790 @adw-q46zy4-promote-gitcontext-s
  Scenario: A framework-root execution runs from the injected framework root even when the process working directory has moved
    Given a git context for target repository "acme/webapp"
    And the context's spawn seam records every command
    And the process working directory is moved outside both the framework root and the workspace
    When the command "gh api user" is executed through the public executor in the "framework root" directory
    Then the recorded executor command ran in the "framework root" directory

  # ── §4 THE WORKSPACE CLASS, AND AN EXPLICIT WORKTREE INSIDE IT (AC2) ────────────────────
  #
  # The other half of the existing cwd contract: the workspace class resolves to the context base
  # path — and, like §3, not to wherever the process happens to sit — while an explicitly named
  # worktree narrows it. Both are RED before.

  @adw-790 @adw-q46zy4-promote-gitcontext-s
  Scenario: A workspace execution runs from the target workspace even when the process working directory has moved
    Given a git context for target repository "acme/webapp"
    And the context's spawn seam records every command
    And the process working directory is moved outside both the framework root and the workspace
    When the command "git remote get-url origin" is executed through the public executor in the "target workspace" directory
    Then the recorded executor command ran in the "target workspace" directory

  @adw-790 @adw-q46zy4-promote-gitcontext-s
  Scenario: A workspace execution aimed at a named worktree runs from that worktree directory
    Given a git context for target repository "acme/webapp"
    And the context's spawn seam records every command
    When the command "git rev-parse --abbrev-ref HEAD" is executed through the public executor in the worktree directory for branch "feature-issue-790-x"
    Then the recorded executor command ran in the worktree directory for branch "feature-issue-790-x"

  # ── §5 EXISTING OPERATIONS KEEP THEIR WORKING DIRECTORIES (AC2, AC4) ────────────────────
  #
  # "Operationally invisible" is the PRD's requirement for the whole refactor, and the working
  # directory is where an invisible refactor would most easily become visible. The rows span the
  # classes that could each be misrouted on their own: a repo-API read, a stdin-carrying repo-API
  # write, a PAT-requiring repo-API write, the repo-free identity probe, the board query, and three
  # workspace-git reads. GREEN before and after — this is the regression guard on the existing
  # repoApiCwd behaviour, and it fails the moment the promotion collapses the two classes into one
  # default.

  @adw-790 @adw-q46zy4-promote-gitcontext-s
  Scenario Outline: Existing context operations still spawn in the working directory their class requires
    Given a git context for target repository "acme/webapp"
    And the context is configured with the primary token "token-primary" and the personal access token "token-pat"
    And the context's spawn seam records every command
    When the "<method>" context method is invoked
    Then the recorded command for the "<method>" context method ran in the "<directory>" directory

    Examples:
      | method               | directory        |
      | fetch-issue-comments | framework root   |
      | issue-comment        | framework root   |
      | approve-pr           | framework root   |
      | authenticated-user   | framework root   |
      | board-status-move    | framework root   |
      | remote-url           | target workspace |
      | local-branches       | target workspace |
      | head-short           | target workspace |

  @adw-790 @adw-q46zy4-promote-gitcontext-s
  Scenario: A worktree-scoped context operation still spawns in the worktree it was given
    Given a git context for target repository "acme/webapp"
    And the context's spawn seam records every command
    When the "current-branch" context method is invoked for the worktree of branch "feature-issue-790-x"
    Then the recorded executor command ran in the worktree directory for branch "feature-issue-790-x"

  # ── §6 THE CREDENTIAL ENVIRONMENT IS PER COMMAND AND CALLER-SUPPLIED (AC1) ──────────────
  #
  # The difference between an executor that CARRIES a credential and one that CHOOSES one. Two
  # executions, two different credentials, two child environments — each carrying its own, neither
  # replaced by the context's own token. An executor that kept resolving `GH_TOKEN` from its own state
  # would satisfy "accepts a credential env" while ignoring it, and the TokenProvider slice would then
  # have nothing to plug into. The PATH assertion pins the opposite failure: the parameter is an
  # OVERLAY on the inherited environment, not a replacement for it. RED before.

  @adw-790 @adw-q46zy4-promote-gitcontext-s
  Scenario: Each execution carries the credential its caller supplied while still inheriting the process environment
    Given a git context for target repository "acme/webapp"
    And the context is configured with the primary token "token-primary" and the personal access token "token-pat"
    And the context's spawn seam records every command
    When the command "gh api user" is executed through the public executor in the "framework root" directory carrying the credential token "credential-first"
    And the command "gh api user" is executed through the public executor in the "framework root" directory carrying the credential token "credential-second"
    Then the recorded executor commands carried the credential tokens "credential-first" and "credential-second" in order
    And the recorded executor command inherited the process environment's PATH

  # ── §7 PAT SELECTION STAYS FUNCTIONAL FOR INTERNAL OPERATIONS ───────────────────────────
  #
  # The issue is explicit that `usePat` "remains functional in this slice" — token selection leaves in
  # the TokenProvider slice, not this one. A slice that cleaned the signature by deleting the
  # behaviour would break PR approval in production and pass every other scenario here. GREEN before
  # and after.

  @adw-790 @adw-q46zy4-promote-gitcontext-s
  Scenario: A PAT-requiring operation still spawns with the PAT while an ordinary operation spawns with the primary token
    Given a git context for target repository "acme/webapp"
    And the context is configured with the primary token "token-primary" and the personal access token "token-pat"
    And the context's spawn seam records every command
    When the "approve-pr" context method is invoked
    And the "fetch-issue-comments" context method is invoked
    Then the recorded command for the "approve-pr" context method carried the credential token "token-pat" in its child environment
    And the recorded command for the "fetch-issue-comments" context method carried the credential token "token-primary" in its child environment

  # ── §8 …BUT THE FLAG HAS NO PURCHASE ON THE PUBLIC ENTRY (AC1) ──────────────────────────
  #
  # The runtime half of "must not leak into the new public signature", and the half that still holds
  # if the options type is ever loosened. The context here HAS a PAT configured, so an executor that
  # still honoured the flag would visibly substitute it for the caller's credential. RED before. See
  # the scope note above for why the compile-time half lives in §14 rather than in a scenario.

  @adw-790 @adw-q46zy4-promote-gitcontext-s
  Scenario: A PAT-selection flag handed to the public executor cannot displace the caller's credential
    Given a git context for target repository "acme/webapp"
    And the context is configured with the primary token "token-primary" and the personal access token "token-pat"
    And the context's spawn seam records every command
    When the command "gh api user" is executed through the public executor in the "framework root" directory with a PAT-selection flag set and the credential token "credential-from-caller"
    Then the recorded executor command carried the credential token "credential-from-caller" in its child environment

  # ── §9 OPTIONAL STANDARD INPUT (AC1) ────────────────────────────────────────────────────
  #
  # The fourth input, and the only one whose ABSENCE must also be observable: `defaultExec` branches
  # on `input !== undefined` and passes `stdio: ['pipe','pipe','pipe']` only when stdin is supplied,
  # so an executor that always forwarded an empty string would change how every stdin-free command is
  # spawned. The third scenario is the one that matters operationally: nine repo-API writes carry
  # their payload on stdin rather than in the command string, deliberately, so bodies never reach a
  # shell argument list. RED before on the first two; GREEN before and after on the third.

  @adw-790 @adw-q46zy4-promote-gitcontext-s
  Scenario: Standard input supplied to the public executor reaches the child process
    Given a git context for target repository "acme/webapp"
    And the context's spawn seam records every command
    When the command "gh api graphql --input -" is executed through the public executor in the "framework root" directory carrying the standard-input payload "stdin-payload-790"
    Then the recorded executor command carried the standard-input payload "stdin-payload-790"

  @adw-790 @adw-q46zy4-promote-gitcontext-s
  Scenario: A command executed without standard input carries none to the child process
    Given a git context for target repository "acme/webapp"
    And the context's spawn seam records every command
    When the command "git status --porcelain" is executed through the public executor in the "target workspace" directory
    Then the recorded executor command carried no standard input

  @adw-790 @adw-q46zy4-promote-gitcontext-s
  Scenario: An internal write operation still delivers its body on standard input through the promoted executor
    Given a git context for target repository "acme/webapp"
    And the context's spawn seam records every command
    When the "issue-comment" context method is invoked
    Then the recorded command for the "issue-comment" context method carried the standard-input payload "issue comment body"

  # ── §10 EVERY INTERNAL OPERATION REACHES THE SEAM THROUGH THE PUBLIC EXECUTOR (AC4) ─────
  #
  # "All internal git/gh operations route through it." Observed by wrapping the context's own public
  # executor with a pass-through observer and comparing what the observer saw against what actually
  # reached the spawn seam: equal counts mean every command went through the public entry; a seam
  # with more calls than the observer means something spawned around it. The rows cover each internal
  # dispatch family — a git read, a repo-API read, a stdin write, a PAT write, and the multi-command
  # board query. RED before; see the scope note above for the implementation shape this forecloses
  # and why the committed plan already satisfies it.

  @adw-790 @adw-q46zy4-promote-gitcontext-s
  Scenario Outline: No internal operation reaches the spawn seam around the public executor
    Given a git context for target repository "acme/webapp"
    And the context is configured with the primary token "token-primary" and the personal access token "token-pat"
    And the context's spawn seam records every command
    And the context's public executor is wrapped with a pass-through observer
    When the "<method>" context method is invoked
    Then every recorded spawn command passed through the public executor

    Examples:
      | method               |
      | remote-url           |
      | local-branches       |
      | fetch-issue-comments |
      | issue-comment        |
      | approve-pr           |
      | board-status-move    |

  # ── §11 THE MISSING-WORKING-DIRECTORY REWRAP STAYS INSIDE THE EXECUTOR (AC3) ────────────
  #
  # #777's actionable error, asserted through the PUBLIC entry — which is the whole point of "stays
  # inside". If the rewrap were lifted to the internal call sites during the promotion, every one of
  # them would keep passing while a caller of the public executor got the raw `spawnSync /bin/sh
  # ENOENT`, the unreadable failure that cost hours of diagnosis on the production host. The three
  # assertions are the three things that made the rewrapped error actionable: it is still recognisable
  # by code, it names the directory, and it names the repository. RED before.

  @adw-790 @adw-q46zy4-promote-gitcontext-s
  Scenario: A public execution whose working directory does not exist raises the actionable missing-directory failure
    Given a git context for target repository "acme/webapp"
    And the context's spawn seam raises "a missing-directory failure while the working directory is absent"
    When the command "git status --porcelain" is executed through the public executor in the "target workspace" directory
    Then the executor failure is recognisable by the missing-working-directory error code
    And the executor failure names the working directory that could not be entered
    And the executor failure names the repository "acme/webapp"

  # ── §12 EVERY OTHER FAILURE REACHES THE CALLER UNWRAPPED (AC3 guard) ────────────────────
  #
  # The rewrap is a diagnosis, never a blanket wrap. The second row is the sharp one: the SAME error
  # code as the rewrap's trigger, raised while the working directory exists — a missing binary, not a
  # missing directory. Rewrapping it would relabel "gh is not installed" as "this workspace was never
  # cloned" and send the reader looking for the wrong problem. GREEN before and after: the guard
  # already probes the directory before rewrapping, and the promotion must not turn it into a
  # catch-all.

  @adw-790 @adw-q46zy4-promote-gitcontext-s
  Scenario Outline: A failure that is not a missing working directory reaches the caller untouched
    Given a git context for target repository "acme/webapp"
    And the context's spawn seam raises "<failure>"
    When the command "git status --porcelain" is executed through the public executor in the "target workspace" directory
    Then the executor failure is the spawn seam's own failure, unwrapped

    Examples:
      | failure                                                          |
      | a plain failure carrying no error code                           |
      | a missing-file failure raised while the working directory is present |

  # ── §13 NO PROCESS-ENVIRONMENT MUTATION (AC5) ───────────────────────────────────────────
  #
  # The invariant the whole GitContext PRD exists to protect. Both credential paths are exercised in
  # one scenario — a caller-supplied credential through the public entry, and the internal PAT
  # selection — because either could be implemented by assigning to `process.env` and would then pass
  # every other assertion in this file. GREEN before and after.

  @adw-790 @adw-q46zy4-promote-gitcontext-s
  Scenario: Neither a public execution nor an internal PAT operation mutates the process environment
    Given a git context for target repository "acme/webapp"
    And the context is configured with the primary token "token-primary" and the personal access token "token-pat"
    And the context's spawn seam records every command
    When the command "gh api user" is executed through the public executor in the "framework root" directory carrying the credential token "credential-from-caller"
    And the "approve-pr" context method is invoked
    Then no process environment variable was modified by the run

  # ── §14 Type-check backstop (T22), and the home of the signature claim ──────────────────
  #
  # Two jobs. First the ordinary one: a new public signature, two new exported types and two rewritten
  # classifiers make the type-checker the cheapest proof that the migration is complete rather than
  # partial (feature-775 §T, feature-769 §T precedent). Second, and specific to this issue: because
  # `adws/tsconfig.json` globs `./**/*.ts`, this command also type-checks
  # `adws/gitContext/__tests__/gitContext.test.ts`, where the plan's `@ts-expect-error` case asserts
  # that an options object carrying `usePat: true` is a TYPE error. Re-adding a GitHub-specific
  # parameter to the executor's options makes that `@ts-expect-error` unused, which fails this
  # scenario. That is how "no GitHub-specific parameters in its signature" is enforced — see the scope
  # note above for why no scenario tries to assert a compile-time fact at runtime.

  @adw-790 @adw-q46zy4-promote-gitcontext-s
  Scenario: The ADW TypeScript type-check passes with the spawn chokepoint promoted to a public forge-neutral executor
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
