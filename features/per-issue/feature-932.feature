@adw-932 @adw-xs9x3g-bug-adw-none-wins-on
Feature: adw:none stops every spawn path, a repository's cron defines every ADW label on it, and a major-upgrade issue is routed by its label

  Issue #932 implements three owner rulings that ADR-0041 (items 1 and 2) and ADR-0033 (item 1)
  record as divergences (`specs/adr/0041-label-based-classification.md`,
  `specs/adr/0033-depaudit-as-dependency-gate.md`):

    1. `adw:none` opts an issue out "entirely" (the PRD's word); on 2026-10-01 the owner ruled that
       it "always wins, on every path". Today only two functions read it: `decideIssueOpenedRoute`
       (`issues.opened`, from the labels the event carried) and `decideLabelRecovery`, which the
       cron filter's `evaluateIssue` consults on the truly fresh path only (no adwId, no stage). A
       `## Continue` comment, the closing of a dependency, the cron's takeover of an abandoned or
       timed-out workflow and the cron's merge hoist all start a run on an `adw:none` issue, and so
       does the opening of an issue whose `adw:none` lands just after the event was captured.
    2. `ensureAdwLabelsExist` (`adws/forge/adwLabelProvisioning.ts`) has no caller. A repository
       gets an `adw:*` label only when ADW applies one itself (`applyLabel` creates a missing label
       first), so a person cannot pick `adw:none` from the label menu until something created it.
    3. The `depaudit-triage` skill writes `/adw_sdlc` into the body of a major-upgrade issue. Since
       ADR-0041 the body selects nothing; the skill must apply an `adw:*` label instead.

  The issue also says what must NOT change: conflicting classification labels are refused on
  `issues.opened` and by the cron, and left to the classifier on every other path (ADR-0041,
  More Information, settled by the owner on 2026-10-01).

  The plan (`specs/issue-932-adw-xs9x3g-bug-adw-none-wins-on-sdlc_planner-adw-none-gate-label-provisioning.md`)
  gates the opt-out in `classifyAndSpawnWorkflow` on a live label read, drops an opted-out issue in
  the cron filter at every stage, and provisions the label catalogue when a repository's cron
  starts. Every row below holds for that design; §3 is written against it.

  The scenario groups further down (§1–§5):

    §1  `adw:none` STARTS NO RUN, ON ANY PATH (AC1). `issues.opened`, including an `adw:none` that
        lands after the opening event; a `## Continue` comment, on a fresh issue and on one with an
        earlier workflow; the closing of a dependency; the cron's fresh sweep, its takeover and its
        merge hoist. Every path has a positive control that does start a run, so no "no run"
        assertion can pass because nothing was observable.

    §2  CONFLICTING CLASSIFICATION LABELS ARE HANDLED EXACTLY AS BEFORE. Refused on
        `issues.opened` and by the cron; classified and started on the comment and
        dependency-closure paths.

    §3  THE ADW LABELS ARE PROVISIONED UP FRONT (AC2). A cron launched for a repository (the webhook
        launches one on that repository's first event) defines every label of the ADW label
        catalogue on that repository, and a forge that refuses does not stop the cron.

    §4  A MAJOR-UPGRADE ISSUE IS ROUTED BY ITS LABEL (the executable half of AC3).

    §5  BACKSTOPS. Type-check and the git/gh guard.

  Each row is written to fail for a reason, not to restate a criterion:
    • RED TODAY: the comment, dependency-closure, cron-takeover and cron-merge rows of §1, the §1
      opening whose label lands after the event, and both §3 rows. Each of those paths starts a
      run on an `adw:none` issue today, and no cron defines a label;
    • the rows that put `adw:none` beside a classification label fail for a fix that lets a single
      `adw:<type>` label win. `classifyIssueForTrigger` returns the label's classification before
      anything else, and a takeover never reaches it;
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
    • the late-label opening fails for a fix that reads only the labels the event carried. The
      docs-index sweep (`adws/triggers/docsIndexSweepDefaults.ts`) files its report issue and only
      then labels it `hitl` and `adw:none`, so that issue's opening event carries no label. Its
      "no label applied" also fails for a fix that checks only after the inferred label is
      written back;
    • the other `issues.opened` rows and the cron's fresh-sweep row are GREEN TODAY and must stay
      green. The opened row with `adw:none` beside two classification labels fails for a fix that
      moves the opt-out out of the opened router into a shared check that runs after the router's
      conflict refusal: the cleanup comment would then be posted on an opted-out issue;
    • §2 is GREEN TODAY and must stay green. A shared check that also refuses conflicts fails the
      comment and dependency-closure rows. One that also sends conflicts to the classifier fails
      the opened and cron rows. A deterministic tie-break fails "the issue classifier was
      consulted";
    • §3: the launch row fails for provisioning hooked only onto the webhook's request path or
      into `adw_init`, and for provisioning against any repository but the cron's own. The
      refusing-forge row fails for provisioning that lets a refusal escape (the cron would die
      before its first poll) and for provisioning that gives up at the first refused label;
    • §4 is GREEN TODAY and must stay green. Its first row pins the routing the corrected skill
      relies on: `adw:bug` applied at creation runs `adws/adwSdlc.tsx` with no classification call
      and no label written back, so the issue never gains a second classification label. Its
      second row fails for a fix that repairs the triage path on ADW's side, by teaching ADW to
      read orchestrator commands in an issue body again, which ADR-0041 removed on purpose. That
      row's label (`adw:chore`) deliberately differs from what the body's `/adw_sdlc` asks for, so
      the row can tell which of the two decided.

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

  F1  "ONE PLACE THAT ALL PATHS PASS THROUGH".
      `classifyIssueForTrigger`'s docblock calls it "the sole chokepoint all four trigger paths
      (cron, issues.opened, issue_comment, dependency-closure) share", but it is skipped whenever
      the classification is already known (the opened route and the cron's single-label fresh
      path pass one in) and on every takeover. `classifyAndSpawnWorkflow` is the function all four
      paths call, yet the cron's takeover branch and merge hoist launch without it. The plan
      therefore gates there, on a live `fetchLabels` read before `evaluateCandidate`, and also
      drops an opted-out issue in the cron filter's `evaluateIssue` at every stage. The rows pin
      the behaviour on every path, not where the check sits.

  F2  PROVISIONING HAPPENS WHEN A REPOSITORY'S CRON STARTS.
      The issue allows `adw_init` or the first webhook. The plan calls the provisioning from the
      entry-script block of `adws/triggers/trigger_cron.ts`, because the webhook starts one cron
      per repository on that repository's first event (`ensureCronProcess`, unchanged). That keeps
      eight synchronous `gh label create` calls off the webhook's request path and its 10-second
      delivery timeout. `adw_init` was not chosen: it now runs only inside `adwUpgrade`, which the
      upgrade gate launches for target repositories after a workflow has started on an issue. §3
      therefore launches a real cron process. The self-host cron (no `--target-repo`) provisions
      ADW's own repository the same way; no row exercises it, because it would act on a real
      repository.

  F3  A FORGE MAY REFUSE TO CREATE A LABEL.
      `JiraIssueTracker.ensureLabel` throws "not implemented", and the GitHub adapter throws when
      `gh label create` fails. `ensureAdwLabelsExist` contains each label's failure; whatever calls
      it must contain the rest (the boundary's `providers` getter can throw too), or the cron of
      such a repository dies at start and stops sweeping it.

  F4  THE TRIAGE SKILL FILES ITS ISSUE ON ADW'S OWN REPOSITORY, LABELLED AT CREATION.
      The skill is `target: false`, so it is never copied into a target repository, and it files on
      the current repository. `gh issue create --label` refuses a label the repository does not
      define, so the plan has the skill create the label first (`gh label create … --force`) and
      then pass `--label adw:bug` to `gh issue create`. `adw:bug` routes to `adws/adwSdlc.tsx`, the
      full SDLC the PRD wants for a breaking upgrade; `adw:chore` would route to
      `adws/adwChore.tsx`, whose diff gate can auto-merge. The label goes in the create call: ADW
      reads labels from the opening event, and an issue opened without one gets an inferred label
      written back, which a later label would conflict with.

  F5  NOT PINNED HERE.
      The `## Retry` and `## Cancel` directives (ADR-0032) and the `adw:upgrade` route at the top
      of `classifyAndSpawnWorkflow` are not among the issue's four paths. Under the plan,
      `adw:none` is read before `adw:upgrade`, so a comment no longer drives an `#UPG` issue that
      someone labelled `adw:none`, and the cron holds the merge of an `adw:none` issue that a
      `## Retry` reset to `awaiting_merge`. No row decides either.

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
      and creation/update times, served consistently by `fetchIssue` (an empty body and no
      comments today), `fetchComments`, `getIssueState` and `listIssues` (which returns [] today).
      `listIssues` lists every seeded issue not in state "CLOSED", in seeding order, with `labels`
      as `{ name }` objects and with its comments. Anything not seeded keeps today's answer, so the
      features that already use the tracker are unaffected.
    • NEVER LAUNCH A REAL ORCHESTRATOR. Every launch on the §1, §2 and §4 paths goes through `bunx`
      on PATH: `spawnDetached` for fresh spawns and takeovers, and the cron merge hoist's own
      `spawn('bunx', …)`. Shadow `bunx` with a recorder that logs its full argv and exits at once,
      and restore PATH in `After`. The shadow behind `enableBunxRelaunchIntercept`
      (`features/regression/step_definitions/feature-902-queue.steps.ts`) is the precedent, but it
      stays alive and drops the script from its record, so it cannot be reused as it is. A launch
      belongs to issue N when the first argument after the script is N. Compare scripts
      repo-relative, because `spawnDetached` and the merge hoist absolutise `adws/…` against
      REPO_ROOT.
    • NEVER CALL THE REAL CLAUDE CLI. Several RED rows reach `/classify_issue` today. For every
      `@adw-932` row, point `CLAUDE_CODE_PATH` at a recording wrapper around
      `test/mocks/claude-cli-stub.ts`: save and restore the variable and call
      `clearClaudeCodePathCache()`, as feature-820's steps do. The wrapper logs its argv (the
      prompt is the last argument) to a path fixed in the wrapper itself, because the agent's
      environment does not carry `MOCK_*` variables. "consulted for issue N" means a recorded
      invocation whose prompt names `/classify_issue` and `#N`. Which classification the stub
      answers is never asserted: an answer the classifier cannot parse defaults to `/feature`,
      which still starts one run.
    • THE WEBHOOK ROWS drive the real `dispatchWebhookEvent` with a mint override that returns the
      recording boundary, as feature-908's webhook row does. Every payload names the boundary's
      repository and carries the issue's title, body and labels exactly as the recording tracker
      holds them, so a fix that reads labels from the payload and one that reads them from the
      tracker see the same thing. The one exception is the opening "with no labels in the event",
      whose payload carries an empty label list. Neutralise `ensureCronProcess` by registering this
      process's PID for the repository first (`writeCronPid`) and remove the registration in
      `After`. Save, remove and restore `agents/.auth_gate`, or the webhook ignores the event, and
      `GITHUB_WEBHOOK_SECRET`, or the unsigned payload is refused with a 401. The opened, comment
      and closed branches finish asynchronously: wait, bounded, for the handling to settle before
      asserting, and let a negative launch assertion wait the same bounded period.
    • ISSUE NUMBERS ARE DISTINCT ON PURPOSE. `shouldTriggerIssueWorkflow` ignores a second
      `issues.opened` or `## Continue` for the same issue number within 60 s; the cron keeps a
      process-wide `processedSpawns` set; spawn locks are keyed by issue. A number reused across
      rows makes a later row ignore its event, and its negative assertions then pass vacuously.
    • THE CRON ROWS of §1 and §2 call the exported `checkAndTrigger(boundary)` with the recording
      boundary. Seed every issue's `createdAt` and `updatedAt` well before `GRACE_PERIOD_MS`
      (5 minutes) ago, or the filter drops it as `grace_period` and the controls fail. The tick
      also runs the pause-queue scan, the auth-queue scan and the periodic sweeps against the
      checkout's real `agents/` directory: save and empty `agents/paused_queue.json` around it, as
      feature-908 does, and keep the `bunx` shadow active for the whole tick. The tick counter is
      process-wide: every fifth tick also runs the hung-orchestrator sweep (harmless here, because
      no seeded state pairs a `*_running` stage with a pid) and a fifteenth would run the
      dev-server janitor, so keep this feature's ticks well under fifteen. Locks land under two
      identities: `evaluateCandidate` keys the spawn lock by the boundary's repository, while the
      cron's merge-dispatch gate and its own lock releases use the cron module's identity (under
      import, the checkout's repository). Remove the locks under both in `After`.
    • "issue N has an earlier ADW workflow under adw id X recorded at workflowStage S running P"
      seeds a comment carrying `**ADW ID:** \`X\`` and no stage heading, visible to
      `fetchComments`, to `fetchIssue` and to the comments `listIssues` returns. It also writes the
      top-level state through `AgentStateManager.writeTopLevelState`: the adw id, the issue number,
      the stage, `P` as `orchestratorScript` and the boundary's repository as `repoIdentity`, with
      no phases, no pid and no branch name, so a takeover recovers without probing a worktree. Use
      only lowercase letters, digits and hyphens in an adw id. Remove `agents/<adwId>` in `After`.
    • §3 LAUNCHES A REAL CRON. "a cron trigger process is launched with --target-repo R" spawns the
      real `bunx tsx adws/triggers/trigger_cron.ts --target-repo R` through `spawnRealCron`
      (`features/regression/step_definitions/realCronProcess.ts`, the helper behind the registry's
      W-PQ5) with its own `RealCronWorld`, a throwaway `TARGET_REPOS_DIR` and, first on the PATH it
      passes in `extraEnv`, a recording `gh` shadow. The `bunx` shadow must not be on PATH at that
      moment, or it swallows the cron launch. The `gh` shadow records the argv of every
      `gh label create`, answers `gh auth token` with a fake token and exits 0 with no output for
      everything else, as `createGhMockDir` does; after "the forge refuses to create labels" it
      records `gh label create` and exits 1. The forge adapter hands `gh` the cron's whole
      environment, so the shadow can find its log path there. "the repository R has each of these
      labels" waits, bounded (20 s), until the shadow has recorded `gh label create '<label>'
      --repo R … --force` for every row; "was asked to create" means the same record, refused or
      not; "completes its first poll tick" waits, bounded, for the cron's `POLL:` or
      `checkAndTrigger: tick failed` line, as W-PQ5 does. Kill the cron with `killRealCronWorld` in
      an `@adw-932` `After` hook. Write the two `--target-repo` phrases as literal text, as W-PQ5's
      definition does: cucumber's snippet generator reads their first dash as a `{float}`.
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
      pending in `whenSteps.ts`, and W14 (`the cron poll batch runs`), which has no definition;
    • the registry's W-PQ5 (`a cron trigger process launched with --target-repo {string} completes
      its first probing poll tick`). Its world and its cleanup hook belong to `@adw-911`, so an
      `@adw-932` row would leave its cron running; it also sets `PROBE_INTERVAL_CYCLES` and replays
      pause-queue comments, which §3 does not need. §3's launch and poll-tick phrases follow its
      wording.
  The registry has no phrase for any of the following, so novel phrasing is introduced for them:
    • dispatching an opening (with or without its labels in the event), a comment or a closing
      through the webhook from the recording boundary, and running one cron tick from it;
    • seeding a third label, an issue body, an issue state and an earlier workflow;
    • asserting the ADW runs started for an issue and the orchestrator a run executes;
    • asserting whether the issue classifier was consulted;
    • launching a real cron for a repository, a forge that refuses to create labels, the labels a
      repository has, the labels the forge was asked to create, and a cron's first poll tick.

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
  Scenario: An issue labelled adw:none just after it was opened starts no run, although its opening event carried no label
    Given a launch boundary for the repository "adw-fixture/void-932" whose providers record every call
    And issue 9328 in the recording tracker carries the label "adw:none"
    When the webhook dispatches the opening of issue 9328 from that boundary with no labels in the event
    Then no ADW run was started for issue 9328
    And the issue classifier was not consulted for issue 9328
    And the boundary's providers recorded no label applied to issue 9328

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
  Scenario: A cron launched for a repository defines every label of the ADW label catalogue on that repository
    When a cron trigger process is launched with --target-repo "adw-fixture/labels-932"
    Then the repository "adw-fixture/labels-932" has each of these labels:
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
  Scenario: A cron whose forge refuses to create labels still asks for every one of them and goes on to poll its repository
    Given the forge refuses to create labels
    When a cron trigger process is launched with --target-repo "adw-fixture/labels-refused-932"
    Then the forge was asked to create each of these labels on the repository "adw-fixture/labels-refused-932":
      | label          |
      | adw:chore      |
      | adw:bug        |
      | adw:feature    |
      | adw:pr_review  |
      | adw:upgrade    |
      | adw:none       |
      | adw:unverified |
      | adw:blocked    |
    And the cron trigger process launched with --target-repo "adw-fixture/labels-refused-932" completes its first poll tick

  # ── §4 A MAJOR-UPGRADE ISSUE IS ROUTED BY ITS LABEL ────────────────────────────────────────

  @adw-932 @adw-xs9x3g-bug-adw-none-wins-on
  Scenario: A major-upgrade issue filed with adw:bug and no command in its body runs the full SDLC without a classification call or a label written back
    Given a launch boundary for the repository "adw-fixture/void-932" whose providers record every call
    And issue 9327 in the recording tracker is titled "depaudit: major upgrade — left-pad 1.3.0 → ^2.0.0 (resolves GHSA-0000-0932-0001)"
    And the body of issue 9327 in the recording tracker reads:
      """
      Major upgrade of left-pad from 1.3.0 to ^2.0.0 resolves GHSA-0000-0932-0001 (high, OSV).

      Originating finding: GHSA-0000-0932-0001 in left-pad 1.3.0, reported by depaudit scan.
      """
    And issue 9327 in the recording tracker carries the label "adw:bug"
    When the webhook dispatches the opening of issue 9327 from that boundary
    Then exactly one ADW run was started for issue 9327
    And the ADW run started for issue 9327 runs the orchestrator "adws/adwSdlc.tsx"
    And the issue classifier was not consulted for issue 9327
    And the boundary's providers recorded no label applied to issue 9327

  @adw-932 @adw-xs9x3g-bug-adw-none-wins-on
  Scenario: A /adw_sdlc left in a major-upgrade issue's body selects nothing; the issue's adw label decides the orchestrator
    Given a launch boundary for the repository "adw-fixture/void-932" whose providers record every call
    And issue 9329 in the recording tracker is titled "depaudit: major upgrade — minimist 0.0.8 → ^1.2.6 (resolves GHSA-0000-0932-0002)"
    And the body of issue 9329 in the recording tracker reads:
      """
      Major upgrade of minimist from 0.0.8 to ^1.2.6 resolves GHSA-0000-0932-0002 (critical, OSV).

      /adw_sdlc
      """
    And issue 9329 in the recording tracker carries the label "adw:chore"
    When the webhook dispatches the opening of issue 9329 from that boundary
    Then exactly one ADW run was started for issue 9329
    And the ADW run started for issue 9329 runs the orchestrator "adws/adwChore.tsx"
    And the issue classifier was not consulted for issue 9329

  # ── §5 BACKSTOPS ────────────────────────────────────────────────────────────────────────────

  @adw-932 @adw-xs9x3g-bug-adw-none-wins-on
  Scenario: TypeScript type-check passes with the opt-out on every spawn path and the labels provisioned at cron start
    Then the ADW TypeScript type-check passes

  @adw-932 @adw-xs9x3g-bug-adw-none-wins-on
  Scenario: The git/gh guard stays green with label provisioning at cron start
    When the git/gh guard is run across the repository
    Then the git/gh guard reports no violations
