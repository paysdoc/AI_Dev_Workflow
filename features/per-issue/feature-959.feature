@adw-959 @adw-r5ifl5-bug-an-orchestrator @promotion-suggested-2026-10-04
Feature: A workflow whose orchestrator died in starting or in any running stage is taken over by the cron's next poll under its adwId — a live orchestrator is never killed, reset or doubled, a spawn lock the cron itself left behind never holds a dead workflow hostage, and an orchestrator that dies during startup says why in its execution log

  Issue #959. On 2026-10-02 at 00:15:42 UTC the cron relaunched the workflow of #935 (adwId
  `gyxjcf-bug-repair-the-regre`) after a `phase_timeout`. The relaunched orchestrator (pid 80620)
  recorded `workflowStage: 'starting'`, wrote `Allocated port 57665 for dev server` to its
  execution log and exited without another word: the cron launches orchestrators with their
  output discarded. More than six hours later nothing had picked the issue up again, with 2 of 5
  concurrency slots in use. The top-level state still read `starting`, still carried the previous
  run's `lastSeenAt`, and had no `pid`. The issue's spawn lock was recorded under pid 41399, the
  cron itself, with `startedAt` 00:15:44, two seconds after the relaunch.

  Why nothing recovers it today:
    • The cron filter (`evaluateIssue`, `adws/triggers/cronIssueFilter.ts`) drops every stage
      that `classifyStageString` classes `active`, whether or not its orchestrator is alive. That
      is `starting` and every `*_running` stage, dynamic ones such as `stepDef_running` included.
      The takeover handler's branch 8 (an `active` stage with a dead pid → worktree reset →
      remote reconcile → `take_over_adwId`) is never reached.
    • The hung-orchestrator sweep (`findHungOrchestrators`) considers only `*_running` stages and
      reads `pid` and `pidStartedAt` from the top-level state. `initializeWorkflow` writes `pid`
      only into the orchestrator's own sub-state, and no state file carries `pidStartedAt` at all
      (only the spawn lock records a start time), so today the sweep never reports anything. By
      design it also passes over a dead pid: it hunts live, wedged orchestrators.
    • `## Retry` acts only on paused and human-gated stages (feature-908).
    • The spawn lock. `evaluateCandidate` takes the issue's spawn lock under the cron's own pid
      and releases it only on its normal exits. Nothing releases it when a step in between
      throws (a worktree reset, a remote read, a comment). The lock then stays recorded under a
      live pid, the cron's, for as long as the cron runs. Every later candidate for the issue is
      deferred to the cron itself, and an orchestrator that reaches the lock exits with "spawn
      lock already held by another orchestrator", a line only its discarded output sees. The lock
      left on #935 fits: the cron's pid, taken two seconds after the relaunch, most likely while
      the relaunched orchestrator was still starting up.

  `starting` is not a short stage. Only a named phase writes a `*_running` stage, and the
  orchestrators name almost none: `adwPlanBuildReview` names no phase, and `adwSdlc`, `adwChore`
  and `adwPlanBuildTestReview` name only `stepDef`. A healthy orchestrator therefore sits in
  `starting` through install, plan and build, often for hours. Recovery must decide on whether
  the orchestrator is alive, never on how long its stage has lasted. For a few seconds after it
  records `starting`, a live orchestrator also holds no spawn lock and runs no heartbeat, and
  its state still carries the previous run's `lastSeenAt`.

  What #959 changes, as behaviour. The issue leaves the mechanism open, and so do these
  scenarios: the cron filter may pass an `active` stage on to `evaluateCandidate` once its
  orchestrator is confirmed dead, or the hung-orchestrator sweep may cover `starting` and read
  liveness from wherever the pid lives.
    • A workflow whose orchestrator died in `starting` or in any running stage is taken over by
      the cron under its own adwId. The cron relaunches the orchestrator the state records, and
      it needs no restart to do so.
    • Liveness is decidable for `starting`: the orchestrator's pid and start time are recorded
      when `starting` is written, or resolved from its sub-state or the spawn lock.
    • A live orchestrator is never killed, never has its worktree reset, never gets a second
      orchestrator beside it, and is never left facing a spawn lock the cron took and kept.
    • A spawn lock recorded under the cron's own pid is not a live holder for an issue whose
      orchestrator is dead.
    • An orchestrator that throws during startup writes the error into its own execution log,
      `agents/<adwId>/<orchestrator>/execution.log`, the file the operator read for #935.

  The labels below are the section numbers used for the scenario groups further down (§1–§6):

    §1  A DEAD ORCHESTRATOR IS TAKEN OVER (AC1, AC3). One poll takes over a workflow whose
        relaunched orchestrator recorded `starting` and died before its first phase, as #935's
        did. It relaunches the orchestrator the state records, under the same adwId. One poll
        also takes over an orchestrator that died later and left its spawn lock behind: in
        `starting` (running a phase anonymously), in `build_running`, or in the dynamic
        `stepDef_running`.

    §2  A LIVE ORCHESTRATOR IS LEFT ALONE (AC2). None of these is killed, reset or doubled, or
        left facing a lock the cron kept: a relaunched orchestrator still starting up; one that
        records `starting` while the cron is deciding; one that holds its lock and heartbeats in
        `starting` or in `build_running`. A spawn lock held by another live process still turns
        the cron away, and an issue that now carries `adw:none` is still never taken over. A PR
        review on the issue's own adwId, ten minutes into `pr_review_build_running`, whose state
        still recorded the finished SDLC run's dead pid, is not reset and gets no second
        orchestrator.

    §3  THE CRON'S OWN SPAWN LOCK (the issue's unverified factor, confirmed by reading the code).
        A lock recorded under the cron's own pid, left behind by an earlier poll, does not stop
        the cron from taking over an `abandoned`, a `phase_timeout` or a dead `starting` workflow.

    §4  REPLAYING #935 (AC3). The same cron, never restarted, relaunches a timed-out workflow.
        The relaunched orchestrator records `starting` exactly as #935's did, with no pid in the
        top-level state, and dies; the cron's pid is left on the issue's spawn lock. The cron's
        next poll relaunches the workflow under the same adwId.

    §5  NO SILENT DEATHS (AC4). An orchestrator launched as the cron launches it, with its output
        discarded, that throws during startup writes the error into its own execution log and
        exits 1. A log that already holds an earlier run's lines keeps them.

    §6  BACKSTOPS. The type-check and the git/gh guard.

  Each row is written to fail for a specific wrong implementation:
    • every §1 row is RED today, because the filter drops every `active` stage. The script rows
      fail for a recovery that relaunches a default orchestrator, or that starts the issue afresh
      under a new adwId. The `stepDef_running` row fails for a fix that lists literal stages
      instead of using the `active` class. The rows past the spawn lock fail for a fix that
      recovers only an orchestrator that died before taking it;
    • the still-starting row fails for a fix that reads death from a missing spawn lock, a
      missing heartbeat or a stale `lastSeenAt`. A live orchestrator that is still starting up
      shows all three, unless the fixed startup itself takes or refreshes them first;
    • the row that records `starting` while the cron is deciding fails for a takeover handler
      that treats a live `starting` orchestrator like a live running one. Branch 7 sends SIGKILL
      to a live pid that does not hold the lock, then resets the worktree. The filter and the
      takeover handler read the state seconds apart, so a live `starting` orchestrator reaches the
      handler whatever the filter decides, and the webhook path reaches it with no filter at all.
      Today that pid is missing and the handler resets and relaunches; once the pid is recorded,
      branch 7 would kill instead. This row stops a fix from trading the one for the other;
    • both of those rows fail for a fix that defers but keeps the lock it took. The orchestrator
      then finds the lock held by the cron and exits, the most likely way #935's orchestrator died;
    • the heartbeating rows fail for a sweep that treats a long `starting` as hung, or that kills
      a live orchestrator whose heartbeat is fresh;
    • the PR-review row fails for a PR review that does not record itself as owner. It reuses the
      issue's adwId, whose state still records the finished SDLC run's dead pid, so the cron
      reads the live review as dead, resets the worktree it is editing and relaunches
      `adws/adwPrReview.tsx` beside it. It also fails for a fix that records the pid only where
      none is recorded;
    • the foreign-lock row fails for a fix that ignores the spawn lock once the state's own pid
      is dead. The holder may be a merge orchestrator, or a run the webhook is starting;
    • the `adw:none` row fails for a recovery path that relaunches past the cron's opt-out gate.
      Its control half is RED today;
    • every §3 row is RED today: `acquireIssueSpawnLock` reads the cron's own pid as a live holder,
      and the decision is `defer_live_holder`. The `abandoned` and `phase_timeout` rows separate
      the lock from the filter, which already passes those stages. The flagged feature-912
      candidate row (below) fails for a fix that discounts every lock recorded under the caller's
      own pid without checking that the orchestrator is dead;
    • the §4 replay is RED today. It fails for a fix that leaves out any one of three parts: the
      filter, the cron's own lock, or a `starting` state with no pid in the top-level state. A fix
      that decides liveness only from a pid it newly records there leaves #935 itself stranded,
      because #935's state predates that field, and #935 must come back without anyone editing
      its state. The replay also fails for a fix that works only in a freshly started cron;
    • every §5 row is RED today: `main()` has no catch, so the rejection goes to a discarded
      stderr. The rows fail for a fix in one orchestrator script only, and for a handler installed
      only once `initializeWorkflow` has returned (the pre-flight check throws before that). They
      fail for a fix that writes the error anywhere but the orchestrator's own execution log. The
      earlier-run row fails for a fix that rewrites the log instead of appending to it.

  ── WHY SOME CRITERIA GET NO SCENARIO OF THEIR OWN, AND WHAT IS NOT SPECIFIED HERE ──────────
  AC1 and AC2 ask for unit tests. The vitest suite discharges them in the build and test phases;
  §1 and §2 are their behavioural counterparts. Not specified here:
    • the `.claude/` assets that #935's relaunched orchestrator copied over its worktree from a
      stale checkout. The issue suggests a separate issue for it, and no row here mentions
      `.claude/`;
    • an orchestrator that is alive but wedged in `starting`. The issue asks for dead ones. No
      row asks the sweep to kill one; §2 only forbids killing a live one whose heartbeat is fresh
      or has not started yet;
    • a workflow whose orchestrator dies in a `*_completed` stage. `stepDef_completed` stays in
      place from the step-definition phase to the end of the run, because every later phase runs
      anonymously, but `classifyStageString` classes it `resumable`, not `active`, so the cron
      still drops it as `adw_stage:stepDef_completed`;
    • how often the cron may relaunch a workflow whose orchestrator keeps dying in `starting`.
      Today's resume cap (`MAX_RESUME_ATTEMPTS`) counts only `phase_timeout` recoveries;
    • the seconds between a relaunch and the relaunched orchestrator recording `starting`, while
      its state still shows the stage it was relaunched from;
    • the exit through "spawn lock already held by another orchestrator". It is a deliberate
      `process.exit(0)`, not a thrown error, so the issue's minimum does not cover it. §2 and §3
      remove the way the cron caused it.

  FLAGGED BY THIS ISSUE. Four existing rows now also carry `@adw-959`. Each guards behaviour next
  to the code this issue changes, and none of the rows changes:
    • feature-908, "`## Retry` on a running stage does nothing …": `## Retry` stays a no-op on
      every running stage, `starting` included. #959 recovers a dead `starting` through the cron,
      not through the directive;
    • feature-912, the hung-orchestrator detector outline: a live orchestrator whose heartbeat is
      fresh is never reported;
    • feature-912, the waiting-orchestrator candidate row. Its harness runs the orchestrator and
      the candidate in one process, so the lock is recorded under the candidate's own pid while
      the orchestrator lives. The candidate must still defer;
    • feature-912, the death row: an orchestrator that died in a running stage is still taken
      over under its adwId by the takeover handler alone.

  How these scenarios observe the system. Every assertion targets a runtime artefact:
    • the orchestrator launches the cron makes, recorded by a `bunx` shadow;
    • the top-level state file `agents/<adwId>/state.json`;
    • the spawn-lock record under `agents/spawn_locks/`;
    • whether the processes that stand in for orchestrators are still alive;
    • the worktree resets requested of the launch boundary's git context;
    • the orchestrator's execution log, `agents/<adwId>/<orchestrator>/execution.log`, and the
      exit code of the orchestrator process.
  No scenario reads, greps or parses a source file.

  Notes for the step definitions:

    • THE CRON ROWS reuse feature-932's harness. "a launch boundary for the repository … whose
      providers record every call" is feature-796's recording boundary (`world796()`), whose
      tracker feature-932 extended to serve bodies, comments, states, timestamps and
      `listIssues`. A poll calls the exported `checkAndTrigger(boundary)`, as feature-932's cron
      rows do. Save and empty `agents/paused_queue.json`, and save, remove and restore
      `agents/.auth_gate`: with a gate set, the tick returns before it looks at any issue.
    • "with its hung-orchestrator sweep due" first runs `runHungDetectorSweep` over this
      scenario's adwIds only, through the deps seam it exposes (list only those adwIds; read state
      and liveness as production does). It then runs one `checkAndTrigger(boundary)`. Never sweep
      the whole `agents/` directory. "the same cron polls again" does the same in the same
      process. trigger_cron's module state (`processedSpawns`, the tick counter) lives on between
      the two polls, which is what "never restarted" means here.
    • NEVER LAUNCH A REAL ORCHESTRATOR FROM A CRON ROW. Shadow `bunx` on PATH with a recorder that
      logs its full argv and exits at once, as feature-932 does. A launch belongs to issue N when
      the first argument after the script is N. Compare scripts repo-relative, because
      `spawnDetached` absolutises them. "the cron launched no orchestrator" waits a short bounded
      period before it concludes.
    • THE WORKFLOW. "issue N has an ADW workflow under adwId X that runs S, whose last run stopped
      at T half an hour ago" seeds issue N in the recording tracker, created and updated well over
      `GRACE_PERIOD_MS` ago, with a comment carrying `**ADW ID:** \`X\``. It adds to an issue
      another step seeded and never clears its labels. It writes the top-level state a run leaves,
      through `AgentStateManager.writeTopLevelState`: the adwId, the issue number, stage T, S as
      `orchestratorScript`, the boundary's repository as `repoIdentity`, a `branchName`, a
      `lastSeenAt` half an hour old, phase entries whose times are at least half an hour old, no
      `resumeAttempts` (a `phase_timeout` take-over then stays under the resume cap), and no pid.
      Use only lowercase letters, digits and hyphens in an adwId. Keep each scenario's
      workflows under `MAX_CONCURRENT_PER_REPO`. Remove `agents/<adwId>` in `After`.
    • PROCESSES. A dead orchestrator is a short-lived child: capture its pid and start token
      (`getProcessStartTime`) while it lives, then kill it and wait for it to exit. A live
      orchestrator is a throwaway long-lived child, killed in `After`. Never write a made-up pid.
    • MIRROR THE FIXED STARTUP. "recorded "starting"" and "is alive and still starting up" write
      what the real `initializeWorkflow`, as this issue fixes it, has written once it has
      recorded `starting`, with the child's pid and start token. That is the top-level fields,
      every liveness record the fix adds (top-level `pid`/`pidStartedAt`, the orchestrator
      sub-state, or the spawn lock if the fixed startup takes it by then), the sub-state `pid`,
      and the execution-log lines. Read the fixed `initializeWorkflow` and copy what it does. Add
      nothing it does not write and leave out nothing it does, or the rows stop testing the fix.
      "died before its first phase" writes nothing after that; "still starting up" leaves the
      child running.
    • #935'S SHAPE. "records "starting" exactly as #935's relaunched orchestrator did" writes what
      `initializeWorkflow` wrote before this fix. In the top-level state: `workflowStage:
      'starting'`, the script, the repository and the branch name, merged over the previous state
      (its `lastSeenAt` stays), and no `pid` or `pidStartedAt`. In the orchestrator sub-state,
      `agents/<adwId>/sdlc-orchestrator/state.json`: the dead child's `pid`, with no start time.
      In the execution log: the startup lines, ending with `Allocated port 57665 for dev server`.
      No spawn lock is taken for it.
    • AFTER THE LOCK. "died at workflowStage S ten minutes ago, leaving the issue's spawn lock
      behind" mirrors the fixed startup with the dead child, then writes:
        – the stage S. For `X_running`, also the phase entry `phaseRunner` writes, with
          `status: 'running'` and a start at least ten minutes old; for `starting`, no phase entry;
        – a `lastSeenAt` ten minutes old;
        – the spawn-lock record `acquireIssueSpawnLock` wrote while the child lived: its pid and
          the start token captured then, under the boundary's repository.
      "is alive at workflowStage S, holding the issue's spawn lock and heartbeating" does the same
      with the live child, the lock taken under the child's pid, and a `lastSeenAt` of now.
    • RECORDING WHILE THE CRON DECIDES. The step arms a one-shot trigger. The trigger writes the
      still-starting artefacts (as above, with a live child) after the poll's filter has run and
      before the takeover handler reads the state. `checkIssueEligibility` asks the recording
      tracker for the concurrency check's issue listing between the two, which makes a convenient
      hook. Assert that the trigger fired.
    • LOCKS. "the cron's own process holds the spawn lock for issue N in the repository R" records
      the lock under this process's pid (`acquireIssueSpawnLock(R, N, process.pid)`), because the
      cron runs in this process here. Make it idempotent. After a take-over, trigger_cron releases
      the lock under the cron module's own identity (under import, the checkout's repository), not
      the boundary's, so a poll that took a workflow over leaves the boundary-repository lock under
      this pid. "nothing but the orchestrator of workflow X holds the issue's spawn lock" holds when
      there is no lock, or when the lock records that orchestrator's pid. Remove the locks under
      both identities in `After`, as feature-932 does.
    • WORKTREES. Wrap the boundary's `gitContext.resetWorktree` to record the call and do nothing
      else. Give benign answers to every other git call a take-over makes through that context
      (the worktree probe, and the remote-branch read behind `deriveStageFromRemote`). A take-over
      then never runs git against fixture paths and never throws half-way; a throw would leave a
      lock under this process's pid, which is the bug itself, and spoil later rows. "the worktree
      of workflow X was not reset" holds when no reset was recorded for X's branch or worktree.
    • THE EXECUTION-LOG ROWS launch the REAL script, never through the `bunx` shadow, the way the
      cron launches one: `bunx tsx <script> <issue> <adwId> --target-repo <repo>`, detached, with
      its stdio ignored, from the ADW checkout.
        – "the Claude CLI that ADW is configured to run exists but is not executable" points
          `CLAUDE_CODE_PATH`, in the child's environment, at an existing file without the execute
          bit, given as an absolute path (`.env` never overrides a variable that is already set).
          It also blanks the GitHub App variables. `initializeWorkflow`'s pre-flight check then
          throws before any forge or git access.
        – Wait, bounded, for the child to exit, and store its exit code in `lastExitCode`, which
          T5 reads. Remove `agents/<adwId>` before the launch and in `After`.
        – "records the error that stopped its startup" holds when the log has a line, written by
          this launch, that names the non-executable path; the pre-flight error names the path it
          rejected. "…, after the line L" also requires that line to come after L.
        – "already ends with the line L" seeds the log as `AgentStateManager.appendLog` writes it.
    • SAFETY.
        – The tick counter is process-wide, and feature-932's ticks count too. Every fifth tick
          also runs the real sweep over the working directory's whole `agents/` directory. Every
          fifteenth runs the dev-server janitor against `TARGET_REPOS_DIR`, which on a developer's
          machine holds real target-repository worktrees. Run the suite from a worktree, as ADW's
          test phase does, and make sure no janitor tick from this feature reaches real worktrees.
          Both cadences and `TARGET_REPOS_DIR` are read once, at import; `cucumber.js` already pins
          one such variable before any support code is imported.
        – Issue numbers are distinct on purpose: launches, locks and `processedSpawns` are keyed
          by issue across the whole run. The replay uses issue 9535, not 935. The cron module
          releases locks under the checkout's own identity, `paysdoc/AI_Dev_Workflow`, whose real
          issue #935 has a real lock file.
        – The repository `adw-fixture/void-959` does not exist and `acme/widgets` is fictional. No
          comment may reach GitHub.
    • HOOKS. Initialise `mockContext` in a `Before` hook, because T1 and T5 fall into a legacy
      source-inspection branch when it is null. Scope every hook to
      `@adw-959 and not @adw-908 and not @adw-912`, because the flagged rows run under their own
      harness. G-PQ14's holder process and lock are cleaned up only by feature-911's
      `@adw-911 or @pause-queue-ownership` `After` hook: widen that hook to `@adw-959`, or export
      its cleanup.

  Vocabulary note. These registered phrases from `features/regression/vocabulary.md` are reused:
    • G18     `the ADW codebase is checked out`
    • G-PQ14  `another live process holds the spawn lock for issue {int} in the repository {string}`
    • T1      `the state file for adwId {string} records workflowStage {string}`
    • T5      `the orchestrator subprocess exited {int}`
    • T22     `the ADW TypeScript type-check passes`
    • W16/T34 `the git/gh guard is run across the repository` / `the git/gh guard reports no
      violations`
  These per-issue phrases are reused because their world is exported for sharing, as feature-848
  and feature-932 already do: feature-796's `a launch boundary for the repository {string} whose
  providers record every call`, and feature-820's `issue {int} in the recording tracker carries
  the label {string}` and `issue {int} in the recording tracker carries the labels {string} and
  {string}`. These phrases are deliberately NOT reused:
    • feature-932's `the cron tick runs once from that boundary`, `exactly one ADW run was started
      for issue {int}`, `the ADW run started for issue {int} runs the orchestrator {string}` and
      `no ADW run was started for issue {int}`. They are bound to feature-932's world and are
      swept with it. Its `issue {int} has an earlier ADW workflow under adw id …` writes no branch
      name, no `lastSeenAt` and no phases, so it can show no reset and no phase-time grace period;
    • feature-912's `the next candidate arrives at issue {int}` and `the candidate takes the
      workflow over under adwId {string}`. They call `evaluateCandidate` directly, past the cron
      filter this issue is about;
    • the registry's W14 (`the cron poll batch runs`), which has no definition and knows no
      boundary or sweep; W10, which is pending; G5 and T6, which name a legacy lock path
      (`.adw/locks/issue-N.lock`); and G6, which writes state into a worktree's `.adw/state.json`.
  The registry has no phrase for the following, so novel phrasing is introduced for them: the
  workflow's history; an orchestrator that recorded `starting` and died, died holding its lock,
  is still starting up, records `starting` mid-poll, or lives and heartbeats; the finished SDLC
  run that exited, and the PR review that started up on the issue's pull request; #935's shape;
  the cron's own lock; the two polls; the launch, liveness, reset and lock assertions; and the
  non-executable Claude CLI, the cron-style launch and the execution-log assertions.

  Background:
    Given the ADW codebase is checked out

  # ── §1 A DEAD ORCHESTRATOR IS TAKEN OVER ──────────────────────────────────────────────────────

  @adw-959 @adw-r5ifl5-bug-an-orchestrator
  Scenario Outline: A workflow whose relaunched orchestrator recorded "starting" and died before its first phase is taken over by the cron's next poll, which relaunches the orchestrator the state records under the same adwId
    Given a launch boundary for the repository "adw-fixture/void-959" whose providers record every call
    And issue <issue> has an ADW workflow under adwId "<adwId>" that runs "<script>", whose last run stopped at "phase_timeout" half an hour ago
    And a relaunched orchestrator for workflow "<adwId>" recorded "starting" and died before its first phase
    When the cron polls from that boundary, with its hung-orchestrator sweep due
    Then the cron has launched 1 orchestrator for issue <issue>
    And every orchestrator the cron launched for issue <issue> runs "<script>" under adwId "<adwId>"

    Examples:
      | issue | adwId        | script            |
      | 9591  | dead959-9591 | adws/adwSdlc.tsx  |
      | 9592  | dead959-9592 | adws/adwChore.tsx |

  @adw-959 @adw-r5ifl5-bug-an-orchestrator
  Scenario Outline: A workflow whose orchestrator died at <stage>, leaving its spawn lock behind, is taken over by the cron's next poll under the same adwId
    Given a launch boundary for the repository "adw-fixture/void-959" whose providers record every call
    And issue <issue> has an ADW workflow under adwId "<adwId>" that runs "adws/adwSdlc.tsx", whose last run stopped at "phase_timeout" half an hour ago
    And the orchestrator of workflow "<adwId>" died at workflowStage "<stage>" ten minutes ago, leaving the issue's spawn lock behind
    When the cron polls from that boundary, with its hung-orchestrator sweep due
    Then the cron has launched 1 orchestrator for issue <issue>
    And every orchestrator the cron launched for issue <issue> runs "adws/adwSdlc.tsx" under adwId "<adwId>"

    Examples:
      | stage           | issue | adwId        |
      | starting        | 9593  | dead959-9593 |
      | build_running   | 9594  | dead959-9594 |
      | stepDef_running | 9595  | dead959-9595 |

  # ── §2 A LIVE ORCHESTRATOR IS LEFT ALONE ──────────────────────────────────────────────────────

  @adw-959 @adw-r5ifl5-bug-an-orchestrator
  Scenario: A relaunched orchestrator that is alive and still starting up is left alone — not killed, not reset, not doubled, and not left facing a spawn lock the cron took
    Given a launch boundary for the repository "adw-fixture/void-959" whose providers record every call
    And issue 9596 has an ADW workflow under adwId "live959-9596" that runs "adws/adwSdlc.tsx", whose last run stopped at "phase_timeout" half an hour ago
    And a relaunched orchestrator for workflow "live959-9596" is alive and still starting up, past recording "starting" but before its first phase
    When the cron polls from that boundary, with its hung-orchestrator sweep due
    Then the cron launched no orchestrator for issue 9596
    And the orchestrator process of workflow "live959-9596" is still alive
    And the worktree of workflow "live959-9596" was not reset
    And nothing but the orchestrator of workflow "live959-9596" holds the issue's spawn lock
    And the state file for adwId "live959-9596" records workflowStage "starting"

  @adw-959 @adw-r5ifl5-bug-an-orchestrator
  Scenario: A relaunched orchestrator that records "starting" while the cron is deciding is deferred to — the takeover handler never kills it, resets its worktree or starts a second orchestrator beside it
    Given a launch boundary for the repository "adw-fixture/void-959" whose providers record every call
    And issue 9597 has an ADW workflow under adwId "race959-9597" that runs "adws/adwSdlc.tsx", whose last run stopped at "phase_timeout" half an hour ago
    And a relaunched orchestrator for workflow "race959-9597" is alive and records "starting" between the cron's filtering of the issue and its takeover decision
    When the cron polls from that boundary, with its hung-orchestrator sweep due
    Then the cron launched no orchestrator for issue 9597
    And the orchestrator process of workflow "race959-9597" is still alive
    And the worktree of workflow "race959-9597" was not reset
    And nothing but the orchestrator of workflow "race959-9597" holds the issue's spawn lock
    And the state file for adwId "race959-9597" records workflowStage "starting"

  @adw-959 @adw-r5ifl5-bug-an-orchestrator
  Scenario Outline: A live orchestrator that holds its spawn lock and heartbeats at <stage> is left alone
    Given a launch boundary for the repository "adw-fixture/void-959" whose providers record every call
    And issue <issue> has an ADW workflow under adwId "<adwId>" that runs "adws/adwSdlc.tsx", whose last run stopped at "phase_timeout" half an hour ago
    And the orchestrator of workflow "<adwId>" is alive at workflowStage "<stage>", holding the issue's spawn lock and heartbeating
    When the cron polls from that boundary, with its hung-orchestrator sweep due
    Then the cron launched no orchestrator for issue <issue>
    And the orchestrator process of workflow "<adwId>" is still alive
    And the worktree of workflow "<adwId>" was not reset
    And nothing but the orchestrator of workflow "<adwId>" holds the issue's spawn lock
    And the state file for adwId "<adwId>" records workflowStage "<stage>"

    Examples:
      | stage         | issue | adwId        |
      | starting      | 9598  | live959-9598 |
      | build_running | 9599  | live959-9599 |

  @adw-959 @adw-r5ifl5-bug-an-orchestrator
  Scenario: A PR review ten minutes into "pr_review_build_running", on a workflow whose state still records the finished SDLC run's dead pid, is left alone — not reset and not doubled
    Given a launch boundary for the repository "adw-fixture/void-959" whose providers record every call
    And issue 9600 has an ADW workflow under adwId "prr959-9600" that runs "adws/adwSdlc.tsx", whose last run stopped at "awaiting_merge" half an hour ago
    And the SDLC run of workflow "prr959-9600" has exited, leaving its pid in the state
    And a PR review of workflow "prr959-9600" has started up on the issue's pull request and has stood at workflowStage "pr_review_build_running" for ten minutes
    When the cron polls from that boundary, with its hung-orchestrator sweep due
    Then the cron launched no orchestrator for issue 9600
    And the worktree of workflow "prr959-9600" was not reset
    And the state file for adwId "prr959-9600" records workflowStage "pr_review_build_running"

  @adw-959 @adw-r5ifl5-bug-an-orchestrator @adw-963
  Scenario: A spawn lock held by another live process still turns the cron away from a workflow whose orchestrator died in "starting"
    Given a launch boundary for the repository "adw-fixture/void-959" whose providers record every call
    And issue 9580 has an ADW workflow under adwId "held959-9580" that runs "adws/adwSdlc.tsx", whose last run stopped at "phase_timeout" half an hour ago
    And a relaunched orchestrator for workflow "held959-9580" recorded "starting" and died before its first phase
    And another live process holds the spawn lock for issue 9580 in the repository "adw-fixture/void-959"
    When the cron polls from that boundary, with its hung-orchestrator sweep due
    Then the cron launched no orchestrator for issue 9580

  @adw-959 @adw-r5ifl5-bug-an-orchestrator
  Scenario: The cron still never takes over a workflow on an issue that now carries adw:none, even when its orchestrator died in "starting", and takes over its neighbour
    Given a launch boundary for the repository "adw-fixture/void-959" whose providers record every call
    And issue 9581 in the recording tracker carries the labels "adw:bug" and "adw:none"
    And issue 9581 has an ADW workflow under adwId "none959-9581" that runs "adws/adwSdlc.tsx", whose last run stopped at "phase_timeout" half an hour ago
    And a relaunched orchestrator for workflow "none959-9581" recorded "starting" and died before its first phase
    And issue 9582 in the recording tracker carries the label "adw:bug"
    And issue 9582 has an ADW workflow under adwId "none959-9582" that runs "adws/adwSdlc.tsx", whose last run stopped at "phase_timeout" half an hour ago
    And a relaunched orchestrator for workflow "none959-9582" recorded "starting" and died before its first phase
    When the cron polls from that boundary, with its hung-orchestrator sweep due
    Then the cron launched no orchestrator for issue 9581
    And the cron has launched 1 orchestrator for issue 9582
    And every orchestrator the cron launched for issue 9582 runs "adws/adwSdlc.tsx" under adwId "none959-9582"

  # ── §3 THE CRON'S OWN SPAWN LOCK ──────────────────────────────────────────────────────────────

  @adw-959 @adw-r5ifl5-bug-an-orchestrator
  Scenario Outline: A spawn lock the cron's own process left behind does not stop the cron from taking over a workflow stopped at <stage>
    Given a launch boundary for the repository "adw-fixture/void-959" whose providers record every call
    And issue <issue> has an ADW workflow under adwId "<adwId>" that runs "adws/adwChore.tsx", whose last run stopped at "<stage>" half an hour ago
    And the cron's own process holds the spawn lock for issue <issue> in the repository "adw-fixture/void-959"
    When the cron polls from that boundary, with its hung-orchestrator sweep due
    Then the cron has launched 1 orchestrator for issue <issue>
    And every orchestrator the cron launched for issue <issue> runs "adws/adwChore.tsx" under adwId "<adwId>"

    Examples:
      | stage         | issue | adwId        |
      | abandoned     | 9583  | self959-9583 |
      | phase_timeout | 9584  | self959-9584 |

  @adw-959 @adw-r5ifl5-bug-an-orchestrator
  Scenario: A spawn lock the cron's own process left behind does not stop the cron from taking over a workflow whose relaunched orchestrator died in "starting"
    Given a launch boundary for the repository "adw-fixture/void-959" whose providers record every call
    And issue 9585 has an ADW workflow under adwId "self959-9585" that runs "adws/adwSdlc.tsx", whose last run stopped at "phase_timeout" half an hour ago
    And a relaunched orchestrator for workflow "self959-9585" recorded "starting" and died before its first phase
    And the cron's own process holds the spawn lock for issue 9585 in the repository "adw-fixture/void-959"
    When the cron polls from that boundary, with its hung-orchestrator sweep due
    Then the cron has launched 1 orchestrator for issue 9585
    And every orchestrator the cron launched for issue 9585 runs "adws/adwSdlc.tsx" under adwId "self959-9585"

  # ── §4 REPLAYING #935 ─────────────────────────────────────────────────────────────────────────

  @adw-959 @adw-r5ifl5-bug-an-orchestrator
  Scenario: Replaying #935 — the same cron, never restarted, relaunches a timed-out workflow; the relaunched orchestrator records "starting" as #935's did and dies with the cron's pid left on the spawn lock; the cron's next poll relaunches the workflow under the same adwId
    Given a launch boundary for the repository "adw-fixture/void-959" whose providers record every call
    And issue 9535 has an ADW workflow under adwId "replay959-9535" that runs "adws/adwSdlc.tsx", whose last run stopped at "phase_timeout" half an hour ago
    When the cron polls from that boundary, with its hung-orchestrator sweep due
    Then the cron has launched 1 orchestrator for issue 9535
    When the orchestrator the cron relaunched for workflow "replay959-9535" records "starting" exactly as #935's relaunched orchestrator did, and dies before its first phase
    And the cron's own process holds the spawn lock for issue 9535 in the repository "adw-fixture/void-959"
    And the same cron polls again from that boundary, with its hung-orchestrator sweep due
    Then the cron has launched 2 orchestrators for issue 9535
    And every orchestrator the cron launched for issue 9535 runs "adws/adwSdlc.tsx" under adwId "replay959-9535"

  # ── §5 NO SILENT DEATHS ───────────────────────────────────────────────────────────────────────

  @adw-959 @adw-r5ifl5-bug-an-orchestrator
  Scenario Outline: An orchestrator launched as the cron launches it, with its output discarded, that throws during startup writes the error into its own execution log and exits 1
    Given the Claude CLI that ADW is configured to run exists but is not executable
    When the orchestrator "<script>" is launched as the cron launches it, for issue <issue> under adwId "<adwId>" and the target repository "acme/widgets", with its output discarded
    Then the orchestrator subprocess exited 1
    And the execution log of the "<orchestrator>" for adwId "<adwId>" records the error that stopped its startup

    Examples:
      | script                    | orchestrator                 | issue | adwId           |
      | adws/adwSdlc.tsx          | sdlc-orchestrator            | 9571  | silent959-sdlc  |
      | adws/adwChore.tsx         | chore-orchestrator           | 9572  | silent959-chore |
      | adws/adwPlanBuild.tsx     | plan-build-orchestrator      | 9573  | silent959-pb    |
      | adws/adwPlanBuildTest.tsx | plan-build-test-orchestrator | 9574  | silent959-pbt   |

  @adw-959 @adw-r5ifl5-bug-an-orchestrator
  Scenario: Replaying #935's log — an execution log that already holds an earlier run's lines keeps them, and the startup error is written after them
    Given the Claude CLI that ADW is configured to run exists but is not executable
    And the execution log of the "sdlc-orchestrator" for adwId "silent959-9575" already ends with the line "Allocated port 57665 for dev server"
    When the orchestrator "adws/adwSdlc.tsx" is launched as the cron launches it, for issue 9575 under adwId "silent959-9575" and the target repository "acme/widgets", with its output discarded
    Then the orchestrator subprocess exited 1
    And the execution log of the "sdlc-orchestrator" for adwId "silent959-9575" still holds the line "Allocated port 57665 for dev server"
    And the execution log of the "sdlc-orchestrator" for adwId "silent959-9575" records the error that stopped its startup, after the line "Allocated port 57665 for dev server"

  # ── §6 BACKSTOPS ──────────────────────────────────────────────────────────────────────────────

  @adw-959 @adw-r5ifl5-bug-an-orchestrator
  Scenario: TypeScript type-check passes with liveness decidable for "starting" and the takeover reachable from every active stage
    Then the ADW TypeScript type-check passes

  @adw-959 @adw-r5ifl5-bug-an-orchestrator
  Scenario: The git/gh guard stays green with the cron taking over dead active stages and orchestrators logging their startup errors
    When the git/gh guard is run across the repository
    Then the git/gh guard reports no violations
