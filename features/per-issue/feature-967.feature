@adw-967 @adw-ls9ywd-bug-run-the-cron-can
Feature: The cron, cancel and promotion smoke scenarios run a real process or the real webhook dispatcher, and pass: the cron launches the sdlc orchestrator for an eligible issue, a ## Cancel comment resets the issue's workflow as the cancel handler does, and the promotion sweep's threshold ramps from 3 to 5 with the target repository's promotion activity

  Issue #967 is a slice of #935, which was too large for one run and is closed. It works on item 3
  of the `## Divergence` section of ADR-0037
  (`specs/adr/0037-tiered-regression-suite-with-fixed-vocabulary.md`): the smoke and surface
  scenarios are pending. It moves the four smoke scenarios that need no full agent pipeline onto
  real processes, through the subprocess harness of #966 and the webhook harness of #961. The other
  four smoke scenarios (the two of `adw_chore_diff_verdicts`, `adw_sdlc_happy_path` and
  `pause_resume_rate_limit`) stay pending, and item 3 stays in the ADR until the last slice.

  Today, in `features/regression/smoke/`:
    • `cron_trigger_spawn` carries no `@subprocess`, so W10 is pending. If it ran, its Thens
      would fail: it expects a comment on issue 300, while what the cron does for an eligible
      issue is launch its orchestrator, which the launch recorder catches; and it ends with T5,
      which fails after W10 because the harness kills the cron and records no exit code. The cron
      never reads its G11 worktree.
    • `cancel_directive` runs the sdlc orchestrator under a manifest and expects workflowStage
      `cancelled`, which no code under `adws/` writes (ADR-0032, Confirmation), and a comment on
      issue 500, which the cancel handler never posts: it deletes comments. `## Cancel` is handled
      by the trigger that receives it, through `handleCancelDirective`, not by an orchestrator.
    • `promotion_threshold_auto_ramp` runs W1 `promotion-sweep` under manifests whose edits and
      `commits` take effect only when the Claude CLI stub runs, and the sweep never invokes it. So
      neither row seeds the per-issue file, the vocabulary or the history it describes. The young
      row expects a comment on issue 512, which the sweep never posts.

  What #967 changes:
    • The four rows are rewritten in place in `features/regression/smoke/`, keeping
      `@regression @smoke` and taking no `@adw-` tag: a file carries the tag of one tier or the
      other (ADR-0037), and #963, #965 and #966 rewrote their surface rows in place the same way.
      `cron_trigger_spawn` and both promotion rows add `@subprocess`, without which W1 and W10 are
      pending. `cancel_directive` adds `@webhook`, the scope of #961's hooks. It starts no child
      process, so it carries no `@subprocess`.
    • None of the four invokes the Claude CLI stub, so none loads a manifest. The three manifests
      they loaded (`cancel-directive.json`, `promotion-threshold-young-repo.json` and
      `promotion-threshold-mature-repo.json` in `test/fixtures/jsonl/manifests/`) lose their last
      user and are removed.
    • The rows' new phrases are registered in `features/regression/vocabulary.md`.

  The labels below are the section numbers of the scenario groups further down (§1–§4):

    §1  THE FOUR SMOKE SCENARIOS PASS, TWICE IN A ROW, AND LEAVE THE CHECKOUT AS THEY FOUND IT. Run
        through Cucumber twice in a row, while ADW's auth gate holds a record, a workflow of another
        repository is paused and a stand-in for the developer's gh records every call, each of the
        four passes both times and no other smoke scenario fails. Afterwards the auth gate, the
        pause queue, the cron registry and the cron logs are as they were, the developer's gh has
        received no call, and the checkout holds none of the rows' state, logs, spawn locks or
        running crons.

    §2  THE MATURE PROMOTION ROW READS WHERE THE SWEEP'S MARKER LANDS. On the young repository,
        where the sweep suggests the scenario, 'carries no "@promotion-suggested-" tag' fails.

    §3  THE CANCEL ROW'S THENS SEE WHAT ITS GIVENS SEEDED. Delivered a plain comment instead of
        `## Cancel`, each of the row's state, worktree, branch and comment Thens fails.

    §4  THE TYPE-CHECK.

  Each row is written to fail for a specific wrong implementation:
    • §1 fails when any of the four is pending, undefined or failing on either run; when a run
      leaves behind something that breaks the next one (the adwId's state, a spawn lock, a live
      cron); when a row's hooks do not clear the auth gate, which makes the cron skip its poll and
      the webhook answer `auth_gate_set`, or do not put it back; when a run changes the pause
      queue, the cron registry or the cron logs; when the cancel row's dispatch reaches the
      developer's gh instead of the mock GitHub API; and when a hook change makes one of the other
      four smoke scenarios run its orchestrator and fail.
    • §2 fails for a T19 that reads the workspace's checkout, which the sweep never writes, so that
      the mature row would pass whatever the sweep did.
    • §3 fails for a state Then that looks where the Given did not write, a worktree or branch Then
      that lists another repository than the one holding the seeded worktree, and a comment Then
      that passes on an issue none of whose comments was deleted.
    • The rows themselves. `cron_trigger_spawn` fails when the cron launches no orchestrator for
      issue 300, launches it twice, or launches it without `--target-repo acme/widgets`.
      `cancel_directive` fails when the directive does not reach the cancel handler, when the
      handler keeps the state, the worktree, the branch or any comment, and when a comment is
      posted. The young promotion row fails when N is not 3, when the marker does not land on the
      default branch, or when no promotion issue is filed. The mature row fails when N is not 5,
      when the sweep tags the scenario, or when it merges a marker pull request.

  ── WHY SOME CLAIMS GET NO ROW ───────────────────────────────────────────────────────────────
    • "cancel_directive asserts only what cancelHandler.ts does" is a fact about that row's text.
      Its Thens are the handler's deletions (the state, the worktree with its branch, every comment)
      and the absence of a posted comment. Left out on purpose: the SIGTERM and SIGKILL of the
      orchestrator (the seeded state names no process, so the handler skips that step, and nothing
      real may be signalled); the cron's dedup set (the cron path only); and the webhook's answer
      `{ status: 'cancelled', issue }`, which is the dispatcher's, not the handler's.
    • "Scenarios passing on dev still pass": ADW's test phase runs `@regression` as a blocker tag
      (ADR-0037, item 2), which covers every regression scenario. §1 adds that no other smoke
      scenario fails.
    • Dropping T5 from `cron_trigger_spawn`: feature-966 already shows that T5 fails after W10.
    • Item 3 staying in ADR-0037 is a documentation fact. No scenario reads a decision record.

  How these scenarios observe the system. Every assertion targets a runtime artefact: the launches
  the recorder caught; the checkout's `agents/<adwId>/` directory; `git worktree list` and
  `git branch` of the throwaway acme/widgets workspace; the requests the mock GitHub API recorded;
  the exit code and standard output of the promotion sweep; the per-issue feature file as the sweep
  landed it on the workspace's default branch; and, for §1–§3, the step results of child Cucumber
  runs, `agents/.auth_gate`, `agents/paused_queue.json`, `agents/cron/`, `logs/agents/cron/`, the
  spawn locks, the process table and the call log of a stand-in gh. No scenario reads, greps or
  parses a source file. The files, commits, comments, issues and pull requests the Givens seed are
  inputs.

  Notes for the step definitions:
    • NEVER LET THE CANCEL HANDLER OR THE PROMOTION SWEEP ACT ON THE CHECKOUT, ITS WORKTREES OR ITS
      BRANCHES, OR ON THE DEVELOPER'S TARGET REPOSITORIES. NEVER LET THE REAL GH RUN. NEVER SIGNAL
      A PROCESS THE SCENARIO DID NOT START.
    • `claimAdwId` accepts only `surface-…` and `throwaway<N>-…`. The issue names `cancel-smoke-500`
      and the promotion rows keep `promotion-threshold-smoke-512`. Accept these made-up smoke
      adwIds too, by a rule that no real adwId (six random characters, then the issue's slug) can
      satisfy.
    • `cron_trigger_spawn`: G4 seeds issue 300 labelled `adw:feature`, opened and last updated an
      hour ago, past the cron's grace period, as its registry row says. W10, T-SP4 and T-SP5 are
      #966's, unchanged.
    • `cancel_directive`:
        – Keep W1, W9 and W10 pending in the four smoke scenarios that carry no `@subprocess`. The
          cancel row needs what the subprocess harness gives the Givens it shares with the
          subprocess rows (the mock issue, G-SP2's claim and its cleanup, the throwaway
          acme/widgets workspace). Do not get it by widening that harness's Before hook to `@smoke`,
          which would run those four orchestrators.
        – The dispatch is the real exported `dispatchWebhookEvent`, through #961's `deliver` (the
          launch recorder on `PATH` for the call, the response recorded), with an injected
          `mintEventBoundary`. Its boundary holds a real GitContext over the throwaway workspace,
          through which the handler removes worktrees (it does not use the `cwd` the dispatcher
          passes it), and providers whose issue tracker answers `fetchComments`, `getIssueTitle`
          and `deleteComment` from the mock GitHub API, as `mockForgeProviders` does. Never
          `buildEventBoundary`: its providers run the real gh, and its workspace path comes from
          the Cucumber process's `TARGET_REPOS_DIR`, an empty directory (`cucumber.js`).
        – "the webhook receives the comment {string} on issue {int} from the repository {string},
          signed with the secret {string}" delivers `issue_comment` with the action `created`,
          `repository.full_name` and `clone_url`, `issue.number` and `comment.body`, signed as
          W-WH2 signs. First it adds the comment to the issue's comments in the mock state, since
          GitHub holds a comment when it delivers it; through the state, not a recorded POST, which
          T14 would count. "issue {int} holds an ADW workflow comment for adwId {string}" seeds the
          same way a comment built by ADW's own issue workflow-comment formatter
          (`adws/forge/workflowCommentsIssue.ts`), so the handler finds the adwId as it does in
          production.
        – G-SP2 writes the top-level state with no `pid`, so the handler's kill step finds none.
        – "the target repository's workspace holds a worktree for issue {int} on the branch
          {string}" adds the worktree with a new branch off `main`, at the path the workspace's
          GitContext gives the branch, under `.worktrees/`. The handler removes the worktrees whose
          directory name contains `-issue-<N>-`, as ADW's branch names do, so the branch must too.
          "holds no worktree for issue {int}" reads `git worktree list --porcelain` of that same
          workspace, and fails naming any worktree whose directory name contains `-issue-<N>-`, or
          the seeded directory if it is still on disk. "holds no branch {string}" reads
          `git branch --list` there.
        – "the checkout holds no state for adwId {string}" asserts that `agents/<adwId>/` is gone.
        – "the mock GitHub API recorded the deletion of every comment on issue {int}" requires a
          recorded DELETE of `/repos/acme/widgets/issues/comments/<id>` for every comment the issue
          held when the comment was delivered: the seeded ADW workflow comment and the `## Cancel`
          comment. It fails when the issue held none.
    • `promotion_threshold_auto_ramp`:
        – The sweep never reads the workspace's checkout. It adds a worktree for
          `chore/promotion-sweep` off `refs/remotes/origin/main` (the git mock turns its fetch into
          a no-op), lists `features/per-issue/feature-*.feature` there with `git ls-files`, reads
          `.adw/scenarios.md` and the vocabulary it names there, and counts the per-issue scenario
          additions of the last 90 days with `git log -p` there. Every seeding Given commits on
          `main` and moves `refs/remotes/origin/main` with it.
        – "declares its regression vocabulary in {string}" writes `.adw/scenarios.md` with
          `## Per-Issue Scenario Directory`, `## Regression Scenario Directory` and
          `## Vocabulary Registry`, and the registry that section names, in the vocabulary's own
          format (`## Given`, `## When` and `## Then` sections of five-column rows), and commits
          both.
        – "has committed {string} holding the scenario {string}, which the promotion scorer rates
          {int}" commits a feature file holding that one scenario, and fails unless the real
          `parseScenarios` and `score` rate it N against the committed vocabulary: for instance, a
          subprocess-pattern When step and one And after it (3 + 1), with no surface example. A
          scorer change that moves the score then fails this Given, not a Then.
        – The ratio, as `loadPromotionStats` computes it today. The numerator is not a count of
          commits: it is one merge time per closed issue labelled `regression-promotion` whose
          linking pull request (`Closes #N` or `Implements #N`) merged in the window, read through
          `gh issue list --state all --search 'label:"regression-promotion"'` and
          `gh pr list --state merged`. The denominator is the number of `Scenario:` lines added to
          `.feature` files under `features/per-issue/` in `git log -p` over the window. "the target
          repository has {int} promotion issue(s) whose pull request merged in the last 90 days"
          leaves exactly that many such issues in the mock state (none for 0), each promoting a
          feature other than feature-9300 (a tracker naming feature-9300 would change its
          reconcile), each with a merged pull request linking it. "{int} more per-issue scenarios
          were added to, and since removed from, the target repository's default branch in the
          last 90 days" commits them in files that a later commit removes, as the per-issue sweep
          removes a file 14 days after its merge: `git log -p` still counts the additions, and the
          sweep lists no extra candidate.
        – THE MARKER. On `originate` the sweep commits the marker in its own worktree, pushes
          `chore/promotion-sweep` (a no-op under the git mock), opens and merges a pull request
          (the gh shadow records both), files the promotion issue, then deletes the branch and
          removes its worktree. Nothing reaches the workspace's checkout. So T18 as it reads today
          (the file on disk under the registered worktree) cannot pass on the young row, and T19
          would pass on the mature row whatever the sweep did. T18 and T19 read the file as it
          stands on the workspace's default branch once the sweep's pull request has merged, which
          is where production lands it. The harness lands it as GitHub would, for instance by
          having the gh shadow's `pr merge` fast-forward the workspace's `main` and
          `refs/remotes/origin/main` to the head branch before the sweep deletes it. §2 fails for a
          T19 that reads anything else.
        – The sweep has no worktree of its own, so W1 registers the target workspace in
          `World.worktreePaths` under the adwId it runs the sweep with: the issue's "workspace
          registered under the adwId".
        – `promotionSweep: threshold N, originated M` is the sweep's own report line on standard
          output, read by T-SP2. On the mature row, "threshold 5, originated 0" with T19 shows the
          file was scored and left; the young row fails if the seeding never reached the sweep.
        – Seed the mock state through `setState`, never through recorded requests: T7 counts the
          recorded merges.
    • §1 runs `@regression and @smoke` in a child Cucumber process twice, through feature-963's
      child-run helpers, with a timeout of several minutes: the cron probe alone may wait 60 s for
      its first poll. Just before the first run it snapshots `agents/.auth_gate`,
      `agents/paused_queue.json` and the files of `agents/cron/` and `logs/agents/cron/`, an absent
      file or directory counting as empty. The child runs take the environment that "the
      developer's gh, first on the PATH, records every call it receives" gives them, through
      feature-961's `setChildEnvironment`. "ADW's pause queue holds a workflow paused for the
      repository {string}" writes one entry with `--target-repo <repository>` among its
      `extraArgs` and no live process, so that no cron of these scenarios owns it. "no other smoke
      scenario fails on either run" means that no step of another smoke scenario is failed,
      ambiguous or undefined.
    • §2 and §3 write their throwaway scenario with feature-963's helpers: §2 with feature-966's
      `@subprocess` writer, §3 with a `@webhook` one. "the throwaway regression scenario fails at
      its last step, and every step before that one passes" judges the child run as feature-963's
      "fails at the step" does, for the last step of the throwaway scenario.
    • HOOKS. Key this feature's hooks on its adwId tag, `@adw-ls9ywd-bug-run-the-cron-can`, never on
      `@adw-967`, as feature-966 does. Before each scenario save `agents/.auth_gate` and
      `agents/paused_queue.json`. After it, run the World's cleanup, which feature-963's helpers
      push onto, clear the child environment (`setChildEnvironment(null)`), and restore both
      files. The `@webhook` hooks of `webhookCronSteps.ts` must give a `@regression @webhook`
      scenario everything the cancel row needs, so that §3's throwaway rows run under them.

  Vocabulary note. Registered phrases from `features/regression/vocabulary.md` reused by the rows:
  G4, G-SP2, G-WH3, W1, W10, T5, T7, T14, T18, T19, T-SP2, T-SP4 and T-SP5; by this file: G18 and
  T22.
  Registered phrases deliberately NOT reused:
    • G11: it makes a temporary worktree of its own, on which neither the cancel handler nor the
      sweep acts;
    • G13 to G17: they copy fixtures from `test/fixtures/scenarios/promotion/`, which does not
      exist, and commit nothing, while the sweep reads only what is committed;
    • G1 and G3: G1 only puts the mock server's address in the environment, which the gh shadow
      and the injected boundary make unnecessary, and nothing loads a manifest;
    • T1, T2 and T-WH1: no code writes a `cancelled` stage; neither the cancel handler nor the
      sweep posts a comment; T-WH1 requires the answer's body to be exactly `{ status }`, while the
      cancel answer also names the issue, and it is the dispatcher's, not the handler's.
  Per-issue phrases reused from feature-961, feature-963 and feature-966: "ADW's auth gate holds a
  record of an earlier authentication failure"; "the developer's gh, first on the PATH, records
  every call it receives"; "the developer's gh received no call"; "the checkout holds no state and
  no logs for any of these adwIds:"; "the checkout holds no spawn lock for issue {int} in the
  repository {string}"; "no cron trigger for the repository {string} is still running"; "a
  throwaway @subprocess regression scenario with the steps:"; "the throwaway regression scenario is
  run through Cucumber"; "the throwaway regression scenario fails at the step {string}".
  The registry has no phrase for the following, so novel phrasing is introduced:
    • for the rows, to be registered by the build together with them: the worktree and the ADW
      workflow comment of the workflow to cancel; the signed comment the webhook receives; the
      state, worktree and branch the cancel leaves; the deletion of every comment; the
      workspace's declared vocabulary, its committed per-issue scenario and the score it gets; the
      promotions merged and the per-issue scenarios added in the last 90 days;
    • for this file only: the two smoke runs and what they pass, fail and leave; the paused
      workflow of another repository; the throwaway `@webhook` scenario and its last step.

  Background:
    Given the ADW codebase is checked out

  # ── §1 THE FOUR SMOKE SCENARIOS PASS, TWICE IN A ROW, AND LEAVE THE CHECKOUT AS THEY FOUND IT ──

  @adw-967 @adw-ls9ywd-bug-run-the-cron-can
  Scenario: While ADW's auth gate holds a record and another repository's workflow is paused, the four smoke scenarios pass on two Cucumber runs in a row without calling the developer's gh, and leave the auth gate, the pause queue, the cron registry and the checkout as they found them
    Given ADW's auth gate holds a record of an earlier authentication failure
    And ADW's pause queue holds a workflow paused for the repository "acme/elsewhere"
    And the developer's gh, first on the PATH, records every call it receives
    When the regression suite's smoke scenarios are run through Cucumber twice in a row
    Then each of these smoke scenarios passes on both runs:
      | feature                               | scenario                                                                                                                                                  |
      | cron_trigger_spawn.feature            | cron probe launches the sdlc orchestrator for the eligible issue 300, for the target repository                                                           |
      | cancel_directive.feature              | a signed ## Cancel comment deletes the workflow's state, removes the issue's worktree and its branch, and deletes every comment on the issue, posting none |
      | promotion_threshold_auto_ramp.feature | young repo — borderline-score scenario (score=4) is tagged because N = 3 (bootstrap)                                                                      |
      | promotion_threshold_auto_ramp.feature | mature repo — same borderline-score scenario is NOT tagged because N rises to 5                                                                           |
    And no other smoke scenario fails on either run
    And the developer's gh received no call
    And ADW's auth gate, the pause queue, the cron registry and the cron logs are as they were before the runs
    And the checkout holds no state and no logs for any of these adwIds:
      | adwId                         |
      | cancel-smoke-500              |
      | promotion-threshold-smoke-512 |
    And the checkout holds no spawn lock for issue 300 in the repository "acme/widgets"
    And no cron trigger for the repository "acme/widgets" is still running

  # ── §2 THE MATURE PROMOTION ROW READS WHERE THE SWEEP'S MARKER LANDS ─────────────────────────

  @adw-967 @adw-ls9ywd-bug-run-the-cron-can
  Scenario: Where the promotion sweep suggests the scenario, 'carries no "@promotion-suggested-" tag' fails, so the mature row cannot pass by reading a file the sweep's marker never reaches
    Given a throwaway @subprocess regression scenario with the steps:
      """
      Given the target repository's workspace declares its regression vocabulary in ".adw/scenarios.md"
      And the target repository's workspace has committed "features/per-issue/feature-9300.feature" holding the scenario "A borderline scenario", which the promotion scorer rates 4
      And the target repository has 0 promotion issues whose pull request merged in the last 90 days
      When the "promotion-sweep" orchestrator is invoked with adwId "throwaway967-young" and issue 9671
      Then the orchestrator subprocess's output contains "promotionSweep: threshold 3, originated 1"
      And the artefact file at "features/per-issue/feature-9300.feature" in the worktree for adwId "throwaway967-young" carries no "@promotion-suggested-" tag on the scenario named "A borderline scenario"
      """
    When the throwaway regression scenario is run through Cucumber
    Then the throwaway regression scenario fails at the step 'the artefact file at "features/per-issue/feature-9300.feature" in the worktree for adwId "throwaway967-young" carries no "@promotion-suggested-" tag on the scenario named "A borderline scenario"'

  # ── §3 THE CANCEL ROW'S THENS SEE WHAT ITS GIVENS SEEDED ─────────────────────────────────────

  @adw-967 @adw-ls9ywd-bug-run-the-cron-can
  Scenario Outline: Delivered a plain comment instead of ## Cancel, the cancel row's Then "<check>" fails, so it cannot pass on a workflow the cancel handler never reset
    Given a throwaway @webhook regression scenario with the steps:
      """
      Given an issue 9672 exists in the mock issue tracker
      And a prior run for adwId "throwaway967-cancel" recorded workflowStage "build_running" for the repository "acme/widgets"
      And the target repository's workspace holds a worktree for issue 9672 on the branch "feature-issue-9672-throwaway"
      And issue 9672 holds an ADW workflow comment for adwId "throwaway967-cancel"
      And the webhook secret is set to "adw-regression-webhook-secret"
      When the webhook receives the comment "Thanks, this looks good." on issue 9672 from the repository "acme/widgets", signed with the secret "adw-regression-webhook-secret"
      Then <then>
      """
    When the throwaway regression scenario is run through Cucumber
    Then the throwaway regression scenario fails at its last step, and every step before that one passes

    Examples:
      | check    | then                                                                             |
      | state    | the checkout holds no state for adwId "throwaway967-cancel"                      |
      | worktree | the target repository's workspace holds no worktree for issue 9672               |
      | branch   | the target repository's workspace holds no branch "feature-issue-9672-throwaway" |
      | comments | the mock GitHub API recorded the deletion of every comment on issue 9672         |

  # ── §4 THE TYPE-CHECK ───────────────────────────────────────────────────────────────────────

  @adw-967 @adw-ls9ywd-bug-run-the-cron-can
  Scenario: The ADW TypeScript type-check passes with the four smoke scenarios on a real process or the real webhook dispatcher
    Then the ADW TypeScript type-check passes
