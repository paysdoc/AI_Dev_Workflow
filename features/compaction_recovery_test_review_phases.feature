@adw-u7lut9-extend-compaction-re @adw-l9w3wm-extend-compaction-re
Feature: Extend compaction recovery to test and review phases

  The build agent already handles compaction detection and restart via the
  shared continuation counter and buildContinuationPrompt. The test retry
  loop (testPhase.ts) and review retry loop (prReviewPhase.ts) are also
  long-running and can hit context compaction, but currently lack the
  continuation loop to recover. This feature adds compaction recovery to
  both phases, reusing the same pattern established in issue #298.

  # --- Test phase compaction recovery ---

  @adw-u7lut9-extend-compaction-re @adw-l9w3wm-extend-compaction-re @regression
  Scenario: testPhase restarts the test resolution agent when compactionDetected is true
    Given the test phase is running a test retry loop
    And the test resolution agent is resolving a failing test
    When the test resolution agent returns with compactionDetected = true
    Then the continuation counter is incremented
    And the test resolution prompt is rebuilt with the original test failure context and partial output
    And a new test resolution agent is spawned with fresh context

  @adw-u7lut9-extend-compaction-re @adw-l9w3wm-extend-compaction-re
  Scenario: Test phase compaction continuation shares the same counter as token limit continuations
    Given the test phase is running a test retry loop
    When the first test resolution agent returns with tokenLimitExceeded = true
    And the second test resolution agent returns with compactionDetected = true
    Then the shared continuation counter is 2
    And the total number of continuations does not exceed MAX_TOKEN_CONTINUATIONS

  @adw-u7lut9-extend-compaction-re @adw-l9w3wm-extend-compaction-re @regression
  Scenario: Test phase compaction continuation respects MAX_TOKEN_CONTINUATIONS limit
    Given the test phase is running with MAX_TOKEN_CONTINUATIONS = 3
    And 3 continuations have already occurred (any mix of token limit and compaction)
    When the next test resolution agent returns with compactionDetected = true
    Then the test phase stops retrying and reports the failure
    And the error indicates maximum continuations exceeded

  @adw-u7lut9-extend-compaction-re @adw-l9w3wm-extend-compaction-re
  Scenario: Test phase compaction continuation accumulates cost across restarts
    Given the test phase is running a test retry loop
    When the first test resolution agent returns with compactionDetected = true and totalCostUsd = 0.04
    And the continuation test resolution agent completes successfully with totalCostUsd = 0.02
    Then the total accumulated cost for the test phase includes both runs

  @adw-u7lut9-extend-compaction-re @adw-l9w3wm-extend-compaction-re
  Scenario: Test phase compaction continuation passes original failure context not accumulated prompts
    Given the test phase is running a test retry loop with a failing test
    When the first test resolution agent returns with compactionDetected = true
    Then the continuation prompt receives the original test failure output
    And the continuation prompt receives the first agent's partial resolution output
    When the second test resolution agent also returns with compactionDetected = true
    Then the continuation prompt again receives the original test failure output
    And the continuation prompt receives the second agent's partial resolution output

  # --- Test phase compaction recovery comment ---

  @adw-u7lut9-extend-compaction-re @adw-l9w3wm-extend-compaction-re @regression
  Scenario: Test phase compaction recovery posts a distinct issue comment
    Given the test phase is running with a GitHub repo context
    When the test resolution agent returns with compactionDetected = true
    Then an issue comment is posted with the "test_compaction_recovery" stage
    And the comment is distinct from "compaction_recovery" used by the build phase

  @adw-u7lut9-extend-compaction-re @adw-l9w3wm-extend-compaction-re
  Scenario: Test phase compaction recovery comment includes continuation number
    Given the test phase is running with a GitHub repo context
    When the test resolution agent returns with compactionDetected = true for the 2nd time
    Then the test_compaction_recovery comment includes continuation number 2

  # --- E2E and BDD test resolution compaction recovery ---

  @adw-l9w3wm-extend-compaction-re
  Scenario: E2E test resolution agent restarts when compactionDetected is true
    Given the E2E test retry loop is resolving a failed E2E test
    And runResolveE2ETestAgent is called for the failing test
    When the resolve E2E test agent returns with compactionDetected = true
    Then the resolve E2E test agent is restarted with fresh context
    And the restart uses the original E2E test failure context and partial output

  @adw-l9w3wm-extend-compaction-re
  Scenario: BDD scenario resolution agent restarts when compactionDetected is true
    Given the BDD scenario retry loop is resolving a failed scenario
    And runResolveE2ETestAgent is called for the failing BDD scenario
    When the resolve agent returns with compactionDetected = true
    Then the resolve agent is restarted with fresh context
    And the restart uses the original scenario failure context and partial output

  # --- Review phase compaction recovery ---

  @adw-u7lut9-extend-compaction-re @adw-l9w3wm-extend-compaction-re @regression
  Scenario: prReviewPhase restarts the review resolution agent when compactionDetected is true
    Given the review retry loop is running in prReviewPhase
    And the review resolution agent is resolving a review blocker
    When the review resolution agent returns with compactionDetected = true
    Then the continuation counter is incremented
    And the review resolution prompt is rebuilt with the original review blocker context and partial output
    And a new review resolution agent is spawned with fresh context

  @adw-u7lut9-extend-compaction-re @adw-l9w3wm-extend-compaction-re
  Scenario: Review phase compaction continuation shares the same counter as token limit continuations
    Given the review retry loop is running in prReviewPhase
    When the first review resolution agent returns with tokenLimitExceeded = true
    And the second review resolution agent returns with compactionDetected = true
    Then the shared continuation counter is 2
    And the total number of continuations does not exceed MAX_TOKEN_CONTINUATIONS

  @adw-u7lut9-extend-compaction-re @adw-l9w3wm-extend-compaction-re @regression
  Scenario: Review phase compaction continuation respects MAX_TOKEN_CONTINUATIONS limit
    Given the review retry loop is running with MAX_TOKEN_CONTINUATIONS = 3
    And 3 continuations have already occurred (any mix of token limit and compaction)
    When the next review resolution agent returns with compactionDetected = true
    Then the review phase stops retrying and reports the failure
    And the error indicates maximum continuations exceeded

  @adw-u7lut9-extend-compaction-re @adw-l9w3wm-extend-compaction-re
  Scenario: Review phase compaction continuation accumulates cost across restarts
    Given the review retry loop is running in prReviewPhase
    When the first review resolution agent returns with compactionDetected = true and totalCostUsd = 0.06
    And the continuation review resolution agent completes successfully with totalCostUsd = 0.04
    Then the total accumulated cost for the review phase includes both runs

  @adw-u7lut9-extend-compaction-re @adw-l9w3wm-extend-compaction-re
  Scenario: Review phase compaction continuation passes original blocker context not accumulated prompts
    Given the review retry loop is running with a review blocker
    When the first review resolution agent returns with compactionDetected = true
    Then the continuation prompt receives the original review blocker details
    And the continuation prompt receives the first agent's partial resolution output
    When the second review resolution agent also returns with compactionDetected = true
    Then the continuation prompt again receives the original review blocker details
    And the continuation prompt receives the second agent's partial resolution output

  # --- Review phase compaction recovery comment ---

  @adw-u7lut9-extend-compaction-re @adw-l9w3wm-extend-compaction-re @regression
  Scenario: Review phase compaction recovery posts a distinct issue comment
    Given the review retry loop is running with a GitHub repo context
    When the review resolution agent returns with compactionDetected = true
    Then an issue comment is posted with the "review_compaction_recovery" stage
    And the comment is distinct from "compaction_recovery" used by the build phase
    And the comment is distinct from "test_compaction_recovery" used by the test phase

  @adw-u7lut9-extend-compaction-re @adw-l9w3wm-extend-compaction-re
  Scenario: Review phase compaction recovery comment includes continuation number
    Given the review retry loop is running with a GitHub repo context
    When the review resolution agent returns with compactionDetected = true for the 2nd time
    Then the review_compaction_recovery comment includes continuation number 2

  # --- WorkflowStage type extensions ---

  @adw-u7lut9-extend-compaction-re @adw-l9w3wm-extend-compaction-re @regression
  Scenario: WorkflowStage type includes test_compaction_recovery and review_compaction_recovery
    Given the file "adws/types/workflowTypes.ts" exists
    Then the WorkflowStage union type includes "test_compaction_recovery"
    And the WorkflowStage union type includes "review_compaction_recovery"

  @adw-u7lut9-extend-compaction-re @adw-l9w3wm-extend-compaction-re
  Scenario: workflowCommentsIssue has formatters for test and review compaction recovery
    Given the file "adws/github/workflowCommentsIssue.ts" exists
    Then there is a formatter for "test_compaction_recovery" comments
    And there is a formatter for "review_compaction_recovery" comments
    And each formatter indicates which phase triggered the compaction restart

  @adw-u7lut9-extend-compaction-re @adw-l9w3wm-extend-compaction-re
  Scenario: STAGE_HEADER_MAP includes test and review compaction recovery entries
    Given the file "adws/core/workflowCommentParsing.ts" exists
    Then the STAGE_HEADER_MAP maps a distinct header to "test_compaction_recovery"
    And the STAGE_HEADER_MAP maps a distinct header to "review_compaction_recovery"
    And each header is distinct from the build phase's "compaction_recovery" header

  # --- Partial state saving on compaction ---

  @adw-u7lut9-extend-compaction-re @adw-l9w3wm-extend-compaction-re
  Scenario: Test phase compaction saves partial agent state before continuation
    Given the test phase is running with agent state tracking
    When the test resolution agent returns with compactionDetected = true
    Then AgentStateManager.writeState is called with partial output
    And AgentStateManager.appendLog records that compaction was detected during test resolution

  @adw-u7lut9-extend-compaction-re @adw-l9w3wm-extend-compaction-re
  Scenario: Review phase compaction saves partial agent state before continuation
    Given the review retry loop is running with agent state tracking
    When the review resolution agent returns with compactionDetected = true
    Then AgentStateManager.writeState is called with partial output
    And AgentStateManager.appendLog records that compaction was detected during review resolution

  # --- Model usage accumulation ---

  @adw-u7lut9-extend-compaction-re @adw-l9w3wm-extend-compaction-re
  Scenario: Test phase compaction continuation accumulates model usage across restarts
    Given the test phase is running a test retry loop
    When the first test resolution agent returns with compactionDetected = true and modelUsage data
    And the continuation test resolution agent completes successfully with its own modelUsage data
    Then the total model usage is the merged sum of both runs

  @adw-u7lut9-extend-compaction-re @adw-l9w3wm-extend-compaction-re
  Scenario: Review phase compaction continuation accumulates model usage across restarts
    Given the review retry loop is running in prReviewPhase
    When the first review resolution agent returns with compactionDetected = true and modelUsage data
    And the continuation review resolution agent completes successfully with its own modelUsage data
    Then the total model usage is the merged sum of both runs

  # --- Type checks ---

  @adw-u7lut9-extend-compaction-re @adw-l9w3wm-extend-compaction-re @regression
  Scenario: All type checks pass with test and review compaction recovery changes
    Given the ADW codebase with test and review compaction recovery implemented
    When "bunx tsc --noEmit" is run
    Then the command exits with code 0
    And "bunx tsc --noEmit -p adws/tsconfig.json" also exits with code 0
