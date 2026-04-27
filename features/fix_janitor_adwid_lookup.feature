@adw-499
Feature: Fix dev server janitor adwId lookup for real branch names

  Bug #499: the dev server janitor's `extractAdwIdFromDirName` looked for a
  literal `-adw-` marker in worktree directory names, but real branch names
  produced by `generateBranchName` follow the format
  `${prefix}-issue-${issueNumber}-${slug}` and never contain `-adw-`.

  Result: every legitimate ADW worktree resolved to `adwId = null`,
  inerting both the `isNonTerminal` and `orchestratorAlive` protective
  signals in `runJanitorPass`. The 30-minute age check was the only thing
  standing between a productive build agent and SIGTERM. Issue #55's build
  agent (adwId `ra4jwa`) was killed mid-stream after 48 passing scenarios.

  Fix: replace the directory-name parser with a two-step lookup —
  `extractIssueNumberFromDirName` parses the issue number from the
  worktree directory name, and `findActiveAdwIdForIssue` resolves the
  freshest live adwId by scanning top-level state files keyed on
  `issueNumber` and disambiguating ties by `lastSeenAt`. The kill
  decision rule (`shouldCleanWorktree`) is unchanged — only the lookup
  changes.

  Background:
    Given the ADW codebase is checked out

  # ═══════════════════════════════════════════════════════════════════════════
  # 1. New parser: extractIssueNumberFromDirName
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-499 @regression
  Scenario: devServerJanitor.ts exports extractIssueNumberFromDirName
    Given "adws/triggers/devServerJanitor.ts" is read
    Then the file exports a function named "extractIssueNumberFromDirName"

  @adw-499 @regression
  Scenario: extractIssueNumberFromDirName matches the real generateBranchName format
    Given "adws/triggers/devServerJanitor.ts" is read
    Then the file contains "-issue-"
    And the file contains "parseInt"

  @adw-499 @regression
  Scenario: extractIssueNumberFromDirName returns a number for a feature branch
    Given the worktree directory name "feature-issue-55-scraper-visual-asset-capture"
    When extractIssueNumberFromDirName parses the directory name
    Then the parsed issue number is 55

  @adw-499 @regression
  Scenario: extractIssueNumberFromDirName returns a number for a chore branch
    Given the worktree directory name "chore-issue-492-bdd-authoring-smoke-surface-scenarios"
    When extractIssueNumberFromDirName parses the directory name
    Then the parsed issue number is 492

  @adw-499 @regression
  Scenario: extractIssueNumberFromDirName returns a number for a bugfix branch
    Given the worktree directory name "bugfix-issue-499-fix-janitor-adwid-lookup"
    When extractIssueNumberFromDirName parses the directory name
    Then the parsed issue number is 499

  @adw-499 @regression
  Scenario: extractIssueNumberFromDirName returns null when no -issue- segment is present
    Given the worktree directory name "manually-created-dir"
    When extractIssueNumberFromDirName parses the directory name
    Then the parsed issue number is null

  @adw-499
  Scenario: extractIssueNumberFromDirName returns null for non-numeric issue id
    Given the worktree directory name "feature-issue-abc-some-slug"
    When extractIssueNumberFromDirName parses the directory name
    Then the parsed issue number is null

  @adw-499
  Scenario: extractIssueNumberFromDirName returns null for empty string
    Given the worktree directory name ""
    When extractIssueNumberFromDirName parses the directory name
    Then the parsed issue number is null

  # ═══════════════════════════════════════════════════════════════════════════
  # 2. New lookup: findActiveAdwIdForIssue
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-499 @regression
  Scenario: devServerJanitor.ts exports findActiveAdwIdForIssue
    Given "adws/triggers/devServerJanitor.ts" is read
    Then the file exports a function named "findActiveAdwIdForIssue"

  @adw-499 @regression
  Scenario: findActiveAdwIdForIssue consults listAdwStateDirs and readTopLevelStateRaw
    Given "adws/triggers/devServerJanitor.ts" is read
    Then the file contains "listAdwStateDirs"
    And the file contains "readTopLevelStateRaw"

  @adw-499 @regression
  Scenario: findActiveAdwIdForIssue filters candidates by issueNumber
    Given "adws/triggers/devServerJanitor.ts" is read
    Then the file contains "issueNumber"

  @adw-499 @regression
  Scenario: findActiveAdwIdForIssue disambiguates ties by lastSeenAt
    Given "adws/triggers/devServerJanitor.ts" is read
    Then the file contains "lastSeenAt"

  @adw-499 @regression
  Scenario: findActiveAdwIdForIssue returns the only matching adwId when one state file matches
    Given the agent state directory contains:
      | adwId  | issueNumber | lastSeenAt           |
      | ra4jwa | 55          | 2026-04-26T19:50:00Z |
      | xx1234 | 99          | 2026-04-26T19:55:00Z |
    When findActiveAdwIdForIssue is called for issue 55
    Then the resolved adwId is "ra4jwa"

  @adw-499 @regression
  Scenario: findActiveAdwIdForIssue picks the freshest lastSeenAt when multiple state files share an issue number
    Given the agent state directory contains:
      | adwId  | issueNumber | lastSeenAt           |
      | older1 | 55          | 2026-04-25T10:00:00Z |
      | newer2 | 55          | 2026-04-26T19:55:00Z |
    When findActiveAdwIdForIssue is called for issue 55
    Then the resolved adwId is "newer2"

  @adw-499 @regression
  Scenario: findActiveAdwIdForIssue returns null when no state file matches the issue number
    Given the agent state directory contains:
      | adwId  | issueNumber | lastSeenAt           |
      | xx1234 | 99          | 2026-04-26T19:55:00Z |
    When findActiveAdwIdForIssue is called for issue 55
    Then the resolved adwId is null

  @adw-499
  Scenario: findActiveAdwIdForIssue treats missing lastSeenAt as the oldest possible timestamp
    Given the agent state directory contains:
      | adwId   | issueNumber | lastSeenAt           |
      | nostamp | 55          |                      |
      | stamped | 55          | 2026-04-26T19:55:00Z |
    When findActiveAdwIdForIssue is called for issue 55
    Then the resolved adwId is "stamped"

  # ═══════════════════════════════════════════════════════════════════════════
  # 3. JanitorDeps extension
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-499 @regression
  Scenario: JanitorDeps interface declares listAdwStateDirs
    Given "adws/triggers/devServerJanitor.ts" is read
    Then the file contains "listAdwStateDirs"

  @adw-499 @regression
  Scenario: JanitorDeps interface declares readTopLevelStateRaw
    Given "adws/triggers/devServerJanitor.ts" is read
    Then the file contains "readTopLevelStateRaw"

  @adw-499 @regression
  Scenario: Default listAdwStateDirs filters out the cron subdirectory
    Given "adws/triggers/devServerJanitor.ts" is read
    Then the file contains "cron"

  @adw-499 @regression
  Scenario: Default readTopLevelStateRaw delegates to AgentStateManager.readTopLevelState
    Given "adws/triggers/devServerJanitor.ts" is read
    Then the file contains "AgentStateManager.readTopLevelState"

  # ═══════════════════════════════════════════════════════════════════════════
  # 4. runJanitorPass uses the new lookup
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-499 @regression
  Scenario: runJanitorPass calls extractIssueNumberFromDirName instead of extractAdwIdFromDirName
    Given "adws/triggers/devServerJanitor.ts" is read
    Then the file contains "extractIssueNumberFromDirName"
    And the file does not contain "extractAdwIdFromDirName"

  @adw-499 @regression
  Scenario: runJanitorPass calls findActiveAdwIdForIssue with the parsed issue number
    Given "adws/triggers/devServerJanitor.ts" is read
    Then the file contains "findActiveAdwIdForIssue"

  @adw-499 @regression
  Scenario: shouldCleanWorktree decision rule signature is unchanged
    Given "adws/triggers/devServerJanitor.ts" is read
    Then the file exports a function named "shouldCleanWorktree"
    And the file contains "isNonTerminal"
    And the file contains "orchestratorAlive"
    And the file contains "ageMs"
    And the file contains "gracePeriodMs"

  # ═══════════════════════════════════════════════════════════════════════════
  # 5. Regression: live build agents are protected from the janitor
  # ═══════════════════════════════════════════════════════════════════════════
  # These are the four cells of the lookup × decision matrix that exercise
  # the bug — a real branch-name worktree with a matching state file must
  # resolve to a non-null adwId so the protective signals can apply.

  @adw-499 @regression
  Scenario: Live build agent on a real-format worktree is left alone when state shows non-terminal stage and PID alive
    Given a worktree directory named "feature-issue-55-scraper-visual-asset-capture"
    And a top-level state file with adwId "ra4jwa" and issueNumber 55 and workflowStage "build_running"
    And the orchestrator process for adwId "ra4jwa" is alive
    And the worktree is older than 30 minutes
    And the worktree has a process holding files open
    When runJanitorPass evaluates the worktree
    Then the dev server process is left alone

  @adw-499 @regression
  Scenario: Completed orchestrator on a real-format worktree is reaped after the grace period
    Given a worktree directory named "feature-issue-55-scraper-visual-asset-capture"
    And a top-level state file with adwId "ra4jwa" and issueNumber 55 and workflowStage "completed"
    And the orchestrator process for adwId "ra4jwa" is dead
    And the worktree is older than 30 minutes
    And the worktree has a process holding files open
    When runJanitorPass evaluates the worktree
    Then the dev server process is killed

  @adw-499 @regression
  Scenario: Live build agent on a real-format worktree is left alone even when no state file is found
    Given a worktree directory named "feature-issue-55-scraper-visual-asset-capture"
    And no top-level state file matches issueNumber 55
    And the worktree is younger than 30 minutes
    And the worktree has a process holding files open
    When runJanitorPass evaluates the worktree
    Then the dev server process is left alone

  @adw-499
  Scenario: Multiple state files for the same issue use the freshest lastSeenAt for liveness
    Given a worktree directory named "feature-issue-55-scraper-visual-asset-capture"
    And the agent state directory contains:
      | adwId  | issueNumber | lastSeenAt           | workflowStage |
      | older1 | 55          | 2026-04-25T10:00:00Z | completed     |
      | newer2 | 55          | 2026-04-26T19:55:00Z | build_running |
    And the orchestrator process for adwId "newer2" is alive
    And the worktree is older than 30 minutes
    And the worktree has a process holding files open
    When runJanitorPass evaluates the worktree
    Then the dev server process is left alone

  # ═══════════════════════════════════════════════════════════════════════════
  # 6. Removed code — old parser is gone
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-499 @regression
  Scenario: extractAdwIdFromDirName is no longer exported from devServerJanitor.ts
    Given "adws/triggers/devServerJanitor.ts" is read
    Then the file does not contain "export function extractAdwIdFromDirName"

  @adw-499 @regression
  Scenario: The literal -adw- marker is no longer used to parse adwIds
    Given "adws/triggers/devServerJanitor.ts" is read
    Then the file does not contain "'-adw-'"

  @adw-499 @regression
  Scenario: devServerJanitor.test.ts no longer asserts against the invented -adw- fixture
    Given "adws/triggers/__tests__/devServerJanitor.test.ts" is read
    Then the file does not contain "extractAdwIdFromDirName"
    And the file does not contain "feature-issue-123-adw-abc123-my-feature"

  # ═══════════════════════════════════════════════════════════════════════════
  # 7. Unit test coverage for the new lookup
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-499 @regression
  Scenario: Unit tests cover extractIssueNumberFromDirName against real branch formats
    Given "adws/triggers/__tests__/devServerJanitor.test.ts" is read
    Then the file contains "extractIssueNumberFromDirName"
    And the file contains "feature-issue-55"
    And the file contains "chore-issue-492"

  @adw-499 @regression
  Scenario: Unit tests cover findActiveAdwIdForIssue match scenarios
    Given "adws/triggers/__tests__/devServerJanitor.test.ts" is read
    Then the file contains "findActiveAdwIdForIssue"
    And the file contains "lastSeenAt"

  @adw-499 @regression
  Scenario: Unit tests cover the runJanitorPass live-agent skip path
    Given "adws/triggers/__tests__/devServerJanitor.test.ts" is read
    Then the file contains "build_running"
    And the file contains "issueNumber"

  @adw-499 @regression
  Scenario: Unit tests cover the runJanitorPass completed-stage reap path
    Given "adws/triggers/__tests__/devServerJanitor.test.ts" is read
    Then the file contains "completed"
    And the file contains "killProcessesInDirectory"

  # ═══════════════════════════════════════════════════════════════════════════
  # 8. TypeScript compilation
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-499 @regression
  Scenario: TypeScript type-check passes after the lookup is replaced
    When "bunx tsc --noEmit" is run
    Then the command exits with code 0
    And "bunx tsc --noEmit -p adws/tsconfig.json" also exits with code 0
