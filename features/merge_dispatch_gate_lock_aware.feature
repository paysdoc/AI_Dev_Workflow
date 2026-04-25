@adw-488
Feature: Lock-aware merge dispatch gate replaces process-lifetime processedMerges set

  Issue #488 part A: the cron previously kept a module-scoped
  `processedMerges = new Set<number>()` and added the issue number any time
  it dispatched `adwMerge.tsx` for an `awaiting_merge` candidate. That set
  lives for the entire cron-process lifetime, so once `adwMerge` exited
  without merging (for any reason — `hitl_blocked`, transient failure,
  approval missing) the issue was filtered as "processed" forever — until
  the cron was restarted or `## Cancel` was posted.

  The fix removes `processedMerges` entirely and gates the merge spawn on
  the spawn lock. `shouldDispatchMerge(repoInfo, issueNumber, deps?)` reads
  the spawn-lock record via `readSpawnLockRecord` and consults
  `isProcessLive(pid, pidStartedAt)`:
    - no lock record         → dispatch
    - lock with dead PID     → dispatch (the staleness check will reclaim
                                it inside acquireIssueSpawnLock)
    - lock with live PID     → defer (a previous adwMerge is in flight)
    - malformed JSON         → dispatch (treated as no lock)

  `ProcessedSets` and `MutableProcessedSets` collapse to a single `spawns`
  field. `evaluateIssue` no longer has an awaiting-merge dedup branch — the
  `shouldDispatchMerge` lock check at dispatch time is the single source of
  truth for "is an adwMerge already running for this issue?".

  Background:
    Given the ADW codebase is checked out

  # ═══════════════════════════════════════════════════════════════════════
  # 1. shouldDispatchMerge module exists with injectable deps
  # ═══════════════════════════════════════════════════════════════════════

  @adw-488 @regression
  Scenario: mergeDispatchGate.ts exists at the conventional path
    Then the file "adws/triggers/mergeDispatchGate.ts" exists

  @adw-488 @regression
  Scenario: mergeDispatchGate.ts exports shouldDispatchMerge
    Given "adws/triggers/mergeDispatchGate.ts" is read
    Then the file exports a function named "shouldDispatchMerge"

  @adw-488 @regression
  Scenario: shouldDispatchMerge accepts repoInfo, issueNumber, and optional deps
    Given "adws/triggers/mergeDispatchGate.ts" is read
    Then the function "shouldDispatchMerge" accepts parameters "repoInfo", "issueNumber", and an optional "deps" object

  @adw-488 @regression
  Scenario: shouldDispatchMerge deps interface declares readLock and isLive injectables
    Given "adws/triggers/mergeDispatchGate.ts" is read
    Then the deps interface declares a "readLock" function field
    And the deps interface declares an "isLive" function field

  @adw-488 @regression
  Scenario: shouldDispatchMerge default deps wire readSpawnLockRecord and isProcessLive
    Given "adws/triggers/mergeDispatchGate.ts" is read
    Then "readSpawnLockRecord" is imported from "./spawnGate"
    And "isProcessLive" is imported from "../core/processLiveness"

  # ═══════════════════════════════════════════════════════════════════════
  # 2. shouldDispatchMerge — the four required cases
  # ═══════════════════════════════════════════════════════════════════════

  @adw-488 @regression
  Scenario: shouldDispatchMerge returns true when no spawn lock record exists
    Given a repo "acme/widgets" and issue 42 with no spawn lock record
    When shouldDispatchMerge is called for that repo and issue
    Then shouldDispatchMerge returns true

  @adw-488 @regression
  Scenario: shouldDispatchMerge returns true when the lock holder PID is not live
    Given a spawn lock record for repo "acme/widgets" and issue 42 with a recorded PID that is no longer live
    And isProcessLive returns false for that PID and pidStartedAt
    When shouldDispatchMerge is called for that repo and issue
    Then shouldDispatchMerge returns true

  @adw-488 @regression
  Scenario: shouldDispatchMerge returns false when the lock holder PID is live
    Given a spawn lock record for repo "acme/widgets" and issue 42 with a live PID
    And isProcessLive returns true for that PID and pidStartedAt
    When shouldDispatchMerge is called for that repo and issue
    Then shouldDispatchMerge returns false

  @adw-488 @regression
  Scenario: shouldDispatchMerge returns true on malformed lock JSON
    Given a spawn lock file for repo "acme/widgets" and issue 42 whose contents cannot be parsed as JSON
    When shouldDispatchMerge is called for that repo and issue
    Then shouldDispatchMerge returns true

  # ═══════════════════════════════════════════════════════════════════════
  # 3. Cron wiring — processedMerges is gone, gate is consulted instead
  # ═══════════════════════════════════════════════════════════════════════

  @adw-488 @regression
  Scenario: trigger_cron.ts no longer declares processedMerges at module scope
    Given "adws/triggers/trigger_cron.ts" is read
    Then the file does not contain "const processedMerges"
    And the file does not contain "processedMerges.add"
    And the file does not contain "processedMerges.has"

  @adw-488 @regression
  Scenario: trigger_cron.ts imports shouldDispatchMerge from mergeDispatchGate
    Given "adws/triggers/trigger_cron.ts" is read
    Then "shouldDispatchMerge" is imported from "./mergeDispatchGate"

  @adw-488 @regression
  Scenario: trigger_cron.ts consults shouldDispatchMerge before spawning adwMerge
    Given "adws/triggers/trigger_cron.ts" is read
    Then "shouldDispatchMerge" is called before the merge spawn for awaiting_merge candidates

  @adw-488 @regression
  Scenario: trigger_cron.ts logs a deferring message and continues when shouldDispatchMerge returns false
    Given "adws/triggers/trigger_cron.ts" is read
    Then the merge dispatch path logs a message containing "merge orchestrator already in flight" when shouldDispatchMerge returns false
    And the loop continues without spawning adwMerge in that case

  @adw-488 @regression
  Scenario: trigger_cron.ts no longer passes a merges field to handleCancelDirective
    Given "adws/triggers/trigger_cron.ts" is read
    Then the call to "handleCancelDirective" does not include a "merges" property
    And the only field passed in the processedSets argument is "spawns"

  @adw-488 @regression
  Scenario: trigger_cron.ts no longer passes a merges field to filterEligibleIssues
    Given "adws/triggers/trigger_cron.ts" is read
    Then the call to "filterEligibleIssues" does not include a "merges" property
    And the only field passed in the processed argument is "spawns"

  # ═══════════════════════════════════════════════════════════════════════
  # 4. cronIssueFilter — ProcessedSets collapses to spawns only
  # ═══════════════════════════════════════════════════════════════════════

  @adw-488 @regression
  Scenario: ProcessedSets interface declares only the spawns field
    Given "adws/triggers/cronIssueFilter.ts" is read
    Then the "ProcessedSets" interface declares a "spawns" field
    And the "ProcessedSets" interface does not declare a "merges" field

  @adw-488 @regression
  Scenario: evaluateIssue does not consult processed.merges for awaiting_merge candidates
    Given "adws/triggers/cronIssueFilter.ts" is read
    Then the awaiting_merge branch does not reference "processed.merges"

  @adw-488 @regression
  Scenario: evaluateIssue still honours processed.spawns for non-merge candidates
    Given "adws/triggers/cronIssueFilter.ts" is read
    Then the file contains "processed.spawns"

  # ═══════════════════════════════════════════════════════════════════════
  # 5. cancelHandler — MutableProcessedSets collapses to spawns only
  # ═══════════════════════════════════════════════════════════════════════

  @adw-488 @regression
  Scenario: MutableProcessedSets interface declares only the spawns field
    Given "adws/triggers/cancelHandler.ts" is read
    Then the "MutableProcessedSets" interface declares a "spawns" field
    And the "MutableProcessedSets" interface does not declare a "merges" field

  @adw-488 @regression
  Scenario: handleCancelDirective no longer deletes from processedSets.merges
    Given "adws/triggers/cancelHandler.ts" is read
    Then the file does not contain "processedSets.merges.delete"
    And the file does not reference "processedSets.merges"

  @adw-488 @regression
  Scenario: handleCancelDirective still deletes the issue from processedSets.spawns
    Given "adws/triggers/cancelHandler.ts" is read
    Then the file contains "processedSets.spawns.delete"

  # ═══════════════════════════════════════════════════════════════════════
  # 6. Operational behaviour — the bug from #488 is fixed
  # ═══════════════════════════════════════════════════════════════════════

  @adw-488 @regression
  Scenario: An issue whose previous adwMerge exited without merging is re-dispatched on the next cron cycle
    Given an awaiting_merge issue whose previous adwMerge run exited with reason "awaiting_approval"
    And the spawn lock from that previous run is no longer held by a live PID
    When the cron evaluates the issue on the next cycle
    Then shouldDispatchMerge returns true for the issue
    And adwMerge is dispatched again

  @adw-488 @regression
  Scenario: A second concurrent merge dispatch for the same issue is deferred while the first adwMerge is still running
    Given an awaiting_merge issue whose adwMerge orchestrator is currently running and holding the spawn lock
    When the cron evaluates the issue on a subsequent cycle while the first adwMerge has not yet exited
    Then shouldDispatchMerge returns false
    And no second adwMerge is spawned

  @adw-488 @regression
  Scenario: Recovery does not require restarting the cron process
    Given the cron process has been running continuously across multiple awaiting_merge dispatch attempts
    When a human approves the previously-blocking PR
    Then the very next cron cycle re-dispatches adwMerge for the issue
    And no cron-process restart is required

  # ═══════════════════════════════════════════════════════════════════════
  # 7. TypeScript compilation
  # ═══════════════════════════════════════════════════════════════════════

  @adw-488 @regression
  Scenario: TypeScript type-check passes after removing processedMerges and adding mergeDispatchGate
    When "bunx tsc --noEmit" is run
    Then the command exits with code 0
    And "bunx tsc --noEmit -p adws/tsconfig.json" also exits with code 0
