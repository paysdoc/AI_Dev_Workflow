@adw-777 @adw-moe8r2-gitcontext-surfaces
Feature: A GitContext spawn into a workspace that was never cloned names the missing directory and the repository — instead of "spawnSync /bin/sh ENOENT"

  Issue #777 makes a missing target workspace diagnosable. `GitContext` resolves `#basePath` in its
  constructor (`resolveBasePath`, `adws/gitContext/gitContext.ts:97-101` —
  `path.join(targetReposDir, owner, repo)` for a non-self-host context) and never checks that the
  directory exists. When `#run` hands that path to `execSync` as the spawn `cwd`, Node reports a
  NONEXISTENT SPAWN CWD as an ENOENT on the shell binary, so the first symptom is:

    Error: spawnSync /bin/sh ENOENT

  Nothing in that error names the missing directory, the repository, or the likely cause, and it
  surfaces deep inside whatever unrelated call happened to be running. Diagnosing the 2026-07-30
  webhook outage (the `paysdoc/paysdoc.nl#28` Cancel directive) took a full morning largely because
  of this misleading error shape.

  Live baseline captured on this host 2026-07-30 (node v26.5.0 under `bunx tsx`, darwin), driving a
  real `GitContext` over real temp directories with the real `defaultExec`:

    • construction with an absent workspace does NOT throw — construct-before-clone is legal today
    • `remoteUrl()`                     → message "spawnSync /bin/sh ENOENT", code 'ENOENT',
                                          syscall 'spawnSync /bin/sh'; the message contains NEITHER
                                          the base path NOR "acme/webapp"
    • `getCurrentBranch(<absent worktree>)` → the same message, naming neither the worktree path nor
                                          the repository
    • cwd EXISTS but holds no checkout   → code undefined, status 128, message
                                          "Command failed: git remote get-url origin\nfatal: not a
                                          git repository …" — a genuine git failure is already
                                          distinguishable from a spawn-cwd failure
    • `resolveGitDir` / `currentBranchSymbolic` → null, `worktreeRegistration` → 'missing' for an
                                          absent worktree — the takeover probes swallow the throw
    • a repo-API call pre-clone         → spawn cwd is the injected framework repo root (issue #775,
                                          merged; `@adw-775` is green at 23 scenarios / 139 steps)

  THE FIX: a spawn that is ABOUT TO USE a working directory that does not exist fails with an error
  naming that path and the repository identity — e.g.
  `GitContext: working directory does not exist: /path/to/owner/repo (owner/repo, selfHost=false) —
  has a workflow ever cloned this workspace on this host?` — while every flow that legitimately runs
  without a workspace keeps working.

  The behavioural contract pinned below:

    1. THE ERROR IS ACTIONABLE (Symptom, Desired behavior 1). A workspace-scoped git read on a host
       that has never cloned the repository fails with an error that names the missing directory, the
       repository, the self-host discriminator, and the actionable question about whether the
       workspace was ever cloned here. This is the headline: RED before on all four counts, since the
       whole message today is the eight characters-plus "spawnSync /bin/sh ENOENT".
    2. THE EXPLICIT WORKTREE PATH COUNTS TOO (Desired behavior 1, "basePath OR explicit worktree
       path"). With the workspace present but the worktree absent, the error names the WORKTREE
       directory — the path actually handed to the spawn. Deliberately separated from §1 because a
       validation that only ever inspects `#basePath` passes §1 and fails here, and because a
       worktree that vanished under a running workflow is a real production state (a merge-time
       cleanup race is recorded in `adws/known_issues.md:329-341`, and the takeover wrong-base-path
       incident class turns on exactly this).
    3. CONSTRUCT-BEFORE-CLONE STILL WORKS (Desired behavior 2). The issue's own caution, pinned as
       behaviour rather than as a comment: the real `ensureRepoWorkspace` clone path
       (`adws/gitContext/repoWorkspace.ts:107-129`) is driven end-to-end for a repository that has
       never been cloned, and still records its clone. A constructor-time `existsSync` would abort
       this flow at `targetRepoManager.ts:64` — before the clone it exists to perform — and would
       make a fresh target repo unusable forever.
    4. THE CHECK IS AT SPAWN TIME, NOT A CONSTRUCTION-TIME SNAPSHOT (Desired behavior 2). A context
       built while the workspace was absent reads the branch successfully once the workspace appears.
       This forecloses the near-miss fix: resolving existence ONCE in the constructor and caching the
       verdict in a field, which keeps §3 green (nothing throws at construction) while permanently
       poisoning every long-lived context — the cron holds contexts across the clone that
       `ensureTargetRepoWorkspace` performs.
    5. REPO-API COMMANDS ARE NOT AFFECTED (Desired behavior 3). After #775, repo-API gh commands run
       from the injected framework repo root, so the check must not fire for them: a Cancel/Retry
       directive stays processable on a host that has never cloned the workspace. RED-if-over-fixed —
       a validation written against `this.#basePath` instead of against the RESOLVED cwd would
       resurrect the very outage #775 fixed, one issue later.
    6. A REAL GIT FAILURE IS NOT MISREPORTED AS A MISSING DIRECTORY. With the workspace present but
       holding no checkout, the failure is git's own — the new message must not be pasted over an
       unrelated failure, which would replace one misleading error with another. The false-positive
       guard; GREEN before and after.
    7. SELF-HOST IS UNAFFECTED. For a self-host context `basePath === frameworkRepoRoot`, which
       always exists, so the check is structurally a no-op there and the framework's own dogfooded
       workflows keep reading their own checkout. GREEN before and after.
    8. THE SWALLOWING PROBES STILL SWALLOW. `resolveGitDir`, `currentBranchSymbolic` and
       `worktreeRegistration` exist to answer questions ABOUT a worktree that may not be there
       (issue #638's `decideWorktreeReuse` Class-A signals), and `listWorktrees` answers the same
       question about a base path that may not be there; each swallows the throw. The new error must
       not escape them: an uncaught throw on the takeover path killed the whole cron loop once
       already (vestmatic #187, `trigger_cron.ts` has no try/catch around the takeover call). GREEN
       before and after — a guard against validating ABOVE those try/catch blocks, e.g. in a public
       wrapper or in `worktreePathFor`.
    9. THE FAILURE IS STILL RECOGNISABLE BY ITS ERROR CODE, AND THE ORIGINAL SURVIVES. The enriched
       error keeps `code === 'ENOENT'` and carries the original spawn failure as its `cause`, so code
       that classifies by error code keeps working and the original stack is not thrown away. The
       code half is a deliberate compatibility pin — see the scope note below; it is the one
       assertion here that goes beyond the issue text, and it is what keeps the merged `@adw-775` §10
       scenario green without rewriting another issue's step definitions.
   10. TYPE-CHECK BACKSTOP (T22).

  Mapping onto the issue's Desired behavior: bullet 1 (fail with an error naming the path and the
  repo identity, for basePath OR an explicit worktree path) → §1, §2; bullet 2 (constructor-time
  validation is wrong — the check belongs at spawn time) → §3, §4; bullet 3 (after #775 the check
  should only fire for commands that genuinely need a local repo) → §5, and §7 for the self-host
  half. §6, §8 and §9 are the non-regression guards the fix needs in order to be safe rather than
  merely correct.

  Mapping onto the accompanying plan's acceptance criteria
  (`specs/issue-777-adw-moe8r2-gitcontext-surfaces-sdlc_planner-actionable-missing-workspace-error.md`,
  written against this file and cross-referencing it by section) — one-to-one, section for section:
  AC1 → §1; AC2 (explicit worktree path named) → §2; AC3 (construct-before-clone still works) → §3;
  AC4 (spawn-time, not a construction-time snapshot) → §4; AC5 (repo-API commands unaffected) → §5;
  AC6 (a real git failure is not misreported) → §6; AC7 (self-host unaffected) → §7; AC8 (the
  swallowing probes still swallow) → §8; AC9 (still ENOENT, plus `cause`) → §9; AC10 → §T. Two
  criteria are covered by the plan's unit suite rather than here — an ENOENT-CODED failure whose
  working directory DOES exist propagates verbatim, and the happy path performs no filesystem
  existence probe — see the last scope note.

  Observability / rot-prevention note:

    Every assertion targets an artefact the system PRODUCES: the error a context method raises
    (message text and error code — the same "raised error" surface the registry's T-HC4/T-HC5 rows
    already sanction), the value a context method returns, the `(command, cwd)` pairs a recorded
    spawn seam captures (vocabulary surface #2), real on-disk temp directories the step itself
    creates as fixtures, and the type-checker's exit status (surface #4). No step reads
    `gitContext.ts`, `repoWorkspace.ts` or any other framework source as text, substring-matches its
    contents, or parses it as JSON/AST.

    The message assertions (§1, §2) are deliberately COMPONENT-WISE, not literal: they assert that
    the raised message contains the missing path, contains `owner/repo`, reports the self-host
    discriminator, and asks about cloning. Rewording the sentence keeps them green; dropping any of
    the four diagnostic facts — which is the entire point of the issue — turns them red.

  Scope notes:

    • WHY THE SCENARIOS DRIVE `GitContext` DIRECTLY. Same reasoning feature-775 records: the crash
      sites take a `repoInfo` and resolve their own context through `gitContextForRepo`, whose token
      resolution mints a real App installation token for the named repo — so a fictitious fixture
      repo throws at construction on any host where the App is configured, and a real one would point
      `resolveBasePath` at a real checkout. An explicit identity plus an explicit token is the
      established pattern (feature-658 / feature-659 / feature-663 / feature-775).
    • MOST SCENARIOS USE THE REAL `defaultExec` — NO INJECTED EXEC. The failure being fixed is a REAL
      spawn against a REAL missing path, and the fix may legitimately live either as a pre-flight
      check inside `#run` or as an ENOENT catch-and-rewrap AROUND the exec call (the issue permits
      both). A recorder that never spawns would silently satisfy the first shape and never exercise
      the second, so §1, §2, §4, §6, §7, §8 and §9 run real `git` commands in real temp directories:
      local, offline, sub-second, and faithful. Only §3 (which must not clone for real) and §5 (which
      must not reach the GitHub API) use an injected seam — and §5's stand-in REALLY SPAWNS with the
      supplied cwd, so the cwd is genuinely exercised there too.
    • THE COMPLETE SET OF SPAWN WORKING DIRECTORIES IS THREE, verified 2026-07-30 by reading every
      `#run` call site in `gitContext.ts` and every op module: (a) `#basePath`, (b) an explicit
      `opts.cwd` — always a worktree path or an already-resolved repo path, (c) `#repoApiCwd`, the
      injected framework root, reachable only through `#runRepoApi`. Worth stating because it bounds
      the fix: `worktreeCreateOps` passes the new worktree path as an ARGUMENT to `git worktree add`
      and always spawns from `baseCwd`, and `worktreeRemoveOps` does the same for removal, so
      "creating a worktree that does not exist yet" is NOT a spawn into a missing cwd and needs no
      carve-out. §1 covers (a), §2 covers (b), §5 covers (c).
    • THE CONSTRUCT-BEFORE-CLONE RISK IS ENTIRELY AT CONSTRUCTION TIME, verified 2026-07-30 by
      reading `repoWorkspace.ts:107-129`: on the not-yet-cloned branch `ensureRepoWorkspace` calls
      `cloneRepo` through its own injected exec and never touches the context at all; the injected
      `getDefaultBranch` thunk is invoked only on the ALREADY-cloned branch, and after #775 that is a
      repo-API call running from the framework root. So nothing in the clone path spawns into the
      absent workspace — which is precisely why the check is safe at spawn time and fatal in the
      constructor. §3 drives the real module rather than merely asserting "construction did not
      throw", so the claim is pinned against the production flow the issue names.
    • §9 IS A DELIBERATE COMPATIBILITY PIN AND THE ONE PLACE THIS FEATURE EXCEEDS THE ISSUE TEXT.
      `feature-775.steps.ts:334-337` implements `the workspace-git operation fails with a spawn
      working-directory failure` as `assert.strictEqual(err.code, 'ENOENT')`, and feature-775.feature
      §10 (merged, green) uses it to pin that a pre-clone git read still FAILS rather than being
      answered out of the framework checkout. #777 replaces the error object at exactly that site. If
      the enriched error keeps `code = 'ENOENT'` (one `Object.assign`, or a rewrap that copies the
      code), feature-775 §10 stays green and no other issue's scenarios need touching; if it does
      not, feature-775 §10 goes RED and its step definition must be migrated as part of this issue.
      §9 pins the former because it is the non-breaking choice, because a message match is the wrong
      thing to switch on anyway (verified 2026-07-30: node says "spawnSync /bin/sh ENOENT" while bun
      says "ENOENT: no such file or directory, posix_spawn '/bin/sh'" for the same failure), and
      because it makes the new error a strict ENRICHMENT of the old one rather than a replacement.
      MAINTAINER OVERRIDE: if you would rather the enriched error carry no `code`, delete §9 and
      migrate `feature-775.steps.ts:334-337` instead — those are the only two options, and doing
      neither breaks a merged scenario.
    • WHAT IS NOT PINNED HERE, AND WHY. (a) Whether the message wording matches the issue's example
      verbatim — §1 asserts the four diagnostic facts, not the sentence. (b) Whether a cwd that
      exists but is a FILE rather than a directory is reported specially: `spawnSync` gives ENOTDIR
      there, and no production flow produces it. (c) An ENOENT-CODED failure whose working directory
      DOES exist (pinned by the plan's unit suite, step 4) — the complement of §6, which covers the
      same guard for a non-ENOENT failure. A real spawn cannot produce that combination, so proving
      it needs an injected exec that throws a fabricated ENOENT; that is a unit-test shape, and the
      plan pins it at step 4. (d) That the happy path performs no filesystem existence probe (the
      plan's other unit-only criterion, proven with a counting `fsDeps` spy) — an injected-seam call
      count, again a unit-test shape.
      (c) and (d) together are what make the plan's catch-and-rewrap choice binding; nothing in this
      file forces that choice, so if the implementation ever moves to a pre-spawn probe, every
      scenario here still holds and only those two unit tests change.
    • THE @regression MAINTENANCE SWEEP IS SKIPPED for this issue: `.adw/scenarios.md` configures a
      `## Regression Scenario Directory`, so promotion is a deliberate human decision and this agent
      never auto-promotes.

  Vocabulary note:

    Registered phrases reused (`features/regression/vocabulary.md`):
      G18  `the ADW codebase is checked out`
      T22  `the ADW TypeScript type-check passes`

    Novel phrasing introduced here — the registry has no phrase for a spawn working directory, a
    missing workspace, or a takeover probe, and the GitContext families live in per-issue step defs
    rather than the registry. All 685 phrases currently registered across
    `features/{per-issue,regression,}/step_definitions/` were checked on 2026-07-30: none matches any
    phrase below, and none is a Cucumber-expression pattern that could match one, so
    feature-777.steps.ts is self-contained with zero AmbiguousStepDefinition risk under the globally
    loaded per-issue step defs. In particular every phrase is deliberately distinct from
    feature-775's neighbouring family (`a target repository {string} registered on a host that has
    never cloned its workspace`, `the {string} repo-API operation runs through the context`, `the
    {string} workspace-git operation runs through the context`, `the workspace-git operation fails
    with a spawn working-directory failure`, …), whose module-private world is not importable.
    Surfaced to the maintainer in the agent Output:
      • `a target workspace repository {string} that has never been cloned on this host`
      • `a target workspace repository {string} whose workspace directory exists but holds no git checkout`
      • `a target workspace repository {string} whose workspace holds a git checkout on branch {string}`
      • `a self-hosted framework repository {string} whose framework checkout is on branch {string}`
      • `the repository's spawns are stood in for by a harmless command that really runs in the given working directory`
      • `a workspace-scoped git read is issued for the repository`
      • `a worktree-scoped git read is issued for the worktree of branch {string}`
      • `the {string} repository-API operation is issued for the repository`
      • `the workspace-ensure flow runs for the repository`
      • `the workspace is cloned on this host after the context was built, on branch {string}`
      • `the takeover probe inspects the worktree of branch {string}`
      • `the worktree listing is requested for the repository`
      • `the failure names the missing workspace directory`
      • `the failure names the missing worktree directory for branch {string}`
      • `the failure names the repository {string}`
      • `the failure reports the self-host discriminator as {string}`
      • `the failure asks whether the workspace was ever cloned on this host`
      • `no missing-working-directory failure is raised`
      • `the workspace-scoped git read returns the branch name {string}`
      • `the workspace-ensure flow records a clone into the workspace directory`
      • `the failure is the git command's own failure rather than a missing-working-directory report`
      • `the failure is still recognisable by the missing-working-directory error code`
      • `the failure carries the original spawn failure as its cause`
      • `the takeover probe reports the worktree as missing without raising`
      • `the worktree listing answers empty without raising`

    Step-definition note for the maintainer (feature-777.steps.ts — keep it SELF-CONTAINED with its
    own module-private world and `After` cleanup; do NOT import `gitContextSharedWorld.ts`, whose
    roots are imaginary sentinels and whose `makeNoOpFsDeps` hardcodes `existsSync: () => false`, and
    do NOT import feature-775's world, which is module-private):

      • REAL FIXTURE DIRECTORIES, PRODUCTION LAYOUT. Per scenario create two `mkdtempSync` roots — a
        `targetReposDir` and a `frameworkRepoRoot` — and construct the context with
        `{owner: 'acme', repo: 'webapp', selfHost: false, token, gitIdentity, frameworkRepoRoot,
        targetReposDir}` so production's `resolveBasePath` computes
        `basePath = <targetReposDir>/acme/webapp` unaided. "never been cloned" = leave that path
        absent; "exists but holds no git checkout" = `mkdirSync(basePath, {recursive: true})`;
        "holds a git checkout on branch X" = additionally `execSync('git init -q -b X', {cwd:
        basePath})` (verified 2026-07-30: `getCurrentBranch()` then returns "X" with no commit
        needed, because `branchOps` uses `git branch --show-current`). The self-host Given makes the
        FRAMEWORK root the checkout and passes `selfHost: true`. `rmSync` both roots in `After`.
      • DEFAULT TO NO INJECTED EXEC. §1, §2, §4, §6, §7, §8 and §9 must construct the context with no
        `deps.exec` at all, so the real `defaultExec` really spawns. Two seams are the exceptions:
        (a) §5's Given installs a recorder that pushes `{command, cwd}` and then really spawns
            `execSync("printf '%s' '[]'", {...options})` passing `options.cwd` THROUGH UNCHANGED, and
            mirroring `defaultExec`'s `input` branch (`gitContext.ts:57-68`) when `options.input !==
            undefined` — so no `gh` binary, no network, no token, and the cwd is still exercised.
        (b) §3's `the workspace-ensure flow runs for the repository` calls the REAL
            `ensureRepoWorkspace` (exported from `adws/gitContext/index.ts`) with
            `{targetReposDir, getDefaultBranch: () => ctx.defaultBranch(), exec, fsDeps}` where
            `exec` records `git clone …` without spawning it. Assert the recorded clone command
            mentions the workspace path — that is a recorded-call artefact, never a filesystem or
            source read.
      • ASSERT MESSAGE COMPONENTS, NEVER THE WHOLE SENTENCE. `… names the missing workspace
        directory` → `message.includes(ctx.basePath)`; `… names the missing worktree directory for
        branch X` → `message.includes(ctx.worktreePathFor(X))`; `… names the repository "acme/webapp"`
        → `message.includes('acme/webapp')`; `… reports the self-host discriminator as "false"` →
        `/selfHost\s*[=:]\s*false/i.test(message)`; `… asks whether the workspace was ever cloned on
        this host` → `/clon(e|ed|ing)/i.test(message)`. Tolerant of rewording, intolerant of dropping
        a diagnostic fact.
      • `no missing-working-directory failure is raised` must be a POSITIVE test, not just
        `lastError === null`: §5's write ops return void and §3 returns a path, so assert that no
        error was captured AND — when one was — that its message carries none of the working-directory
        markers. Keeping it uniform lets §5's outline reuse it across reads and writes.
      • `the failure is the git command's own failure rather than a missing-working-directory report`
        → assert `typeof err.status === 'number' && err.status !== 0` (verified 2026-07-30: status
        128, code undefined for `git remote get-url origin` in a non-repo directory) AND that the
        message does not match the working-directory markers.
      • `the takeover probe inspects the worktree of branch X` calls all three probes
        (`resolveGitDir`, `currentBranchSymbolic`, `worktreeRegistration`) inside one try/catch and
        stores the three results; the paired Then asserts `null`, `null`, `'missing'` and that
        nothing was thrown. Verified 2026-07-30 as today's behaviour, so this is GREEN-before. The
        `listWorktrees()` pair is the same shape against the missing BASE path rather than a missing
        worktree, and asserts `[]` plus no throw.
      • `the failure carries the original spawn failure as its cause` → assert `err.cause` is set and
        that `(err.cause as NodeJS.ErrnoException).code === 'ENOENT'`. Do NOT assert the cause's
        MESSAGE — that is the runtime-divergent string (node vs bun) this feature deliberately never
        matches on.
      • OPERATION NAME MAP for §5. `fetch-issue-comments` → `fetchIssueComments(28)`, `default-branch`
        → `defaultBranch()` (the one the clone flow's thunk calls), `issue-comment` →
        `commentOnIssue(28, 'body')` (the stdin-carrying write that acknowledges a directive),
        `apply-label` → `applyLabel(28, 'adw:bug')`, `authenticated-user` → `authenticatedUser()`
        (carries no repo identity at all).
      • T22 (`the ADW TypeScript type-check passes`) and G18 (`the ADW codebase is checked out`) are
        REUSED, not redefined — redefining either would be an AmbiguousStepDefinition. They live in
        `feature-504.steps.ts:1126` and `ensureCronOnEveryEventSteps.ts` respectively. Confirmed by
        `--dry-run --tags @adw-777` on 2026-07-30: 15 scenarios, 75 steps, 25 distinct undefined
        phrases (exactly the list above), 17 steps already resolved, zero ambiguity errors.
      • TWO PHRASES CONTAIN AN APOSTROPHE — `the repository's spawns are stood in for by …` and `the
        failure is the git command's own failure rather than a missing-working-directory report`.
        Declare those two with double-quoted string literals (feature-775.steps.ts:147 does the
        same); a single-quoted literal needs escaping and is easy to get subtly wrong.

  Background:
    Given the ADW codebase is checked out

  # ── §1 THE ERROR IS ACTIONABLE (Symptom; Desired behavior 1) ────────────────────────────
  #
  # The headline, and a faithful reproduction of the production incident: a registered target repo,
  # a host that has never cloned its workspace, and a git read that spawns into the absent base
  # path. Today the entire message is "spawnSync /bin/sh ENOENT" — it names no path, no repository,
  # no cause. RED before on all four assertions; GREEN after with a message a human can act on.

  @adw-777 @adw-moe8r2-gitcontext-surfaces
  Scenario: A git read on a host that never cloned the workspace fails with an error naming the directory, the repository and the cause
    Given a target workspace repository "acme/webapp" that has never been cloned on this host
    When a workspace-scoped git read is issued for the repository
    Then the failure names the missing workspace directory
    And the failure names the repository "acme/webapp"
    And the failure reports the self-host discriminator as "false"
    And the failure asks whether the workspace was ever cloned on this host

  # ── §2 THE EXPLICIT WORKTREE PATH COUNTS TOO (Desired behavior 1) ───────────────────────
  #
  # The issue names two cwd sources — "basePath or explicit worktree path" — and this is the second.
  # The workspace is present here, so a validation that only ever inspects `#basePath` sails past §1
  # and dies here: the path actually handed to the spawn is the missing WORKTREE, and that is the
  # path the error must name. A worktree that vanished under a running workflow is a real production
  # state (the merge-time cleanup race in adws/known_issues.md:329-341). RED before.
  #
  # The hint is asserted here TOO, identically to §1, and that is deliberate: it pins ONE message
  # shape for both cwd sources rather than a hint that classifies which kind of directory went
  # missing. The issue gives a single example message for both ("basePath or explicit worktree
  # path"), and the accompanying plan makes the same call — a classifying hint would keep
  # basePath/frameworkRepoRoot knowledge inside the diagnosis, which is exactly the coupling the
  # GitContext package was factored to avoid.

  @adw-777 @adw-moe8r2-gitcontext-surfaces
  Scenario: A git read against a worktree that does not exist names the missing worktree directory
    Given a target workspace repository "acme/webapp" whose workspace holds a git checkout on branch "trunk"
    When a worktree-scoped git read is issued for the worktree of branch "feature-issue-777-x"
    Then the failure names the missing worktree directory for branch "feature-issue-777-x"
    And the failure names the repository "acme/webapp"
    And the failure asks whether the workspace was ever cloned on this host

  # ── §3 CONSTRUCT-BEFORE-CLONE STILL WORKS (Desired behavior 2) ──────────────────────────
  #
  # The issue's own caution — "legitimate flows construct a GitContext before the workspace is
  # cloned" — pinned against the real module rather than asserted in a comment. The REAL
  # `ensureRepoWorkspace` runs for a repository that has never been cloned and still records its
  # clone. A constructor-time `existsSync` would abort this at `targetRepoManager.ts:64`, before the
  # clone it exists to perform, and a fresh target repo could then never be onboarded at all.
  # GREEN before and after — the guard that says where the check may NOT go.

  @adw-777 @adw-moe8r2-gitcontext-surfaces
  Scenario: The clone flow still runs for a repository whose workspace has never existed on this host
    Given a target workspace repository "acme/webapp" that has never been cloned on this host
    When the workspace-ensure flow runs for the repository
    Then no missing-working-directory failure is raised
    And the workspace-ensure flow records a clone into the workspace directory

  # ── §4 SPAWN-TIME, NOT A CONSTRUCTION-TIME SNAPSHOT (Desired behavior 2) ────────────────
  #
  # The near-miss fix, foreclosed: resolving existence ONCE in the constructor and caching the
  # verdict keeps §3 green — nothing throws at construction — while permanently poisoning every
  # long-lived context. The cron and the webhook both hold a context across the clone that
  # `ensureTargetRepoWorkspace` performs, so a stale "absent" verdict would make the workspace
  # unreachable for the life of the process. The check must re-evaluate at each spawn.
  # GREEN before and after.

  @adw-777 @adw-moe8r2-gitcontext-surfaces
  Scenario: A context built before the workspace existed reads the workspace once it appears
    Given a target workspace repository "acme/webapp" that has never been cloned on this host
    When the workspace is cloned on this host after the context was built, on branch "trunk"
    And a workspace-scoped git read is issued for the repository
    Then no missing-working-directory failure is raised
    And the workspace-scoped git read returns the branch name "trunk"

  # ── §5 REPO-API COMMANDS ARE NOT AFFECTED (Desired behavior 3) ──────────────────────────
  #
  # "After #775 lands, repo-API gh commands no longer use the target basePath, so this check should
  # only fire for commands that genuinely need a local repo." A validation written against
  # `this.#basePath` rather than against the RESOLVED cwd would pass §1 and §2 and resurrect the very
  # outage #775 fixed, one issue later — a Cancel directive unprocessable on a host with no clone.
  # The rows span the crash site, the read the clone flow's own thunk performs, both write shapes
  # (stdin-carrying and not), and the one command that carries no repository identity at all.
  # GREEN before and after — this section exists to stay green.

  @adw-777 @adw-moe8r2-gitcontext-surfaces
  Scenario Outline: Repository-API operations are unaffected by the working-directory check on a host with no cloned workspace
    Given a target workspace repository "acme/webapp" that has never been cloned on this host
    And the repository's spawns are stood in for by a harmless command that really runs in the given working directory
    When the "<operation>" repository-API operation is issued for the repository
    Then no missing-working-directory failure is raised

    Examples:
      | operation            |
      | fetch-issue-comments |
      | default-branch       |
      | issue-comment        |
      | apply-label          |
      | authenticated-user   |

  # ── §6 A REAL GIT FAILURE IS NOT MISREPORTED AS A MISSING DIRECTORY ─────────────────────
  #
  # The false-positive guard. The working directory is present, so the failure is git's own — a
  # catch-and-rewrap that fires on any error, or a check that concludes "missing" from the wrong
  # signal, would paste the new message over an unrelated fault and replace one misleading error
  # with another. Verified 2026-07-30: this failure arrives with status 128 and no error code, so it
  # is already distinguishable from a spawn-cwd failure. GREEN before and after.

  @adw-777 @adw-moe8r2-gitcontext-surfaces
  Scenario: A git command that fails inside a directory that does exist still reports its own failure
    Given a target workspace repository "acme/webapp" whose workspace directory exists but holds no git checkout
    When a workspace-scoped git read is issued for the repository
    Then the failure is the git command's own failure rather than a missing-working-directory report

  # ── §7 SELF-HOST IS UNAFFECTED ──────────────────────────────────────────────────────────
  #
  # For a self-host context `basePath === frameworkRepoRoot`, which always exists, so the check is
  # structurally a no-op there. Asserted so the framework's own dogfooded workflows keep reading
  # their own checkout and the fix cannot narrow to a shape that moves or blocks them.
  # GREEN before and after.

  @adw-777 @adw-moe8r2-gitcontext-surfaces
  Scenario: A self-host context still reads its own framework checkout
    Given a self-hosted framework repository "adw-fixture/framework-fixture" whose framework checkout is on branch "trunk"
    When a workspace-scoped git read is issued for the repository
    Then no missing-working-directory failure is raised
    And the workspace-scoped git read returns the branch name "trunk"

  # ── §8 THE SWALLOWING PROBES STILL SWALLOW ──────────────────────────────────────────────
  #
  # `resolveGitDir`, `currentBranchSymbolic` and `worktreeRegistration` exist to answer questions
  # ABOUT a worktree that may not be there — issue #638's Class-A reuse signals — and each swallows
  # the throw today. The new error must not escape them: an uncaught throw on the takeover path
  # killed the entire cron loop once already (vestmatic #187; trigger_cron.ts wraps no try/catch
  # around the takeover call), so a validation placed ABOVE those try/catch blocks — in a public
  # wrapper, or in `worktreePathFor` — would trade a cryptic error for a dead scheduler.
  # GREEN before and after.

  @adw-777 @adw-moe8r2-gitcontext-surfaces
  Scenario: Probing a worktree that does not exist still answers "missing" instead of raising
    Given a target workspace repository "acme/webapp" whose workspace holds a git checkout on branch "trunk"
    When the takeover probe inspects the worktree of branch "feature-issue-777-x"
    Then the takeover probe reports the worktree as missing without raising

  # The base-path half of the same guard, and a different swallow site: `listWorktrees` spawns from
  # `#basePath`, so on a host that never cloned the workspace it is the enriched error — not the
  # cryptic one — that its try/catch has to swallow. The janitor and the worktree sweeps call this
  # across every registered repo, so a throw escaping here would take down a loop that must survive
  # one unusable repo among many. GREEN before and after.

  @adw-777 @adw-moe8r2-gitcontext-surfaces
  Scenario: Listing worktrees on a host that never cloned the workspace answers empty instead of raising
    Given a target workspace repository "acme/webapp" that has never been cloned on this host
    When the worktree listing is requested for the repository
    Then the worktree listing answers empty without raising

  # ── §9 THE ERROR CODE SURVIVES, AND SO DOES THE ORIGINAL FAILURE ────────────────────────
  #
  # The compatibility pin, and the one assertion here that goes beyond the issue text. The enriched
  # error replaces the object thrown at exactly the site `feature-775.steps.ts:334-337` inspects
  # (`assert.strictEqual(err.code, 'ENOENT')`), which the merged feature-775 §10 uses to pin that a
  # pre-clone git read still FAILS rather than being answered from the framework checkout. Keeping
  # `code = 'ENOENT'` makes the new error a strict enrichment of the old one, keeps that merged
  # scenario green without rewriting another issue's step definitions, and keeps classification off
  # the message — which differs by runtime (node: "spawnSync /bin/sh ENOENT"; bun: "ENOENT: no such
  # file or directory, posix_spawn '/bin/sh'"). The `cause` assertion is the other half: enriching a
  # message must not throw away the original error's stack, which is what points at the call site
  # the issue complains is invisible. GREEN before on the code; RED before on the message and the
  # cause, since today there is no wrapper at all.

  @adw-777 @adw-moe8r2-gitcontext-surfaces
  Scenario: The enriched failure keeps the error code that callers classify on
    Given a target workspace repository "acme/webapp" that has never been cloned on this host
    When a workspace-scoped git read is issued for the repository
    Then the failure is still recognisable by the missing-working-directory error code
    And the failure names the missing workspace directory
    And the failure carries the original spawn failure as its cause

  # ── §T Type-check backstop (T22) ────────────────────────────────────────────────────────
  #
  # The validation at the spawn chokepoint keeps the ADW codebase type-clean. Consistent with
  # feature-775 §T and feature-769 §T.

  @adw-777 @adw-moe8r2-gitcontext-surfaces
  Scenario: The ADW TypeScript type-check passes with the spawn working-directory check in place
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
