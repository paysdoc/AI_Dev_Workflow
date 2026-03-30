@adw-344-d1-cost-writes-observability
Feature: D1 cost writes in standalone orchestrators and worker observability

  Four orchestrators (adwInit, adwPlan, adwDocument, adwPrReview) manually
  accumulate costs via persistTokenCounts() but never call postCostRecordsToD1().
  adwInit and adwPlan are migrated to the CostTracker/runPhase pattern.
  adwDocument and adwPrReview lack a WorkflowConfig, so they use direct
  createPhaseCostRecords + postCostRecordsToD1 calls instead.
  Additionally, both Cloudflare Workers (cost-api, screenshot-router) lack
  observability configuration.

  Background:
    Given the ADW codebase is checked out

  # -- 1: adwInit uses CostTracker/runPhase pattern --------------------------------

  @adw-344-d1-cost-writes-observability @regression
  Scenario: adwInit orchestrator imports CostTracker and runPhase from phaseRunner
    Given "adws/adwInit.tsx" is read
    Then the file imports "CostTracker" from "core/phaseRunner" or "../core/phaseRunner"
    And the file imports "runPhase" from "core/phaseRunner" or "../core/phaseRunner"

  @adw-344-d1-cost-writes-observability @regression
  Scenario: adwInit orchestrator instantiates a CostTracker
    Given "adws/adwInit.tsx" is read
    Then the file contains "new CostTracker()"

  @adw-344-d1-cost-writes-observability @regression
  Scenario: adwInit orchestrator does not manually accumulate cost variables
    Given "adws/adwInit.tsx" is read
    Then the file does not declare a local "totalCostUsd" variable
    And the file does not declare a local "totalModelUsage" variable
    And the file does not call "mergeModelUsageMaps" directly

  @adw-344-d1-cost-writes-observability
  Scenario: adwInit orchestrator does not call persistTokenCounts directly
    Given "adws/adwInit.tsx" is read
    Then the file does not call "persistTokenCounts" directly
    And the file does not import "persistTokenCounts"

  @adw-344-d1-cost-writes-observability
  Scenario: adwInit passes tracker totals to completeWorkflow
    Given "adws/adwInit.tsx" is read
    Then the file passes "tracker.totalCostUsd" and "tracker.totalModelUsage" to completeWorkflow

  # -- 2: adwPlan uses CostTracker/runPhase pattern --------------------------------

  @adw-344-d1-cost-writes-observability @regression
  Scenario: adwPlan orchestrator imports CostTracker and runPhase from phaseRunner
    Given "adws/adwPlan.tsx" is read
    Then the file imports "CostTracker" from "core/phaseRunner" or "../core/phaseRunner"
    And the file imports "runPhase" from "core/phaseRunner" or "../core/phaseRunner"

  @adw-344-d1-cost-writes-observability @regression
  Scenario: adwPlan orchestrator instantiates a CostTracker
    Given "adws/adwPlan.tsx" is read
    Then the file contains "new CostTracker()"

  @adw-344-d1-cost-writes-observability @regression
  Scenario: adwPlan orchestrator does not manually accumulate cost variables
    Given "adws/adwPlan.tsx" is read
    Then the file does not declare a local "totalCostUsd" variable
    And the file does not declare a local "totalModelUsage" variable
    And the file does not call "mergeModelUsageMaps" directly

  @adw-344-d1-cost-writes-observability
  Scenario: adwPlan orchestrator does not call persistTokenCounts directly
    Given "adws/adwPlan.tsx" is read
    Then the file does not call "persistTokenCounts" directly
    And the file does not import "persistTokenCounts"

  # -- 3: adwDocument posts cost records to D1 directly ----------------------------
  #    adwDocument uses AgentStateManager (no WorkflowConfig), so CostTracker/
  #    runPhase cannot be used. Direct createPhaseCostRecords + postCostRecordsToD1
  #    calls are used instead.

  @adw-344-d1-cost-writes-observability @regression
  Scenario: adwDocument orchestrator imports D1 cost write functions
    Given "adws/adwDocument.tsx" is read
    Then the file imports "createPhaseCostRecords" from the cost module
    And the file imports "postCostRecordsToD1" from the cost d1Client module

  @adw-344-d1-cost-writes-observability @regression
  Scenario: adwDocument orchestrator posts cost records to D1 after agent completes
    Given "adws/adwDocument.tsx" is read
    Then the file calls "createPhaseCostRecords" to build cost records
    And the file calls "postCostRecordsToD1" to send records to D1

  # -- 4: adwPrReview posts cost records to D1 directly ----------------------------
  #    adwPrReview uses PRReviewWorkflowConfig (not WorkflowConfig), so
  #    CostTracker/runPhase cannot be used. Direct createPhaseCostRecords +
  #    postCostRecordsToD1 calls are added per phase via a local helper.

  @adw-344-d1-cost-writes-observability @regression
  Scenario: adwPrReview orchestrator imports D1 cost write functions
    Given "adws/adwPrReview.tsx" is read
    Then the file imports "createPhaseCostRecords" from the cost module
    And the file imports "postCostRecordsToD1" from the cost d1Client module

  @adw-344-d1-cost-writes-observability @regression
  Scenario: adwPrReview orchestrator posts cost records to D1 for install, plan, and build phases
    Given "adws/adwPrReview.tsx" is read
    Then the file calls "postCostRecordsToD1" after the install phase
    And the file calls "postCostRecordsToD1" after the plan phase
    And the file calls "postCostRecordsToD1" after the build phase

  @adw-344-d1-cost-writes-observability
  Scenario: adwPrReview orchestrator does not post to D1 for test phase
    Given "adws/adwPrReview.tsx" is read
    Then the test phase D1 write is handled internally by prReviewCompletion

  # -- 5: All standalone orchestrators write cost data to D1 -----------------------

  @adw-344-d1-cost-writes-observability @regression
  Scenario: adwInit and adwPlan use CostTracker for D1 writes
    Given the orchestrator files "adws/adwInit.tsx" and "adws/adwPlan.tsx" are read
    Then both files import "CostTracker" from "core/phaseRunner"
    And neither file imports "persistTokenCounts"

  @adw-344-d1-cost-writes-observability @regression
  Scenario: adwDocument and adwPrReview use direct D1 cost writes
    Given the orchestrator files "adws/adwDocument.tsx" and "adws/adwPrReview.tsx" are read
    Then both files import "createPhaseCostRecords" from the cost module
    And both files import "postCostRecordsToD1" from the cost d1Client module

  # -- 6: Worker observability configuration ---------------------------------------

  @adw-344-d1-cost-writes-observability @regression
  Scenario: Cost API worker has observability enabled
    Given the file "workers/cost-api/wrangler.toml" is read
    Then the file contains an "[observability]" section
    And the observability section has "enabled = true"

  @adw-344-d1-cost-writes-observability @regression
  Scenario: Screenshot router worker has observability enabled
    Given the file "workers/screenshot-router/wrangler.toml" is read
    Then the file contains an "[observability]" section
    And the observability section has "enabled = true"

  # -- 7: Type checks pass --------------------------------------------------------

  @adw-344-d1-cost-writes-observability @regression
  Scenario: TypeScript type-check passes after orchestrator migration
    Given the ADW codebase with migrated orchestrators
    When "bunx tsc --noEmit" is run
    Then the command exits with code 0

  @adw-344-d1-cost-writes-observability @regression
  Scenario: TypeScript type-check passes with adws tsconfig after migration
    Given the ADW codebase with migrated orchestrators
    When "bunx tsc --noEmit -p adws/tsconfig.json" is run
    Then the command exits with code 0

  # -- 8: Unit tests pass ---------------------------------------------------------

  @adw-344-d1-cost-writes-observability @regression
  Scenario: All unit tests pass after orchestrator migration
    Given the ADW codebase with migrated orchestrators
    When "bun run test" is run
    Then all unit tests pass
