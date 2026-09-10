@adw-769 @adw-5k8n5z-cron-sweep-probes-re
Feature: The cron sweep probes act on the repository the cron was launched for — a target-repo cron no longer sweeps, scores, or writes to the framework repo

  Issue #769 fixes a repo-retargeting hole in the two cron sweep probes,
  `runPerIssueScenarioSweep` (`adws/triggers/perIssueScenarioSweep.ts`) and `runPromotionSweep`
  (`adws/triggers/promotionSweep.ts`), both invoked on a cadence from `adws/triggers/trigger_cron.ts`.
  The cron resolves its repo identity correctly (`cronRepoInfo`) and builds a launch-boundary
  context (`cronGitContext = buildLaunchGitContext(targetRepo)`), but passes NEITHER to the sweeps —
  they are called with no arguments, so every default dep re-derives identity from scratch via
  `gitContextForRepo(getRepoInfo())`. `getRepoInfo()` with no `cwd` shells `git remote get-url
  origin` against `process.cwd()`, which for every cron is the FRAMEWORK checkout.

  So each of the three live target-repo crons sweeps `paysdoc/AI_Dev_Workflow` instead of its own
  target. Observed 2026-07-29 in the `vestmatic/vestmatic-research` cron log — AI_Dev_Workflow issue
  numbers and AI_Dev_Workflow feature files:

    perIssueScenarioSweep: sweeping stale scenario features/per-issue/feature-701.feature …
    ⚠️ perIssueScenarioSweep: checkout is not on default branch "dev" — skipping persistence
    promotionSweep: features/per-issue/feature-504.feature → leave

  This is NOT a GitContext bypass: a `RepoInfo` IS passed, the constructor gets mandatory identity,
  and `resolveBasePath` runs with no cwd fallback — the package's contract holds. What breaks is the
  PRD's other half: identity must be established ONCE at the launch boundary and THREADED, never
  re-derived. `gitContextForRepo` is a public, synchronous, boundary-free factory that accepts any
  `RepoInfo`; handed the framework's identity it cooperates perfectly, because it cannot tell a
  correct caller from an incorrect one. `checkGitGhGuard` cannot see it either — there is no raw
  `git`/`gh`, and `readLocalRepoInfo` is the permanently-allowlisted bootstrap read. The bypass
  shape is a COMPOSITION of two individually-legal calls.

  Four consequences, all of which the contract below pins:

    1. Target repos are never swept — per-issue scenarios never hit the 14-day TTL and promotion
       candidates are never scored, for every target repo, permanently.
    2. The pass never converges — the framework checkout is not on `dev`, persistence
       short-circuits, and the same stale files are re-detected every cadence forever, each
       candidate costing a `gh pr list --limit 200`.
    3. A latent CROSS-REPO WRITE hazard — the branch mismatch is the only thing preventing damage.
       On `dev`, every target-repo cron would land removals on AI_Dev_Workflow's default branch and
       file `regression-promotion` issues there, concurrently across three crons.
    4. Out-of-scope auth — each default helper re-mints an installation token for a repo the
       process has no business touching (5 constructions per per-issue pass, 9 per promotion pass).

  THE FIX: both probes take a `GitContext` (not a `RepoInfo`), so there is no identity resolution
  left inside them; the module-level `defaultX` free functions become a `makeDefaultDeps(ctx)`
  factory closing over the passed context; every `getRepoInfo()` call leaves both files; and when no
  launch context is available the call sites SKIP the pass rather than fall back to cwd. The guard
  gains a rule so the cwd-derived-identity-feeding-a-context-construction shape cannot recur.

  The behavioural contract pinned below (the OBSERVABLE half of the acceptance criteria):

    1. A TARGET-REPO CRON SWEEPS ITS OWN TARGET (AC2). A cron holding a target-repo launch context
       removes the TARGET repo's stale per-issue scenario — the pass acts on the repo the cron was
       launched for, not on whatever repo the process working directory happens to be.
    2. A TARGET-REPO CRON DOES NOT TOUCH FRAMEWORK-REPO PATHS (AC7, hazard 3). The same tick leaves
       the framework checkout's per-issue tree tracked and its branch tip unmoved, even though the
       framework checkout carries an equally-stale scenario and IS the process working directory.
       This is the cross-repo write hazard, pinned as behaviour.
    3. NO PASS-INTERNAL IDENTITY RESOLUTION (AC1 / AC5). Every repository operation the pass
       performs — including the merged-PR lookup that today costs a `gh pr list` against the wrong
       repo — is issued through the INJECTED launch context, and none is issued outside it. A pass
       that constructed its own context (however correct) would show zero operations on the
       injected one, so this pins "no identity resolution left inside" and "exactly one context per
       pass" as one observable.
    4. THE PROMOTION SWEEP SCORES THE TARGET REPO'S CANDIDATES (AC2). A target-repo cron's promotion
       pass reports the TARGET repo's per-issue scenario as a candidate and reports no candidate
       from the framework checkout.
    5. THE PROMOTION SWEEP NEVER WRITES TO THE FRAMEWORK REPO (AC2 / hazard 3). Its reconciliation
       query is issued through the cron's launch context, and it creates no issue in — and adds no
       commit to — the framework checkout. This is the "files `regression-promotion` issues there,
       concurrently across crons" hazard.
    6. SELF-HOST CRON IS UNCHANGED (AC3). A cron launched with no `--target-repo` holds a self-host
       context and still sweeps the framework repo. The fix must not trade one retarget for another.
    7. NO LAUNCH CONTEXT ⇒ SKIP, NOT FALL BACK (AC4). When no launch context is available, each pass
       is skipped without touching any repository checkout, the skip is reported in the cron log,
       and the cycle completes without a thrown error — non-fatal, and never a cwd fallback.
    8. THE GUARD FLAGS THE COMPOSITION (AC6). `gitContextForRepo(getRepoInfo())` in a non-boundary
       source is reported as a violation, so this class cannot be reintroduced.
    9. THE GUARD DOES NOT OVER-FIRE (AC6). The guarded-fallback shape (`repoInfo ?? getRepoInfo()`)
       and launch-boundary files stay legal — a rule that flagged them would be un-shippable.
   10. THE WHOLE REPOSITORY IS COMPLIANT (AC6 ratchet). With the new rule in place the guard passes
       across the whole ADW repository — which requires `githubApi.ts`'s identically-shaped
       `gitContextForRepo(getRepoInfo()).authenticatedUser()` to be brought into compliance, not
       left to fail the build. The issue's alternative ("or explicitly allowlisted") is closed by
       #701 (allowlist deleted) and #700 (`(0 allowlisted)` stdout assertion), so the plan makes the
       self-host identity explicit (`readLocalRepoInfo(REPO_ROOT)`) at that site and at the three
       other cwd-derived constructions instead. This scenario asserts only the verdict, so it holds
       whichever way compliance is reached.
   11. TYPE-CHECK BACKSTOP (T22).

  Observability / rot-prevention note:

    Every assertion targets an artefact the system PRODUCES — the commit graph and tracked tree of
    throwaway fixture git repos, the removal batch the sweep returns, the report the promotion sweep
    returns, recorded calls on an injected/recording `GitContext`, recorded logger entries, the
    guard's verdict on a fixture source, and the type-checker's exit status. These are vocabulary
    registry surfaces #3 (git artefacts), #2 (recorded calls), #5 (log streams) and #4 (exit codes).
    No step reads `perIssueScenarioSweep.ts`, `promotionSweep.ts`, `promotionSweepDefaults.ts`,
    `trigger_cron.ts`, `checkGitGhGuard.ts` or any other framework source file as text,
    substring-matches its contents, or parses it as JSON/AST.

      • The two fixture checkouts ("target repository checkout" / "framework repository checkout")
        are real temp git repos the step constructs and seeds — INPUT fixtures, the category the
        Rot-Detection Rubric permits (as feature-758 / feature-735 / feature-648 build theirs).
        Asserting which of the two the pass acted on is asserting the SUT's observable output.
      • The guard scenarios (§9–§11) drive the guard's exported scan core over a THROWAWAY FIXTURE
        SOURCE the step writes into a temp root, exactly as the @adw-537 hash scenarios feed fixture
        inputs to `computeFrameworkHash`. The fixture is an INPUT to the system under test, not a
        framework source file, and the assertion is on the guard's VERDICT. §12 runs the guard over
        the real repository and asserts only its verdict — never any file's contents.
      • "still tracked" / "carries no commit added by the sweep" are git-artefact assertions over
        the fixture repos (tree membership and branch tip), the same shape as registered T31–T33 —
        never file-on-disk existence of a source file.

  Scope notes:

    • THE ISSUE'S LINE REFERENCES ARE STALE — THE BUG SURFACE IS WIDER THAN IT SAYS. The issue cites
      `perIssueScenarioSweep.ts:58,67,85,95,114` as five `gitContextForRepo(getRepoInfo())` sites,
      but #758 has since moved the listing/reading/persisting defaults behind
      `prepareSweepBase()` in `adws/triggers/perIssueSweepPersist.ts`. TODAY the per-issue sweep's
      cwd-derived identity lives in TWO files: `defaultGetMergedAt` (`perIssueScenarioSweep.ts`) and
      `prepareSweepBase` (`perIssueSweepPersist.ts:51`) — and the latter is the one that decides
      WHICH REPO the sweep worktree, the listing, and the removal PR belong to. Threading the
      context only into `perIssueScenarioSweep.ts` would leave the bug live. The scenarios below are
      written against behaviour, so they hold regardless of how the fix is factored; the
      implementer must carry `prepareSweepBase` too. `promotionSweepDefaults.ts` is unchanged from
      the issue's description (nine sites).
    • THE README CORRECTION (AC8) IS NOT BDD-ASSERTABLE and is deliberately not pinned here —
      asserting documentation text would be a substring match against a repo file, which the
      Rot-Detection Rubric forbids. It remains a real deliverable for the implementer. The stale
      "manual CLI today, not yet wired into cron" claim is at README.md:28, README.md:328 and
      README.md:861 (NOT README.md:26 as the issue states); `adws/README.md` contains no
      promotion-sweep text at all, so there is nothing to correct there — the issue's second target
      does not exist.
    • "`getRepoInfo` IS NOT IMPORTED BY EITHER FILE" (AC1, second half) IS A SOURCE PROPERTY and is
      intentionally left to the implementer's unit tests and to the guard rule (§8–§10) rather than
      asserted as a scenario. §3 pins the behavioural half — no identity resolution happens inside
      the pass — which is what the import ban exists to guarantee.
    • THE SWEEP SEMANTICS THEMSELVES ARE NOT RE-PINNED. The 14-day retention window, the
      promotion-tag exemption, the sibling step-def cleanup, the sync→branch→PR persistence
      (feature-735 / feature-739 / feature-758), and the promotion lifecycle actions
      (originate/decline/redrive/withdraw) are those issues' contracts. This fix changes only WHICH
      REPOSITORY the passes act on; it must not widen, narrow, or disable any of them.
    • THE UNIT-TEST HALVES ARE THE IMPLEMENTER'S. The exact `makeDefaultDeps(ctx)` shape, the
      count of contexts constructed per pass as a structural fact, the tick-gate signatures, and
      the guard rule's AST matching belong in Vitest, exactly as feature-735 / feature-758 split
      their unit coverage from their BDD scenarios. The BDD layer pins only observable behaviour.
    • THE @regression MAINTENANCE SWEEP IS SKIPPED for this issue: `.adw/scenarios.md` configures a
      `## Regression Scenario Directory`, so promotion to the regression suite is a deliberate human
      decision and this agent never auto-promotes. The issue's requested "per-issue
      `@adw-{issueNumber}` BDD scenario driving the cross-repo case" (AC7) is §2 below.

  Vocabulary note:

    Registered phrases reused (`features/regression/vocabulary.md`):
      G18  `the ADW codebase is checked out`
      T22  `the ADW TypeScript type-check passes`

    Novel phrasing introduced here — the registry has no phrase for a two-checkout cron world, a
    threaded launch context, a pass skipped for want of one, or a guard verdict over a fixture
    source. The phrasing is deliberately DISTINCT from feature-758's sweep phrases (`the per-issue
    scenario sweep runs on the cron host`, `origin carries a sweep branch that omits…`), from
    feature-735 / feature-739's sweep phrases, and from feature-691 / feature-700's guard phrases
    (`the git/gh guard scans the file {string}`, `the git/gh guard is run across the repository`,
    `the git/gh guard reports no violation in that file`), so feature-769.steps.ts can define
    self-contained step defs with zero AmbiguousStepDefinition risk under the globally-loaded
    per-issue step defs. The gap is surfaced to the maintainer in the agent Output:
      • `a target repository checkout carrying a per-issue scenario for issue {int} whose linked PR merged {int} days ago`
      • `a framework repository checkout carrying a per-issue scenario for issue {int} whose linked PR merged {int} days ago`
      • `the cron process is working from the framework repository checkout`
      • `the cron holds a launch context for the target repository`
      • `the cron holds a self-host launch context for the framework repository`
      • `the cron holds no launch context`
      • `the cron cycle runs the per-issue scenario sweep`
      • `the cron cycle runs the promotion sweep`
      • `the git/gh guard scans a fixture source at {string} containing:`
      • `the sweep removes the per-issue scenario for issue {int} from the target repository checkout`
      • `the sweep removes the per-issue scenario for issue {int} from the framework repository checkout`
      • `the framework repository checkout still tracks the per-issue scenario for issue {int}`
      • `the framework repository checkout carries no commit added by the pass`
      • `every repository operation the pass performed was issued through the cron's launch context`
      • `the pass issued no repository operation outside the cron's launch context`
      • `the merged-PR lookup for issue {int} was issued through the cron's launch context`
      • `the promotion sweep reports the per-issue scenario for issue {int} as a candidate from the target repository checkout`
      • `the promotion sweep reports no candidate from the framework repository checkout`
      • `the promotion tracking issues were queried through the cron's launch context`
      • `the promotion sweep creates no issue in the framework repository`
      • `the pass is skipped without touching any repository checkout`
      • `the skipped pass is reported in the cron log`
      • `the cron cycle completes without a thrown error`
      • `the git/gh guard reports a violation in that fixture source`
      • `the git/gh guard reports no violation in that fixture source`
      • `the git/gh guard runs across the whole ADW repository`
      • `the guard run reports no violations`

    Step-definition note for the maintainer (feature-769.steps.ts — keep it SELF-CONTAINED with its
    own `@adw-769` After and module-private world; do NOT reach into feature-735's / feature-739's /
    feature-758's sweep step defs, nor feature-691's / feature-700's guard step defs — see the
    TTL-coupling warning at the end):

      • TWO-CHECKOUT WORLD. Build two real temp git repos: the TARGET checkout at
        `<tmp>/adw-fixture/target-fixture` (so a `GitContext` with `targetReposDir: <tmp>`,
        `owner: 'adw-fixture'`, `repo: 'target-fixture'`, `selfHost: false` resolves `basePath` to
        it — production's `resolveBasePath` layout, no monkey-patching) and the FRAMEWORK checkout
        at a separate temp dir. Seed each with `features/per-issue/feature-{N}.feature` plus its
        `features/per-issue/step_definitions/feature-{N}.steps.ts` sibling, committed, with a real
        bare remote as `origin` (feature-758's construction).
      • SAFETY PROPERTY — THE FRAMEWORK FIXTURE'S REMOTE MUST NAME A FICTITIOUS owner/repo (e.g.
        `https://github.com/adw-fixture/framework-fixture.git`). `the cron process is working from
        the framework repository checkout` does `process.chdir(frameworkFixture)` (restore the
        original cwd in `After`). This is what makes the RED run both meaningful AND harmless: the
        unfixed code resolves `adw-fixture/framework-fixture` from cwd, `gitContextForRepo` then
        calls `resolveContextToken`, the GitHub App IS configured on the cron host so it tries to
        mint an installation token for a repo with no installation and THROWS, and every default's
        `catch` degrades to `[]`/`null`. The unfixed pass therefore sweeps NOTHING — a crisp RED —
        while being structurally unable to reach the real `paysdoc/AI_Dev_Workflow` checkout or make
        a network call. DO NOT give the framework fixture a real owner/repo: `resolveBasePath` would
        then point the unfixed `prepareSweepBase` at a real checkout and the RED run would create a
        `chore/scenario-sweep` worktree in the maintainer's actual repository.
      • THE INJECTED CONTEXT IS A RECORDING SUBCLASS. `the cron holds a launch context for the
        target repository` constructs a real `GitContext` over the target fixture and subclasses it
        (feature-758's `InjectablePushGitContext` precedent) to (a) RECORD every repository
        operation it is asked to perform — at minimum `lsFiles`, `fetchMergedPRs`, `listOpenIssues`,
        `createIssue`, `defaultBranch` — and (b) override ONLY the gh-backed seams: `defaultBranch()`
        returns the fixture's branch name (production shells `gh repo view`), `fetchMergedPRs()`
        returns a canned merged-PR JSON body linking the seeded issue at the seeded merge date, and
        `listOpenIssues()` returns `[]`. Every git operation stays REAL, so the GREEN signal comes
        from the real threaded code, never a hand-mirrored stand-in. `the cron holds a self-host
        launch context for the framework repository` builds the same recording subclass with
        `selfHost: true` and `frameworkRepoRoot: <framework fixture>`.
      • DRIVE THE REAL ENTRY POINTS. `the cron cycle runs the per-issue scenario sweep` calls the
        REAL `runPerIssueScenarioSweep({ gitContext, persistRemoval: <recorder that applies the
        removal to the fixture worktree> })` and stores the returned removal batch; `the cron cycle
        runs the promotion sweep` calls the REAL `runPromotionSweep({ gitContext, fileIssue:
        <recorder> })` and stores the returned report. INJECT NOTHING ELSE — in particular do NOT
        inject `listFeatures`, `readFeatureContent`, `getMergedAt`, `listPerIssueFeatures`,
        `listStepDefSiblings`, `listPromotionIssues`, `loadVocabulary`, `loadStats`, `tagAndCommit`
        or `scenariosConfig`: those defaults ARE the retargeting bug, each reaches git/gh only
        through `ctx` (so the recording subclass already intercepts it), and injecting them makes
        every scenario vacuous — §5 in particular asserts that the reconciliation query went through
        the injected context, which requires `listPromotionIssues` to fall through.
        `persistRemoval` / `fileIssue` are injected
        only because their production paths reach gh through free functions
        (`defaultFindPRByBranch`, `mergePR`, `applyLabel`) that no context override can intercept;
        both recorders assert what the pass DECIDED to persist, which is the observable in question.
      • WHERE THE SKIP IS DRIVEN. `the cron holds no launch context` + a `When` requires the fix to
        expose the cadence-and-skip gate as an exported, injectable tick for BOTH sweeps — keep the
        existing `runPromotionSweepTick(cycleCount, sweep)` SHAPE and add the per-issue counterpart,
        widening the sweep parameter to a NULLABLE bound thunk whose production default is bound to
        the cron's launch context. The sweep MUST stay in position 2: `feature-745.steps.ts:79` calls
        `runPromotionSweepTick(cycleCount, fakeSweep)`, and moving a context parameter in there would
        force a rewrite of five passing regression scenarios. So `the cron holds no launch context`
        passes `null` in the SWEEP position, and the step asserts: the injected sweep was never
        invoked, no recorded operation on either fixture, the skip line appears on CAPTURED STDOUT
        (the cron's `log` is console-backed — `adws/core/logger.ts:62` — so there is no logger seam
        to inject and none should be added), and nothing threw. (`cronGitContext` is legitimately
        null whenever `trigger_cron.ts` is imported as a module, which is exactly how BDD reaches
        it — the guard at `trigger_cron.ts:75` does not fire.)
      • GUARD FIXTURES (§9–§11). `the git/gh guard scans a fixture source at {string} containing:`
        writes the DocString to `<tmpRoot>/<path>` and calls the guard's exported scan core over
        that single relative path with `<tmpRoot>` as the repo root — the established per-file scan
        pattern from feature-695/696/699, with a fixture source instead of a real one so the
        scenario cannot rot when production files move. `scanFiles` applies NO path exemption (only
        `visitDir`'s directory skips are path-based), and the new rule deliberately introduces no
        allowlist — #701 deleted it and #700's `(0 allowlisted)` stdout assertion depends on its
        absence. §11's launch boundary therefore stays legal BY SHAPE: a guarded-fallback identity
        (`targetRepo ?? getRepoInfo()`) feeding the boundary CONSTRUCTOR (`new GitContext(...)`),
        which is the real `buildLaunchGitContext` shape (`adws/core/launchGitContext.ts:87-98`). The
        boundary path in that step is documentary, not load-bearing. §12 (`the git/gh guard runs
        across the whole ADW repository`) spawns `bunx tsx adws/checkGitGhGuard.ts` and asserts the
        exit status only.
      • TTL-COUPLING WARNING (worth a maintainer decision, not a blocker): this fix makes the
        per-issue TTL sweep actually converge for the first time, so per-issue step-def files become
        genuinely deletable. Any scenario that reuses another issue's per-issue step definitions
        breaks the moment the depended-on issue's files age past 14 days and are swept — and this is
        NOT hypothetical: the registered T22 phrase `the ADW TypeScript type-check passes` is
        defined in `per-issue/step_definitions/feature-504.steps.ts:1126`, and
        `features/per-issue/feature-504.feature` is one of the very files the broken pass was
        already scoring (`promotionSweep: features/per-issue/feature-504.feature → leave`). Every
        scenario carrying a §T backstop — this one, feature-758, feature-735, feature-739 and others
        — depends on it. feature-700 §4a similarly depends on feature-691's guard steps. That
        coupling is why every step above is self-contained EXCEPT the two registered vocabulary
        phrases (G18, T22), which are reused rather than redefined because redefining them would be
        an AmbiguousStepDefinition. The durable fix is to relocate registry-registered step defs
        (G18 already lives in the sweep-exempt `features/step_definitions/`; T22 does not) out of
        `features/per-issue/`. Out of scope here — surfaced in the agent Output.

  Background:
    Given the ADW codebase is checked out

  # ── §1 A TARGET-REPO CRON SWEEPS ITS OWN TARGET (AC2) ──────────────────────────────────
  #
  # The headline. The cron holds a target-repo launch context but is working from the framework
  # checkout — the exact live configuration of all three crons. The stale scenario that must be
  # removed is the TARGET's. RED before (identity is re-derived from cwd, the framework-derived
  # construction throws at token mint, every default degrades to empty, nothing is swept);
  # GREEN after.

  @adw-769 @adw-5k8n5z-cron-sweep-probes-re
  Scenario: A target-repo cron tick sweeps the target repository's stale per-issue scenario
    Given a target repository checkout carrying a per-issue scenario for issue 611 whose linked PR merged 20 days ago
    And a framework repository checkout carrying a per-issue scenario for issue 612 whose linked PR merged 20 days ago
    And the cron process is working from the framework repository checkout
    And the cron holds a launch context for the target repository
    When the cron cycle runs the per-issue scenario sweep
    Then the sweep removes the per-issue scenario for issue 611 from the target repository checkout

  # ── §2 A TARGET-REPO CRON DOES NOT TOUCH FRAMEWORK-REPO PATHS (AC7, hazard 3) ───────────
  #
  # The issue's explicitly-requested cross-repo scenario, and the latent write hazard: today only
  # the framework checkout's branch mismatch prevents three concurrent crons from committing
  # removals onto AI_Dev_Workflow's default branch. The framework checkout carries an equally-stale
  # scenario AND is the process working directory, so nothing but correct threading keeps the pass
  # off it. RED before (the pass targets the framework repo — the observed live behaviour);
  # GREEN after.

  @adw-769 @adw-5k8n5z-cron-sweep-probes-re
  Scenario: A target-repo cron tick leaves the framework repository's per-issue scenarios alone
    Given a target repository checkout carrying a per-issue scenario for issue 611 whose linked PR merged 20 days ago
    And a framework repository checkout carrying a per-issue scenario for issue 612 whose linked PR merged 20 days ago
    And the cron process is working from the framework repository checkout
    And the cron holds a launch context for the target repository
    When the cron cycle runs the per-issue scenario sweep
    Then the framework repository checkout still tracks the per-issue scenario for issue 612
    And the framework repository checkout carries no commit added by the pass

  # ── §3 NO PASS-INTERNAL IDENTITY RESOLUTION (AC1 / AC5) ─────────────────────────────────
  #
  # "Accept a gitContext and perform no repo identity resolution of their own" + "exactly one
  # GitContext per pass" as ONE observable: a pass that built its own context — even a correct one —
  # would leave the injected context unused. The merged-PR lookup is called out because it is the
  # per-candidate `gh pr list --limit 200` that impact 2 and impact 4 are about: today it is issued
  # against the framework repo with a framework-bound token. RED before (zero operations reach the
  # injected context); GREEN after.

  @adw-769 @adw-5k8n5z-cron-sweep-probes-re
  Scenario: The per-issue sweep issues every repository operation through the cron's launch context
    Given a target repository checkout carrying a per-issue scenario for issue 611 whose linked PR merged 20 days ago
    And a framework repository checkout carrying a per-issue scenario for issue 612 whose linked PR merged 20 days ago
    And the cron process is working from the framework repository checkout
    And the cron holds a launch context for the target repository
    When the cron cycle runs the per-issue scenario sweep
    Then every repository operation the pass performed was issued through the cron's launch context
    And the merged-PR lookup for issue 611 was issued through the cron's launch context
    And the pass issued no repository operation outside the cron's launch context

  # ── §4 THE PROMOTION SWEEP SCORES THE TARGET REPO'S CANDIDATES (AC2) ────────────────────
  #
  # The second probe, same defect (nine `gitContextForRepo(getRepoInfo())` sites in
  # promotionSweepDefaults.ts). The candidate set must come from the target checkout — the live log
  # shows it scoring AI_Dev_Workflow's `feature-504.feature` from a vestmatic cron. RED before (the
  # framework-derived construction throws, the listing degrades to empty, the report is empty);
  # GREEN after.

  @adw-769 @adw-5k8n5z-cron-sweep-probes-re
  Scenario: A target-repo cron tick scores the target repository's per-issue scenarios for promotion
    Given a target repository checkout carrying a per-issue scenario for issue 611 whose linked PR merged 20 days ago
    And a framework repository checkout carrying a per-issue scenario for issue 612 whose linked PR merged 20 days ago
    And the cron process is working from the framework repository checkout
    And the cron holds a launch context for the target repository
    When the cron cycle runs the promotion sweep
    Then the promotion sweep reports the per-issue scenario for issue 611 as a candidate from the target repository checkout
    And the promotion sweep reports no candidate from the framework repository checkout

  # ── §5 THE PROMOTION SWEEP NEVER WRITES TO THE FRAMEWORK REPO (hazard 3) ────────────────
  #
  # The write half of the promotion probe: on a checkout that happened to be on the default branch,
  # three target-repo crons would concurrently file `regression-promotion` issues into
  # AI_Dev_Workflow and commit tag writes there. The reconciliation query — issued unconditionally
  # at the start of every pass — must go through the cron's launch context. RED before (zero
  # operations reach the injected context); GREEN after.

  @adw-769 @adw-5k8n5z-cron-sweep-probes-re
  Scenario: A target-repo cron's promotion pass queries and writes only through its launch context
    Given a target repository checkout carrying a per-issue scenario for issue 611 whose linked PR merged 20 days ago
    And a framework repository checkout carrying a per-issue scenario for issue 612 whose linked PR merged 20 days ago
    And the cron process is working from the framework repository checkout
    And the cron holds a launch context for the target repository
    When the cron cycle runs the promotion sweep
    Then the promotion tracking issues were queried through the cron's launch context
    And the promotion sweep creates no issue in the framework repository
    And the framework repository checkout carries no commit added by the pass

  # ── §6 SELF-HOST CRON IS UNCHANGED (AC3) ───────────────────────────────────────────────
  #
  # "Self-host cron (no --target-repo) still sweeps the framework repo — no regression." The fix
  # must not trade a cwd-derived retarget for a target-only one: with a self-host launch context the
  # framework repo is the correct subject, and its stale scenario is swept. GREEN both before and
  # after by construction — this is the regression guard that keeps the fix honest.

  @adw-769 @adw-5k8n5z-cron-sweep-probes-re
  Scenario: A self-host cron tick still sweeps the framework repository's stale per-issue scenario
    Given a framework repository checkout carrying a per-issue scenario for issue 612 whose linked PR merged 20 days ago
    And the cron process is working from the framework repository checkout
    And the cron holds a self-host launch context for the framework repository
    When the cron cycle runs the per-issue scenario sweep
    Then the sweep removes the per-issue scenario for issue 612 from the framework repository checkout
    And every repository operation the pass performed was issued through the cron's launch context

  # ── §7 NO LAUNCH CONTEXT ⇒ SKIP, NOT FALL BACK — PER-ISSUE SWEEP (AC4) ──────────────────
  #
  # `cronGitContext` is null whenever trigger_cron.ts is imported as a module rather than launched
  # as the entry script. The call site must SKIP the pass — logged and non-fatal — rather than fall
  # back to cwd, which is precisely the behaviour being removed. RED before (no skip gate exists;
  # the pass runs and re-derives identity from cwd); GREEN after.

  @adw-769 @adw-5k8n5z-cron-sweep-probes-re
  Scenario: A cron cycle with no launch context skips the per-issue sweep instead of falling back to the working directory
    Given a target repository checkout carrying a per-issue scenario for issue 611 whose linked PR merged 20 days ago
    And a framework repository checkout carrying a per-issue scenario for issue 612 whose linked PR merged 20 days ago
    And the cron process is working from the framework repository checkout
    And the cron holds no launch context
    When the cron cycle runs the per-issue scenario sweep
    Then the pass is skipped without touching any repository checkout
    And the skipped pass is reported in the cron log
    And the cron cycle completes without a thrown error

  # ── §8 NO LAUNCH CONTEXT ⇒ SKIP, NOT FALL BACK — PROMOTION SWEEP (AC4) ──────────────────
  #
  # The same contract for the second probe, whose write path (tag commits + `regression-promotion`
  # issues) makes a cwd fallback strictly more dangerous than the per-issue one.

  @adw-769 @adw-5k8n5z-cron-sweep-probes-re
  Scenario: A cron cycle with no launch context skips the promotion sweep instead of falling back to the working directory
    Given a target repository checkout carrying a per-issue scenario for issue 611 whose linked PR merged 20 days ago
    And a framework repository checkout carrying a per-issue scenario for issue 612 whose linked PR merged 20 days ago
    And the cron process is working from the framework repository checkout
    And the cron holds no launch context
    When the cron cycle runs the promotion sweep
    Then the pass is skipped without touching any repository checkout
    And the skipped pass is reported in the cron log
    And the cron cycle completes without a thrown error

  # ── §9 THE GUARD FLAGS THE COMPOSITION (AC6) ────────────────────────────────────────────
  #
  # The guard could not see this bug: no raw git/gh, and `readLocalRepoInfo` is the permanently
  # allowlisted bootstrap read — the bypass is a COMPOSITION of two legal calls. The new rule flags
  # cwd-derived identity feeding a context construction, so the class cannot recur. RED before (no
  # such rule; the fixture scans clean); GREEN after.

  @adw-769 @adw-5k8n5z-cron-sweep-probes-re
  Scenario: The guard flags a cwd-derived repo identity feeding a context construction
    When the git/gh guard scans a fixture source at "adws/triggers/someProbe.ts" containing:
      """
      import { getRepoInfo } from '../github';
      import { gitContextForRepo } from '../github/gitContextFactory';

      export function listThings(): string[] {
        const ctx = gitContextForRepo(getRepoInfo());
        return ctx.lsFiles(ctx.basePath, 'features/per-issue');
      }
      """
    Then the git/gh guard reports a violation in that fixture source

  # ── §10 THE GUARD DOES NOT OVER-FIRE — GUARDED FALLBACK (AC6) ───────────────────────────
  #
  # "`bun run lint:git-guard` … passes on the guarded-fallback sites (`repoInfo ?? getRepoInfo()`)".
  # A caller that PREFERS a threaded identity and only falls back when none was supplied is the
  # legal shape used across adwPrReview, webhookGatekeeper and trigger_webhook; a rule that flagged
  # it would be un-shippable. Guards the fix against over-firing. Written at the permanent launch-
  # boundary path (#823 retired `adws/providers/repoContext.ts`'s own sanctioned-site standing, which
  # this fixture never meant to exercise — this row is about the guarded-fallback shape, not about
  # which file it lives in).

  @adw-769 @adw-5k8n5z-cron-sweep-probes-re
  Scenario: The guard permits a threaded identity with a guarded fallback
    When the git/gh guard scans a fixture source at "adws/core/launchGitContext.ts" containing:
      """
      import { getRepoInfo, type RepoInfo } from '../github';
      import { gitContextForRepo } from '../github/gitContextFactory';

      export function handle(repoInfo?: RepoInfo): string {
        const resolvedRepoInfo = repoInfo ?? getRepoInfo();
        return gitContextForRepo(resolvedRepoInfo).remoteUrl();
      }
      """
    Then the git/gh guard reports no violation in that fixture source

  # ── §11 THE GUARD DOES NOT OVER-FIRE — LAUNCH BOUNDARY (AC6) ────────────────────────────
  #
  # Identity has to be derived from the environment SOMEWHERE — that is what a launch boundary is
  # for. The rule is about re-derivation everywhere else, so the boundary stays legal — BY SHAPE,
  # not by a path allowlist (the rule adds none: #701 deleted the allowlist and #700 asserts
  # `(0 allowlisted)`). The fixture is the real `buildLaunchGitContext` shape — a guarded-fallback
  # identity feeding the boundary constructor — written at the boundary path for documentary value.

  @adw-769 @adw-5k8n5z-cron-sweep-probes-re
  Scenario: The guard permits identity resolution inside a launch boundary
    When the git/gh guard scans a fixture source at "adws/core/launchGitContext.ts" containing:
      """
      import { GitContext } from '../gitContext';
      import { getRepoInfo } from '../github/githubApi';
      import type { TargetRepoInfo } from '../types/issueTypes';

      export function buildContext(targetRepo: TargetRepoInfo | null): GitContext {
        const { owner, repo } = targetRepo ?? getRepoInfo();
        return new GitContext({ owner, repo, selfHost: targetRepo === null });
      }
      """
    Then the git/gh guard reports no violation in that fixture source

  # ── §12 THE WHOLE REPOSITORY IS COMPLIANT (AC6 ratchet) ─────────────────────────────────
  #
  # The ratchet. With the new rule in place the guard must pass across the whole ADW repository —
  # which forces the two sweep files to be threaded AND forces a decision on `githubApi.ts`'s
  # identically-shaped `gitContextForRepo(getRepoInfo()).authenticatedUser()`: bring it into
  # compliance or allowlist it with a reason. Leaving it to fail the build is not an option.

  @adw-769 @adw-5k8n5z-cron-sweep-probes-re
  Scenario: The git/gh guard passes across the whole repository with the identity-threading rule in place
    When the git/gh guard runs across the whole ADW repository
    Then the guard run reports no violations

  # ── §T Type-check backstop (T22) ────────────────────────────────────────────────────────
  #
  # The threaded `gitContext` deps, the `makeDefaultDeps(ctx)` factories, and the tick-gate
  # signature changes keep the ADW codebase type-clean. Consistent with feature-758 §T.

  @adw-769 @adw-5k8n5z-cron-sweep-probes-re
  Scenario: The ADW TypeScript type-check passes with the launch context threaded into both sweeps
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
