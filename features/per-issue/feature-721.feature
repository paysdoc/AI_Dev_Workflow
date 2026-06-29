@adw-721 @adw-l1zzfx-pr-review-review-fai
Feature: A failed PR-review blocks at review_failed under its own adwId and tags its orchestratorScript, so ## Retry re-runs PR-review (never SDLC) — the takeover/phase_timeout spawn routes through resolveResumeSpawn instead of hardcoding adwSdlc

  Issue #721 makes PR-review a first-class RESUMABLE orchestrator and stops the
  takeover / `phase_timeout` spawn path from hardcoding the SDLC orchestrator.
  Parent PRD: `specs/prd/pr-review-adwid-consolidation-and-review-failed-gate.md`
  (§Implementation Decisions "Resume-spawn routing", "## Retry recovery", and
  "Post-review outcome gate"; User Stories 5, 10, 18).

  The defect this closes is a routing defect, and it is INCORRECT, not merely
  wasteful. Today the takeover/`phase_timeout` resume spawn is hardcoded to
  `adws/adwSdlc.tsx` (trigger_cron's `take_over_adwId` branch). So if a PR-review
  run ever blocks and a human posts `## Retry`, the resume would re-run the SDLC
  orchestrator — which works from the issue spec and NEVER reads PR review
  comments. The human's review-comment intent would be silently dropped: SDLC
  cannot address the PR feedback that triggered the PR-review run in the first
  place. #721 makes the resume route back to PR-review.

  This slice builds directly on three shipped pieces and changes them minimally:

    • #719 introduced the pure `decidePostReviewOutcome(reviewPassed)` gate that
      `adwPrReview` already consults at completion. On a passing review it writes
      `awaiting_merge`; on a failing review #719 left the run INERT (the gate's
      `writeAwaitingMerge:false` short-circuited the top-level write). #721 ADOPTS
      the fail-path: a failing PR-review now WRITES the `review_failed` stage the
      gate already returns, instead of settling inert.
    • #720 introduced the `review_failed` blocking stage, its cron-excluded
      classification, and the `review_failed → phase_timeout` `## Retry` re-arm in
      `handleRetryDirective`. That re-arm is orchestrator-agnostic (it only rewrites
      `workflowStage` + clears the resume counter). #721 RELIES ON it unchanged for
      PR-review-owned adwIds; the routing — which orchestrator the re-armed run
      resumes under — is what #721 adds.
    • The auth-queue resume path (`scanAuthQueue`) already reads
      `state.orchestratorScript ?? 'adws/adwSdlc.tsx'` to pick its spawn target.
      #721 GENERALISES that one-liner into a pure, tested `resolveResumeSpawn(state)`
      and routes the takeover/`phase_timeout` spawn through it too.

  The behavioural contract pinned below:

    1. RESOLVE-RESUME-SPAWN ROUTES BY orchestratorScript (AC3, the deep-module
       core). The pure `resolveResumeSpawn(state)` maps an adwId's top-level state
       to `{ script, args }`: a state whose `orchestratorScript` is
       `adws/adwPrReview.tsx` routes to PR-review; one that is `adws/adwSdlc.tsx`
       routes to SDLC; one with NO `orchestratorScript` DEFAULTS to SDLC (the
       back-compat / safety default for legacy and SDLC-minted states). The `args`
       are normalised to `(issueNumber, adwId)`.
    2. PR-REVIEW ADOPTS THE FAIL-PATH — review_failed + orchestratorScript (AC1,
       AC2). A PR-review run whose review did NOT pass after the retry budget now
       records `review_failed` to its top-level state (no longer inert) AND tags
       that state with `orchestratorScript = adws/adwPrReview.tsx`, so a later
       resume routes back to PR-review. (PR-review does not pass through the
       standard workflow-init that stamps `orchestratorScript`, so it must persist
       its own — this is a real, load-bearing write, not a redundant one.)
    3. ## RETRY RE-RUNS PR-REVIEW UNDER THE SAME adwId (AC4, AC5). A `## Retry` on a
       `review_failed` PR-review issue re-arms it to `phase_timeout` and clears the
       resume counter (the #720 re-arm, reused) WHILE PRESERVING its
       `orchestratorScript = adws/adwPrReview.tsx` (the partial state write does not
       drop the routing field). The resume spawn for that re-armed state then routes
       to PR-review — NOT SDLC — under the SAME adwId. End to end: a PR-review
       failure recovers as a PR-review run, never as an SDLC run.
    4. TYPE-CHECK BACKSTOP (AC6). The ADW TypeScript type-check still passes after
       `resolveResumeSpawn` is added, the takeover/`phase_timeout` spawn is wired
       through it, and the PR-review completion adopts the fail-path.

  Observability / rot-prevention note:

    Every assertion below targets a runtime OUTPUT of the system under test, never
    a source file:

      • §1 and §3.2 phase-import the pure `resolveResumeSpawn(state)` and assert the
        `{ script, args }` value it RETURNS — a function-of-the-system return value,
        exactly the observable category feature-719 §1 / feature-720 §1 assert for
        `decidePostReviewOutcome` and feature-712 §4–§6 assert for the pure remote-
        version read. The script-path strings (`adws/adwPrReview.tsx`,
        `adws/adwSdlc.tsx`) are the ROUTING DECISION'S RETURNED VALUE — the script
        the resolver picks — and the issue/PRD name them verbatim as that contract.
        No step calls `existsSync`/`readFileSync` on those paths, substring-matches
        them against any file, or parses a source file: the assertion is purely
        "the resolver returned this script string", the direct analogue of "the gate
        returned the `review_failed` stage string". That the returned path resolves
        to a real, compiling module is proven separately and BEHAVIOURALLY by the
        type-checker in §4, never by a runtime file probe.
      • §2 and §3.1 assert the TOP-LEVEL STATE FILE the run writes
        (`agents/<adwId>/state.json`) — the `workflowStage`, `orchestratorScript`,
        and `resumeAttempts` fields — read exactly as registered vocabulary T1 reads
        the `workflowStage` field. The state file is an ARTEFACT (an orchestrator
        output), a permitted read; `orchestratorScript` is the artefact's
        orchestrator-tag field, the T1 analogue.

    No step reads `adws/core/resolveResumeSpawn.ts`, `adws/phases/prReviewCompletion.ts`,
    `adws/triggers/trigger_cron.ts`, `adws/triggers/scanAuthQueue.ts`, or
    `adws/triggers/retryHandler.ts` as text, substring-matches their contents, or
    parses them as JSON/AST. The routing is proven by the value the resolver
    returns; the fail-path adoption by the stage + tag the completion writes; the
    re-arm by the state the retry handler persists.

  Scope notes:

    • THE PINNED BEHAVIOUR IS THE OBSERVABLE OUTCOME — the resolver's returned
      `{ script, args }`, the written `workflowStage`/`orchestratorScript`, and the
      `## Retry` re-arm — NOT the resolver's internal branch structure, the name or
      shape of its return object, or the order of fields the completion writes. An
      implementer may structure `resolveResumeSpawn` and the persisted state freely
      as long as these outcomes hold (the #636/#639/#720 "pin the decision, not the
      taxonomy" stance).
    • THE DETACHED SPAWN ITSELF IS OUT OF SCOPE here, as it was in feature-638/#639.
      §1/§3.2 pin the pure resolver the takeover/`phase_timeout` path now consults
      (`resolveResumeSpawn`), exactly as feature-638 pins `evaluateCandidate` rather
      than driving the real `spawnDetached`. That trigger_cron's `take_over_adwId`
      branch calls the resolver and spawns its returned `{ script, args }` (rather
      than the old hardcoded `adws/adwSdlc.tsx`) is thin wiring over the resolver,
      covered by §4's type-check and the existing cron regression harness
      (`cron_trigger_spawn.feature`); it is deliberately NOT re-driven as a real
      detached subprocess.
    • adwPrReview's RESUME EXECUTION is out of scope here. This slice still runs
      PR-review under its OWN generated adwId (full adwId consolidation — PR-review
      reusing the issue's adwId, and the `(issueNumber, adwId)` CLI normalisation —
      is slice #4). §3 proves the resume ROUTES to PR-review with the same adwId in
      its args; that adwPrReview's `main()` then consumes those args and resolves its
      PR from the persisted branch is wiring proven by §4's type-check, not by
      driving a full adwPrReview subprocess.
    • feature-719 IS NOT MODIFIED AND IS NOT RE-TAGGED. Its §3 asserts the NEGATIVE
      (a failing PR-review run "does not record awaiting_merge" and "records no
      error"), which #721's fail-path adoption PRESERVES — `review_failed` is still
      not `awaiting_merge` and is not an error — so feature-719 §3 stays green on the
      same post-#721 completion. #721 ADDS the positive assertion (the failing run
      now records `review_failed` + its `orchestratorScript`); it does not change
      what #719 pinned. Likewise feature-720 (the SDLC side of the same gate + the
      `review_failed → phase_timeout` re-arm) stays green and untouched.
    • THE @regression MAINTENANCE SWEEP IS SKIPPED for this issue: `.adw/scenarios.md`
      configures a `## Regression Scenario Directory`, so promotion to the
      regression suite is a deliberate human decision and the agent never
      auto-promotes.

  Vocabulary note:

    Reused registered phrases (`features/regression/vocabulary.md`):
      G18 `the ADW codebase is checked out`
      G4  `an issue {int} exists in the mock issue tracker`
      G1  `the mock GitHub API is configured to accept issue comments`
      G6  `a state file exists for adwId {string} at stage {string}`
      G11 `the worktree for adwId {string} is initialised at branch {string}`
      T1  `the state file for adwId {string} records workflowStage {string}`
      T22 `the ADW TypeScript type-check passes`

    Reused from sibling per-issue features (globally loaded, not yet registered) —
    deliberately reused verbatim so this slice proves the EXISTING surfaces carry
    the PR-review case with no new mechanism:
      from feature-719 (the shared PR-review completion+gate driver — the direct base):
        `the PR-review outcome handoff is executed for adwId {string} on PR {int} after a failing review`
      from feature-527 (the `## Retry` directive re-entry):
        `issue {int} carries an ADW comment naming adwId {string}`
        `issue {int} has a comment whose body is {string}`
        `the {string} directive is processed for issue {int}`
      from feature-639 (the resume-counter seed/assert):
        `the state file for adwId {string} is seeded with a resume attempt count of {int}`
        `the state file for adwId {string} records a resume attempt count of {int}`

    Novel phrasing introduced here — the registry has no phrase for the resume-spawn
    resolver, for the `orchestratorScript` state field, or for seeding it. Surfaced
    to the maintainer in the agent Output:
      • `a resume state for adwId {string} on issue {int} whose orchestratorScript is {string}`
      • `a resume state for adwId {string} on issue {int} with no recorded orchestratorScript`
      • `the resume spawn is resolved for that state`
      • `the resume spawn targets the orchestrator script {string}`
      • `the resume spawn does not target the orchestrator script {string}`
      • `the resume spawn passes issue {int} and adwId {string} as its normalized arguments`
      • `the state file for adwId {string} records orchestratorScript {string}`
      • `the state file for adwId {string} is seeded with orchestratorScript {string}`

    Step-definition note for the maintainer:
      • §1 / §3.2 phase-import `resolveResumeSpawn` from `adws/core/resolveResumeSpawn.ts`.
        The Given builds an in-memory top-level-state object
        (`{ adwId, issueNumber, orchestratorScript? }` — the same shape
        `AgentStateManager.readTopLevelState` returns) on the World; the When calls
        `resolveResumeSpawn(state)` and stores the returned `{ script, args }`. The
        Thens assert `result.script` equals the expected path string and that
        `result.args` leads with the normalized `(issueNumber, adwId)` pair
        (`args[0] === String(issue) && args[1] === adwId`), tolerant of any
        target-repo args the spawn caller appends afterwards. The `does not target`
        Then asserts `result.script !== 'adws/adwSdlc.tsx'`. These pin the documented
        routing disposition, not field names, so they survive a change to the return
        object's shape.
      • §2 reuses feature-719's `the PR-review outcome handoff is executed ... after a
        failing review` When verbatim (it drives `completePRReviewWorkflow` with the
        gate's failing outcome over a mocked config) — already globally registered,
        so do NOT redefine it. After #721, that same driver writes `review_failed` +
        `orchestratorScript`; the two new Thens (registered T1 for the stage, and the
        novel `records orchestratorScript`) read them off `agents/<adwId>/state.json`.
        The novel `records orchestratorScript` Then mirrors thenSteps.ts T1, reading
        the `orchestratorScript` field instead of `workflowStage`.
      • §3.1 reuses the feature-527/639 `## Retry` steps verbatim; the only new steps
        are the `is seeded with orchestratorScript` Given (writes the field onto the
        seeded top-level state, mirroring feature-639's resume-count seeder) and the
        `records orchestratorScript` Then (shared with §2). It asserts the re-arm
        writes `phase_timeout` + `resumeAttempts: 0` and LEAVES `orchestratorScript`
        intact — `writeTopLevelState` merges, so the partial re-arm preserves it.
      • feature-721.steps.ts must declare its OWN `@adw-721` Before/After hooks
        (mirroring feature-720.steps.ts): the Before sets up the mock infrastructure;
        the After removes the `agents/<adwId>` dirs the disk-writing scenarios create
        (`prreview-721-fail`, `prreview-721-retry`), since the reused feature-719/527
        Whens register their cleanup under their own tag scopes. The pure-resolver
        scenarios (`rrs-721-*`, `prreview-721-resume`) write nothing to disk.

  Background:
    Given the ADW codebase is checked out

  # ── §1 resolveResumeSpawn routes by orchestratorScript (AC3) ──────────────────
  #
  # The deep-module core. `resolveResumeSpawn(state)` is a pure function mapping an
  # adwId's top-level state to the orchestrator `{ script, args }` to resume under.
  # One scenario per orchestratorScript plus the absent default — the exact unit
  # matrix AC6 calls out, asserted behaviourally on the resolver's return value.
  # The PR-review case also pins the normalized `(issueNumber, adwId)` args.

  @adw-721 @adw-l1zzfx-pr-review-review-fai
  Scenario: resolveResumeSpawn routes a PR-review-owned state to adwPrReview with normalized (issue, adwId) args
    Given a resume state for adwId "rrs-721-prr" on issue 7211 whose orchestratorScript is "adws/adwPrReview.tsx"
    When the resume spawn is resolved for that state
    Then the resume spawn targets the orchestrator script "adws/adwPrReview.tsx"
    And the resume spawn passes issue 7211 and adwId "rrs-721-prr" as its normalized arguments

  @adw-721 @adw-l1zzfx-pr-review-review-fai
  Scenario: resolveResumeSpawn routes an SDLC-owned state to adwSdlc
    Given a resume state for adwId "rrs-721-sdlc" on issue 7212 whose orchestratorScript is "adws/adwSdlc.tsx"
    When the resume spawn is resolved for that state
    Then the resume spawn targets the orchestrator script "adws/adwSdlc.tsx"

  @adw-721 @adw-l1zzfx-pr-review-review-fai
  Scenario: resolveResumeSpawn defaults to adwSdlc when the state records no orchestratorScript
    Given a resume state for adwId "rrs-721-legacy" on issue 7213 with no recorded orchestratorScript
    When the resume spawn is resolved for that state
    Then the resume spawn targets the orchestrator script "adws/adwSdlc.tsx"

  # ── §2 PR-review adopts the fail-path: review_failed + orchestratorScript (AC1, AC2) ─
  #
  # A PR-review run whose review did not pass after the retry budget now records
  # `review_failed` (no longer the #719 inert outcome) AND tags its state with
  # `orchestratorScript = adws/adwPrReview.tsx`, so a later resume routes back to
  # PR-review. Reuses feature-719's failing-handoff driver verbatim; feature-719 §3
  # stays green because its negative assertions (not awaiting_merge, no error) still
  # hold for `review_failed`.

  @adw-721 @adw-l1zzfx-pr-review-review-fai
  Scenario: An exhausted PR-review review records review_failed and tags its orchestratorScript as adwPrReview
    Given an issue 7214 exists in the mock issue tracker
    And the worktree for adwId "prreview-721-fail" is initialised at branch "feature-issue-7214-prr"
    And a state file exists for adwId "prreview-721-fail" at stage "pr_review_build_completed"
    And the mock GitHub API is configured to accept issue comments
    When the PR-review outcome handoff is executed for adwId "prreview-721-fail" on PR 7214 after a failing review
    Then the state file for adwId "prreview-721-fail" records workflowStage "review_failed"
    And the state file for adwId "prreview-721-fail" records orchestratorScript "adws/adwPrReview.tsx"

  # ── §3 ## Retry re-runs PR-review under the same adwId, never SDLC (AC4, AC5) ──
  #
  # The crux. §3.1: a `## Retry` on a `review_failed` PR-review issue re-arms it to
  # `phase_timeout` and clears the resume counter (the #720 re-arm), PRESERVING its
  # PR-review `orchestratorScript` — proving the partial state write does not drop
  # the routing field. §3.2: the resume spawn for that re-armed state routes to
  # PR-review, not SDLC, under the SAME adwId — the literal "routing a PR-review
  # failure to SDLC is incorrect" guard.

  @adw-721 @adw-l1zzfx-pr-review-review-fai
  Scenario: ## Retry on a review_failed PR-review issue re-arms it to phase_timeout and preserves its adwPrReview orchestratorScript
    Given an issue 7215 exists in the mock issue tracker
    And issue 7215 carries an ADW comment naming adwId "prreview-721-retry"
    And a state file exists for adwId "prreview-721-retry" at stage "review_failed"
    And the state file for adwId "prreview-721-retry" is seeded with orchestratorScript "adws/adwPrReview.tsx"
    And the state file for adwId "prreview-721-retry" is seeded with a resume attempt count of 2
    And issue 7215 has a comment whose body is "## Retry"
    When the "## Retry" directive is processed for issue 7215
    Then the state file for adwId "prreview-721-retry" records workflowStage "phase_timeout"
    And the state file for adwId "prreview-721-retry" records a resume attempt count of 0
    And the state file for adwId "prreview-721-retry" records orchestratorScript "adws/adwPrReview.tsx"

  @adw-721 @adw-l1zzfx-pr-review-review-fai
  Scenario: The resume spawn for a re-armed PR-review run re-runs PR-review under the same adwId, not SDLC
    Given a resume state for adwId "prreview-721-resume" on issue 7216 whose orchestratorScript is "adws/adwPrReview.tsx"
    When the resume spawn is resolved for that state
    Then the resume spawn targets the orchestrator script "adws/adwPrReview.tsx"
    And the resume spawn does not target the orchestrator script "adws/adwSdlc.tsx"
    And the resume spawn passes issue 7216 and adwId "prreview-721-resume" as its normalized arguments

  # ── §4 Type-check backstop (AC6) ──────────────────────────────────────────────
  #
  # `resolveResumeSpawn` is a new module, the takeover/`phase_timeout` spawn is
  # rewired through it, and the PR-review completion adopts the fail-path. The
  # type-check confirms the new module compiles, its input type matches the state
  # trigger_cron passes, and the returned script paths name real modules — proven
  # by the compiler (registry T22), never by a runtime file probe.

  @adw-721 @adw-l1zzfx-pr-review-review-fai
  Scenario: The ADW TypeScript type-check passes after adding resolveResumeSpawn and routing the takeover spawn through it
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
