@adw-sgdfol-cost-revamp-orchestr
Feature: Cost revamp: orchestrator migration and old code cleanup

  Final migration slice that updates all orchestrators to the new cost flow,
  deletes old cost modules, retires cost fields from shared types, strips
  token/cost extraction from the JSONL parser, and verifies everything works
  end-to-end with no references to deleted modules.

  Background:
    Given the ADW codebase is checked out

  # ── 1: Orchestrators use new cost flow ──────────────────────────────────────

  @adw-sgdfol-cost-revamp-orchestr @regression
  Scenario: adwPlanBuild orchestrator imports cost utilities only from adws/cost
    Given "adws/adwPlanBuild.tsx" is read
    Then all cost-related imports resolve to "adws/cost" or "adws/phases/phaseCostCommit"
    And no imports reference "core/costPricing", "core/costReport", "core/costCsvWriter", or "core/tokenManager"

  @adw-sgdfol-cost-revamp-orchestr @regression
  Scenario: adwSdlc orchestrator imports cost utilities only from adws/cost
    Given "adws/adwSdlc.tsx" is read
    Then all cost-related imports resolve to "adws/cost" or "adws/phases/phaseCostCommit"
    And no imports reference "core/costPricing", "core/costReport", "core/costCsvWriter", or "core/tokenManager"

  @adw-sgdfol-cost-revamp-orchestr
  Scenario: adwPlanBuildTest orchestrator imports cost utilities only from adws/cost
    Given "adws/adwPlanBuildTest.tsx" is read
    Then all cost-related imports resolve to "adws/cost" or "adws/phases/phaseCostCommit"
    And no imports reference "core/costPricing", "core/costReport", "core/costCsvWriter", or "core/tokenManager"

  @adw-sgdfol-cost-revamp-orchestr
  Scenario: adwPlanBuildReview orchestrator imports cost utilities only from adws/cost
    Given "adws/adwPlanBuildReview.tsx" is read
    Then all cost-related imports resolve to "adws/cost" or "adws/phases/phaseCostCommit"
    And no imports reference "core/costPricing", "core/costReport", "core/costCsvWriter", or "core/tokenManager"

  @adw-sgdfol-cost-revamp-orchestr
  Scenario: adwPlanBuildTestReview orchestrator imports cost utilities only from adws/cost
    Given "adws/adwPlanBuildTestReview.tsx" is read
    Then all cost-related imports resolve to "adws/cost" or "adws/phases/phaseCostCommit"
    And no imports reference "core/costPricing", "core/costReport", "core/costCsvWriter", or "core/tokenManager"

  @adw-sgdfol-cost-revamp-orchestr
  Scenario: adwPlanBuildDocument orchestrator imports cost utilities only from adws/cost
    Given "adws/adwPlanBuildDocument.tsx" is read
    Then all cost-related imports resolve to "adws/cost" or "adws/phases/phaseCostCommit"
    And no imports reference "core/costPricing", "core/costReport", "core/costCsvWriter", or "core/tokenManager"

  @adw-sgdfol-cost-revamp-orchestr
  Scenario: adwPatch orchestrator imports cost utilities only from adws/cost
    Given "adws/adwPatch.tsx" is read
    Then all cost-related imports resolve to "adws/cost" or "adws/phases/phaseCostCommit"
    And no imports reference "core/costPricing", "core/costReport", "core/costCsvWriter", or "core/tokenManager"

  @adw-sgdfol-cost-revamp-orchestr
  Scenario: adwPrReview orchestrator imports cost utilities only from adws/cost
    Given "adws/adwPrReview.tsx" is read
    Then all cost-related imports resolve to "adws/cost" or "adws/phases/phaseCostCommit"
    And no imports reference "core/costPricing", "core/costReport", "core/costCsvWriter", or "core/tokenManager"

  @adw-sgdfol-cost-revamp-orchestr
  Scenario: adwBuild orchestrator imports cost utilities only from adws/cost
    Given "adws/adwBuild.tsx" is read
    Then all cost-related imports resolve to "adws/cost" or "adws/phases/phaseCostCommit"
    And no imports reference "core/costPricing", "core/costReport", "core/costCsvWriter", or "core/tokenManager"

  @adw-sgdfol-cost-revamp-orchestr
  Scenario: adwTest orchestrator imports cost utilities only from adws/cost
    Given "adws/adwTest.tsx" is read
    Then all cost-related imports resolve to "adws/cost" or "adws/phases/phaseCostCommit"
    And no imports reference "core/costPricing", "core/costReport", "core/costCsvWriter", or "core/tokenManager"

  @adw-sgdfol-cost-revamp-orchestr
  Scenario: adwDocument orchestrator imports cost utilities only from adws/cost
    Given "adws/adwDocument.tsx" is read
    Then all cost-related imports resolve to "adws/cost" or "adws/phases/phaseCostCommit"
    And no imports reference "core/costPricing", "core/costReport", "core/costCsvWriter", or "core/tokenManager"

  @adw-sgdfol-cost-revamp-orchestr
  Scenario: adwInit orchestrator imports cost utilities only from adws/cost
    Given "adws/adwInit.tsx" is read
    Then all cost-related imports resolve to "adws/cost" or "adws/phases/phaseCostCommit"
    And no imports reference "core/costPricing", "core/costReport", "core/costCsvWriter", or "core/tokenManager"

  # ── 2: Old cost files deleted ───────────────────────────────────────────────

  @adw-sgdfol-cost-revamp-orchestr @regression
  Scenario: Old costPricing.ts is deleted
    Then the file "adws/core/costPricing.ts" does not exist

  @adw-sgdfol-cost-revamp-orchestr @regression
  Scenario: Old costReport.ts is deleted
    Then the file "adws/core/costReport.ts" does not exist

  @adw-sgdfol-cost-revamp-orchestr @regression
  Scenario: Old costCsvWriter.ts is deleted
    Then the file "adws/core/costCsvWriter.ts" does not exist

  @adw-sgdfol-cost-revamp-orchestr @regression
  Scenario: Old tokenManager.ts is deleted
    Then the file "adws/core/tokenManager.ts" does not exist

  @adw-sgdfol-cost-revamp-orchestr @regression
  Scenario: Old costTypes.ts is deleted
    Then the file "adws/types/costTypes.ts" does not exist

  # ── 3: ClaudeCodeResultMessage cost fields retired ──────────────────────────

  @adw-sgdfol-cost-revamp-orchestr @regression
  Scenario: ClaudeCodeResultMessage no longer has totalCostUsd field
    Given "adws/types/agentTypes.ts" is read
    Then the "ClaudeCodeResultMessage" interface does not contain a "totalCostUsd" field

  @adw-sgdfol-cost-revamp-orchestr @regression
  Scenario: ClaudeCodeResultMessage no longer has modelUsage field
    Given "adws/types/agentTypes.ts" is read
    Then the "ClaudeCodeResultMessage" interface does not contain a "modelUsage" field

  @adw-sgdfol-cost-revamp-orchestr
  Scenario: ClaudeCodeResultMessage retains non-cost fields
    Given "adws/types/agentTypes.ts" is read
    Then the "ClaudeCodeResultMessage" interface still contains "type", "subtype", "isError", "durationMs", "numTurns", "result", and "sessionId"

  # ── 4: jsonlParser.ts no longer handles token/cost extraction ───────────────

  @adw-sgdfol-cost-revamp-orchestr @regression
  Scenario: jsonlParser no longer imports from tokenManager
    Given "adws/agents/jsonlParser.ts" is read
    Then the file does not import from "core/tokenManager"

  @adw-sgdfol-cost-revamp-orchestr @regression
  Scenario: jsonlParser no longer tracks modelUsage in parser state
    Given "adws/agents/jsonlParser.ts" is read
    Then the "JsonlParserState" interface does not contain a "modelUsage" field
    And the "JsonlParserState" interface does not contain a "totalTokens" field

  @adw-sgdfol-cost-revamp-orchestr @regression
  Scenario: jsonlParser no longer extracts cost from result messages
    Given "adws/agents/jsonlParser.ts" is read
    Then the parseJsonlOutput function does not call "computeTotalTokens" or "computePrimaryModelTokens"
    And the parseJsonlOutput function does not assign to "state.modelUsage"

  @adw-sgdfol-cost-revamp-orchestr
  Scenario: jsonlParser still parses text content from assistant messages
    Given "adws/agents/jsonlParser.ts" is read
    Then the parseJsonlOutput function still extracts text from assistant messages
    And the "extractTextFromAssistantMessage" function is still exported

  @adw-sgdfol-cost-revamp-orchestr
  Scenario: jsonlParser still parses tool use from assistant messages
    Given "adws/agents/jsonlParser.ts" is read
    Then the parseJsonlOutput function still extracts tool usage from assistant messages
    And the "extractToolUseFromMessage" function is still exported

  @adw-sgdfol-cost-revamp-orchestr
  Scenario: jsonlParser still tracks turnCount and toolCount
    Given "adws/agents/jsonlParser.ts" is read
    Then the "JsonlParserState" interface still contains "turnCount" and "toolCount" fields

  @adw-sgdfol-cost-revamp-orchestr
  Scenario: jsonlParser still invokes progress callbacks
    Given "adws/agents/jsonlParser.ts" is read
    Then the parseJsonlOutput function still calls the onProgress callback for tool_use and text events

  # ── 5: No imports reference deleted modules ─────────────────────────────────

  @adw-sgdfol-cost-revamp-orchestr @regression
  Scenario: No file in adws/ imports from core/costPricing
    Given the "adws/" directory is scanned for imports
    Then no TypeScript file imports from "core/costPricing" or "./costPricing"

  @adw-sgdfol-cost-revamp-orchestr @regression
  Scenario: No file in adws/ imports from core/costReport
    Given the "adws/" directory is scanned for imports
    Then no TypeScript file imports from "core/costReport" or "./costReport"

  @adw-sgdfol-cost-revamp-orchestr @regression
  Scenario: No file in adws/ imports from core/costCsvWriter
    Given the "adws/" directory is scanned for imports
    Then no TypeScript file imports from "core/costCsvWriter" or "./costCsvWriter"

  @adw-sgdfol-cost-revamp-orchestr @regression
  Scenario: No file in adws/ imports from core/tokenManager
    Given the "adws/" directory is scanned for imports
    Then no TypeScript file imports from "core/tokenManager" or "./tokenManager"

  @adw-sgdfol-cost-revamp-orchestr @regression
  Scenario: No file in adws/ imports from types/costTypes
    Given the "adws/" directory is scanned for imports
    Then no TypeScript file imports from "types/costTypes" or "./costTypes"

  @adw-sgdfol-cost-revamp-orchestr
  Scenario: core/index.ts no longer re-exports from deleted modules
    Given "adws/core/index.ts" is read
    Then the file does not export from "costPricing"
    And the file does not export from "costReport"
    And the file does not export from "costCsvWriter"
    And the file does not export from "tokenManager"
    And the file does not export from "costTypes"

  # ── 6: costCommitQueue.ts unchanged and functional ──────────────────────────

  @adw-sgdfol-cost-revamp-orchestr @regression
  Scenario: costCommitQueue.ts remains in core/ and is unchanged
    Given the file "adws/core/costCommitQueue.ts" exists
    Then the file exports "costCommitQueue" and "CostCommitQueue"

  @adw-sgdfol-cost-revamp-orchestr
  Scenario: costCommitQueue is still re-exported from core/index.ts
    Given "adws/core/index.ts" is read
    Then the file still exports "costCommitQueue" from "./costCommitQueue"

  # ── 7: retryOrchestrator uses new cost imports ──────────────────────────────

  @adw-sgdfol-cost-revamp-orchestr
  Scenario: retryOrchestrator.ts no longer imports from costReport or costTypes
    Given "adws/core/retryOrchestrator.ts" is read
    Then the file does not import from "costReport"
    And the file does not import from "costTypes"

  # ── 8: Phase files still produce PhaseCostRecords ───────────────────────────

  @adw-sgdfol-cost-revamp-orchestr @regression
  Scenario: All phase files import PhaseCostRecord from adws/cost
    Given the phase files in "adws/phases/" are read
    Then every phase file that produces cost records imports "PhaseCostRecord" from the cost module
    And no phase file imports from deleted cost modules

  # ── 9: Type checks pass ────────────────────────────────────────────────────

  @adw-sgdfol-cost-revamp-orchestr @regression
  Scenario: TypeScript type-check passes with main tsconfig
    Given the ADW codebase with old cost modules removed
    When "bunx tsc --noEmit" is run
    Then the command exits with code 0

  @adw-sgdfol-cost-revamp-orchestr @regression
  Scenario: TypeScript type-check passes with adws tsconfig
    Given the ADW codebase with old cost modules removed
    When "bunx tsc --noEmit -p adws/tsconfig.json" is run
    Then the command exits with code 0

  # ── 10: Vitest unit tests pass ──────────────────────────────────────────────

  @adw-sgdfol-cost-revamp-orchestr @regression
  Scenario: All Vitest unit tests pass after migration
    Given the ADW codebase with old cost modules removed
    When "bun run test" is run
    Then all unit tests pass

  # ── 13: agentProcessHandler still uses new cost extractor ───────────────────

  @adw-sgdfol-cost-revamp-orchestr
  Scenario: agentProcessHandler imports only from adws/cost for cost tracking
    Given "adws/agents/agentProcessHandler.ts" is read
    Then the file imports cost utilities from "adws/cost" or "../cost"
    And the file does not import from "core/tokenManager"
    And the file does not import from "core/costPricing"

  # ── 14: Workflow comments use new cost formatter ────────────────────────────

  @adw-sgdfol-cost-revamp-orchestr
  Scenario: workflowCommentsIssue.ts uses new cost types
    Given "adws/github/workflowCommentsIssue.ts" is read
    Then the file imports PhaseCostRecord from "adws/cost" or "../cost"
    And the file does not import from deleted cost modules

  @adw-sgdfol-cost-revamp-orchestr
  Scenario: workflowCompletion.ts uses new cost imports
    Given "adws/phases/workflowCompletion.ts" is read
    Then the file imports from "adws/cost" or "../cost"
    And the file does not import from deleted cost modules

  # ── 15: Trigger files use new cost imports ──────────────────────────────────

  @adw-sgdfol-cost-revamp-orchestr
  Scenario: Webhook handler uses new cost reporting imports
    Given "adws/triggers/webhookHandlers.ts" is read
    Then the file imports "rebuildProjectTotalCsv" from the cost reporting module
    And the file does not import from deleted cost modules
