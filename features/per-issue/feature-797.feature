@adw-797 @adw-qnr31u-migrate-core-trigger
Feature: The last semantic callers walk to the providers and GitContext's forge surface is deleted behind them — a core package that loads on its own, with git, worktree, workspace and executor and nothing else

  Issue #797 is the final slice of the GitContext forge-agnostic refactor
  (`specs/prd/gitcontext-forge-agnostic-refactor.md`) and the second of two migration waves. #790
  promoted the spawn chokepoint to a public `exec`, #791 replaced the construction-time credential
  with a TokenProvider port, #792 moved the GitHub material into the forge adapter and left the
  command-string builders there, #793 narrowed the bootstrap reads, #794 made the launch boundary
  hand back a GitContext and a provider triple bound to ONE identity, #795 added the
  ad-hoc-construction guard rule, and #796 walked the orchestrators and phases across. What is left
  is everything else — the core utilities, the triggers, the comment layer — and then the deletion
  that the whole phase exists for.

  The deletion is what makes this slice different from #796. #796 could migrate a caller and leave
  the method standing; #797 cannot. AC2 removes the methods, so EVERY remaining caller must move,
  whether or not the issue's Touched Files list named it, and the slice is not done when the named
  files are green — it is done when `bunx tsc --noEmit` is green with the methods gone. The
  acceptance criteria are unusually literal about the end state: "no module ANYWHERE calls a
  forge-semantic method on GitContext", "core package has zero GitHub-specific code and zero
  ADW-application imports", "operator-visible behavior unchanged (same comments, same repos, same
  commands)".

  WHAT THE CODE ACTUALLY LOOKS LIKE TODAY. A scan of every non-test module for a forge-semantic
  method invoked on a GitContext returns 55 call sites. The issue's Touched Files list covers
  fewer than a third of them. Grouped by who owns the call:

    THE NAMED SCOPE — core utilities and triggers (14 sites)
      core/targetRepoManager.ts:73,95          ctx.defaultBranch()
      core/upgradeClaim.ts:77,142              findPRByBranch / ctx.defaultBranch()
      core/remoteReconcile.ts:51               deps.findPRByBranch(branchName, repoInfo)
      core/resolvePrReviewTarget.ts:22         deps.fetchIssueComments(pr.issueNumber)
      triggers/trigger_cron.ts:97              gitContextForRepo(cronRepoInfo).listOpenIssues(…)
      triggers/concurrencyGuard.ts:24          gitContextForRepo(repoInfo).listOpenIssues(…)
      triggers/webhookGatekeeper.ts:203        gitContextForRepo(repoInfo).listOpenIssues(…)
      triggers/issueClosedUnblockRouter.ts:53  ctx.listOpenIssues(…)
      triggers/takeoverHandler.ts:89           gitContextForRepo(repoInfo).issueComments(n)
      triggers/perIssueScenarioSweep.ts:80     ctx.fetchMergedPRs(200)
      triggers/perIssueSweepPersist.ts:55,74   ctx.defaultBranch() / ctx.createPR(…)
      triggers/promotionSweepDefaults.ts:126,145,158  listOpenIssues / defaultBranch / createIssue

    THE UNNAMED SCOPE THAT AC2 DRAGS IN (41 sites)
      github/issueApi.ts                       14 sites, every one `gitContextForRepo(repoInfo).<semantic>()`
      github/prApi.ts                          10 sites, same shape
      github/labelManager.ts                    5 sites
      github/hitlBoardNotifier.ts               2 sites
      github/linkedPrDetector.ts:44             fetchAllPRs()
      github/projectBoardApi.ts:27              ctx.moveIssueToStatus(…)
      github/githubApi.ts:60                    authenticatedUser()
      providers/github/githubCodeHost.ts:56,91,104,137   defaultBranch/findPRByBranch/createPR/setSecret
      vcs/branchOperations.ts:130               defaultBranch()
      healthCheckChecks.ts:195,269              authenticatedUser() / fetchIssue(n)

  The second group is the load-bearing one and it is not optional. `GitHubIssueTracker`
  (`providers/github/githubIssueTracker.ts:44`) delegates to the free functions in
  `adws/github/issueApi.ts`, and every one of those functions opens by constructing a context and
  calling the method AC2 deletes. So the providers the whole refactor routes traffic through are
  themselves standing on the surface being removed: migrating a caller to `issueTracker.fetchIssue`
  today lands, two hops later, on `gitContext.fetchIssue`. This slice has to cut that floor out and
  land the adapter on the builders and the executor it already owns — `createGhCommandRunner`
  (`providers/github/ghCommandRunner.ts`) is the seam, and it reproduces `#runRepoApi` verbatim on
  the public `exec`, which is precisely why #790 made `exec` public.

  THE DELETION HAS ONE OBSERVABLE THAT MATTERS MORE THAN THE OTHERS. `gitContext.ts:81-92` are five
  imports reaching UP out of the package into `../providers/github/commands/` for the builders the
  semantic methods call — the only imports in the whole package that point outside it, and the
  literal subject of AC3's "zero ADW-application imports". The file's own header calls them
  transitional and names this issue as the one that deletes them. That makes AC3 provable by
  something better than a code read: copy `adws/gitContext/` on its own into an empty directory and
  ask it to load. Today it cannot — module resolution fails on the adapter path. After this slice it
  must, because that is the Phase B file-move the PRD is rehearsing (story 20).

  Scope notes — six findings from writing these scenarios, all for review:

    • THE PORTS STILL CANNOT EXPRESS THE LISTINGS, AND THE SUBSTITUTION IS SILENT. Five of the named
      callers list issues; `IssueTracker` (`providers/types.ts:118`) offers exactly one listing —
      `searchOpenIssues(search, limit)` at `:139` — which is OPEN-only and projects to
      `IssueSummary` = `{ number, title }`. Every caller needs more than two fields:
      `trigger_cron.ts:97` asks for `body, comments, createdAt, updatedAt, labels` and feeds all
      five to `cronIssueFilter.evaluateIssue`; `concurrencyGuard.ts:24` needs `comments`;
      `issueClosedUnblockRouter.ts:53` and `webhookGatekeeper.ts:203` need `body`; and
      `promotionSweepDefaults.ts:126` needs `state` AND `labels` AND passes `state: 'all'`. A
      migration onto `searchOpenIssues` as it stands compiles, runs, and returns issues with an
      empty body and no comments — at which point the cron finds every issue ineligible and quietly
      stops spawning anything. §2 and §3 are the rows that fail if this happens; the port must grow
      a listing that carries a field selection and a state selection.
    • `fetchMergedPRs` HAS NO PORT EQUIVALENT AT ALL. `perIssueScenarioSweep.ts:80` reads
      `ctx.fetchMergedPRs(200)` to find when the issue's PR merged, because — as the comment there
      says — GitHub search cannot express the `Closes owner/repo#N` body marker, so the sweep
      fetches merged PRs and matches client-side. `CodeHost` has `listOpenPullRequests()`
      (`:213`), which is the wrong set by definition, and `findPullRequestByBranch` (`:216`), which
      is the wrong lookup. Without a merged-PR listing the sweep's retention clock never starts and
      it removes nothing, forever, silently. §3 pins it.
    • `upgradeFailureCap`'s CONSUMER IS ALREADY MIGRATED — the issue names it, #796 closed it.
      `adwUpgrade.tsx:493-499` already reads `providers.issueTracker.fetchComments(issueNumber)`
      and feeds it to `countUpgradeFailureComments`. The one thing worth protecting is that
      `IssueComment.author` (`providers/types.ts:46`) stays populated from the REST `user.login`
      via `fetchIssueCommentsRest` — `isUpgradeFailureComment` gates on `author.endsWith('[bot]')`,
      so an author field that arrives empty makes the count permanently zero and the upgrade
      escalation never fires. No scenario is written for it here: it is #796's row, still green, and
      duplicating it would just make this file's RED noisier. Flagged so the plan does not "tidy"
      the comment fetch onto `fetchIssue(n).comments` on the way past.
    • A REPOSITORY'S DEFAULT BRANCH AND ITS PROVIDERS MUST NOT MEET ON A MISSING WORKSPACE. The
      ordering hazard in the slice. `ensureTargetRepoWorkspace` (`core/targetRepoManager.ts:67`)
      calls `ctx.defaultBranch()` for a workspace that may not be on disk yet, and the boundary
      resolves provider selection by reading `.adw/providers.md` from `gitContext.basePath`
      (`launchGitContext.ts`, the lazy mint) — the very directory a clone would create. Two facts
      keep the loop open, and both must survive the migration: `ensureRepoWorkspace`
      (`gitContext/repoWorkspace.ts:119-122`) invokes the `getDefaultBranch` thunk on the
      already-cloned FETCH branch only — never before a clone — and provider minting is deferred
      until first use. Route `defaultBranch()` through `codeHost.getDefaultBranch()` as a thunk and
      both hold; hoist the read (or mint eagerly) in front of the clone and the first run against a
      new target repo dies at clone time. `adwMerge.tsx:271`, `adwUpgrade.tsx:524`,
      `workflowInit.ts:236` and `prReviewPhase.ts:90` all sit on this path. §6's two rows pin it.
    • THE `repoApiCwd` CONTRACT LOSES ITS ONLY TEST WHEN THE METHODS GO.
      `gitContext/__tests__/repoApiCwd.test.ts` enumerates every `#runRepoApi` method and asserts
      the framework-root cwd and the credential env for each. Deleting the methods deletes the
      subject, and with it the proof of PRD story 16 — repo-independent forge commands run from the
      framework root, which is what lets a cron host act on a repository it never cloned. The
      contract itself must not die with the methods; it moves to the adapter's route to the
      executor. §7 is written as its survivor and is the one row here that is green today, red only
      if the migration drops the cwd class on the way through.
    • "BOTH GUARD RULES" IS NOW THREE, AND THE THIRD ONE BITES BACK. The issue was written before
      #795 landed; `checkGitGhGuard.ts` today runs `git-gh-shellout`, `cwd-derived-identity` and
      `unsanctioned-construction`. The third carries a stale-entry ratchet
      (`guard/constructionRule.ts:208`, `checkGitGhGuard.ts:222,251`) that FAILS the build when a
      transitional allowlist entry's file stops constructing anything. The allowlist
      (`constructionRule.ts:84-129`) holds 36 entries owned by `#796` and 5 owned by `#797`. This
      migration is exactly the event that empties many of them — so a green guard after this slice
      requires deleting the entries it made stale, and AC4's "both guard rules green" is only
      honest if read as "the guard exits 0", ratchet included. §8 makes that explicit rather than
      leaving it to be discovered in CI.

  Testing notes for the step definitions:

    • THE PACKAGE-ISOLATION ROW IS A COPY, NOT A READ. §1's first scenario `cp -R`s
      `adws/gitContext/` (minus `__tests__`) into an `mkdtempSync` directory with no `node_modules`
      above it and no sibling `providers/`, then dynamically imports the copied `index.ts` under
      tsx, recording either success or the thrown error. It asserts the LOAD OUTCOME — an artefact —
      never the text of any file. The temp directory is removed in `After`. This is the same
      fixture-as-SUT-input shape the `@adw-537` hash rows use (vocabulary G-HC1).
    • THE MEMBER PROBE IS A RUNTIME SHAPE, NOT A SOURCE SCAN. §1's second scenario constructs a
      `GitContext` with an injected `exec` fake and asserts membership of the forge-semantic names
      (`fetchIssue`/`commentOnIssue`/`listOpenIssues`/…/`moveIssueToStatus`) and of the surviving
      names (`exec`, `commandEnv`, `getCurrentBranch`, `createWorktree`, `pushBranch`, …). Same
      neighbourhood as feature-796's watched-context `Proxy`, one step further: 796 asked whether a
      member was CALLED, this asks whether it EXISTS.
    • DRIVE THE PRODUCTION COMPOSITION, NOT A HAND-BUILT DEPS BAG. As in #796: handing
      `runUpgradeRedriveScan` or `deriveStageFromRemote` a fake `deps` proves nothing, because the
      deps are fakes before and after. Each scenario builds the module's own default deps from a
      boundary carrying recording providers — `buildDefaultReconcileDeps`
      (`core/remoteReconcile.ts`), `buildDefaultTakeoverDeps` (`triggers/takeoverHandler.ts:79`),
      `makeDefaultDeps` (`triggers/promotionSweepDefaults.ts`), `prepareSweepBase`
      (`triggers/perIssueSweepPersist.ts:52`) — which means those builders must take the boundary
      (or its `{ gitContext, providers }` pair) rather than a bare GitContext. That is a call-shape
      change and the issue permits it; it is not a behaviour change. No row here drives
      `buildDefaultDependencyUnblockDeps` (`triggers/issueClosedUnblockRouter.ts:50`),
      `concurrencyGuard` or `webhookGatekeeper.closeAbandonedDependents`: they sit at the bottom of
      `repoInfo`-parameterised chains that hold no boundary, so they satisfy AC1 through the shared
      `adws/github` wrapper layer instead, the way their siblings already do.
    • THE CRON'S FETCH IS MODULE-PRIVATE AND MUST BE EXTRACTED. `fetchOpenIssues`
      (`trigger_cron.ts:96`) is a private function inside a module with import-time side effects
      (`setInterval`, the process guard, the boundary build), so cucumber cannot reach it — the same
      finding feature-796 recorded for `initializeWorkflow`. `getCronProviders()`
      (`trigger_cron.ts:86-92`) already exists and its own comment names this issue as the receiving
      end. §2 therefore drives an exported listing function taking the providers, in the shape
      `cronIssueFilter` already consumes. The plan extracts it as `listCronOpenIssues(issueTracker)`
      in a new `triggers/cronIssueListing.ts` (which also keeps `trigger_cron.ts`, already over the
      line guideline, from gaining a function); §2's When resolves to that call.
    • THE RECORDING EXECUTOR IS THE `exec` SEAM, NOT A MOCK SERVER. §7's rows build a `GitContext`
      with `new GitContext(opts, { exec })` where `exec` pushes `{ command, cwd, env }` and returns
      canned stdout, then run the adapter over it via `createGhCommandRunner`. `frameworkRepoRoot`
      and `targetReposDir` are `mkdtempSync` throwaways; the workspace directory is deliberately NOT
      created, which is the whole point of the framework-root row.
    • THE FIXTURE REPOSITORY MUST NOT EXIST. Every scenario uses `adw-fixture/void-797`, which is
      not a repository. A RED run reaches un-migrated code that shells out for real; nearly all of
      it catches and logs, so nothing throws, but a plausible-looking name plus a live token could
      post a real comment. Do not substitute one.
    • REUSED, NOT REDEFINED — redefining any of these is an AmbiguousStepDefinition:
      `the ADW codebase is checked out` (`features/step_definitions/ensureCronOnEveryEventSteps.ts:8`),
      `the ADW TypeScript type-check passes` (`feature-504.steps.ts:1126`),
      `the git/gh guard is run across the repository` and `the git/gh guard reports no violations`
      (`feature-691.steps.ts:82,91`). Every other phrase in this file is new. Deliberate distance
      was kept from feature-796's families: 796 owns "the boundary's issue tracker recorded …" and
      "the watched git context was asked for …", so this file says "the recording issue tracker …"
      and "the git context exposes …".
    • ONE NEAR-MISS ALREADY CAUGHT, DO NOT REINTRODUCE IT. The boundary Given in this file reads
      `the repository {string} is launched with recording providers`. It deliberately does NOT read
      "a launch boundary for the repository … whose providers record every call" — that phrase is
      `feature-796.steps.ts:501`, and matching it would silently route these scenarios into 796's
      world, whose recording stand-ins log provider CALLS but answer none of the listings, merged-PR
      lookups or default-branch reads that §2–§6 depend on. This file's Given must build its own world.

  Background:
    Given the ADW codebase is checked out

  # ── §1  THE CORE PACKAGE STANDS ALONE (AC2, AC3, PRD story 20) ────────────────────────────
  #
  # The keystone, and the only pair of rows that cannot be satisfied by moving call sites around.
  # `gitContext.ts:81-92` reaches up into `../providers/github/commands/` for the builders its
  # semantic methods call; those five imports are the package's only outward edges and the literal
  # subject of AC3. They leave when the methods leave, and the proof is that the package then loads
  # with nothing else on disk — the Phase B file move, rehearsed.

  @adw-797 @adw-qnr31u-migrate-core-trigger
  Scenario: The git context package copied on its own into an empty directory loads
    Given the git context package is copied on its own into an empty directory
    When the copied git context package is imported as its own entry point
    Then the import of the copied package succeeds
    And the copied package resolved no module outside its own directory

  # The other half of AC2, and the guard against a migration that deletes too much. The surviving
  # public API is named by PRD story 20: git, worktree, workspace, executor, and the ports.

  @adw-797 @adw-qnr31u-migrate-core-trigger
  Scenario: A constructed git context offers its git, worktree, workspace and executor operations and no forge semantics
    Given a git context constructed over a recording command executor
    Then the git context exposes no forge-semantic operation
    And the git context still exposes its git, worktree, workspace and executor operations

  # ── §2  THE CRON STILL SEES THE ISSUES IT USED TO SEE (AC1, AC5) ──────────────────────────
  #
  # `trigger_cron.ts:97` asks for seven fields and hands all of them to `cronIssueFilter`.
  # `IssueTracker.searchOpenIssues` (`providers/types.ts:139`) returns `{ number, title }`. The
  # first row proves the listing moved; the second proves it did not lose four fifths of its
  # payload on the way — the failure that stops the cron spawning anything without erroring once.

  @adw-797 @adw-qnr31u-migrate-core-trigger
  Scenario: The cron's open-issue listing is served by the issue tracker bound to the cron's repository
    Given the repository "adw-fixture/void-797" is launched with recording providers
    And the recording issue tracker holds an open issue 42
    When the cron's open-issue listing runs from that boundary
    Then the recording issue tracker recorded an open-issue listing for "adw-fixture/void-797"
    And the git context was asked for no forge-semantic operation

  @adw-797 @adw-qnr31u-migrate-core-trigger
  Scenario: A listed issue still carries the body, comments, labels and timestamps the cron's eligibility filter reads
    Given the repository "adw-fixture/void-797" is launched with recording providers
    And the recording issue tracker holds an open issue 42 carrying the label "chore", a body, an adw-id comment and a creation timestamp
    When the cron's open-issue listing runs from that boundary
    Then the cron evaluates issue 42 as eligible
    And the listed issue 42 carries its body, its comments, its labels and its timestamps

  # ── §3  THE SWEEPS ASK QUESTIONS THE OPEN-ONLY PORTS CANNOT ANSWER (AC1, AC5) ─────────────
  #
  # `promotionSweepDefaults.ts:126` passes `state: 'all'` deliberately: the promotion decider
  # distinguishes `decline` (tracker closed unmerged, or `adw:blocked`) from `redrive` (tracker
  # missing entirely), and it can only tell them apart if closed trackers are visible. Migrated
  # onto an open-only listing, every closed tracker reads as missing and the sweep re-files an
  # issue a human deliberately closed — on every cycle.

  @adw-797 @adw-qnr31u-migrate-core-trigger
  Scenario: A promotion tracker that was closed unmerged is seen by the sweep and declines rather than being re-filed
    Given the repository "adw-fixture/void-797" is launched with recording providers
    And a per-issue scenario file for issue 61 tagged as promotion-suggested
    And the recording issue tracker holds a closed promotion-tracking issue for issue 61
    When the promotion sweep tick runs from that boundary
    Then the promotion sweep decided "decline" for issue 61
    And the recording issue tracker recorded no issue creation

  # `perIssueScenarioSweep.ts:80` needs the merge date of a PR that closed the issue, and says in
  # its own comment why search cannot supply it. `CodeHost` has no merged-PR listing at all, so a
  # migration that reaches for `listOpenPullRequests` returns nothing, the retention clock never
  # starts, and the sweep silently removes nothing forever.

  @adw-797 @adw-qnr31u-migrate-core-trigger
  Scenario: The per-issue sweep still learns when the pull request that closed an issue was merged
    Given the repository "adw-fixture/void-797" is launched with recording providers
    And the recording code host holds a merged pull request 9 whose body closes issue 61
    When the per-issue scenario sweep resolves the merge date for issue 61
    Then the resolved merge date is the merge date of pull request 9
    And the git context was asked for no forge-semantic operation

  # The sweep's own persistence path: `perIssueSweepPersist.ts:55` reads the default branch to cut
  # the sweep worktree and `:74` opens the removal PR. Both are forge semantics on a context that
  # is otherwise doing legitimate worktree work — the mixed call site this slice has to separate.

  @adw-797 @adw-qnr31u-migrate-core-trigger
  Scenario: The sweep's removal pull request is opened by the code host while its worktree stays on the git context
    Given the repository "adw-fixture/void-797" is launched with recording providers
    And the recording code host reports the default branch "main"
    When the per-issue sweep persists a removal batch from that boundary
    Then the recording code host recorded exactly one pull request creation
    And the recording code host was asked for the default branch
    And the git context was asked for no forge-semantic operation

  # ── §4  THE STAGE READERS MUST STILL SEE PULL REQUESTS THAT ARE NOT OPEN (AC1, AC5) ───────
  #
  # `remoteReconcile.mapArtifactsToStage` maps MERGED to `completed` and CLOSED to `discarded`.
  # An open-only lookup returns null for both, `readOnce` yields null, and the function falls back
  # to the state file it exists to distrust — so a finished run reads as unfinished and the cron
  # picks it up again. Same trap as #796 §2, different module, and this one is named in the issue.

  @adw-797 @adw-qnr31u-migrate-core-trigger
  Scenario Outline: The remote reconcile derives the stage of a pull request that is no longer open
    Given the repository "adw-fixture/void-797" is launched with recording providers
    And a state file for adw id "qnr31u-void" recording branch "feature-issue-42-void"
    And the recording code host holds a pull request 7 on branch "feature-issue-42-void" in state "<state>"
    When the remote reconcile derives the stage for adw id "qnr31u-void" from that boundary
    Then the derived stage is "<stage>"

    Examples:
      | state  | stage        |
      | OPEN   | awaiting_merge |
      | MERGED | completed      |
      | CLOSED | discarded      |

  # The reconcile's whole design is a read followed by a mandatory re-verification read, because
  # the forge lags its own writes; the two must AGREE before a stage is returned. A provider that
  # memoises its answer makes the second read return the first read's value and the verification
  # becomes ceremony. This row fails if the migration introduces caching anywhere on that path.

  @adw-797 @adw-qnr31u-migrate-core-trigger
  Scenario: The reconcile's verification read asks the code host a second time rather than reusing the first answer
    Given the repository "adw-fixture/void-797" is launched with recording providers
    And a state file for adw id "qnr31u-void" recording branch "feature-issue-42-void"
    And the recording code host holds a pull request 7 on branch "feature-issue-42-void" in state "MERGED"
    When the remote reconcile derives the stage for adw id "qnr31u-void" from that boundary
    Then the recording code host was asked for the pull request on branch "feature-issue-42-void" at least 2 times

  # ── §5  COMMENT HANDLING KEEPS ITS EXACT WORDS AND ITS EXACT ORDER (AC1, AC5) ─────────────
  #
  # `postWorkflowComment` (`github/workflowCommentsIssue.ts:410`) formats a stage comment and hands
  # it to `commentOnIssue`, which builds its own context — but it has no caller left (only
  # re-exports), so it leaves with the semantic surface. The live route is `postIssueStageComment`
  # (`phases/phaseCommentHelpers.ts:33`), which formats through the same `formatWorkflowComment` and
  # posts through `issueTracker.commentOnIssue`. AC5's "same comments" is the whole point: the body
  # operators read must not shift by a character when the posting route changes. The stage below is
  # `plan_building` — a real `WorkflowStage`, so the row exercises a real formatter rather than
  # `formatWorkflowComment`'s unknown-stage default.

  @adw-797 @adw-qnr31u-migrate-core-trigger
  Scenario: The workflow stage comment is posted by the issue tracker with the body it has today
    Given the repository "adw-fixture/void-797" is launched with recording providers
    When the workflow stage comment for stage "plan_building" is posted for issue 42 from that boundary
    Then the recording issue tracker recorded a comment on issue 42
    And the recorded comment on issue 42 carries the ADW signature
    And the recorded comment on issue 42 is the body the stage "plan_building" formats today
    And the git context was asked for no forge-semantic operation

  # `takeoverHandler.ts:89` resolves the adw id by reading the raw REST comment list and taking the
  # LATEST match. Comment ORDER is load-bearing: resolve the wrong adw id and the takeover kills a
  # live orchestrator's sibling instead of the wedged run it was aiming at.

  @adw-797 @adw-qnr31u-migrate-core-trigger
  Scenario: The takeover handler resolves the most recent adw id from the comments the tracker returns
    Given the repository "adw-fixture/void-797" is launched with recording providers
    And issue 42 carries an adw-id comment for "aaaaaa-old" followed by one for "zzzzzz-new"
    When the takeover handler resolves the adw id for issue 42 from that boundary
    Then the resolved adw id is "zzzzzz-new"
    And the git context was asked for no forge-semantic operation

  # ── §6  A REPOSITORY THAT HAS NEVER BEEN CLONED (AC1, AC5, PRD story 16) ──────────────────
  #
  # The ordering hazard from the scope notes, as two executable rows. `ensureTargetRepoWorkspace`
  # routes its default-branch read through the code host, and provider selection is read lazily from
  # the workspace directory — so the two must not meet on a directory that does not exist yet.
  # `ensureRepoWorkspace` (`gitContext/repoWorkspace.ts:119-122`) is what keeps them apart: the
  # thunk is invoked on the already-cloned fetch branch ONLY, never on the clone branch. The first
  # row pins the read; the second pins the deferral, and fails if a migration hoists the
  # default-branch read (or an eager provider mint) in front of the clone. Every orchestrator's
  # first run against a new target repo goes through here.

  @adw-797 @adw-qnr31u-migrate-core-trigger
  Scenario: A target repository workspace already on disk resolves its default branch through the code host
    Given the repository "adw-fixture/void-797" is launched with recording providers
    And the workspace directory for "adw-fixture/void-797" is already cloned
    And the recording code host reports the default branch "main"
    When the target repository workspace is ensured from that boundary
    Then the ensure resolved the default branch "main"
    And ensuring the workspace raised no error about a missing provider configuration

  @adw-797 @adw-qnr31u-migrate-core-trigger
  Scenario: A target repository that has never been cloned is created without asking for its default branch first
    Given the repository "adw-fixture/void-797" is launched with recording providers
    And the workspace directory for "adw-fixture/void-797" does not exist
    When the target repository workspace is ensured from that boundary
    Then the recording code host was not asked for the default branch
    And no provider configuration was read from the workspace directory that does not exist

  # ── §7  SAME COMMANDS, SAME REPOS, SAME PLACE THEY RUN FROM (AC5, stories 16 and 19) ──────
  #
  # AC5's "same commands" is literally the command strings that reach a process, and after the
  # deletion the only route to one is the adapter feeding `GitContext.exec`. These two rows are the
  # survivors of `gitContext/__tests__/repoApiCwd.test.ts`, whose subject this slice removes: the
  # framework-root cwd class (a cron host acts on repositories it never cloned) and the credential
  # arriving per command in the child environment rather than in this process's.

  @adw-797 @adw-qnr31u-migrate-core-trigger
  Scenario: The migrated open-issue listing reaches a process as one gh command addressed to the bound repository
    Given the forge operations for "adw-fixture/void-797" run through a git context whose executor records every command
    When the open-issue listing runs for that repository
    Then exactly one command was recorded
    And the recorded command addresses the repository "adw-fixture/void-797"
    And the recorded command requests the issue fields the cron's eligibility filter reads

  @adw-797 @adw-qnr31u-migrate-core-trigger
  Scenario: A forge command still runs from the framework root when the repository's workspace was never cloned
    Given the forge operations for "adw-fixture/void-797" run through a git context whose executor records every command
    And the workspace directory for "adw-fixture/void-797" does not exist
    When the open-issue listing runs for that repository
    Then the recorded command ran from the framework root
    And the recorded command carried its credential in the child environment
    And no credential was written into the ambient process environment

  # ── §8  THE STRUCTURAL BACKSTOPS (AC4) ────────────────────────────────────────────────────
  #
  # AC4 verbatim, plus the ratchet the issue predates. The type-check is the only thing that proves
  # AC2 across all 55 call sites at once: with the methods gone, any missed caller fails to compile.

  @adw-797 @adw-qnr31u-migrate-core-trigger
  Scenario: The git/gh guard stays green across the repository after the last callers migrate
    When the git/gh guard is run across the repository
    Then the git/gh guard reports no violations

  @adw-797 @adw-qnr31u-migrate-core-trigger
  Scenario: The sanctioned-construction allowlist carries no entry for a file that no longer constructs anything
    When the git/gh guard is run across the repository
    Then the guard reports no stale transitional entry in the sanctioned-construction allowlist

  @adw-797 @adw-qnr31u-migrate-core-trigger
  Scenario: The ADW TypeScript type-check passes with GitContext's forge-semantic surface deleted
    Then the ADW TypeScript type-check passes
