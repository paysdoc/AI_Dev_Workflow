@adw-467hhd-remove-unnecessary-e
Feature: Remove unnecessary exports across the codebase

  Many functions and constants were exported but only used within their own
  file, inflating the public API surface. All listed symbols must have their
  `export` keyword removed while remaining fully functional internally. Barrel
  re-exports of those symbols must also be removed. The test suite must
  continue to pass with no import breakage.

  Background:
    Given the ADW codebase is checked out

  # ── 1. Core internal helpers ────────────────────────────────────────────────

  @adw-467hhd-remove-unnecessary-e
  Scenario: stripFencedCodeBlocks and extractAdwCommandFromText are not exported from issueClassifier.ts
    Given "adws/core/issueClassifier.ts" is read
    When searching for "export" before "stripFencedCodeBlocks" and "extractAdwCommandFromText"
    Then neither symbol is prefixed with the "export" keyword
    And both symbols are still defined in the file

  @adw-467hhd-remove-unnecessary-e
  Scenario: extractIssueTypeOption and parseIssueNumber are not exported from orchestratorCli.ts
    Given "adws/core/orchestratorCli.ts" is read
    When searching for "export" before "extractIssueTypeOption" and "parseIssueNumber"
    Then neither symbol is prefixed with the "export" keyword
    And both symbols are still defined in the file

  @adw-467hhd-remove-unnecessary-e
  Scenario: getModelPricing is not exported from costPricing.ts
    Given "adws/core/costPricing.ts" is read
    When searching for "export" before "getModelPricing"
    Then "getModelPricing" is not prefixed with the "export" keyword
    And "getModelPricing" is still defined in the file

  @adw-467hhd-remove-unnecessary-e
  Scenario: getAdwIdFromState is not exported from retryOrchestrator.ts
    Given "adws/core/retryOrchestrator.ts" is read
    When searching for "export" before "getAdwIdFromState"
    Then "getAdwIdFromState" is not prefixed with the "export" keyword
    And "getAdwIdFromState" is still defined in the file

  @adw-467hhd-remove-unnecessary-e
  Scenario: projectBoardApi.ts internal helpers are not exported
    Given "adws/github/projectBoardApi.ts" is read
    When searching for exports of "findRepoProjectId", "findIssueProjectItem", "getStatusFieldOptions", and "updateProjectItemStatus"
    Then none of those four symbols are prefixed with the "export" keyword
    And "moveIssueToStatus" remains exported for external callers

  @adw-467hhd-remove-unnecessary-e
  Scenario: ADW_COMMIT_PATTERN is not exported from prCommentDetector.ts
    Given "adws/github/prCommentDetector.ts" is read
    When searching for "export" before "ADW_COMMIT_PATTERN"
    Then "ADW_COMMIT_PATTERN" is not prefixed with the "export" keyword
    And "ADW_COMMIT_PATTERN" is still defined in the file

  # ── 2. Agent formatter/helper functions ─────────────────────────────────────

  @adw-467hhd-remove-unnecessary-e
  Scenario: prAgent.ts formatter helpers are not exported
    Given "adws/agents/prAgent.ts" is read
    When searching for exports of "formatPullRequestArgs" and "extractPrUrlFromOutput"
    Then neither symbol is prefixed with the "export" keyword
    And both symbols are still defined in the file

  @adw-467hhd-remove-unnecessary-e
  Scenario: documentAgent.ts formatter helpers are not exported
    Given "adws/agents/documentAgent.ts" is read
    When searching for exports of "formatDocumentArgs" and "extractDocPathFromOutput"
    Then neither symbol is prefixed with the "export" keyword
    And both symbols are still defined in the file

  @adw-467hhd-remove-unnecessary-e
  Scenario: Agent formatter functions across kpiAgent, scenarioAgent, validationAgent, resolutionAgent, and patchAgent are not exported
    Given each of "adws/agents/kpiAgent.ts", "adws/agents/scenarioAgent.ts", "adws/agents/validationAgent.ts", "adws/agents/resolutionAgent.ts", and "adws/agents/patchAgent.ts" is read
    When searching for exports of "formatKpiArgs", "formatScenarioArgs", "formatValidationArgs", "formatResolutionArgs", and "formatPatchArgs"
    Then none of those symbols are prefixed with the "export" keyword
    And all symbols are still defined in their respective files

  @adw-467hhd-remove-unnecessary-e
  Scenario: mergeReviewResults and REVIEW_AGENT_COUNT are not exported from reviewRetry.ts
    Given "adws/agents/reviewRetry.ts" is read
    When searching for exports of "mergeReviewResults" and "REVIEW_AGENT_COUNT"
    Then neither symbol is prefixed with the "export" keyword
    And both symbols are still defined in the file

  @adw-467hhd-remove-unnecessary-e
  Scenario: runCrucialScenarioProof and shouldRunScenarioProof are not exported from crucialScenarioProof.ts
    Given "adws/agents/crucialScenarioProof.ts" is read
    When searching for exports of "runCrucialScenarioProof" and "shouldRunScenarioProof"
    Then neither symbol is prefixed with the "export" keyword
    And both symbols are still defined in the file

  # ── 3. Barrel re-exports cleanup ────────────────────────────────────────────

  @adw-467hhd-remove-unnecessary-e
  Scenario: agents/index.ts does not re-export any of the removed agent helper symbols
    Given "adws/agents/index.ts" is read
    When searching for re-exports of "formatPullRequestArgs", "extractPrUrlFromOutput", "formatDocumentArgs", "extractDocPathFromOutput", "formatKpiArgs", "formatScenarioArgs", "formatValidationArgs", "formatResolutionArgs", "formatPatchArgs", "mergeReviewResults", "REVIEW_AGENT_COUNT", "runCrucialScenarioProof", and "shouldRunScenarioProof"
    Then none of those symbols appear in an export statement in the barrel file

  @adw-467hhd-remove-unnecessary-e
  Scenario: core/index.ts does not re-export classifyWithAdwCommand or computeModelCost
    Given "adws/core/index.ts" is read
    When searching for re-exports of "classifyWithAdwCommand" and "computeModelCost"
    Then neither symbol appears in an export statement in the barrel file

  # ── 4. Test-reset hooks removed ─────────────────────────────────────────────

  @adw-467hhd-remove-unnecessary-e
  Scenario: resetLastKnownRates is not exported from costReport.ts
    Given "adws/core/costReport.ts" is read
    When searching for "export" before "resetLastKnownRates"
    Then "resetLastKnownRates" is not prefixed with the "export" keyword
    And "resetLastKnownRates" is still defined in the file

  @adw-467hhd-remove-unnecessary-e
  Scenario: resetCronSpawnedForRepo is not exported from webhookGatekeeper.ts
    Given "adws/triggers/webhookGatekeeper.ts" is read
    When searching for "export" before "resetCronSpawnedForRepo"
    Then "resetCronSpawnedForRepo" is not prefixed with the "export" keyword
    And "resetCronSpawnedForRepo" is still defined in the file

  @adw-467hhd-remove-unnecessary-e
  Scenario: recordMergedPrIssue and resetMergedPrIssues are not exported from webhookHandlers.ts
    Given "adws/triggers/webhookHandlers.ts" is read
    When searching for exports of "recordMergedPrIssue" and "resetMergedPrIssues"
    Then neither symbol is prefixed with the "export" keyword
    And both symbols are still defined in the file

  @adw-467hhd-remove-unnecessary-e
  Scenario: resetPrReviewTriggers and getPrReviewTriggersMap are not exported from trigger_webhook.ts
    Given "adws/triggers/trigger_webhook.ts" is read
    When searching for exports of "resetPrReviewTriggers" and "getPrReviewTriggersMap"
    Then neither symbol is prefixed with the "export" keyword
    And both symbols are still defined in the file

  # ── 5. Trigger internals ────────────────────────────────────────────────────

  @adw-467hhd-remove-unnecessary-e
  Scenario: trigger_cron.ts internal functions and types are not exported
    Given "adws/triggers/trigger_cron.ts" is read
    When searching for exports of "fetchOpenIssues", "hasAdwWorkflowComment", "isWithinGracePeriod", "filterEligibleIssues", "checkAndTrigger", and "RawIssue"
    Then none of those symbols are prefixed with the "export" keyword
    And all symbols are still defined in the file

  @adw-467hhd-remove-unnecessary-e
  Scenario: trigger_webhook.ts internal functions are not exported
    Given "adws/triggers/trigger_webhook.ts" is read
    When searching for exports of "shouldTriggerPrReview", "handleIssueCostRevert", and "resolveWebhookPort"
    Then none of those symbols are prefixed with the "export" keyword
    And all symbols are still defined in the file

  @adw-467hhd-remove-unnecessary-e
  Scenario: getInProgressIssueCount is not exported from concurrencyGuard.ts
    Given "adws/triggers/concurrencyGuard.ts" is read
    When searching for "export" before "getInProgressIssueCount"
    Then "getInProgressIssueCount" is not prefixed with the "export" keyword
    And "getInProgressIssueCount" is still defined in the file

  @adw-467hhd-remove-unnecessary-e
  Scenario: cronProcessGuard.ts internal helpers are not exported
    Given "adws/triggers/cronProcessGuard.ts" is read
    When searching for exports of "getCronPidFilePath", "readCronPid", and "removeCronPid"
    Then none of those symbols are prefixed with the "export" keyword
    And all symbols are still defined in the file

  # ── 6. Backward-compat re-exports removed ───────────────────────────────────

  @adw-467hhd-remove-unnecessary-e
  Scenario: adwBuild.tsx does not re-export parseArguments or printBuildSummary
    Given "adws/adwBuild.tsx" is read
    When searching for re-exports of "parseArguments" and "printBuildSummary"
    Then neither symbol appears in an export statement in "adws/adwBuild.tsx"
    And the originals remain defined in "adws/adwBuildHelpers.ts"

  # ── 7. No import breakage ────────────────────────────────────────────────────

  @adw-467hhd-remove-unnecessary-e @regression
  Scenario: Test suite passes after all exports are removed
    Given all listed exports have had their "export" keyword removed
    And all corresponding barrel re-exports have been cleaned up
    When "bun run test" is executed
    Then the test suite exits with code 0
    And no TypeScript import errors are reported

  @adw-467hhd-remove-unnecessary-e @regression
  Scenario: TypeScript compilation succeeds after export cleanup
    Given all listed exports have had their "export" keyword removed
    When "bunx tsc --noEmit" and "bunx tsc --noEmit -p adws/tsconfig.json" are run
    Then both type-check commands exit with code 0
    And no "Module ... has no exported member" errors are reported
