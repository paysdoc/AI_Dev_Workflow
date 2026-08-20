@adw-796 @adw-mk1wgc-migrate-orchestrator
Feature: Orchestrators and phases reach the forge only through the providers the launch boundary minted — one identity, one hexagon, no ad-hoc construction, and not one observable change to what any workflow does

  Issue #796 is the sixth slice of the GitContext forge-agnostic refactor
  (`specs/prd/gitcontext-forge-agnostic-refactor.md`) and the first of two migration waves. #790
  promoted the spawn chokepoint to a public executor, #791 replaced the construction-time credential
  with a TokenProvider port, #792 moved the GitHub material into the forge adapter, #794 made the
  launch boundary hand back a GitContext and the provider triple bound to the SAME identity in one
  call. Those four built the destination. This slice is the first wave of callers actually walking
  to it: the two thin orchestrators (`adwMerge.tsx`, `adwUpgrade.tsx`) and the phase modules the
  issue names (`workflowInit`, `workflowCompletion`, `reviewPhase`, `prPhase`, `autoMergePhase`),
  plus `adwBuildHelpers.ts`. The issue's Touched Files list is indicative, not exhaustive: AC1
  binds "no orchestrator or phase module", so every `adws/phases/*.ts` file that reaches the forge
  through a GitContext is in scope by the acceptance criterion regardless of whether the issue
  enumerated it — which adds `upgradeGate`, `docsSelfCheck` and `depauditSetup` to the wave, and
  subtracts `workflowCompletion` and `adwBuildHelpers.ts`, both verified to perform no
  forge-semantic work at all (the former is already 100% provider-routed; the latter exports only
  `extractPrNumber`, `parseArguments` and `printBuildSummary`).

  The PRD's bar for this wave is unusually blunt: "no behavior change — same commands against the
  same repos; existing suites are the regression net" (user story 18), and "swapping GitHub for
  GitLab or Jira on a target repo requires no orchestrator changes" (user story 4). Those two
  sentences point in opposite directions and both must hold: the traffic on the wire is identical,
  and the code that produces it no longer knows it is GitHub. Every scenario below is one of those
  two claims, or the wrong-repo invariant that neither may cost.

  WHAT THE CODE ACTUALLY LOOKS LIKE TODAY — because even the literal reading of AC1 is wider than
  one file, and the honest reading is wider still. A scan of every orchestrator (`adws/*.tsx`) and
  every phase module (`adws/phases/*.ts`) for a forge-semantic method invoked on a GitContext
  instance returns nine lines across five files (`healthCheck.tsx` excluded — a diagnostic prober
  whose whole job is to exercise the GitContext credential path):

      adwUpgrade.tsx:508     gitCtx.defaultBranch()
      adwUpgrade.tsx:524     gitCtx.issueHasLabel(issueNumber, TERMINAL_LABEL)
      adwUpgrade.tsx:525     gitCtx.fetchIssueComments(issueNumber)
      adwUpgrade.tsx:526     gitCtx.createLabel(name, color, description)
      adwUpgrade.tsx:527     gitCtx.applyLabel(issueNumber, label)
      adwUpgrade.tsx:528     gitCtx.moveIssueToStatus(issueNumber, status)
      workflowInit.ts:221    gitCtx.defaultBranch()
      prPhase.ts:58          gitCtx?.defaultBranch()
      depauditSetup.ts:43    ctx.setSecret(envName, envValue)
      docsSelfCheck.ts:44    gitContextForRepo(repoInfo).listOpenIssues({ ... })

  The last of those is both a semantic call AND an ad-hoc construction in one expression, and
  neither `setSecret` nor an open-issue search is expressible on the ports as they stand — so the
  literal reading of AC1 already forces the interfaces to grow past the label/PR set below.

  Read literally — "no orchestrator or phase module calls a forge-semantic method on GitContext" —
  rerouting those nine lines closes AC1 and the slice is done. That reading is still too narrow,
  and the reason is AC2. Everywhere else the same operations happen one layer down, through the
  free functions in `adws/github/`, and every one of those functions opens with an ad-hoc
  construction:

      issueApi.ts:128      gitContextForRepo(repoInfo).commentOnIssue(issueNumber, body)
      issueApi.ts:249      gitContextForRepo(repoInfo).issueHasLabel(issueNumber, labelName)
      prApi.ts:63          gitContextForRepo(repoInfo).findPRByBranch(branchName)
      prApi.ts:329         gitContextForRepo(repoInfo).prApprovalState(prNumber)

  So `adwMerge.tsx:128`'s `deps.commentOnIssue(...)`, `autoMergePhase.ts:69`'s
  `issueHasLabel(issueNumber, 'hitl', repoInfo)` and `reviewPhase.ts:115`'s
  `approvePR(prNumber, repoInfo)` each construct a GitContext that the launch boundary never saw,
  from a `repoInfo` the caller assembled itself. That is precisely the "identity selection
  re-fragments and the wrong-repo bug class returns in new clothing" the PRD's Solution section
  warns about, and precisely what AC2 — "all provider instances arrive from the launch boundary (no
  ad-hoc construction)" — exists to stop. The scenarios below are therefore written against the
  honest reading: after this slice, a migrated module's forge work is performed BY an object the
  boundary handed it, and the module holds no GitHub-named function reference of its own.

  Four further ad-hoc constructions sit beside them, none of them semantic calls, all of them
  second identity derivations. Exactly one is a PROVIDER construction, and AC2 is scoped by its own
  wording — "all provider INSTANCES arrive from the launch boundary" — to that one:

      adwUpgrade.tsx:503   createGitHubCodeHost(repoId)     — a provider; AC2 closes this
      workflowInit.ts:132  gitContextForSync({ owner, repo, selfHost })   — beside boundary at :140
      reviewPhase.ts:187   gitContextFor({ owner: ctxOwner, repo: ctxRepo, ... })
      prPhase.ts:56        gitContextFor({ owner: repoContext.repoId.owner, ... })

  The three GitContext constructions are second identity derivations worth recording, but they are
  not provider instances and the issue keeps GitContext's semantic surface alive until wave 2; the
  contexts at `reviewPhase.ts:187` and `prPhase.ts:56` are reached only for git and `commandEnv`
  work, which legitimately stays on a context. No scenario below asserts their removal.

  `workflowInit.ts:153` is the sharpest of them: `fetchGitHubIssue(issueNumber, repoInfo ?? getRepoInfo())`
  falls back to reading the local git remote when no target repo was passed — a second identity
  read, in the one function whose whole job is to establish which repository this run is about.

  Scope notes — five findings from writing these scenarios, all for review:

    • THE PROVIDER INTERFACES CANNOT EXPRESS THIS WAVE AS THEY STAND. The issue's own body lists
      "label and PR operations" as in scope. `IssueTracker` (`providers/types.ts:112`) has
      `fetchIssue`, `commentOnIssue`, `deleteComment`, `closeIssue`, `getIssueState`, `fetchComments`
      and `moveToStatus` — and no label write at all. `CodeHost` (`providers/types.ts:170`) has
      `getDefaultBranch`, `createPullRequest`, `fetchPullRequest`, `commentOnPullRequest`,
      `fetchReviewComments`, `listOpenPullRequests` and `getRepoIdentifier` — and no approval read,
      no approve, no merge, and no branch-scoped lookup. Reading a label is expressible
      (`fetchIssue(n).labels`, at the cost of one extra round trip where `issueHasLabel` is one);
      `ensureLabel` / `applyLabel` (adwUpgrade's escalation) and `addIssueLabel` (autoMergePhase's
      hold) are not expressible at all. The interfaces must grow for this wave to land. The
      scenarios below name operations in domain terms — "applies the hold label", "reads the
      approval" — so they are satisfied by whichever shape the plan chooses, and §3 fails outright
      if the operations are quietly left on GitContext instead.
    • `listOpenPullRequests` IS NOT A BRANCH LOOKUP, AND SUBSTITUTING IT BREAKS adwMerge. The
      tempting migration for `defaultFindPRByBranch` is the CodeHost method that already exists.
      It cannot serve: `selectPreferredPR` (`prApi.ts:46-53`) deliberately falls back to non-OPEN
      pull requests when none are open, and adwMerge's step 4 (`adwMerge.tsx:147`) branches on
      `prState === 'MERGED'` to close out a PR merged out-of-band idempotently, while adwUpgrade's
      idempotency guard (`adwUpgrade.tsx:274`) reads `labels` off the same object. An open-only
      lookup silently turns "already merged" into "no PR found", which after three cron ticks
      escalates a finished issue to `merge_blocked`. §2 is the scenario that fails if this shortcut
      is taken, and the `PullRequest` type needs `state` and `labels` for it to pass.
    • THE ADAPTER STILL CONSTRUCTS CONTEXTS INTERNALLY, AND THAT IS NOT THIS SLICE. After migration
      the path is orchestrator → boundary provider → `adws/github/issueApi.ts` →
      `gitContextForRepo(repoInfo)`, because `GitHubIssueTracker` (`githubIssueTracker.ts:44`)
      delegates to exactly the free functions the callers are leaving. Identity is safe — the
      adapter passes its bound `repoInfo` — but a scenario asserting "no GitContext is constructed
      during a migrated run" would fail for reasons this slice does not own. Nothing below asserts
      that. AC2 is scoped, as its wording says, to where PROVIDER INSTANCES come from.
    • THE PLATFORM CONDITIONAL IN adwMerge SURVIVES THIS SLICE, AND USER STORY 4 SAYS IT SHOULD NOT.
      `adwMerge.tsx:249` reads `platform === Platform.GitHub ? notifyBlockedTransition : async () => undefined`
      — an orchestrator branching on which forge it is talking to, which is the exact shape user
      story 4 exists to delete. It is a board-notification concern reached through
      `github/hitlBoardNotifier`, not one of the issue's named operations, and folding it into
      `BoardManager` is a design decision with its own blast radius. Flagged, not scenarioed;
      recommend it be settled in the plan or explicitly deferred to #797.
    • `adwBuildHelpers.ts` HAS NO FORGE CALL TO MIGRATE. It exports `extractPrNumber`,
      `parseArguments` and `printBuildSummary`; the first is duplicated verbatim as a private
      function in `autoMergePhase.ts:32`, and both exist only because the PR number is recovered by
      string-splitting `ctx.prUrl` instead of being carried from the `PullRequestResult.number` that
      `prPhase.ts:92` already writes to `ctx.prNumber`. That is why the file is a Touched File. §7
      pins the behaviour (the same PR is acted on) without dictating whether the helper is deleted,
      deduplicated, or left alone.

  Testing notes for the step definitions:

    • THE BOUNDARY IS DRIVEN THROUGH #794's `mintProviders` SEAM. `buildLaunchBoundary(targetRepo, deps)`
      accepts `LaunchGitContextDeps.mintProviders`; the step installs a mint that returns recording
      stand-ins for the issue tracker, code host and board manager, each appending
      `{ operation, arguments }` to this file's world. `frameworkRepoRoot` and `targetReposDir` are
      `mkdtempSync` throwaways removed in `After`, exactly as feature-794.steps.ts does it. Do NOT
      reuse feature-794's Given/When phrases — they write into that file's world, and the recording
      stand-ins here need a call log its mint records do not have.
    • THE PRODUCTION WIRING IS THE SYSTEM UNDER TEST, NOT THE INJECTED DEPS. Driving `executeMerge`
      with hand-built `MergeDeps` proves nothing about this slice: the deps are fakes before and
      after. The load-bearing composition is the orchestrator's own default-dependency builder —
      `buildDefaultDeps` (`adwMerge.tsx:233`) and `buildDefaultUpgradeDeps` (`adwUpgrade.tsx:502`),
      both private today. Both must be exported and must take the boundary (or its
      `{ gitContext, providers }` pair) rather than `(platform, gitCtx)` / `(repoId, gitCtx)`. That
      is a call-shape change, which AC3 explicitly permits. The step builds the real deps from a
      boundary carrying recording providers, hands them to the real `executeMerge` / `executeUpgrade`,
      and asserts against the recording providers' call log.
    • THE WATCHED GIT CONTEXT IS A PROXY, NOT A FAKE. `buildLaunchBoundary` constructs its own
      GitContext and exposes no seam for one, so the step wraps `boundary.gitContext` in a `Proxy`
      whose `get` trap appends to a log when the property name is in a hard-coded set of forge-semantic
      member names (the `fetchIssue`/`commentOnIssue`/`issueState`/…/`moveIssueToStatus` block,
      `gitContext.ts:492-742`) and otherwise forwards. Git, worktree, workspace and `commandEnv`
      access is forwarded silently and is expected — those are the operations that legitimately stay
      on the context. The proxy is passed where the production deps builder takes its context.
    • THE FIXTURE REPOSITORY MUST NOT EXIST. A RED run reaches the un-migrated GitHub free
      functions, which shell out for real; every one of them catches and logs, so nothing throws,
      but a run against a real owner/repo with a live token could post a real comment. Every
      scenario below uses `adw-fixture/void-796`, which is not a repository, so the worst a RED run
      can do is a failed `gh` call and a slow step. Do not substitute a plausible-looking name.
    • THE AUTO-MERGE PHASE IS DRIVEN THROUGH ITS TWO EARLY RETURNS ONLY. `executeAutoMergePhase`
      (`autoMergePhase.ts:46`) calls `mergeWithConflictResolution` — real git, real agents — on the
      path past both gates. The hitl gate (`:69`) and the no-approval gate (`:78-88`) both return
      before it, and they are the two that carry every forge call in the phase. §4 stays inside
      them. `logsDir` is a throwaway directory because the skip paths write `skip_reason.txt`.
    • `initializeWorkflow` CANNOT BE DRIVEN IN THIS HARNESS, and §5 does not try. Its unit suite
      reaches it only through `vi.mock` of `child_process`, `fs` and `../../github`
      (`workflowInit.test.ts:16-39`), which cucumber has no equivalent for — the same finding
      feature-794 recorded for its AC3 rows. §5's scenario therefore drives the provider-sourcing
      DECISION, which requires it to be reachable as a plain function taking the boundary and the
      caller's optional `repoId`. Extracting it is the natural shape of the migration (it replaces
      the inline `sameRepoIdentity(...) ? boundary.providers : undefined` ternary at
      `workflowInit.ts:311`); if the plan declines to extract it, §5 must be dropped and the
      `initializeWorkflow: boundary-providers passthrough` unit test named as its replacement,
      rather than left as a pending stub.
    • REUSED, NOT REDEFINED — redefining any of these is an AmbiguousStepDefinition:
      `the ADW codebase is checked out` (`features/step_definitions/ensureCronOnEveryEventSteps.ts:8`),
      `the ADW TypeScript type-check passes` (`feature-504.steps.ts:1126`),
      `the git/gh guard is run across the repository` and `the git/gh guard reports no violations`
      (`feature-691.steps.ts:82,91`). Every other phrase in this file is new. Deliberate distance
      was kept from two neighbourhoods: feature-794 owns "the boundary's issue tracker …" for
      MINTING identity, so this file says "the boundary's issue tracker recorded …" for CALLS; and
      feature-791 owns the "the credential provider …" family, so §8 says "the counting credential
      source".

  Background:
    Given the ADW codebase is checked out

  # ── §1  THE MERGE ORCHESTRATOR'S FORGE TRAFFIC GOES THROUGH THE BOUNDARY (AC1, AC2) ───────
  #
  # adwMerge is the smallest complete instance of the whole slice: it already calls
  # buildLaunchBoundary (`adwMerge.tsx:269`), already has the providers in hand, and then throws
  # them away — `buildDefaultDeps` wires `commentOnIssue`, `issueHasLabel` and `fetchPRApprovalState`
  # straight from `./github`, each of which builds its own context from a `repoInfo` reassembled at
  # `:271`. These three rows are the plainest RED in the file: the boundary's providers record
  # nothing today, because nothing is asked of them.

  @adw-796 @adw-mk1wgc-migrate-orchestrator
  Scenario: The merge orchestrator's completion comment is posted by the issue tracker the boundary minted
    Given a launch boundary for the repository "adw-fixture/void-796" whose providers record every call
    And the boundary's git context is watched for forge-semantic calls
    And the merge orchestrator's production dependencies are built from that boundary
    And the branch "feature-issue-42-void" has a pull request numbered 7 in state "MERGED"
    When the merge orchestrator runs for issue 42 under adw id "mk1wgc-void"
    Then the merge orchestrator reports the outcome "completed" for reason "already_merged"
    And the boundary's issue tracker recorded a comment on issue 42
    And the recorded comment on issue 42 contains "PR #7 has been merged"
    And the watched git context was asked for no forge-semantic operation

  @adw-796 @adw-mk1wgc-migrate-orchestrator
  Scenario: The merge orchestrator's escalation comment is posted by the issue tracker the boundary minted
    Given a launch boundary for the repository "adw-fixture/void-796" whose providers record every call
    And the boundary's git context is watched for forge-semantic calls
    And the merge orchestrator's production dependencies are built from that boundary
    And the branch "feature-issue-42-void" has no pull request
    And the merge orchestrator has already failed to resolve a pull request 2 times
    When the merge orchestrator runs for issue 42 under adw id "mk1wgc-void"
    Then the merge orchestrator reports the outcome "abandoned" for reason "no_pr_found_blocked"
    And the boundary's issue tracker recorded a comment on issue 42
    And the recorded comment on issue 42 contains "ADW Merge Blocked"
    And the watched git context was asked for no forge-semantic operation

  # The hitl gate is the row that proves a READ migrated, not just a write. It is also the row
  # most likely to regress silently: `issueHasLabel` returns false on any error (`issueApi.ts:253`),
  # so a migration that leaves the label read pointing at a context which cannot answer produces a
  # gate that never holds — the orchestrator merges PRs a human was still looking at, and no test
  # that only checks comments would notice.

  @adw-796 @adw-mk1wgc-migrate-orchestrator
  Scenario: The merge orchestrator's human-review gate reads the label and the approval through the boundary's providers
    Given a launch boundary for the repository "adw-fixture/void-796" whose providers record every call
    And the boundary's git context is watched for forge-semantic calls
    And the merge orchestrator's production dependencies are built from that boundary
    And the branch "feature-issue-42-void" has a pull request numbered 7 in state "OPEN"
    And issue 42 carries the label "hitl"
    And pull request 7 has no approving review
    When the merge orchestrator runs for issue 42 under adw id "mk1wgc-void"
    Then the merge orchestrator reports the outcome "abandoned" for reason "hitl_blocked_unapproved"
    And the boundary's providers were asked for the labels on issue 42
    And the boundary's providers were asked for the approval on pull request 7
    And the boundary's issue tracker recorded no comment
    And the watched git context was asked for no forge-semantic operation

  @adw-796 @adw-mk1wgc-migrate-orchestrator
  Scenario: An approved pull request on a human-review issue still proceeds exactly as it does today
    Given a launch boundary for the repository "adw-fixture/void-796" whose providers record every call
    And the merge orchestrator's production dependencies are built from that boundary
    And the branch "feature-issue-42-void" has a pull request numbered 7 in state "OPEN"
    And issue 42 carries the label "hitl"
    And pull request 7 has an approving review
    When the merge orchestrator runs for issue 42 under adw id "mk1wgc-void"
    Then the merge orchestrator did not defer for human review

  # ── §2  THE BRANCH LOOKUP MUST STILL SEE PULL REQUESTS THAT ARE NOT OPEN (AC3) ────────────
  #
  # The scope note's second finding, as an executable row. `listOpenPullRequests` is the only
  # branch-adjacent method CodeHost has today, and reaching for it turns adwMerge's idempotent
  # "already merged" completion into a three-tick escalation to merge_blocked on an issue that is
  # finished. This row is green today (through `defaultFindPRByBranch`), goes red the moment the
  # lookup is migrated onto an open-only method, and is the reason `PullRequest` needs `state`.

  @adw-796 @adw-mk1wgc-migrate-orchestrator
  Scenario Outline: A pull request that is no longer open is still found for its branch
    Given a launch boundary for the repository "adw-fixture/void-796" whose providers record every call
    And the merge orchestrator's production dependencies are built from that boundary
    And the branch "feature-issue-42-void" has a pull request numbered 7 in state "<state>"
    When the merge orchestrator runs for issue 42 under adw id "mk1wgc-void"
    Then the merge orchestrator reports the outcome "<outcome>" for reason "<reason>"

    Examples:
      | state  | outcome   | reason         |
      | MERGED | completed | already_merged |
      | CLOSED | abandoned | pr_closed      |

  # The upgrade orchestrator reads the same lookup for a different property. Its idempotency guard
  # (`adwUpgrade.tsx:274`) asks whether the claim PR carries a `wontfix` label — the escape hatch
  # that lets a flawed-but-merged upgrade be rebuilt. `PullRequest` has no `labels` field, so a
  # migration that drops it silently disables the escape hatch and the hash can never be rebuilt.

  @adw-796 @adw-mk1wgc-migrate-orchestrator
  Scenario: A retired claim pull request labelled wontfix still releases the upgrade for a rebuild
    Given a launch boundary for the repository "adw-fixture/void-796" whose providers record every call
    And the upgrade orchestrator's production dependencies are built from that boundary
    And the claim branch for issue 51 has a pull request numbered 9 in state "MERGED" labelled "wontfix"
    When the upgrade orchestrator runs for issue 51 under adw id "mk1wgc-void"
    Then the upgrade orchestrator did not stop on an existing pull request

  # ── §3  THE UPGRADE ORCHESTRATOR STOPS MINTING ITS OWN PROVIDER (AC1 literal, AC2) ────────
  #
  # `adwUpgrade.tsx:503` is the single ad-hoc provider construction in the whole named scope:
  # `createGitHubCodeHost(repoId)`, one line above the deps that use it. It is also the file that
  # owns all five direct forge-semantic calls on GitContext. Both rows below are therefore RED for
  # two independent reasons, and both must go green together.

  @adw-796 @adw-mk1wgc-migrate-orchestrator
  Scenario: The upgrade orchestrator's pull request is opened by the code host the boundary minted
    Given a launch boundary for the repository "adw-fixture/void-796" whose providers record every call
    And the upgrade orchestrator's production dependencies are built from that boundary
    And the claim branch for issue 51 has no pull request
    And the upgrade regeneration produces a committed change
    When the upgrade orchestrator runs for issue 51 under adw id "mk1wgc-void"
    Then the boundary's code host created exactly one pull request
    And no code host was constructed outside the launch boundary

  @adw-796 @adw-mk1wgc-migrate-orchestrator
  Scenario: The upgrade orchestrator's escalation reads comments, writes the terminal label and moves the board through providers
    Given a launch boundary for the repository "adw-fixture/void-796" whose providers record every call
    And the boundary's git context is watched for forge-semantic calls
    And the upgrade orchestrator's production dependencies are built from that boundary
    And the claim branch for issue 51 has no pull request
    And issue 51 carries 3 recorded upgrade failure comments
    When the upgrade orchestrator runs for issue 51 under adw id "mk1wgc-void"
    Then the upgrade orchestrator reports the outcome "escalated"
    And the boundary's providers were asked for the comments on issue 51
    And the boundary's providers recorded the label "adw:upgrade-escalated" applied to issue 51
    And the boundary's providers recorded issue 51 moved to "Blocked"
    And the watched git context was asked for no forge-semantic operation

  # The same escalation, entered a second time. `applyLabel` is the durable idempotency signal
  # (`adwUpgrade.tsx:297`) — the read that consumes it is the terminal-label check at `:246`, the
  # very first thing executeUpgrade does. Migrating the write to a provider while leaving the read
  # on the context (or vice versa) yields an orchestrator that escalates the same issue on every
  # cron tick, Slack ping included. This row pins the pair.

  @adw-796 @adw-mk1wgc-migrate-orchestrator
  Scenario: An already-escalated issue is recognised by the same providers that escalated it
    Given a launch boundary for the repository "adw-fixture/void-796" whose providers record every call
    And the upgrade orchestrator's production dependencies are built from that boundary
    And issue 51 carries the label "adw:upgrade-escalated"
    When the upgrade orchestrator runs for issue 51 under adw id "mk1wgc-void"
    Then the upgrade orchestrator reports the outcome "escalated"
    And the boundary's providers recorded no label applied to issue 51
    And the boundary's issue tracker recorded no comment

  # ── §4  THE AUTO-MERGE PHASE'S TWO GATES RUN ON THE REPO CONTEXT IT WAS HANDED (AC1, AC2) ──
  #
  # autoMergePhase already receives `repoContext` and `gitContext` on its `WorkflowConfig`
  # (`workflowInit.ts:83,94`) and consults neither for forge work: it rebuilds `repoInfo` from
  # `repoContext.repoId` (`:65`) and hands it to four GitHub free functions. The phase is the
  # densest cluster of ad-hoc construction in the named scope — four contexts built for one
  # skipped merge.

  @adw-796 @adw-mk1wgc-migrate-orchestrator
  Scenario: A human-review label skips the auto-merge without a comment, read through the phase's own providers
    Given an auto-merge phase configuration for issue 42 whose pull request is 7
    And the configuration's providers record every call
    And the configuration's git context is watched for forge-semantic calls
    And issue 42 carries the label "hitl"
    When the auto-merge phase runs
    Then the configuration's providers were asked for the labels on issue 42
    And the configuration's providers recorded no comment
    And the configuration's providers recorded no label applied to issue 42
    And the watched git context was asked for no forge-semantic operation

  @adw-796 @adw-mk1wgc-migrate-orchestrator
  Scenario: An unapproved pull request gets the hold label and the waiting comment through the phase's own providers
    Given an auto-merge phase configuration for issue 42 whose pull request is 7
    And the configuration's providers record every call
    And the configuration's git context is watched for forge-semantic calls
    And issue 42 carries no labels
    And pull request 7 has no approving review
    When the auto-merge phase runs
    Then the configuration's providers were asked for the approval on pull request 7
    And the configuration's providers recorded the label "hitl" applied to issue 42
    And the configuration's providers recorded a comment on issue 42
    And the recorded comment on issue 42 contains "Awaiting human approval"
    And the watched git context was asked for no forge-semantic operation

  # ── §5  WORKFLOW INIT SOURCES ITS PROVIDERS FROM THE BOUNDARY, ALWAYS (AC2) ───────────────
  #
  # #794 taught workflow init to REUSE the boundary's providers when the identities agree
  # (`workflowInit.ts:311`). What it left behind is the else-branch: when they disagree, or when
  # the boundary failed to build, `createRepoContext` resolves a second set from a `repoId` that
  # `:308` derives by reading the local git remote again. This slice closes that branch — the
  # boundary is the only source, and a caller-supplied repoId that contradicts it is a launch
  # error, not a licence to mint.

  @adw-796 @adw-mk1wgc-migrate-orchestrator
  Scenario: Workflow init takes the boundary's provider instances rather than resolving a second set
    Given a launch boundary for the repository "adw-fixture/void-796" whose providers record every call
    When workflow init resolves its providers from that boundary with no caller-supplied identity
    Then workflow init received the very issue tracker and code host the boundary minted
    And workflow init read no repository identity of its own

  @adw-796 @adw-mk1wgc-migrate-orchestrator
  Scenario: A caller-supplied identity that contradicts the boundary is refused rather than served a second provider set
    Given a launch boundary for the repository "adw-fixture/void-796" whose providers record every call
    When workflow init resolves its providers from that boundary with the caller-supplied identity "other-fixture/void-796"
    Then resolving workflow init's providers failed naming both repositories
    And no issue tracker was constructed outside the launch boundary

  # ── §6  A REPOSITORY THAT IS NOT ON GITHUB NEEDS NO ORCHESTRATOR CHANGE (user story 4) ────
  #
  # The payoff row, and the one that cannot be faked by renaming call sites. A phase handed a repo
  # context whose issue tracker is not the GitHub adapter must do all of its forge work on that
  # tracker. Today autoMergePhase ignores the tracker entirely and calls `commentOnIssue` from
  # `../github`, so the non-GitHub tracker sees nothing and a `gh` process is spawned for a
  # repository GitHub has never heard of. This is the scenario that makes "swapping GitHub for
  # GitLab or Jira requires no orchestrator changes" a fact rather than an aspiration.

  @adw-796 @adw-mk1wgc-migrate-orchestrator
  Scenario: An auto-merge on a repository served by a non-GitHub tracker holds the issue through that tracker
    Given an auto-merge phase configuration for issue 42 whose pull request is 7
    And the configuration is served by a recording tracker that is not GitHub
    And issue 42 carries no labels
    And pull request 7 has no approving review
    When the auto-merge phase runs
    Then the non-GitHub tracker recorded the label "hitl" applied to issue 42
    And the non-GitHub tracker recorded a comment on issue 42
    And no GitHub provider was constructed during the phase

  @adw-796 @adw-mk1wgc-migrate-orchestrator
  Scenario: A merge orchestrator run on a repository served by a non-GitHub tracker comments through that tracker
    Given a launch boundary for the repository "adw-fixture/void-796" whose providers are a recording tracker that is not GitHub
    And the merge orchestrator's production dependencies are built from that boundary
    And the branch "feature-issue-42-void" has a pull request numbered 7 in state "MERGED"
    When the merge orchestrator runs for issue 42 under adw id "mk1wgc-void"
    Then the non-GitHub tracker recorded a comment on issue 42
    And no GitHub provider was constructed during the run

  # ── §7  THE WRONG-REPO INVARIANT SURVIVES THE MIGRATION (PRD Solution, story 5) ───────────
  #
  # The whole point of doing this wave behind a boundary rather than by hand. Today a migrated
  # module's forge call carries a `repoInfo` the module assembled itself, and `workflowInit.ts:153`
  # will read the local git remote to fill it in when nothing was passed. After the migration the
  # identity is the boundary's, once, and a remote that answers something else cannot reach the
  # forge call at all.

  @adw-796 @adw-mk1wgc-migrate-orchestrator
  Scenario: A local git remote naming another repository cannot redirect a migrated orchestrator's forge traffic
    Given a launch boundary for the repository "adw-fixture/void-796" whose providers record every call
    And the local git remote answers "someone-else/not-the-target"
    And the merge orchestrator's production dependencies are built from that boundary
    And the branch "feature-issue-42-void" has a pull request numbered 7 in state "MERGED"
    When the merge orchestrator runs for issue 42 under adw id "mk1wgc-void"
    Then every recorded provider call addressed the repository "adw-fixture/void-796"
    And the local git remote was never read

  @adw-796 @adw-mk1wgc-migrate-orchestrator
  Scenario: The pull request the phases act on is the one the code host reported, not one re-derived from a URL
    Given an auto-merge phase configuration for issue 42 whose pull request is 7
    And the configuration's providers record every call
    And issue 42 carries no labels
    And pull request 7 has no approving review
    When the auto-merge phase runs
    Then every recorded provider call about a pull request named pull request 7

  # ── §8  THE MIGRATION CAPTURES NO CREDENTIAL AT WIRING TIME (user story 19) ───────────────
  #
  # The token-bleed class died in #791 by making the credential a QUESTION resolved per command
  # rather than an answer resolved at construction. A migration that builds its provider set at
  # launch is exactly the shape that tempts an implementer to resolve one token while they are
  # there and hand it around. Building the orchestrator's dependencies must ask nothing of the
  # credential source; only running a command may.

  @adw-796 @adw-mk1wgc-migrate-orchestrator
  Scenario: Building a migrated orchestrator's dependencies resolves no credential
    Given a launch boundary for the repository "adw-fixture/void-796" whose providers record every call
    And the boundary resolves credentials through a counting credential source
    When the merge orchestrator's production dependencies are built from that boundary
    Then the counting credential source was never asked

  # ── §9  THE STRUCTURAL BACKSTOPS (AC4) ────────────────────────────────────────────────────
  #
  # The guard is AC4 verbatim. It does not yet carry #795's ad-hoc-construction rule, so a green
  # guard here proves the migration introduced no new shell-out and broke no existing exemption —
  # not that AC2 holds; §3, §5 and §6 carry that. The type-check is the backstop for a migration
  # whose whole risk profile is call-shape churn across seven modules.

  @adw-796 @adw-mk1wgc-migrate-orchestrator
  Scenario: The git/gh guard stays green across the repository after the migration
    When the git/gh guard is run across the repository
    Then the git/gh guard reports no violations

  @adw-796 @adw-mk1wgc-migrate-orchestrator
  Scenario: The ADW TypeScript type-check passes with the orchestrators and phases on providers
    Then the ADW TypeScript type-check passes
