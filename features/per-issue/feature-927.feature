@adw-927 @adw-o4eoya-bug-a-failed-review
Feature: A review loop that ends with blockers stops adwChore, adwPlanBuildReview and adwPlanBuildTestReview at review_failed, as it already stops adwSdlc — no pull request, no approval, never awaiting_merge — while a passing review, and a chore the diff judge did not escalate, behave as today

  Issue #927 resolves the `## Divergence` section of ADR-0048
  (`specs/adr/0048-one-adwid-per-issue-and-review-failed-gate.md`). The ADR's decision: an
  orchestrator that exhausts its review retries with blockers left writes `review_failed` and
  stops. The stage is human-gated. The cron neither spawns nor merges it, and `## Retry` re-arms
  it so the review runs again. The pure function `decidePostReviewOutcome(reviewPassed)` maps the
  verdict to the stage. On a failed review `adwSdlc` then calls `executeSdlcReviewFailedHandoff`,
  which writes `review_failed` and posts the `review_failed` comment. `adwSdlc` then returns
  before the document phase and the pull request.

  Five orchestrators run a review loop. `adwSdlc` and `adwPrReview` consult the gate. The other
  three do not. After the loop they open the pull request and write `awaiting_merge`, whatever
  the review said:
    • `adwChore`, once the diff judge has escalated it into a review loop (ADR-0027). It runs the
      document phase first, and it pre-approves the pull request when the issue has no `hitl`
      label. The false green on #840 (2026-09-22) was a chore run;
    • `adwPlanBuildReview`;
    • `adwPlanBuildTestReview`, which also publishes the scenario proof on the pull request.
  On 2026-09-29 the owner ruled that the gate applies to every orchestrator with a review loop.

  What #927 changes. When the review loop of any of the three ends with blockers, the
  orchestrator does what `adwSdlc` does:
    • it writes `review_failed` to the top-level state and posts the `review_failed` comment. The
      comment names the branch, because there is no pull request to look at, and tells a human to
      push a fix and post `## Retry`;
    • then it stops. It runs no document phase, opens no pull request, publishes no proof,
      approves nothing and never writes `awaiting_merge`;
    • it stops cleanly. A failed review is a verdict, not an error: the workflow ends at
      `review_failed`, not at `abandoned`, and the process does not exit with a failure.
  What stays as it is:
    • the review loop itself. It makes as many attempts as the retry budget allows
      (`MAX_REVIEW_RETRY_ATTEMPTS`, 3 by default), with a patch and a scenario re-test between
      them;
    • a review that passes, on its first attempt or after a patch. The orchestrator carries on as
      today: the document phase (adwChore), the pull request, the proof (adwPlanBuildTestReview),
      the pre-approval (adwChore, and only without `hitl`) and `awaiting_merge`;
    • a chore the diff judge rules safe. It has no review loop, so it is unaffected.

  The labels below are the section numbers used for the scenario groups further down (§1–§5):

    §1  A FAILED REVIEW STOPS THE ORCHESTRATOR (AC1). Each of the three runs a review that still
        has blockers after its last attempt; the diff judge has escalated the chore. The workflow
        ends at `review_failed`, and `awaiting_merge` is never written. Nothing runs after the
        last review attempt. No pull request is opened, and none is approved.

    §2  THE STOP LEAVES A WAY BACK. The issue gets a comment that names the branch and points at
        `## Retry`. The resume that follows a `## Retry` launches the orchestrator that stopped,
        not `adwSdlc`.

    §3  A PASSING REVIEW BEHAVES AS TODAY (AC2). The review passes on its first attempt, or on
        its second after a patch. Each orchestrator then runs the same phases as today, in the
        same order, and ends at `awaiting_merge`. The chore pre-approves its pull request only
        when the issue has no `hitl` label. The other two approve nothing, as today.

    §4  AN UNESCALATED CHORE IS UNAFFECTED. The diff judge rules the chore safe. It runs no review
        and no document phase, opens and pre-approves its pull request, and ends at
        `awaiting_merge`.

    §5  BACKSTOP. The type-check.

  Each row is written to fail for a specific wrong implementation:
    • the §1 rows and the §2 comment assertions are RED today. After a failed review all three
      orchestrators open the pull request and write `awaiting_merge`, and post nothing of their
      own about the failed review;
    • "never recorded workflowStage "awaiting_merge"" reads every stage written during the run,
      not only the last one. It fails for a fix that writes `awaiting_merge` and then overwrites
      it with `review_failed`, because a cron tick between the two writes dispatches the merge;
    • "ran no phase after its last review attempt" fails for a fix that skips the pull request
      but still runs the document phase (adwChore) or publishes the proof
      (adwPlanBuildTestReview). That is work for a branch nobody will merge;
    • every approval assertion after a failed review is made on an issue WITHOUT `hitl`. With
      `hitl` the chore skips its pre-approval anyway, so the row would pass with the bug in
      place;
    • the `review_failed` stage and "ended without an error" fail for a fix that throws to stop.
      The error path writes `abandoned` and exits 1. `abandoned` is a retriable stage, so the
      cron would take the workflow over and run the failed review again with nobody watching:
      the loop of expensive reruns ADR-0048 rules out;
    • "the review was attempted 3 times" fails for a fix that stops at the first failed attempt.
      The patches the retry budget pays for would never run;
    • the §2 resume assertions are GREEN today and must stay green. They fail for a stop path
      that writes another orchestrator's script into the top-level state, as the PR-review
      handoff writes `adws/adwPrReview.tsx`. `## Retry` would then resume the wrong orchestrator;
    • the §3 rows that pass after a patch fail for a gate fed the first verdict, or any failed
      attempt, instead of the loop's final verdict. They also fail for a fix that writes
      `review_failed` inside the loop after each failed attempt;
    • the §3 approval assertions fail for a shared post-review step that pre-approves in every
      orchestrator. Today only adwChore pre-approves;
    • the §3 phase-order assertions fail for a fix that drops the document phase or the proof
      from the passing path, or moves either to the other side of the pull request;
    • §4 fails for a chore gate that a chore the diff judge did not escalate can reach, for
      example one placed after the escalation branch and fed `reviewPassed ?? false`. A chore
      the diff judge rules safe runs no review and so has no verdict. Such a gate would stop
      every safe chore at `review_failed`. Inside the escalation branch, where only a reviewed
      chore arrives, the same `reviewPassed ?? false` is harmless and §4 stays green.
  §3 and §4 are GREEN today and must stay green.

  ── WHY SOME CRITERIA GET NO SCENARIO OF THEIR OWN ──────────────────────────────────────────
  AC3 (unit tests cover the failed and the passed path of each orchestrator) is an obligation on
  the vitest suite, which the build and test phases discharge; §1 and §3 are its behavioural
  counterpart. AC4 (the `## Divergence` section of ADR-0048 is removed in the same pull request)
  is a documentation change. A scenario asserting that a document lacks a section would assert a
  file's contents, which the Rot-Detection Rubric forbids, so the review of the pull request
  checks it.

  `adwSdlc` and `adwPrReview` already apply the gate and do not change, so they are not driven
  here. The cron never re-fires `review_failed`, and `## Retry` re-arms it to `phase_timeout`:
  `cronIssueFilter.test.ts`, `retryHandler.test.ts` and feature-908 §3 pin both. The three
  orchestrators now write that same stage, so those pins cover them unchanged, and feature-908 is
  not re-tagged. No other per-issue scenario pins what the three orchestrators do after their
  review, so none is flagged.

  The regression smoke `adw_chore_diff_verdicts.feature` is left alone. The regression suite
  changes only by a human decision, and its orchestrator step is still pending. If that step is
  ever enabled, its escalated row expects `awaiting_merge`, which from now on holds only while
  the stubbed review passes.

  How these scenarios observe the system. Every assertion targets a runtime artefact:
    • the top-level state file (`agents/<adwId>/state.json`): its final stage, and every stage
      written to it during the run, recorded at the state writer;
    • the phases the orchestrator ran, in order, recorded by the fake phases;
    • the pull requests opened and approved, recorded by a recording code host;
    • the comments posted, recorded by a recording issue tracker;
    • the exit the error path would take, trapped in process;
    • the spawn the real `resolveResumeSpawn` resolves from the top-level state.
  No scenario reads, greps or parses a source file.

  Notes for the step definitions:

    • THE SEAM. None of the three scripts can be driven today. Each calls `main()` as soon as it
      is imported, and reaches its phases through static imports. The build gives each script an
      exported entry point that runs what `main()` runs inside `runWithOrchestratorLifecycle`. It
      takes the `WorkflowConfig` and the phase functions as inputs, with the real phases as
      defaults. `main()` then runs only behind an `import.meta.url` guard. `adwMerge.tsx` is the
      precedent: it exports `executeMerge` with `MergeDeps`. AC3's unit tests can use the same
      seam. The steps import the script and call that entry point.
    • FAKE THE PHASES, NOT THE GATE. Fake only the phases that run agents or touch git: the
      functions the scripts import from `adws/workflowPhases.ts` today. The review loop, the gate
      and the stop path run for real, wherever the build puts them. A step that calls
      `decidePostReviewOutcome` or a shared stop helper itself, or that fakes either, passes with
      the bug in place: the bug is that the scripts do not call the gate.
    • NEVER RUN A REAL AGENT, NEVER REACH GITHUB. Each fake phase appends its name to one ordered
      log and returns a zero-cost result with no phase cost records. The fakes that do more:
        – the review returns the verdict scripted for its attempt. "fails with N blocker(s)" is
          `reviewPassed: false` with N review issues of severity `blocker`; "passes" is
          `reviewPassed: true` with none. It posts no comment, so every comment on the issue
          comes from the orchestrator itself;
        – the diff evaluation (adwChore) returns `verdict: 'regression_possible'` for "the diff
          judge escalates the chore into a review loop", and `'safe'` for "the diff judge rules
          the chore safe";
        – the PR phase opens the pull request the way the real one does, as far as the code host
          can tell: it calls `repoContext.codeHost.createPullRequest` with the issue as
          `linkedIssueNumber`, and sets `ctx.prUrl` and `ctx.prNumber` from the answer;
        – the unit tests and the scenario tests report a pass with no retries.
      In the log, the phases the scenarios name are "review", "document", "pull request" and
      "proof publish". Name the others freely.
    • THE WORKFLOW. "an {string} workflow has started for issue N under adwId X on the branch B"
      builds a `WorkflowConfig` with:
        – a throwaway worktree, and an orchestrator state path under `agents/X/`;
        – B as the branch name and as `ctx.branchName`;
        – a recording `repoContext` for the fictional `acme/widgets`. Its `issueTracker` records
          `commentOnIssue`, answers `fetchLabels` with the issue's labels and resolves
          `moveToStatus`. Its `codeHost` records `createPullRequest`, answering
          `{ url: 'https://github.com/acme/widgets/pull/<k>', number: <k> }`, records
          `approvePullRequest`, which succeeds, and answers `getDefaultBranch` with `main`.
      It then writes the top-level state as `initializeWorkflow` does: the adwId, the issue
      number, `workflowStage: 'starting'`, `branchName` B, and the `orchestratorScript` that
      `deriveOrchestratorScript` gives the orchestrator (`adws/adwChore.tsx`,
      `adws/adwPlanBuildReview.tsx` or `adws/adwPlanBuildTestReview.tsx`). Never let a comment
      or a pull request reach GitHub.
    • LABELS. "issue N has no labels" makes `fetchLabels(N)` answer `[]`. "issue N is labelled
      {string}" makes it answer that one label.
    • THE STAGE HISTORY. For the whole When step, wrap `AgentStateManager.writeTopLevelState`:
      record every `workflowStage` it writes for adwId X, in order, then delegate to the real
      writer. Restore it afterwards. "never recorded workflowStage S" reads that history, and
      fails when the history is empty. T1 reads the final state file.
    • THE EXIT. For the whole When step, replace `process.exit` with a function that records the
      code and throws a sentinel; catch the sentinel and restore `process.exit`. "ended without
      an error" requires that the entry point resolved and that no non-zero exit was recorded.
    • THE REVIEW BUDGET. "the review was attempted N time(s)" counts the review attempts in the
      log; "the review was never attempted" requires none. 3 is the default of
      `MAX_REVIEW_RETRY_ATTEMPTS`, which `adws/core/config.ts` reads from the environment when it
      is first imported. The `Before` hook fails fast, saying so, if the constant is not 3.
    • PHASE ORDER. "ran no phase after its last review attempt": the last entry in the log is the
      last review attempt. "after its last review attempt, … ran exactly these phases, in order"
      compares the entries after the last review attempt with the comma-separated list. "did not
      run the {string} phase": the log holds no entry with that name.
    • THE CODE HOST. "opened no pull request for issue N": no `createPullRequest` for N was
      recorded. "opened one pull request for issue N": exactly one was. "approved no pull
      request": no `approvePullRequest` was recorded. "approved the pull request it opened for
      issue N": exactly one `approvePullRequest` was recorded, for the number `createPullRequest`
      answered for N.
    • THE COMMENT. "a comment on issue N names the branch B and tells a human to post {string}":
      a comment recorded on issue N whose body contains both B and the given text.
    • THE RESUME. "the resume that follows a {string} on adwId X launches S for issue N" reads the
      top-level state of X after the run and calls the real `resolveResumeSpawn` on it. The
      script is S, and the arguments are `[N, X]`.
    • HOOKS. Scope every hook to `@adw-927`.
        – `Before`: initialise `mockContext` with `setupMockInfrastructure()`, because T1 falls
          into a legacy source-inspection branch when it is null. Check the review budget.
        – `After`: restore `AgentStateManager.writeTopLevelState` and `process.exit` if a step
          left them replaced. Remove `agents/<adwId>` for every adwId used, and the throwaway
          worktrees. Tear the mock infrastructure down.
    • REUSED, NOT REDEFINED. G18 is defined in `features/step_definitions/`, and T1 and T22 in
      the regression suite's thenSteps.ts. Redefining any of them is an
      AmbiguousStepDefinition.

  Vocabulary note. These registered phrases from `features/regression/vocabulary.md` are reused:
    • G18 `the ADW codebase is checked out`
    • T1  `the state file for adwId {string} records workflowStage {string}`
    • T22 `the ADW TypeScript type-check passes`
  These registered phrases are deliberately NOT reused:
    • W1 spawns the real orchestrator as a subprocess, whose phases cannot be faked, and its
      definition is still pending;
    • T8 reads the mock GitHub API's recorded requests for a PR creation, and T2 and T3 read
      them for comments. Here the faked PR phase sends nothing over HTTP. Pull requests,
      approvals and comments are observed at the recording code host and issue tracker;
    • T5 reads a subprocess's exit code. Here the error path's exit is trapped in process;
    • G6 writes state under a temporary worktree's `.adw/state.json`. The orchestrators write the
      top-level `agents/<adwId>/state.json`.
  No unregistered phrase from another per-issue feature is reused. Their step definitions are
  swept with their feature, and several are bound to that feature's own world. That is why the
  wording here avoids feature-796's "issue {int} carries no labels" and "issue {int} carries the
  label {string}", and feature-912's "the {string} phase ran {int} time(s)": the same wording
  would match those definitions. The registry has no phrase for the following, so novel phrasing
  is introduced for them: the started workflow; the issue's labels; the diff judge's verdict; the
  scripted review verdicts; the orchestrator's run; the review attempts; the stage history; the
  phase log; the code host's pull requests and approvals; the clean ending; the comment; and the
  resume.

  Background:
    Given the ADW codebase is checked out

  # ── §1 A FAILED REVIEW STOPS THE ORCHESTRATOR ──────────────────────────────────────────────────

  @adw-927 @adw-o4eoya-bug-a-failed-review
  Scenario: An escalated chore whose review still has blockers after its last attempt stops at review_failed: no document phase, no pull request, no pre-approval, and awaiting_merge is never written
    Given an "adwChore" workflow has started for issue 9271 under adwId "fail927-chore" on the branch "chore-issue-9271-rename-config-keys"
    And issue 9271 has no labels
    And the diff judge escalates the chore into a review loop
    And the review fails with 2 blockers on every attempt
    When the "adwChore" orchestrator runs its workflow
    Then the review was attempted 3 times
    And the state file for adwId "fail927-chore" records workflowStage "review_failed"
    And the state file for adwId "fail927-chore" never recorded workflowStage "awaiting_merge"
    And the "adwChore" orchestrator ran no phase after its last review attempt
    And the code host opened no pull request for issue 9271
    And the code host approved no pull request
    And the "adwChore" orchestrator ended without an error

  @adw-927 @adw-o4eoya-bug-a-failed-review
  Scenario Outline: adwPlanBuildReview and adwPlanBuildTestReview stop at review_failed when the review still has blockers after its last attempt: no pull request, no proof, no approval, and awaiting_merge is never written
    Given an "<orchestrator>" workflow has started for issue <issue> under adwId "<adwId>" on the branch "<branch>"
    And issue <issue> has no labels
    And the review fails with 2 blockers on every attempt
    When the "<orchestrator>" orchestrator runs its workflow
    Then the review was attempted 3 times
    And the state file for adwId "<adwId>" records workflowStage "review_failed"
    And the state file for adwId "<adwId>" never recorded workflowStage "awaiting_merge"
    And the "<orchestrator>" orchestrator ran no phase after its last review attempt
    And the code host opened no pull request for issue <issue>
    And the code host approved no pull request
    And the "<orchestrator>" orchestrator ended without an error

    Examples:
      | orchestrator           | issue | adwId        | branch                        |
      | adwPlanBuildReview     | 9272  | fail927-pbr  | feature-issue-9272-csv-export |
      | adwPlanBuildTestReview | 9273  | fail927-pbtr | feature-issue-9273-csv-export |

  # ── §2 THE STOP LEAVES A WAY BACK ──────────────────────────────────────────────────────────────

  @adw-927 @adw-o4eoya-bug-a-failed-review
  Scenario: A chore stopped by its review tells the issue which branch holds the work and to post ## Retry, and the resume that follows a ## Retry is the chore again
    Given an "adwChore" workflow has started for issue 9274 under adwId "retry927-chore" on the branch "chore-issue-9274-rename-config-keys"
    And issue 9274 has no labels
    And the diff judge escalates the chore into a review loop
    And the review fails with 1 blocker on every attempt
    When the "adwChore" orchestrator runs its workflow
    Then a comment on issue 9274 names the branch "chore-issue-9274-rename-config-keys" and tells a human to post "## Retry"
    And the resume that follows a "## Retry" on adwId "retry927-chore" launches "adws/adwChore.tsx" for issue 9274

  @adw-927 @adw-o4eoya-bug-a-failed-review
  Scenario Outline: adwPlanBuildReview and adwPlanBuildTestReview, stopped by their review, tell the issue which branch holds the work and to post ## Retry, and the resume that follows a ## Retry is the same orchestrator
    Given an "<orchestrator>" workflow has started for issue <issue> under adwId "<adwId>" on the branch "<branch>"
    And issue <issue> has no labels
    And the review fails with 1 blocker on every attempt
    When the "<orchestrator>" orchestrator runs its workflow
    Then a comment on issue <issue> names the branch "<branch>" and tells a human to post "## Retry"
    And the resume that follows a "## Retry" on adwId "<adwId>" launches "adws/<orchestrator>.tsx" for issue <issue>

    Examples:
      | orchestrator           | issue | adwId         | branch                        |
      | adwPlanBuildReview     | 9275  | retry927-pbr  | feature-issue-9275-csv-export |
      | adwPlanBuildTestReview | 9276  | retry927-pbtr | feature-issue-9276-csv-export |

  # ── §3 A PASSING REVIEW BEHAVES AS TODAY ───────────────────────────────────────────────────────

  @adw-927 @adw-o4eoya-bug-a-failed-review
  Scenario Outline: An escalated chore whose review passes, on its first attempt or after a patch, documents, opens and pre-approves its pull request and ends at awaiting_merge, as today
    Given an "adwChore" workflow has started for issue <issue> under adwId "<adwId>" on the branch "<branch>"
    And issue <issue> has no labels
    And the diff judge escalates the chore into a review loop
    And the review <verdicts>
    When the "adwChore" orchestrator runs its workflow
    Then the review was attempted <how often>
    And after its last review attempt, the "adwChore" orchestrator ran exactly these phases, in order: "document, pull request"
    And the code host opened one pull request for issue <issue>
    And the code host approved the pull request it opened for issue <issue>
    And the state file for adwId "<adwId>" records workflowStage "awaiting_merge"
    And the state file for adwId "<adwId>" never recorded workflowStage "review_failed"
    And the "adwChore" orchestrator ended without an error

    Examples:
      | verdicts                                                           | how often | issue | adwId           | branch                              |
      | passes on its first attempt                                        | 1 time    | 9277  | pass927-chore-1 | chore-issue-9277-rename-config-keys |
      | fails with 1 blocker on its first attempt and passes on its second | 2 times   | 9278  | pass927-chore-2 | chore-issue-9278-rename-config-keys |

  @adw-927 @adw-o4eoya-bug-a-failed-review
  Scenario: An escalated chore whose review passes on an issue labelled hitl opens its pull request and leaves it unapproved, as today
    Given an "adwChore" workflow has started for issue 9279 under adwId "hitl927-chore" on the branch "chore-issue-9279-rename-config-keys"
    And issue 9279 is labelled "hitl"
    And the diff judge escalates the chore into a review loop
    And the review passes on its first attempt
    When the "adwChore" orchestrator runs its workflow
    Then the code host opened one pull request for issue 9279
    And the code host approved no pull request
    And the state file for adwId "hitl927-chore" records workflowStage "awaiting_merge"

  @adw-927 @adw-o4eoya-bug-a-failed-review
  Scenario Outline: adwPlanBuildReview and adwPlanBuildTestReview, whose review passes on its first attempt or after a patch, open the pull request, publish the proof where they always have, approve nothing and end at awaiting_merge, as today
    Given an "<orchestrator>" workflow has started for issue <issue> under adwId "<adwId>" on the branch "<branch>"
    And issue <issue> has no labels
    And the review <verdicts>
    When the "<orchestrator>" orchestrator runs its workflow
    Then the review was attempted <how often>
    And after its last review attempt, the "<orchestrator>" orchestrator ran exactly these phases, in order: "<phases after the review>"
    And the code host opened one pull request for issue <issue>
    And the code host approved no pull request
    And the state file for adwId "<adwId>" records workflowStage "awaiting_merge"
    And the state file for adwId "<adwId>" never recorded workflowStage "review_failed"
    And the "<orchestrator>" orchestrator ended without an error

    Examples:
      | orchestrator           | verdicts                                                           | how often | phases after the review     | issue | adwId          | branch                        |
      | adwPlanBuildReview     | passes on its first attempt                                        | 1 time    | pull request                | 9280  | pass927-pbr-1  | feature-issue-9280-csv-export |
      | adwPlanBuildReview     | fails with 1 blocker on its first attempt and passes on its second | 2 times   | pull request                | 9281  | pass927-pbr-2  | feature-issue-9281-csv-export |
      | adwPlanBuildTestReview | passes on its first attempt                                        | 1 time    | pull request, proof publish | 9282  | pass927-pbtr-1 | feature-issue-9282-csv-export |
      | adwPlanBuildTestReview | fails with 1 blocker on its first attempt and passes on its second | 2 times   | pull request, proof publish | 9283  | pass927-pbtr-2 | feature-issue-9283-csv-export |

  # ── §4 AN UNESCALATED CHORE IS UNAFFECTED ──────────────────────────────────────────────────────

  @adw-927 @adw-o4eoya-bug-a-failed-review
  Scenario: A chore the diff judge rules safe has no review loop and is unaffected: it opens and pre-approves its pull request and ends at awaiting_merge
    Given an "adwChore" workflow has started for issue 9284 under adwId "safe927-chore" on the branch "chore-issue-9284-fix-readme-typo"
    And issue 9284 has no labels
    And the diff judge rules the chore safe
    When the "adwChore" orchestrator runs its workflow
    Then the review was never attempted
    And the "adwChore" orchestrator did not run the "document" phase
    And the code host opened one pull request for issue 9284
    And the code host approved the pull request it opened for issue 9284
    And the state file for adwId "safe927-chore" records workflowStage "awaiting_merge"
    And the state file for adwId "safe927-chore" never recorded workflowStage "review_failed"
    And the "adwChore" orchestrator ended without an error

  # ── §5 BACKSTOP ────────────────────────────────────────────────────────────────────────────────

  @adw-927 @adw-o4eoya-bug-a-failed-review
  Scenario: TypeScript type-check passes with the review gate applied in all three orchestrators
    Then the ADW TypeScript type-check passes
