@adw-908 @adw-2fgeai-retry-resumes-a-work
Feature: The `## Retry` directive revives a workflow stranded in the paused stage: it drops the workflow's pause-queue entry, respawns the orchestrator its top-level state names with the handling cron's own --target-repo, and says so on the issue, while paused_auth, every running stage and the human-gated branches behave exactly as before

  Issue #908 is the directive slice of `specs/prd/rate-limit-indefinite-retry.md` (user stories
  13–17). A workflow in `workflowStage: paused` whose pause-queue entry is gone has no way back.
  `paused` is in the terminal stage class, so the takeover handler skips it, and the cron filter
  marks it ineligible ("handled exclusively by the pause queue scanner"). `handleRetryDirective`
  ignores it too ("not human-gated"). On 2026-09-22 the scanner evicted #840's chore workflow 44
  minutes before its session limit reset. The operator posted `## Retry` and `## continue`, and
  neither did anything. On 2026-09-24 #871, #872 and #874–#877 were stranded the same way.

  The fix adds a `paused` branch to the handler and changes nothing else. `## Retry` on a paused
  workflow:
    1. removes any pause-queue entry for that adwId, so the scanner cannot spawn a second
       orchestrator later;
    2. respawns the orchestrator that `resolveResumeSpawn` resolves from the top-level state: its
       `orchestratorScript`, defaulting to `adws/adwSdlc.tsx`, with the state's issue number and
       adwId. It passes the handling cron's own `--target-repo`;
    3. posts the existing `resumed` stage comment.
  Everything else keeps today's behaviour:
    • `merge_blocked` still resets to `awaiting_merge` and clears the merge retry counter;
    • `human_gated` and `review_failed` still re-arm to `phase_timeout` with the resume counter
      cleared. The issue mentions only `merge_blocked`, but the handler has three branches and
      none of them may change;
    • `paused_auth` stays a no-op, because the auth queue scanner owns it;
    • every running stage stays a no-op. The orchestrator may be alive, perhaps sleeping
      in-process through a rate limit, and a second one must never start.

  The labels below are the section numbers used for the scenario groups further down (§1–§5):

    §1  THE PAUSED BRANCH (AC1, AC2, AC3; user stories 13, 14). The #840 replay (no queue entry
        left); the still-queued case, followed by the scan that would otherwise relaunch it; the
        orchestrator resolved from top-level state; and a neighbour's queue entry left alone.

    §2  WHAT `## Retry` STILL LEAVES ALONE (AC4, AC5; user stories 15, 16). `paused_auth`, every
        running stage, and the finished or automatically recovered stages.

    §3  THE HUMAN-GATED BRANCHES ARE UNCHANGED (AC6; user story 17). `merge_blocked`,
        `human_gated`, `review_failed`.

    §4  THE OTHER CALLER. The webhook handles `## Retry` too.

    §5  BACKSTOPS (AC8). Type-check and the git/gh guard.

  Each row is written to fail for a reason, not to restate a criterion:
    • the #840 replay is RED today. It fails for any fix that resumes only when a queue entry
      still exists, which is exactly the case the incidents left behind;
    • the still-queued row fails for a fix that launches but leaves the entry, because the scan
      that follows relaunches a second orchestrator. It also fails for a fix that hands the entry
      to the scanner's `resumeWorkflow`. That path launches the entry's script with the entry's
      args, not the orchestrator resolved from top-level state;
    • the resolution rows fail for a fix that hardcodes `adws/adwSdlc.tsx` (every incident was an
      `adwChore` workflow). They also fail for a fix that reads `state.orchestratorScript` raw
      instead of through `resolveResumeSpawn`;
    • every "targets the repository" assertion fails for a respawn without the cron's
      `--target-repo`. Such an orchestrator resolves the cron host's own checkout.
      `initializeWorkflow`'s repo-identity cross-check then fails closed against the persisted
      `repoIdentity` before it writes any stage. The workflow is stranded again, now behind a
      comment announcing that it is resuming. An adwId that predates `repoIdentity` would instead
      run against the wrong repository;
    • "no entry … was added" fails for a fix that re-queues the workflow for the scanner instead of
      launching it. It also fails for a fix that does both, which starts two orchestrators once a
      probe reports clear;
    • the neighbour row fails for a fix that clears the whole queue instead of removing one adwId;
    • the paused_auth row fails for a fix that matches every stage starting with "paused", or the
      whole terminal stage class. Such a fix launches while the login is still expired, or moves
      the stage off `paused_auth`, where `scanAuthQueue` no longer finds it. Its log assertion is
      RED today: the handler logs the generic "not human-gated" line, which does not say why;
    • the running-stage rows include `stepDef_running`. `phaseRunner` builds that stage as
      `${phaseName}_running`, and it is not in the `WorkflowStage` union. A later slice's
      in-process wait holds a stage like it while it sleeps. A fix that recognises only the literal
      running stages would respawn beside that live orchestrator;
    • the finished-stage rows fail for a fix that treats the terminal stage class as "paused-like",
      which would respawn `completed` and `discarded` workflows;
    • the §3 rows and the §4 row are GREEN TODAY and must stay green. §3 fails for a restructured
      handler that also launches on the human-gated branches, or that posts the resumed comment for
      them. The cron's merge hoist and the takeover path already re-dispatch those branches, so a
      launch there is a double dispatch. §4 fails for a fix that makes the new target-repository
      input optional with an empty default. The webhook's call passes none today, so the webhook
      would then respawn without a target repository.

  ── WHY SOME CRITERIA GET NO SCENARIO OF THEIR OWN ──────────────────────────────────────────
  "Existing tests unchanged and green" (AC6) and `bun run test:unit` (AC8) are obligations on the
  vitest suite; the build and test phases discharge them. A scenario asserting that a test file is
  unchanged would assert a source-file property, which the Rot-Detection Rubric forbids. §3
  asserts the behaviour those tests pin instead. AC7 (this slice does not touch the scanner's
  eviction comment) is carried by feature-902's "A genuinely unknown probe failure still counts,
  and the third one drops the workflow with the manual-restart comment". That row asserts today's
  eviction text in every full scenario run. It is not re-tagged, and no row here pins that text,
  because the decider slice is expected to change it.

  How these scenarios observe the system. Every assertion targets a runtime artefact:
    • the orchestrator launches, recorded where they happen (see the notes below);
    • the pause-queue state file (`agents/paused_queue.json`);
    • the top-level state file (`agents/<adwId>/state.json`);
    • the comments the mock GitHub API records;
    • the ADW logger's output, captured while the directive is handled.
  No scenario reads, greps or parses a source file.

  Notes for the step definitions:

    • NEVER LAUNCH A REAL ORCHESTRATOR. Rows that name a real script (`adws/adwChore.tsx`, …) test
      how the script is resolved, not the script itself. Drive the handler with its launch
      injected, and record the script and argv it asked for. Use the `RetryHandlerDeps` seam the
      unit tests already use; `scanAuthQueue`'s `spawnDetached` dependency is the precedent.
      Every pause-queue entry seeded here names a recording fixture orchestrator, never a real one.
      Anything that resumes FROM THE ENTRY therefore launches only the fixture: the scanner, or a
      handler that wrongly delegates to it. The fixture records its argv and stays alive; kill it
      in an `After` hook, as feature-902-queue.steps.ts does. The webhook row cannot inject a seam,
      so its top-level state names the recording fixture as its orchestrator script. The
      launch-counting steps count launches from BOTH places. Compare scripts by repo-relative
      path, because `spawnDetached` absolutises `adws/…` against REPO_ROOT. A real spawn records
      asynchronously, so a negative launch assertion waits a few seconds before concluding.
    • "the cron handles the ## Retry directive on issue N" calls the handler the way
      trigger_cron.ts does. It passes the issue's comments with a trailing `## Retry` comment, the
      cron's own target-repo args, and a launch boundary for the Background's target repository.
      Build the target-repo args with `buildCronTargetRepoArgs`. Capture the ADW logger's output
      around the call.
    • ADW IDS MUST BE EXTRACTABLE. "the latest ADW workflow comment on issue N names adwId X" seeds
      a comment carrying `**ADW ID:** \`X\``. Use only lowercase letters, digits and hyphens in an
      adwId, never underscores. Otherwise the handler cannot extract it, returns before reading
      any state, and every no-op row passes vacuously. The §1 rows are the positive controls.
    • Top-level state goes through `AgentStateManager.writeTopLevelState`. Write the issue number,
      the stage, the orchestrator script when one is named, and the target repository as
      `repoIdentity`. Remove `agents/<adwId>` in `After`.
    • THE PAUSE QUEUE IS THE REAL `agents/paused_queue.json`, relative to the working directory.
      Save and restore any pre-existing file; never clobber an operator's queue. A seeded entry
      carries a real temporary worktree, the recording fixture as `orchestratorScript`, and
      `--target-repo` for the Background's target repository. "the pause-queue scanner then runs
      a probe cycle in which the rate limit has cleared" is
      `scanPauseQueue(PROBE_INTERVAL_CYCLES, () => 'clear')`. Clean up the spawn-lock artefacts
      and `agents/paused_queue_logs/<adwId>.resume.log`.
    • COMMENTS MUST REACH THE MOCK GITHUB API, or every zero-comment row passes vacuously. T14 and
      T27 read the mock server's recorded requests, and `RegressionWorld.getRecordedRequests()`
      returns [] when there is no mockContext. Route the handler's posts to the mock the way
      feature-902-queue.steps.ts does: shadow `gh` so that it records `gh issue comment`, then
      replay the recorded calls against the mock after the When step. Initialise mockContext in
      an `@adw-908` `Before` hook. The Background's "accept issue comments" Given fails fast
      without it, and T1 falls into a legacy source-inspection branch when it is null. The
      resumed-comment rows are the positive controls.
    • SAFETY. The handler runs in-process inside the real ADW checkout, so the cron host's own
      identity really is `paysdoc/AI_Dev_Workflow`, where #840 and #871 are real incident issues.
      A handler that posts through the host identity would comment on them. Blank the GitHub App
      environment and shadow `gh` before any When step; feature-902's `Before` hook does both.
      The target repository `acme/widgets` is deliberately fictional.
    • REGISTERED BUT UNIMPLEMENTED. G19, T25 and T27 have no step definition today, because the
      feature that implemented them (feature-565) was swept. Implement them to their registry
      semantics. For T25, match the resumed stage comment's heading,
      `## :arrow_forward: ADW Workflow Resuming`. Do not match the orchestrator's own
      `:arrows_counterclockwise:` "resuming" comment.
    • THE WEBHOOK ROW drives `dispatchWebhookEvent` with an `issue_comment` payload for the named
      repository, through a mint override whose tracker serves the issue's comments. Neutralise
      `ensureCronProcess` by registering this process's PID for that repository first, as
      feature-821's `preventRealCronSpawn` does. Make sure no `agents/.auth_gate` exists (save and
      restore it), or the webhook ignores the comment. "no orchestrator was launched for issue N
      without the target repository R" holds when every launch recorded for N carries
      `--target-repo R`. It also holds when there is no launch at all: leaving a paused workflow
      to the cron is a legitimate design, but a launch without the target repository is not.
    • The paused_auth log assertion matches a captured line that names the issue number, the stage
      `paused_auth` and the auth queue ("auth queue", "auth-queue" or "authQueue", any case). The
      rest of the wording is free.
    • REUSED, NOT REDEFINED. The git/gh guard pair and T22 are already defined in
      feature-844.steps.ts: the guard pair runs `adws/checkGitGhGuard.ts` and asserts exit 0, and
      T22 runs `tsc --noEmit`. Redefining any of them is an AmbiguousStepDefinition. (The guard
      pair is written `git\/gh` there, because "/" means alternation in a cucumber expression.)
    • Scope every hook to `@adw-908`.

  Vocabulary note. These registered phrases from `features/regression/vocabulary.md` are reused:
    • G18 `the ADW codebase is checked out`
    • G19 `the cron is polling the target repository {string} from a host checked out at {string}`
    • G1  `the mock GitHub API is configured to accept issue comments`
    • T1  `the state file for adwId {string} records workflowStage {string}`
    • T14 `the mock harness recorded zero comment posts on issue {int}`
    • T25 `the resumed comment is recorded on issue {int} in the target repository {string}`
    • T27 `the mock harness recorded zero comment posts on issue {int} in the cron host's own repository {string}`
    • T22 `the ADW TypeScript type-check passes`
  These registered phrases are deliberately NOT reused:
    • G6 writes state under a temporary worktree's `.adw/state.json` with issue 0. The handler
      never looks there; it reads `agents/<adwId>/state.json` and needs the issue number and the
      orchestrator script.
    • G20 fits the queue half, but its implementation seeds a hidden adwId and a top-level state
      with no issue number or orchestrator script. No directive could name that workflow, and no
      respawn could be resolved from it.
    • W13 calls `resumeWorkflow` directly, which is the scanner's path, not the directive's.
  Unregistered phrases from other per-issue features are not reused either. Their step
  definitions are swept with their feature, and several are bound to that feature's own world:
    • 902's pause-queue phrases resolve issues through 902's seeded map;
    • 821's "no workflow was spawned for issue {int}" reads 821's webhook and cron capture;
    • 848's "the ADW logger's output is captured" is undone only by 848's own hooks and Then step.
  The git/gh guard pair is the one exception. It is a stateless subprocess check with no world
  of its own, and five other per-issue features (797, 810, 820, 821, 844) already reuse it.
  The registry has no phrase for any of the following, so novel phrasing is introduced for them:
    • seeding an issue's ADW comment and a top-level state at a stage;
    • seeding or removing a pause-queue entry for an adwId;
    • handling the directive from the cron or from the webhook;
    • running a scan whose probe reports clear;
    • asserting orchestrator launches, queue entries, retry counters and the paused_auth log line.

  Background:
    Given the ADW codebase is checked out
    And the cron is polling the target repository "acme/widgets" from a host checked out at "paysdoc/AI_Dev_Workflow"
    And the mock GitHub API is configured to accept issue comments

  # ── §1 THE PAUSED BRANCH ─────────────────────────────────────────────────────────────────────

  @adw-908 @adw-2fgeai-retry-resumes-a-work
  Scenario: Replaying #840 — `## Retry` on a paused workflow whose pause-queue entry was already evicted respawns its orchestrator once and says so on the issue
    Given the latest ADW workflow comment on issue 840 names adwId "retry908-840"
    And the top-level state for adwId "retry908-840" records issue 840 at workflowStage "paused" with orchestrator script "adws/adwChore.tsx"
    And the rate-limit pause queue holds no entry for adwId "retry908-840"
    When the cron handles the ## Retry directive on issue 840
    Then exactly one orchestrator was launched for issue 840
    And the orchestrator launched for issue 840 runs "adws/adwChore.tsx" under adwId "retry908-840"
    And the orchestrator launched for issue 840 targets the repository "acme/widgets"
    And no entry for adwId "retry908-840" was added to the rate-limit pause queue
    And the resumed comment is recorded on issue 840 in the target repository "acme/widgets"
    And the mock harness recorded zero comment posts on issue 840 in the cron host's own repository "paysdoc/AI_Dev_Workflow"

  @adw-908 @adw-2fgeai-retry-resumes-a-work
  Scenario: `## Retry` on a paused workflow that is still queued drops its pause-queue entry and respawns the orchestrator once, leaving the scanner nothing to relaunch
    Given the latest ADW workflow comment on issue 871 names adwId "retry908-871"
    And the top-level state for adwId "retry908-871" records issue 871 at workflowStage "paused" with orchestrator script "adws/adwChore.tsx"
    And the rate-limit pause queue holds an entry for adwId "retry908-871" on issue 871
    When the cron handles the ## Retry directive on issue 871
    Then the rate-limit pause queue no longer holds an entry for adwId "retry908-871"
    And exactly one orchestrator was launched for issue 871
    And the orchestrator launched for issue 871 runs "adws/adwChore.tsx" under adwId "retry908-871"
    And the orchestrator launched for issue 871 targets the repository "acme/widgets"
    And the resumed comment is recorded on issue 871 in the target repository "acme/widgets"
    When the pause-queue scanner then runs a probe cycle in which the rate limit has cleared
    Then the pause-queue scanner relaunched nothing for issue 871
    And exactly one orchestrator was launched for issue 871

  @adw-908 @adw-2fgeai-retry-resumes-a-work
  Scenario Outline: The respawned orchestrator is the one the paused workflow's top-level state records, never a hardcoded default
    Given the latest ADW workflow comment on issue 874 names adwId "retry908-874"
    And the top-level state for adwId "retry908-874" records issue 874 at workflowStage "paused" with orchestrator script "<script>"
    And the rate-limit pause queue holds no entry for adwId "retry908-874"
    When the cron handles the ## Retry directive on issue 874
    Then exactly one orchestrator was launched for issue 874
    And the orchestrator launched for issue 874 runs "<script>" under adwId "retry908-874"
    And the orchestrator launched for issue 874 targets the repository "acme/widgets"

    Examples:
      | script                      |
      | adws/adwChore.tsx           |
      | adws/adwPlanBuildReview.tsx |

  @adw-908 @adw-2fgeai-retry-resumes-a-work
  Scenario: A paused workflow whose state predates recorded orchestrator scripts respawns under the resume default, adws/adwSdlc.tsx
    Given the latest ADW workflow comment on issue 879 names adwId "retry908-879"
    And the top-level state for adwId "retry908-879" records issue 879 at workflowStage "paused" with no orchestrator script
    And the rate-limit pause queue holds no entry for adwId "retry908-879"
    When the cron handles the ## Retry directive on issue 879
    Then exactly one orchestrator was launched for issue 879
    And the orchestrator launched for issue 879 runs "adws/adwSdlc.tsx" under adwId "retry908-879"
    And the orchestrator launched for issue 879 targets the repository "acme/widgets"

  @adw-908 @adw-2fgeai-retry-resumes-a-work
  Scenario: `## Retry` removes only its own workflow's pause-queue entry
    Given the latest ADW workflow comment on issue 871 names adwId "retry908-871"
    And the top-level state for adwId "retry908-871" records issue 871 at workflowStage "paused" with orchestrator script "adws/adwChore.tsx"
    And the rate-limit pause queue holds an entry for adwId "retry908-871" on issue 871
    And the top-level state for adwId "retry908-872" records issue 872 at workflowStage "paused" with orchestrator script "adws/adwChore.tsx"
    And the rate-limit pause queue holds an entry for adwId "retry908-872" on issue 872
    When the cron handles the ## Retry directive on issue 871
    Then the rate-limit pause queue no longer holds an entry for adwId "retry908-871"
    And the rate-limit pause queue still holds the entry for adwId "retry908-872"
    And no orchestrator was launched for issue 872

  # ── §2 WHAT ## Retry STILL LEAVES ALONE ─────────────────────────────────────────────────────

  @adw-908 @adw-2fgeai-retry-resumes-a-work
  Scenario: `## Retry` on a paused_auth workflow does nothing and logs that the auth queue owns its recovery
    Given the latest ADW workflow comment on issue 873 names adwId "retry908-873"
    And the top-level state for adwId "retry908-873" records issue 873 at workflowStage "paused_auth" with orchestrator script "adws/adwChore.tsx"
    When the cron handles the ## Retry directive on issue 873
    Then no orchestrator was launched for issue 873
    And the state file for adwId "retry908-873" records workflowStage "paused_auth"
    And the mock harness recorded zero comment posts on issue 873
    And the Retry handling logged that issue 873 is paused_auth and left to the auth queue

  @adw-908 @adw-2fgeai-retry-resumes-a-work
  Scenario Outline: `## Retry` on a running stage does nothing, so it can never start a second orchestrator beside a live one
    Given the latest ADW workflow comment on issue 876 names adwId "retry908-876"
    And the top-level state for adwId "retry908-876" records issue 876 at workflowStage "<stage>" with orchestrator script "adws/adwChore.tsx"
    When the cron handles the ## Retry directive on issue 876
    Then no orchestrator was launched for issue 876
    And the state file for adwId "retry908-876" records workflowStage "<stage>"
    And the mock harness recorded zero comment posts on issue 876

    Examples:
      | stage            |
      | starting         |
      | resuming         |
      | install_running  |
      | build_running    |
      | test_running     |
      | review_running   |
      | document_running |
      | stepDef_running  |

  @adw-908 @adw-2fgeai-retry-resumes-a-work
  Scenario Outline: `## Retry` on a finished or automatically recovered stage still does nothing
    Given the latest ADW workflow comment on issue 877 names adwId "retry908-877"
    And the top-level state for adwId "retry908-877" records issue 877 at workflowStage "<stage>" with orchestrator script "adws/adwChore.tsx"
    When the cron handles the ## Retry directive on issue 877
    Then no orchestrator was launched for issue 877
    And the state file for adwId "retry908-877" records workflowStage "<stage>"
    And the mock harness recorded zero comment posts on issue 877

    Examples:
      | stage          |
      | completed      |
      | discarded      |
      | abandoned      |
      | awaiting_merge |
      | phase_timeout  |

  # ── §3 THE HUMAN-GATED BRANCHES ARE UNCHANGED ───────────────────────────────────────────────

  @adw-908 @adw-2fgeai-retry-resumes-a-work
  Scenario: `## Retry` on merge_blocked still re-arms the merge exactly as before and launches nothing itself
    Given the latest ADW workflow comment on issue 881 names adwId "retry908-881"
    And the top-level state for adwId "retry908-881" records issue 881 at workflowStage "merge_blocked" with a merge retry count of 2
    When the cron handles the ## Retry directive on issue 881
    Then the state file for adwId "retry908-881" records workflowStage "awaiting_merge"
    And the top-level state for adwId "retry908-881" records a merge retry count of 0
    And no orchestrator was launched for issue 881
    And the mock harness recorded zero comment posts on issue 881

  @adw-908 @adw-2fgeai-retry-resumes-a-work
  Scenario Outline: `## Retry` on human_gated or review_failed still re-arms the resume counter exactly as before and launches nothing itself
    Given the latest ADW workflow comment on issue 882 names adwId "retry908-882"
    And the top-level state for adwId "retry908-882" records issue 882 at workflowStage "<stage>" with a resume attempt count of 3
    When the cron handles the ## Retry directive on issue 882
    Then the state file for adwId "retry908-882" records workflowStage "phase_timeout"
    And the top-level state for adwId "retry908-882" records a resume attempt count of 0
    And no orchestrator was launched for issue 882
    And the mock harness recorded zero comment posts on issue 882

    Examples:
      | stage         |
      | human_gated   |
      | review_failed |

  # ── §4 THE OTHER CALLER ─────────────────────────────────────────────────────────────────────

  @adw-908 @adw-2fgeai-retry-resumes-a-work
  Scenario: A `## Retry` the webhook delivers never launches an orchestrator without the webhook's target repository
    Given the latest ADW workflow comment on issue 875 names adwId "retry908-875"
    And the top-level state for adwId "retry908-875" records issue 875 at workflowStage "paused" with a recording fixture as its orchestrator script
    When the webhook receives a "## Retry" comment on issue 875 from the repository "acme/widgets"
    Then no orchestrator was launched for issue 875 without the target repository "acme/widgets"

  # ── §5 BACKSTOPS ────────────────────────────────────────────────────────────────────────────

  @adw-908 @adw-2fgeai-retry-resumes-a-work
  Scenario: TypeScript type-check passes with the paused branch wired into the Retry handler
    Then the ADW TypeScript type-check passes

  @adw-908 @adw-2fgeai-retry-resumes-a-work
  Scenario: The git/gh guard stays green with the Retry handler launching orchestrators and posting the resumed comment
    When the git/gh guard is run across the repository
    Then the git/gh guard reports no violations
