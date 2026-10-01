@adw-932 @adw-xs9x3g-bug-adw-none-wins-on
Feature: adw:none stops every spawn path, every ADW label exists on a repository before anyone needs it, and an issue is routed by its label rather than by a command in its body

  Issue #932 implements three owner rulings that ADR-0041 (items 1 and 2) and ADR-0033 (item 1)
  record as divergences (`specs/adr/0041-label-based-classification.md`,
  `specs/adr/0033-depaudit-as-dependency-gate.md`):

    1. `adw:none` opts an issue out "entirely" (the PRD's word); on 2026-10-01 the owner ruled that
       it "always wins, on every path". Today only two functions read it: `decideIssueOpenedRoute`
       (`issues.opened`) and `decideLabelRecovery`, which the cron filter's `evaluateIssue`
       consults on the truly fresh path only (no adwId, no stage). A `## Continue` comment, the
       closing of a dependency, the cron's takeover of an abandoned or timed-out workflow and the
       cron's merge hoist all start a run on an `adw:none` issue.
    2. `ensureAdwLabelsExist` (`adws/forge/adwLabelProvisioning.ts`) has no caller. A repository
       gets an `adw:*` label only when ADW applies one itself (`applyLabel` creates a missing label
       first), so a person cannot pick `adw:none` from the label menu until something created it.
       On 2026-10-01 the ADW repository had five `adw:*` labels and no `adw:none`.
    3. The `depaudit-triage` skill writes `/adw_sdlc` into the body of a major-upgrade issue. Since
       ADR-0041 the body selects nothing; the skill must apply an `adw:*` label instead.

  The issue also says what must NOT change: conflicting classification labels are refused on
  `issues.opened` and by the cron, and left to the classifier on every other path (ADR-0041,
  More Information, settled by the owner on 2026-10-01).

  The labels below are the section numbers used for the scenario groups further down (§1–§5):

    §1  `adw:none` STARTS NO RUN, ON ANY PATH (AC1). `issues.opened`; a `## Continue` comment, on a
        fresh issue and on one with an earlier workflow; the closing of a dependency; the cron's
        fresh sweep, its takeover and its merge hoist. Every path has a positive control that does
        start a run, so no "no run" assertion can pass because nothing was observable.

    §2  CONFLICTING CLASSIFICATION LABELS ARE HANDLED EXACTLY AS BEFORE. Refused on
        `issues.opened` and by the cron; classified and started on the comment and
        dependency-closure paths.

    §3  THE ADW LABELS ARE PROVISIONED UP FRONT (AC2). The first webhook event from a repository
        defines every label of the ADW label catalogue on it.

    §4  A MAJOR-UPGRADE ISSUE IS ROUTED BY ITS LABEL (the executable half of AC3).

    §5  BACKSTOPS. Type-check and the git/gh guard.

  Each row is written to fail for a reason, not to restate a criterion:
    • the comment, dependency-closure, cron-takeover and cron-merge rows of §1 are RED today: each
      of those paths starts a run on an `adw:none` issue;
    • the rows that put `adw:none` beside a classification label fail for a fix that lets a single
      `adw:<type>` label win. `classifyIssueForTrigger` returns the label's classification before
      anything else today, and a takeover never reaches it;
    • the "classifier was not consulted" assertions fail for a fix that reads the opt-out only
      after classification. Such a fix starts no run but spends an LLM call on every opted-out
      issue; ADR-0041 counts "a labelled issue costs no classification call" among its gains;
    • the comment-path takeover row fails for a fix placed where classification happens:
      `classifyAndSpawnWorkflow` launches a takeover before it classifies anything;
    • the cron takeover and merge rows fail for a fix confined to `classifyAndSpawnWorkflow`. The
      cron's takeover branch calls `spawnDetached` itself, and its merge hoist calls
      `spawn('bunx', … adwMerge.tsx …)` itself;
    • the dependency-closure row names two dependents and lists the opted-out one first. It fails
      for a fix that stops at the first opted-out dependent instead of skipping it;
    • the `issues.opened` rows and the cron's fresh-sweep row are GREEN TODAY and must stay green.
      The opened row with `adw:none` beside two classification labels fails for a fix that moves
      the opt-out out of the opened router into a shared check that runs after the router's
      conflict refusal: the cleanup comment would then be posted on an opted-out issue;
    • §2 is GREEN TODAY and must stay green. A shared check that also refuses conflicts fails the
      comment and dependency-closure rows. One that also sends conflicts to the classifier fails
      the opened and cron rows. A deterministic tie-break fails "the issue classifier was
      consulted";
    • §3: the event outline fails for provisioning hooked into a single event branch (only
      `issues.opened`, say). The second-event row fails for provisioning on every delivery, which
      is eight label writes per event. The other-repository row fails for one process-wide flag:
      a single webhook serves every registered repository. The refusing-tracker row fails for
      provisioning that lets a tracker's refusal escape and abort the event;
    • §4 is GREEN TODAY and must stay green. It fails for a fix that repairs the triage path on
      ADW's side, by teaching ADW to read orchestrator commands in an issue body again, which
      ADR-0041 removed on purpose. Its label (`adw:chore`) deliberately differs from what the
      body's `/adw_sdlc` asks for, so the row can tell which of the two decided.

  ── WHY SOME CRITERIA GET NO SCENARIO OF THEIR OWN ──────────────────────────────────────────
  "Unit tests cover each" (AC1) is an obligation on the vitest suite, which the build and test
  phases discharge. A scenario asserting that a test exists would assert a source-file property,
  which the Rot-Detection Rubric forbids; §1 asserts the behaviour those tests pin instead.
  AC3 ("the triage skill contains no orchestrator command in an issue body") is a property of a
  prompt, `.claude/skills/depaudit-triage/SKILL.md`. The skill acts only inside an interactive
  agent session, which no scenario can drive, and reading the file for `/adw_sdlc` would be a
  substring match against a source file. §4 pins the contract the corrected skill relies on.
  AC4 (the Divergence sections of ADR-0041 and ADR-0033 removed in the same pull request) is a
  documentation change. Nothing reads those sections, so there is no artefact to observe.

  ── FINDINGS THE ISSUE BODY DOES NOT CARRY ──────────────────────────────────────────────────

  F1  "ONE PLACE THAT ALL PATHS PASS THROUGH" DOES NOT EXIST YET.
      `classifyIssueForTrigger`'s docblock calls it "the sole chokepoint all four trigger paths
      (cron, issues.opened, issue_comment, dependency-closure) share", but it is skipped whenever
      the classification is already known. The opened route
      and the cron's single-label fresh path hand `classifyAndSpawnWorkflow` a precomputed
      classification, and every takeover, from the webhook or the cron, launches before any
      classification. `classifyAndSpawnWorkflow` is not that place either, because the cron's
      takeover branch and merge hoist launch on their own. A check that covers every §1 row has
      to sit where those launches converge, or the cron's launch sites have to be routed through
      the place where the check sits.

  F2  PROVISIONING IS PER REPOSITORY, ON THE FIRST WEBHOOK.
      The issue allows `adw_init` or the first webhook. These rows pin the first webhook, for
      three reasons. The PRD names it. `adw_init` now runs only inside `adwUpgrade`, which the
      upgrade gate in `workflowInit` launches after a workflow has started on an issue, so after a
      person has already filed one. And the webhook reaches every registered repository,
      including ADW's own. The precedent is `ensureCronProcess`: called for every event with a
      resolved repository and remembered per repository in `cronSpawnedForRepo`. If the plan
      provisions from `adw_init` instead, the alignment step must replace §3's When steps; their
      Then steps hold either way.

  F3  A TRACKER MAY NOT SUPPORT `ensureLabel`.
      `JiraIssueTracker.ensureLabel` throws "not implemented". `ensureAdwLabelsExist` already
      contains each label's failure; a call site that bypasses it must contain them as well, or
      every event from such a repository fails.

  F4  THE TRIAGE SKILL NEEDS ITS LABEL TO EXIST.
      The skill is `target: false`, so it is never copied into a target repository, and it files
      its issue on the current repository: in practice ADW's own. `gh issue create --label`
      refuses a label the repository does not define; only ADW's
      own `applyLabel` creates a missing label first. Item 2 is therefore a precondition of
      item 3. To keep the skill's intent of a full SDLC run, `adw:bug` and `adw:feature` route
      to `adws/adwSdlc.tsx`, while `adw:chore` routes to `adws/adwChore.tsx`. Which label the
      skill applies is the plan's call; no row here pins it.

  F5  NOT PINNED HERE.
      The `## Retry` and `## Cancel` directives (ADR-0032) and the `adw:upgrade` route at the top
      of `classifyAndSpawnWorkflow` are not among the issue's four paths. `## Retry` on a paused
      workflow respawns its orchestrator (#908), so whether `adw:none` stops that too is a question
      for the plan. No row here decides it either way.

  ── HOW THESE ROWS RUN (notes for the step definitions) ────────────────────────────────────
    • THE HARNESS IS feature-796's RECORDING BOUNDARY, the one feature-848 also reuses. `a launch
      boundary for the repository … whose providers record every call` and the call-log
      assertions come from `features/per-issue/step_definitions/feature-796.steps.ts`. The
      `issue … in the recording tracker carries the label(s) …` and `… is titled …` Givens come
      from `feature-820.steps.ts`. Reuse them; redefining one is an AmbiguousStepDefinition. The
      `@adw-796` and `@adw-820` hooks do not fire for these rows, so this feature's step
      definitions own their reset and cleanup (`world796()` exposes the shared world, including
      `tempDirs`).
    • EXTEND THE RECORDING TRACKER; DO NOT FORK IT. The rows need issue bodies, comments, states
      and creation/update times, served consistently by `fetchIssue`, `fetchComments`,
      `getIssueState` and `listIssues` (which returns [] today). `listIssues` lists every seeded
      issue not in state "CLOSED", in seeding order, with `labels` as `{ name }` objects and with
      its comments.
    • NEVER LAUNCH A REAL ORCHESTRATOR. Every launch on these paths goes through `bunx` on PATH:
      `spawnDetached` for fresh spawns and takeovers, and the cron merge hoist's own
      `spawn('bunx', …)`. Shadow `bunx` with a recorder that logs its argv and exits, as
      `enableBunxRelaunchIntercept` in `feature-902-queue.steps.ts` does, and restore PATH in
      `After`. A launch belongs to issue N when the first argument after the script is N. Compare
      scripts repo-relative, because `spawnDetached` and the merge hoist absolutise `adws/…`
      against REPO_ROOT.
    • NEVER CALL THE REAL CLAUDE CLI. Several RED rows reach `/classify_issue` today. For every
      `@adw-932` row, point `CLAUDE_CODE_PATH` at a recording wrapper around
      `test/mocks/claude-cli-stub.ts`: save and restore the variable and call
      `clearClaudeCodePathCache()`, as feature-820's steps do. The wrapper logs its argv to a path
      fixed in the wrapper itself, because the agent's environment does not carry `MOCK_*`
      variables. "consulted for issue N" means a recorded invocation whose prompt names
      `/classify_issue` and `#N`. Which classification the stub answers is never asserted.
    • THE WEBHOOK ROWS drive the real `dispatchWebhookEvent` with a mint override that returns the
      recording boundary, as feature-908's webhook row does. Every payload names the boundary's
      repository and carries the issue's title, body and labels exactly as the recording tracker
      holds them, so a fix that reads labels from the payload and one that reads them from the
      tracker see the same thing. Neutralise `ensureCronProcess` by registering this process's
      PID for the repository first (`writeCronPid`) and remove the registration in `After`. Save,
      remove and restore `agents/.auth_gate`, or the webhook ignores the event. The opened,
      comment and closed branches finish asynchronously: wait, bounded, for the handling to settle
      before asserting, and let a negative launch assertion wait the same bounded period.
    • ISSUE NUMBERS ARE DISTINCT ON PURPOSE. `shouldTriggerIssueWorkflow` ignores a second
      `issues.opened` or `## Continue` for the same issue number within 60 s; the cron keeps a
      process-wide `processedSpawns` set; spawn locks are keyed by issue. A number reused across
      rows makes a later row ignore its event, and its negative assertions then pass vacuously.
    • REPOSITORY NAMES IN §3 ARE DISTINCT ON PURPOSE. Provisioning is remembered per repository for
      the life of the process, so each §3 row dispatches from a repository no other row uses. The
      refusing-tracker row must be its repository's first event, or the refusal is never
      exercised. "the webhook has already dispatched … from the repository R" dispatches through a
      throwaway recording boundary for R, separate from the scenario's own boundary. A neutral
      event starts nothing: an issue edit, a plain comment that is no directive, an approved
      review (each with an issue or pull request number no row seeds).
    • LABEL ASSERTIONS. "recorded each of these labels being defined" means a recorded
      `ensureLabel` call for every row of the table that the tracker did not refuse. "were asked to
      define" counts the call even when it was refused. "no label being defined during that event"
      compares with the call log as it stood when the latest dispatch began. "refuses to define
      labels" makes `ensureLabel` record the call and then throw, as the Jira tracker does.
    • THE CRON ROWS call the exported `checkAndTrigger(boundary)` with the recording boundary. Seed
      every issue's `createdAt` and `updatedAt` well before `GRACE_PERIOD_MS` (5 minutes) ago, or
      the filter drops it as `grace_period` and the controls fail. The tick also runs the
      pause-queue scan, the auth-queue scan and the periodic sweeps against the checkout's real
      `agents/` directory: save and empty `agents/paused_queue.json` around it, as feature-908
      does, and keep the `bunx` shadow active for the whole tick. Locks land under two identities:
      `evaluateCandidate` keys the spawn lock by the boundary's repository, while the cron's
      merge-dispatch gate and its own lock releases use the cron module's identity (under import,
      the checkout's repository). Remove the locks under both in `After`.
    • "issue N has an earlier ADW workflow under adw id X recorded at workflowStage S running P"
      seeds an ADW workflow comment carrying `**ADW ID:** \`X\`` on the issue, visible to
      `fetchComments` and to the comments `listIssues` returns. It also writes the top-level state
      through `AgentStateManager.writeTopLevelState`: the issue number, the stage, `P` as
      `orchestratorScript` and the boundary's repository as `repoIdentity`, with no phases and no
      branch name, so a takeover recovers without probing a worktree. Use only lowercase letters,
      digits and hyphens in an adw id. Remove `agents/<adwId>` in `After`.
    • THE FIXTURE REPOSITORIES DO NOT EXIST. No `adw-fixture/…-932` name is a real repository, so a
      RED run that escapes the harness fails fast instead of acting on one.
    • Scope every hook to `@adw-932`.

  Vocabulary note. These registered phrases from `features/regression/vocabulary.md` are reused:
    • G18 `the ADW codebase is checked out`
    • T22 `the ADW TypeScript type-check passes`
    • W16/T34 `the git/gh guard is run across the repository` / `the git/gh guard reports no violations`
  These per-issue phrases are reused because their world is exported for sharing (`world796()`):
    • from feature-796: `a launch boundary for the repository {string} whose providers record every
      call`, `the boundary's issue tracker recorded no comment`, `the boundary's issue tracker
      recorded a comment on issue {int}`, `the recorded comment on issue {int} contains {string}`,
      `the boundary's providers recorded no label applied to issue {int}`
    • from feature-820: `issue {int} in the recording tracker carries the label {string}`, `issue
      {int} in the recording tracker carries the labels {string} and {string}`, `issue {int} in
      the recording tracker is titled {string}`
  These phrases are deliberately NOT reused:
    • feature-908's `no orchestrator was launched for issue {int}`, `exactly one orchestrator was
      launched for issue {int}`, `the orchestrator launched for issue {int} runs {string} under
      adwId {string}` and `the webhook receives a {string} comment on issue {int} from the
      repository {string}`. They read 908's own launch records and fake tracker, which never see a
      launch made here, so every "no run" row would pass vacuously;
    • the registry's W11 (`the webhook handler receives a {string} event for issue {int}`), which is
      pending in `whenSteps.ts`, and W14 (`the cron poll batch runs`), which has no definition.
  The registry has no phrase for any of the following, so novel phrasing is introduced for them:
    • dispatching an opening, a comment, a closing or a neutral event through the webhook from the
      recording boundary, and running one cron tick from it;
    • seeding a third label, an issue body, an issue state and an earlier workflow, and a tracker
      that refuses to define labels;
    • asserting the ADW runs started for an issue and the orchestrator a run executes;
    • asserting whether the issue classifier was consulted;
    • asserting which labels were defined on the repository.

  Background:
    Given the ADW codebase is checked out

  # ── §1 adw:none STARTS NO RUN, ON ANY PATH ─────────────────────────────────────────────────

  @adw-932 @adw-xs9x3g-bug-adw-none-wins-on
  Scenario: An issue opened with adw:none starts no run, gets no comment and has no label written back
    Given a launch boundary for the repository "adw-fixture/void-932" whose providers record every call
    And issue 9301 in the recording tracker carries the label "adw:none"
    When the webhook dispatches the opening of issue 9301 from that boundary
    Then no ADW run was started for issue 9301
    And the boundary's issue tracker recorded no comment
    And the boundary's providers recorded no label applied to issue 9301

  @adw-932 @adw-xs9x3g-bug-adw-none-wins-on
  Scenario: adw:none outranks two conflicting classification labels on an opened issue, so no cleanup comment is posted
    Given a launch boundary for the repository "adw-fixture/void-932" whose providers record every call
    And issue 9302 in the recording tracker carries the labels "adw:none", "adw:bug" and "adw:feature"
    When the webhook dispatches the opening of issue 9302 from that boundary
    Then no ADW run was started for issue 9302
    And the boundary's issue tracker recorded no comment

  @adw-932 @adw-xs9x3g-bug-adw-none-wins-on
  Scenario: An issue opened with a single classification label still starts the orchestrator its label names
    Given a launch boundary for the repository "adw-fixture/void-932" whose providers record every call
    And issue 9303 in the recording tracker carries the label "adw:chore"
    When the webhook dispatches the opening of issue 9303 from that boundary
    Then exactly one ADW run was started for issue 9303
    And the ADW run started for issue 9303 runs the orchestrator "adws/adwChore.tsx"

  @adw-932 @adw-xs9x3g-bug-adw-none-wins-on
  Scenario: A ## Continue comment on an issue carrying adw:none starts no run and spends no classification
    Given a launch boundary for the repository "adw-fixture/void-932" whose providers record every call
    And issue 9304 in the recording tracker carries the label "adw:none"
    When the webhook dispatches a "## Continue" comment on issue 9304 from that boundary
    Then no ADW run was started for issue 9304
    And the issue classifier was not consulted for issue 9304

  @adw-932 @adw-xs9x3g-bug-adw-none-wins-on
  Scenario: A ## Continue comment on an issue carrying adw:none beside a classification label starts no run
    Given a launch boundary for the repository "adw-fixture/void-932" whose providers record every call
    And issue 9305 in the recording tracker carries the labels "adw:bug" and "adw:none"
    When the webhook dispatches a "## Continue" comment on issue 9305 from that boundary
    Then no ADW run was started for issue 9305

  @adw-932 @adw-xs9x3g-bug-adw-none-wins-on
  Scenario: A ## Continue comment on an issue without adw:none still starts the orchestrator its label names
    Given a launch boundary for the repository "adw-fixture/void-932" whose providers record every call
    And issue 9306 in the recording tracker carries the label "adw:bug"
    When the webhook dispatches a "## Continue" comment on issue 9306 from that boundary
    Then exactly one ADW run was started for issue 9306
    And the ADW run started for issue 9306 runs the orchestrator "adws/adwSdlc.tsx"

  @adw-932 @adw-xs9x3g-bug-adw-none-wins-on
  Scenario: A ## Continue comment takes over an earlier workflow only on the issue that does not carry adw:none
    Given a launch boundary for the repository "adw-fixture/void-932" whose providers record every call
    And issue 9307 in the recording tracker carries the labels "adw:chore" and "adw:none"
    And issue 9307 has an earlier ADW workflow under adw id "none932-9307" recorded at workflowStage "abandoned" running "adws/adwChore.tsx"
    And issue 9308 in the recording tracker carries the label "adw:chore"
    And issue 9308 has an earlier ADW workflow under adw id "none932-9308" recorded at workflowStage "abandoned" running "adws/adwChore.tsx"
    When the webhook dispatches a "## Continue" comment on issue 9307 from that boundary
    And the webhook dispatches a "## Continue" comment on issue 9308 from that boundary
    Then no ADW run was started for issue 9307
    And exactly one ADW run was started for issue 9308
    And the ADW run started for issue 9308 runs the orchestrator "adws/adwChore.tsx"

  @adw-932 @adw-xs9x3g-bug-adw-none-wins-on
  Scenario: Closing a dependency starts no run for the dependent carrying adw:none and still starts the other dependent
    Given a launch boundary for the repository "adw-fixture/void-932" whose providers record every call
    And issue 9309 in the recording tracker is in state "CLOSED"
    And the body of issue 9310 in the recording tracker reads:
      """
      Blocked by #9309
      """
    And issue 9310 in the recording tracker carries the label "adw:none"
    And the body of issue 9311 in the recording tracker reads:
      """
      Blocked by #9309
      """
    And issue 9311 in the recording tracker carries the label "adw:chore"
    When the webhook dispatches the closing of issue 9309 from that boundary
    Then no ADW run was started for issue 9310
    And the issue classifier was not consulted for issue 9310
    And exactly one ADW run was started for issue 9311
    And the ADW run started for issue 9311 runs the orchestrator "adws/adwChore.tsx"

  @adw-932 @adw-xs9x3g-bug-adw-none-wins-on
  Scenario: The cron's sweep of fresh issues passes over an issue carrying adw:none and still picks up its neighbour
    Given a launch boundary for the repository "adw-fixture/void-932" whose providers record every call
    And issue 9312 in the recording tracker carries the label "adw:none"
    And issue 9313 in the recording tracker carries the label "adw:feature"
    When the cron tick runs once from that boundary
    Then no ADW run was started for issue 9312
    And exactly one ADW run was started for issue 9313
    And the ADW run started for issue 9313 runs the orchestrator "adws/adwSdlc.tsx"

  @adw-932 @adw-xs9x3g-bug-adw-none-wins-on
  Scenario Outline: The cron does not take over an earlier workflow on an issue that now carries adw:none
    Given a launch boundary for the repository "adw-fixture/void-932" whose providers record every call
    And issue <optedOut> in the recording tracker carries the labels "adw:chore" and "adw:none"
    And issue <optedOut> has an earlier ADW workflow under adw id "none932-<optedOut>" recorded at workflowStage "<stage>" running "adws/adwChore.tsx"
    And issue <control> in the recording tracker carries the label "adw:chore"
    And issue <control> has an earlier ADW workflow under adw id "none932-<control>" recorded at workflowStage "<stage>" running "adws/adwChore.tsx"
    When the cron tick runs once from that boundary
    Then no ADW run was started for issue <optedOut>
    And exactly one ADW run was started for issue <control>
    And the ADW run started for issue <control> runs the orchestrator "adws/adwChore.tsx"

    Examples:
      | stage         | optedOut | control |
      | abandoned     | 9314     | 9315    |
      | phase_timeout | 9316     | 9317    |

  @adw-932 @adw-xs9x3g-bug-adw-none-wins-on
  Scenario: The cron does not dispatch the merge of an issue that now carries adw:none
    Given a launch boundary for the repository "adw-fixture/void-932" whose providers record every call
    And issue 9318 in the recording tracker carries the labels "adw:bug" and "adw:none"
    And issue 9318 has an earlier ADW workflow under adw id "none932-9318" recorded at workflowStage "awaiting_merge" running "adws/adwSdlc.tsx"
    And issue 9319 in the recording tracker carries the label "adw:bug"
    And issue 9319 has an earlier ADW workflow under adw id "none932-9319" recorded at workflowStage "awaiting_merge" running "adws/adwSdlc.tsx"
    When the cron tick runs once from that boundary
    Then no ADW run was started for issue 9318
    And exactly one ADW run was started for issue 9319
    And the ADW run started for issue 9319 runs the orchestrator "adws/adwMerge.tsx"

  # ── §2 CONFLICTING CLASSIFICATION LABELS ARE HANDLED EXACTLY AS BEFORE ─────────────────────

  @adw-932 @adw-xs9x3g-bug-adw-none-wins-on
  Scenario: An issue opened with two classification labels is still refused with a cleanup comment and starts no run
    Given a launch boundary for the repository "adw-fixture/void-932" whose providers record every call
    And issue 9320 in the recording tracker carries the labels "adw:bug" and "adw:feature"
    When the webhook dispatches the opening of issue 9320 from that boundary
    Then no ADW run was started for issue 9320
    And the boundary's issue tracker recorded a comment on issue 9320
    And the recorded comment on issue 9320 contains "conflicting"

  @adw-932 @adw-xs9x3g-bug-adw-none-wins-on
  Scenario: A ## Continue comment on an issue carrying two classification labels is still classified and started
    Given a launch boundary for the repository "adw-fixture/void-932" whose providers record every call
    And issue 9321 in the recording tracker carries the labels "adw:bug" and "adw:feature"
    When the webhook dispatches a "## Continue" comment on issue 9321 from that boundary
    Then exactly one ADW run was started for issue 9321
    And the issue classifier was consulted for issue 9321

  @adw-932 @adw-xs9x3g-bug-adw-none-wins-on
  Scenario: A dependent carrying two classification labels is still classified and started when its dependency closes
    Given a launch boundary for the repository "adw-fixture/void-932" whose providers record every call
    And issue 9322 in the recording tracker is in state "CLOSED"
    And the body of issue 9323 in the recording tracker reads:
      """
      Blocked by #9322
      """
    And issue 9323 in the recording tracker carries the labels "adw:bug" and "adw:feature"
    When the webhook dispatches the closing of issue 9322 from that boundary
    Then exactly one ADW run was started for issue 9323
    And the issue classifier was consulted for issue 9323

  @adw-932 @adw-xs9x3g-bug-adw-none-wins-on
  Scenario: The cron still passes over a fresh issue carrying two classification labels and picks up its neighbour
    Given a launch boundary for the repository "adw-fixture/void-932" whose providers record every call
    And issue 9324 in the recording tracker carries the labels "adw:bug" and "adw:feature"
    And issue 9325 in the recording tracker carries the label "adw:chore"
    When the cron tick runs once from that boundary
    Then no ADW run was started for issue 9324
    And exactly one ADW run was started for issue 9325
    And the ADW run started for issue 9325 runs the orchestrator "adws/adwChore.tsx"

  # ── §3 THE ADW LABELS ARE PROVISIONED UP FRONT ─────────────────────────────────────────────

  @adw-932 @adw-xs9x3g-bug-adw-none-wins-on
  Scenario Outline: The first webhook event from a repository defines every ADW label on it, whatever kind of event it is
    Given a launch boundary for the repository "<repository>" whose providers record every call
    When the webhook dispatches an "<event>" event with action "<action>" from that boundary
    Then the boundary's providers recorded each of these labels being defined on the repository:
      | label          |
      | adw:chore      |
      | adw:bug        |
      | adw:feature    |
      | adw:pr_review  |
      | adw:upgrade    |
      | adw:none       |
      | adw:unverified |
      | adw:blocked    |

    Examples:
      | repository               | event               | action    |
      | adw-fixture/labels-a-932 | issues              | edited    |
      | adw-fixture/labels-b-932 | issue_comment       | created   |
      | adw-fixture/labels-c-932 | pull_request_review | submitted |

  @adw-932 @adw-xs9x3g-bug-adw-none-wins-on
  Scenario: A later event from a repository the webhook has already provisioned defines no label again
    Given a launch boundary for the repository "adw-fixture/labels-d-932" whose providers record every call
    When the webhook dispatches an "issue_comment" event with action "created" from that boundary
    Then the boundary's providers recorded each of these labels being defined on the repository:
      | label          |
      | adw:chore      |
      | adw:bug        |
      | adw:feature    |
      | adw:pr_review  |
      | adw:upgrade    |
      | adw:none       |
      | adw:unverified |
      | adw:blocked    |
    When the webhook dispatches an "issues" event with action "edited" from that boundary
    Then the boundary's providers recorded no label being defined during that event

  @adw-932 @adw-xs9x3g-bug-adw-none-wins-on
  Scenario: The webhook provisions each repository on that repository's first event, not only the first repository it hears from
    Given the webhook has already dispatched an "issue_comment" event with action "created" from the repository "adw-fixture/labels-first-932"
    And a launch boundary for the repository "adw-fixture/labels-e-932" whose providers record every call
    When the webhook dispatches an "issue_comment" event with action "created" from that boundary
    Then the boundary's providers recorded each of these labels being defined on the repository:
      | label          |
      | adw:chore      |
      | adw:bug        |
      | adw:feature    |
      | adw:pr_review  |
      | adw:upgrade    |
      | adw:none       |
      | adw:unverified |
      | adw:blocked    |

  @adw-932 @adw-xs9x3g-bug-adw-none-wins-on
  Scenario: A repository whose tracker cannot define labels still has its events handled
    Given a launch boundary for the repository "adw-fixture/labels-refusing-932" whose providers record every call
    And the recording tracker refuses to define labels
    And issue 9326 in the recording tracker carries the label "adw:bug"
    When the webhook dispatches a "## Continue" comment on issue 9326 from that boundary
    Then the boundary's providers were asked to define the label "adw:none"
    And exactly one ADW run was started for issue 9326
    And the ADW run started for issue 9326 runs the orchestrator "adws/adwSdlc.tsx"

  # ── §4 A MAJOR-UPGRADE ISSUE IS ROUTED BY ITS LABEL ────────────────────────────────────────

  @adw-932 @adw-xs9x3g-bug-adw-none-wins-on
  Scenario: An issue in the triage skill's major-upgrade format runs the orchestrator its adw label names, and the /adw_sdlc in its body selects nothing
    Given a launch boundary for the repository "adw-fixture/void-932" whose providers record every call
    And issue 9327 in the recording tracker is titled "depaudit: major upgrade — left-pad 1.3.0 → ^2.0.0 (resolves GHSA-3x7q-7vm4-9w5v)"
    And the body of issue 9327 in the recording tracker reads:
      """
      Major upgrade of left-pad from 1.3.0 to ^2.0.0 resolves GHSA-3x7q-7vm4-9w5v (high, OSV).

      /adw_sdlc
      """
    And issue 9327 in the recording tracker carries the label "adw:chore"
    When the webhook dispatches the opening of issue 9327 from that boundary
    Then exactly one ADW run was started for issue 9327
    And the ADW run started for issue 9327 runs the orchestrator "adws/adwChore.tsx"
    And the issue classifier was not consulted for issue 9327

  # ── §5 BACKSTOPS ────────────────────────────────────────────────────────────────────────────

  @adw-932 @adw-xs9x3g-bug-adw-none-wins-on
  Scenario: TypeScript type-check passes with the opt-out on every spawn path and the labels provisioned from the webhook
    Then the ADW TypeScript type-check passes

  @adw-932 @adw-xs9x3g-bug-adw-none-wins-on
  Scenario: The git/gh guard stays green with label provisioning on the webhook path
    When the git/gh guard is run across the repository
    Then the git/gh guard reports no violations
