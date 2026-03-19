@adw-l1x9x9-cost-revamp-phasecos
Feature: PhaseCostRecord data model, CSV output in new format, and per-phase cost commits

  The cost module is revamped to introduce a PhaseCostRecord model that captures
  one record per model per phase. CSV output is rewritten to a new format with
  fixed superset columns (input, output, cache_read, cache_write, reasoning)
  plus dynamic columns for unknown token types. Exchange rate logic moves to a
  dedicated module. Cost CSV files are committed after each phase completion,
  not only at workflow end.

  Background:
    Given the ADW codebase is checked out

  # ── 1: PhaseCostRecord type definition ─────────────────────────────────────

  @adw-l1x9x9-cost-revamp-phasecos @regression
  Scenario: PhaseCostRecord type includes all required fields
    Given the cost type definitions are read
    Then PhaseCostRecord includes field "workflowId" of type string
    And PhaseCostRecord includes field "issueNumber" of type number
    And PhaseCostRecord includes field "phase" of type string
    And PhaseCostRecord includes field "model" of type string
    And PhaseCostRecord includes field "provider" of type string
    And PhaseCostRecord includes field "tokenUsage" as a Record of string to number
    And PhaseCostRecord includes field "computedCostUsd" of type number
    And PhaseCostRecord includes field "reportedCostUsd" of type number
    And PhaseCostRecord includes field "status" of type string
    And PhaseCostRecord includes field "retryCount" of type number
    And PhaseCostRecord includes field "continuationCount" of type number
    And PhaseCostRecord includes field "durationMs" of type number
    And PhaseCostRecord includes field "timestamp" of type string
    And PhaseCostRecord includes field "estimatedTokens" of type number
    And PhaseCostRecord includes field "actualTokens" of type number

  @adw-l1x9x9-cost-revamp-phasecos @regression
  Scenario: PhaseCostRecord status field accepts success, partial, and failed values
    Given the cost type definitions are read
    Then PhaseCostRecord status field allows "success", "partial", and "failed"

  # ── 2: Phase files produce PhaseCostRecord instances ───────────────────────

  @adw-l1x9x9-cost-revamp-phasecos @regression
  Scenario: planPhase produces PhaseCostRecord instances
    Given "adws/phases/planPhase.ts" is read
    Then the plan phase produces or returns PhaseCostRecord instances

  @adw-l1x9x9-cost-revamp-phasecos @regression
  Scenario: buildPhase produces PhaseCostRecord instances
    Given "adws/phases/buildPhase.ts" is read
    Then the build phase produces or returns PhaseCostRecord instances

  @adw-l1x9x9-cost-revamp-phasecos @regression
  Scenario: testPhase produces PhaseCostRecord instances
    Given "adws/phases/testPhase.ts" is read
    Then the test phase produces or returns PhaseCostRecord instances

  @adw-l1x9x9-cost-revamp-phasecos
  Scenario: prPhase produces PhaseCostRecord instances
    Given "adws/phases/prPhase.ts" is read
    Then the PR phase produces or returns PhaseCostRecord instances

  @adw-l1x9x9-cost-revamp-phasecos
  Scenario: reviewPhase produces PhaseCostRecord instances
    Given "adws/phases/prReviewPhase.ts" is read
    Then the review phase produces or returns PhaseCostRecord instances

  @adw-l1x9x9-cost-revamp-phasecos
  Scenario: documentPhase produces PhaseCostRecord instances
    Given "adws/phases/documentPhase.ts" is read
    Then the document phase produces or returns PhaseCostRecord instances

  @adw-l1x9x9-cost-revamp-phasecos
  Scenario: scenarioPhase produces PhaseCostRecord instances
    Given "adws/phases/scenarioPhase.ts" is read
    Then the scenario phase produces or returns PhaseCostRecord instances

  @adw-l1x9x9-cost-revamp-phasecos
  Scenario: kpiPhase produces PhaseCostRecord instances
    Given "adws/phases/kpiPhase.ts" is read
    Then the KPI phase produces or returns PhaseCostRecord instances

  # ── 3: Per-issue CSV format ────────────────────────────────────────────────

  @adw-l1x9x9-cost-revamp-phasecos @regression
  Scenario: Per-issue CSV contains one row per model per phase
    Given "adws/cost/reporting/csvWriter.ts" is read
    Then the per-issue CSV writer produces one row per model per phase from PhaseCostRecord data

  @adw-l1x9x9-cost-revamp-phasecos @regression
  Scenario: Per-issue CSV includes all PhaseCostRecord fields as columns
    Given "adws/cost/reporting/csvWriter.ts" is read
    Then the per-issue CSV header includes columns for workflowId, issueNumber, phase, model, provider, computedCostUsd, reportedCostUsd, status, retryCount, continuationCount, durationMs, and timestamp

  @adw-l1x9x9-cost-revamp-phasecos @regression
  Scenario: Per-issue CSV includes fixed superset token columns
    Given "adws/cost/reporting/csvWriter.ts" is read
    Then the per-issue CSV header includes the fixed token columns "input", "output", "cache_read", "cache_write", and "reasoning"

  @adw-l1x9x9-cost-revamp-phasecos @regression
  Scenario: Unknown token types are auto-appended as extra CSV columns
    Given "adws/cost/reporting/csvWriter.ts" is read
    Then the CSV writer dynamically appends columns for token types not in the fixed superset

  # ── 4: Project total CSV format ────────────────────────────────────────────

  @adw-l1x9x9-cost-revamp-phasecos @regression
  Scenario: Project total CSV contains one row per issue per phase
    Given "adws/cost/reporting/csvWriter.ts" is read
    Then the project total CSV writer produces one row per issue per phase

  @adw-l1x9x9-cost-revamp-phasecos @regression
  Scenario: Project total CSV does not include a markup column
    Given "adws/cost/reporting/csvWriter.ts" is read
    Then the project total CSV does not contain a "markup" or "Markup" column

  # ── 5: Exchange rate module ────────────────────────────────────────────────

  @adw-l1x9x9-cost-revamp-phasecos @regression
  Scenario: Exchange rate logic lives in adws/cost/exchangeRates.ts
    Given "adws/cost/exchangeRates.ts" is read
    Then the file contains exchange rate conversion logic

  @adw-l1x9x9-cost-revamp-phasecos
  Scenario: costReport.ts no longer contains exchange rate logic
    Given "adws/core/costReport.ts" is read
    Then the file does not contain inline exchange rate conversion functions

  # ── 6: Per-phase CSV commits ───────────────────────────────────────────────

  @adw-l1x9x9-cost-revamp-phasecos @regression
  Scenario: Cost CSV is committed after each phase completion
    Given the ADW workflow orchestrator files are read
    Then cost CSV commit is triggered after each phase completes, not only at workflow end

  @adw-l1x9x9-cost-revamp-phasecos
  Scenario: Per-phase commits use the existing costCommitQueue
    Given "adws/core/costCommitQueue.ts" is read
    Then the cost commit queue is used for per-phase cost commits

  # ── 7: Unit test coverage ──────────────────────────────────────────────────

  @adw-l1x9x9-cost-revamp-phasecos @regression
  Scenario: Unit tests cover CSV serialization with various token types
    Given the cost module test files exist
    Then there are unit tests for CSV serialization with standard token types
    And there are unit tests for CSV serialization with mixed known and unknown token types

  @adw-l1x9x9-cost-revamp-phasecos @regression
  Scenario: Unit tests cover dynamic column generation for unknown token types
    Given the cost module test files exist
    Then there are unit tests verifying that unknown token types produce extra CSV columns

  @adw-l1x9x9-cost-revamp-phasecos @regression
  Scenario: Unit tests cover project total aggregation
    Given the cost module test files exist
    Then there are unit tests for project total CSV aggregation from multiple PhaseCostRecord entries

  # ── 8: Type-check passes ───────────────────────────────────────────────────

  @adw-l1x9x9-cost-revamp-phasecos @regression
  Scenario: TypeScript type-check passes after cost module revamp
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
