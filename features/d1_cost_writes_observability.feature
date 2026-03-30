@adw-344-d1-cost-writes-observability
Feature: D1 cost writes in standalone orchestrators and worker observability

  Four orchestrators (adwInit, adwPlan, adwDocument, adwPrReview) manually
  accumulate costs via persistTokenCounts() but never call postCostRecordsToD1().
  They must be migrated to the CostTracker/runPhase pattern so cost data is
  written to D1 after every phase. Additionally, both Cloudflare Workers
  (cost-api, screenshot-router) lack observability configuration.

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

  # -- 3: adwDocument uses CostTracker/runPhase pattern ----------------------------

  @adw-344-d1-cost-writes-observability @regression
  Scenario: adwDocument orchestrator imports CostTracker and runPhase from phaseRunner
    Given "adws/adwDocument.tsx" is read
    Then the file imports "CostTracker" from "core/phaseRunner" or "../core/phaseRunner"
    And the file imports "runPhase" from "core/phaseRunner" or "../core/phaseRunner"

  @adw-344-d1-cost-writes-observability @regression
  Scenario: adwDocument orchestrator instantiates a CostTracker
    Given "adws/adwDocument.tsx" is read
    Then the file contains "new CostTracker()"

  @adw-344-d1-cost-writes-observability
  Scenario: adwDocument orchestrator does not manually track totalCostUsd
    Given "adws/adwDocument.tsx" is read
    Then the file does not declare a local "totalCostUsd" variable
    And the file does not call "persistTokenCounts" directly

  # -- 4: adwPrReview uses CostTracker/runPhase pattern ----------------------------

  @adw-344-d1-cost-writes-observability @regression
  Scenario: adwPrReview orchestrator imports CostTracker and runPhase from phaseRunner
    Given "adws/adwPrReview.tsx" is read
    Then the file imports "CostTracker" from "core/phaseRunner" or "../core/phaseRunner"
    And the file imports "runPhase" from "core/phaseRunner" or "../core/phaseRunner"

  @adw-344-d1-cost-writes-observability @regression
  Scenario: adwPrReview orchestrator instantiates a CostTracker
    Given "adws/adwPrReview.tsx" is read
    Then the file contains "new CostTracker()"

  @adw-344-d1-cost-writes-observability @regression
  Scenario: adwPrReview orchestrator does not manually accumulate cost variables
    Given "adws/adwPrReview.tsx" is read
    Then the file does not declare a local "totalCostUsd" variable
    And the file does not declare a local "totalModelUsage" variable
    And the file does not call "mergeModelUsageMaps" directly
    And the file does not call "persistTokenCounts" directly

  @adw-344-d1-cost-writes-observability
  Scenario: adwPrReview orchestrator does not call computeDisplayTokens directly
    Given "adws/adwPrReview.tsx" is read
    Then the file does not call "computeDisplayTokens" directly
    And the file does not import "computeDisplayTokens"

  # -- 5: No standalone orchestrator uses manual cost pattern ----------------------

  @adw-344-d1-cost-writes-observability @regression
  Scenario: No orchestrator imports persistTokenCounts without CostTracker
    Given the orchestrator files "adws/adwInit.tsx", "adws/adwPlan.tsx", "adws/adwDocument.tsx", and "adws/adwPrReview.tsx" are read
    Then none of the files import "persistTokenCounts" from the cost module
    And all of the files import "CostTracker" from "core/phaseRunner"

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
