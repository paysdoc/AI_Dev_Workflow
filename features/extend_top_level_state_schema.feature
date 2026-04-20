@adw-461 @adw-jcwqw7-orchestrator-resilie
Feature: Extend top-level state schema with pid, pidStartedAt, lastSeenAt, branchName

  The top-level workflow state file at `agents/<adwId>/state.json` is the at-a-glance
  view an operator uses to see whether a given ADW workflow is live, who owns it,
  and how recently it made progress. Today that view is incomplete: the schema does
  not promise a stable home for the owning process's pid, the platform-specific
  start-time token used by `processLiveness`, the most recent heartbeat timestamp,
  or the canonical branch name. Operators have to spelunk into per-phase
  subdirectories to reconstruct those facts.

  This slice extends `AgentState` (the type backing the top-level state file) with
  four optional fields — `pid`, `pidStartedAt`, `lastSeenAt`, and `branchName` —
  and hardens `AgentStateManager.writeTopLevelState` so that partial patches merge
  into existing state atomically without clobbering unrelated fields. The
  consumers of those fields (heartbeat ticker, takeover handler, hung-orchestrator
  detector) are wired in later slices of the orchestrator-coordination-resilience
  PRD; this slice is purely the schema and the atomic writer.

  `pidStartedAt` is written as an ISO 8601 UTC string when the platform's
  start-time token can be normalised (Linux /proc jiffies converted against the
  boot clock); otherwise the raw platform string is stored verbatim, matching the
  `processLiveness` contract. This keeps the field legible to humans on Linux
  while preserving exact-string comparability with the value that
  `processLiveness.getProcessStartTime` returns on every platform.

  Forward compatibility is required: a state file written before this slice (with
  none of the four new fields) must still load and must still be writable via
  partial patch without the reader or writer faulting on the missing fields.

  Addresses user stories 5 and 12 of the orchestrator-coordination-resilience PRD.

  Background:
    Given the ADW codebase is checked out

  # ═══════════════════════════════════════════════════════════════════════════
  # 1. AgentState schema surface
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-461 @regression
  Scenario: AgentState declares an optional pid field of type number
    Given the AgentState interface in "adws/types/agentTypes.ts" is read
    Then the interface declares an optional "pid" field of type "number"

  @adw-461 @regression
  Scenario: AgentState declares an optional pidStartedAt field of type string
    Given the AgentState interface in "adws/types/agentTypes.ts" is read
    Then the interface declares an optional "pidStartedAt" field of type "string"

  @adw-461 @regression
  Scenario: AgentState declares an optional lastSeenAt field of type string
    Given the AgentState interface in "adws/types/agentTypes.ts" is read
    Then the interface declares an optional "lastSeenAt" field of type "string"

  @adw-461 @regression
  Scenario: AgentState declares an optional branchName field of type string
    Given the AgentState interface in "adws/types/agentTypes.ts" is read
    Then the interface declares an optional "branchName" field of type "string"

  @adw-461
  Scenario: pidStartedAt doc comment points at the processLiveness contract
    Given the AgentState interface in "adws/types/agentTypes.ts" is read
    Then the "pidStartedAt" field's doc comment references the processLiveness contract
    And the doc comment notes that ISO 8601 is preferred when available
    And the doc comment notes that a platform-specific string is used otherwise

  @adw-461
  Scenario: lastSeenAt doc comment describes the heartbeat semantic
    Given the AgentState interface in "adws/types/agentTypes.ts" is read
    Then the "lastSeenAt" field's doc comment describes it as the most recent heartbeat write timestamp
    And the doc comment notes that it is ISO 8601

  # ═══════════════════════════════════════════════════════════════════════════
  # 2. pidStartedAt platform-format contract
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-461 @regression
  Scenario: pidStartedAt written on Linux is the value processLiveness returns
    Given the current platform is "linux"
    And processLiveness.getProcessStartTime returns "3647284" for the current process's pid
    When the top-level state is written with pidStartedAt set from getProcessStartTime
    Then the persisted "pidStartedAt" value is exactly "3647284"

  @adw-461 @regression
  Scenario: pidStartedAt written on macOS is the value processLiveness returns
    Given the current platform is "darwin"
    And processLiveness.getProcessStartTime returns "Sat Apr 20 10:00:00 2026" for the current process's pid
    When the top-level state is written with pidStartedAt set from getProcessStartTime
    Then the persisted "pidStartedAt" value is exactly "Sat Apr 20 10:00:00 2026"

  @adw-461
  Scenario: pidStartedAt round-trips through writeTopLevelState and readTopLevelState unchanged
    Given a top-level state file for adwId "abc12345"
    When writeTopLevelState is called with pidStartedAt "Sat Apr 20 10:00:00 2026"
    And readTopLevelState is called for adwId "abc12345"
    Then the returned state's "pidStartedAt" field is exactly "Sat Apr 20 10:00:00 2026"

  # ═══════════════════════════════════════════════════════════════════════════
  # 3. Forward-compatible read of old-schema state files
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-461 @regression
  Scenario: readTopLevelState loads a state file that predates the four new fields
    Given a state file at "agents/legacy01/state.json" with only the pre-461 fields
    When readTopLevelState is called for adwId "legacy01"
    Then the call does not throw
    And the returned state's "adwId" matches the file's adwId
    And the returned state's "pid" is undefined
    And the returned state's "pidStartedAt" is undefined
    And the returned state's "lastSeenAt" is undefined

  @adw-461 @regression
  Scenario: readTopLevelState tolerates a state file missing only lastSeenAt
    Given a state file at "agents/partial01/state.json" with pid and pidStartedAt but no lastSeenAt
    When readTopLevelState is called for adwId "partial01"
    Then the returned state's "pid" matches the file's pid
    And the returned state's "pidStartedAt" matches the file's pidStartedAt
    And the returned state's "lastSeenAt" is undefined

  @adw-461
  Scenario: writeTopLevelState partial patch against an old-schema file does not fault
    Given a state file at "agents/legacy02/state.json" with only adwId and issueNumber
    When writeTopLevelState is called for adwId "legacy02" with patch "{ lastSeenAt: '2026-04-20T10:00:00Z' }"
    Then the call does not throw
    And the persisted file still contains the original "adwId" and "issueNumber"
    And the persisted file now contains "lastSeenAt" equal to "2026-04-20T10:00:00Z"

  # ═══════════════════════════════════════════════════════════════════════════
  # 4. writeTopLevelState is atomic
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-461 @regression
  Scenario: writeTopLevelState writes atomically via rename
    Given "adws/core/agentState.ts" is read
    Then writeTopLevelState writes to a temporary sibling file before renaming into place
    And the rename step replaces the target file in a single filesystem operation

  @adw-461 @regression
  Scenario: writeTopLevelState leaves no stale temp file after a successful write
    Given the state directory for adwId "atomic01" is empty
    When writeTopLevelState is called for adwId "atomic01" with "{ adwId: 'atomic01', issueNumber: 42 }"
    Then "agents/atomic01/state.json" exists with the written content
    And no temp file sibling of "state.json" remains in "agents/atomic01/"

  @adw-461
  Scenario: writeTopLevelState never leaves a partially-written state.json visible to readers
    Given the state directory for adwId "atomic02" has a valid pre-existing state.json
    When writeTopLevelState is called for adwId "atomic02" and the process is killed mid-write
    Then any subsequent readTopLevelState call either returns the pre-existing content or the fully-written new content
    And readTopLevelState never returns a partially-written or invalid JSON document

  # ═══════════════════════════════════════════════════════════════════════════
  # 5. Partial-patch merge preserves unmodified fields
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-461 @regression
  Scenario: Partial patch with only lastSeenAt preserves pid, pidStartedAt, and branchName
    Given a top-level state file for adwId "merge01" with pid 4242, pidStartedAt "3647284", branchName "feature-issue-99-slug", and lastSeenAt "2026-04-20T09:00:00Z"
    When writeTopLevelState is called for adwId "merge01" with patch "{ lastSeenAt: '2026-04-20T10:00:00Z' }"
    Then the persisted "pid" remains 4242
    And the persisted "pidStartedAt" remains "3647284"
    And the persisted "branchName" remains "feature-issue-99-slug"
    And the persisted "lastSeenAt" is now "2026-04-20T10:00:00Z"

  @adw-461 @regression
  Scenario: Partial patch preserves the phases map untouched
    Given a top-level state file for adwId "merge02" with a phases map containing "install" completed and "plan" completed
    When writeTopLevelState is called for adwId "merge02" with patch "{ lastSeenAt: '2026-04-20T10:00:00Z' }"
    Then the persisted phases map still contains "install" with status "completed"
    And the persisted phases map still contains "plan" with status "completed"

  @adw-461 @regression
  Scenario: Partial patch updating pid and pidStartedAt preserves branchName and workflowStage
    Given a top-level state file for adwId "merge03" with branchName "feature-issue-88-foo", workflowStage "build_running", pid 100, pidStartedAt "old-start"
    When writeTopLevelState is called for adwId "merge03" with patch "{ pid: 200, pidStartedAt: 'new-start' }"
    Then the persisted "pid" is now 200
    And the persisted "pidStartedAt" is now "new-start"
    And the persisted "branchName" remains "feature-issue-88-foo"
    And the persisted "workflowStage" remains "build_running"

  @adw-461
  Scenario: Partial patch setting a field to the empty string overwrites the prior value
    Given a top-level state file for adwId "merge04" with branchName "feature-issue-7-old"
    When writeTopLevelState is called for adwId "merge04" with patch "{ branchName: '' }"
    Then the persisted "branchName" is the empty string
    And the persisted "branchName" is not the prior "feature-issue-7-old" value

  # ═══════════════════════════════════════════════════════════════════════════
  # 6. Unit test coverage required by the acceptance criteria
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-461 @regression
  Scenario: Unit test file exists at adws/core/__tests__/topLevelState.test.ts
    Then the file "adws/core/__tests__/topLevelState.test.ts" exists

  @adw-461 @regression
  Scenario: Unit tests cover writing a new-schema state file with all four new fields
    Given "adws/core/__tests__/topLevelState.test.ts" is read
    Then a test writes a state file containing pid, pidStartedAt, lastSeenAt, and branchName
    And that test asserts all four fields round-trip through readTopLevelState

  @adw-461 @regression
  Scenario: Unit tests cover reading an old-schema state file with the four new fields missing
    Given "adws/core/__tests__/topLevelState.test.ts" is read
    Then a test writes a state file that lacks pid, pidStartedAt, lastSeenAt, and branchName
    And that test asserts readTopLevelState returns a value with those fields undefined
    And that test asserts no exception is thrown during the read

  @adw-461 @regression
  Scenario: Unit tests cover partial-patch write preserving unmodified fields
    Given "adws/core/__tests__/topLevelState.test.ts" is read
    Then a test seeds a state file with pid, pidStartedAt, lastSeenAt, and branchName populated
    And the test issues a partial writeTopLevelState patch touching only one of the four fields
    And the test asserts the other three fields retain their original values
    And the test asserts the patched field reflects the new value

  @adw-461
  Scenario: Unit tests cover atomic write behaviour of writeTopLevelState
    Given "adws/core/__tests__/topLevelState.test.ts" is read
    Then a test asserts writeTopLevelState leaves no temp file behind on success

  # ═══════════════════════════════════════════════════════════════════════════
  # 7. TypeScript compilation gate
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-461 @regression
  Scenario: TypeScript type-check passes after the schema extension
    When "bunx tsc --noEmit" is run
    Then the command exits with code 0
    And "bunx tsc --noEmit -p adws/tsconfig.json" also exits with code 0
