@adw-g2u55r-adw-d1-client-and-du
Feature: D1 client module and dual-write integration

  A new HTTP client module in adws/cost/ transforms PhaseCostRecord arrays
  into the Worker's snake_case ingest payload and POSTs them to costs.paysdoc.nl.
  The client is wired into phaseCostCommit.ts so that cost data is written
  to both D1 and CSV (dual-write). D1 writes are skipped when COST_API_URL
  is not configured, and failures log a warning without crashing.

  Background:
    Given the ADW codebase is checked out

  # -- 1: D1 client module exists ---------------------------------------------------

  @adw-g2u55r-adw-d1-client-and-du @regression
  Scenario: D1 client module exists in adws/cost/
    Then a D1 client module exists under "adws/cost/"
    And it exports a function that accepts PhaseCostRecord arrays

  @adw-g2u55r-adw-d1-client-and-du
  Scenario: D1 client module has a clean public interface
    Given the D1 client module source is read
    Then the exported function accepts PhaseCostRecord[], a project slug, and optional project metadata
    And the function returns a Promise

  # -- 2: PhaseCostRecord to ingest payload transformation --------------------------

  @adw-g2u55r-adw-d1-client-and-du @regression
  Scenario: PhaseCostRecord fields are transformed to snake_case in the payload
    Given a PhaseCostRecord with workflowId "abc123", issueNumber 42, phase "build", model "claude-sonnet-4-6", provider "anthropic", computedCostUsd 1.50, reportedCostUsd 1.48, status "success", retryCount 0, contextResetCount 1, and durationMs 120000
    When the D1 client transforms the record to the ingest payload
    Then the payload record contains "workflow_id" = "abc123"
    And the payload record contains "issue_number" = 42
    And the payload record contains "phase" = "build"
    And the payload record contains "model" = "claude-sonnet-4-6"
    And the payload record contains "provider" = "anthropic"
    And the payload record contains "computed_cost_usd" = 1.50
    And the payload record contains "reported_cost_usd" = 1.48
    And the payload record contains "status" = "success"
    And the payload record contains "retry_count" = 0
    And the payload record contains "continuation_count" = 1
    And the payload record contains "duration_ms" = 120000

  @adw-g2u55r-adw-d1-client-and-du @regression
  Scenario: tokenUsage map is included as snake_case token_usage in the payload
    Given a PhaseCostRecord with tokenUsage containing "input" = 500, "output" = 25000, "cache_read" = 1500000, and "cache_write" = 80000
    When the D1 client transforms the record to the ingest payload
    Then the payload record contains a "token_usage" map with "input" = 500, "output" = 25000, "cache_read" = 1500000, and "cache_write" = 80000

  @adw-g2u55r-adw-d1-client-and-du
  Scenario: Timestamp field is included in the payload
    Given a PhaseCostRecord with timestamp "2026-03-27T10:00:00Z"
    When the D1 client transforms the record to the ingest payload
    Then the payload record contains "timestamp" = "2026-03-27T10:00:00Z"

  @adw-g2u55r-adw-d1-client-and-du
  Scenario: Project slug is set as the top-level "project" field in the payload
    Given PhaseCostRecords for project slug "AI_Dev_Workflow"
    When the D1 client assembles the ingest payload
    Then the payload has "project" = "AI_Dev_Workflow"

  @adw-g2u55r-adw-d1-client-and-du
  Scenario: Optional project name and repo_url are included in the payload
    Given PhaseCostRecords for project slug "AI_Dev_Workflow" with name "AI Dev Workflow" and repo_url "https://github.com/paysdoc/AI_Dev_Workflow"
    When the D1 client assembles the ingest payload
    Then the payload has "name" = "AI Dev Workflow"
    And the payload has "repo_url" = "https://github.com/paysdoc/AI_Dev_Workflow"

  @adw-g2u55r-adw-d1-client-and-du
  Scenario: Multiple PhaseCostRecords produce a records array in the payload
    Given 3 PhaseCostRecords for different phases
    When the D1 client assembles the ingest payload
    Then the payload "records" array contains 3 items

  # -- 3: Auth header ---------------------------------------------------------------

  @adw-g2u55r-adw-d1-client-and-du @regression
  Scenario: Auth header is set from COST_API_TOKEN env var
    Given COST_API_URL is set to "https://costs.paysdoc.nl"
    And COST_API_TOKEN is set to "test-token-abc"
    When the D1 client sends a request
    Then the request includes an Authorization header with value "Bearer test-token-abc"

  @adw-g2u55r-adw-d1-client-and-du
  Scenario: Request is POSTed to COST_API_URL/api/cost
    Given COST_API_URL is set to "https://costs.paysdoc.nl"
    When the D1 client sends a request
    Then the request URL is "https://costs.paysdoc.nl/api/cost"
    And the request method is "POST"
    And the Content-Type header is "application/json"

  # -- 4: Skip behavior when COST_API_URL is not set --------------------------------

  @adw-g2u55r-adw-d1-client-and-du @regression
  Scenario: D1 write is skipped when COST_API_URL is not set
    Given COST_API_URL is not set
    When the D1 client is called with PhaseCostRecords
    Then no HTTP request is made
    And no error is thrown
    And no warning is logged

  @adw-g2u55r-adw-d1-client-and-du
  Scenario: D1 write is skipped when COST_API_URL is an empty string
    Given COST_API_URL is set to ""
    When the D1 client is called with PhaseCostRecords
    Then no HTTP request is made
    And no error is thrown

  # -- 5: Error handling - D1 write failures ----------------------------------------

  @adw-g2u55r-adw-d1-client-and-du @regression
  Scenario: Network failure logs a warning but does not crash the workflow
    Given COST_API_URL is set and COST_API_TOKEN is set
    And the fetch request will fail with a network error
    When the D1 client is called with PhaseCostRecords
    Then a warning is logged containing the error details
    And no error is thrown

  @adw-g2u55r-adw-d1-client-and-du
  Scenario: HTTP 401 response logs a warning but does not crash
    Given COST_API_URL is set and COST_API_TOKEN is set
    And the fetch request returns status 401 with body "Unauthorized"
    When the D1 client is called with PhaseCostRecords
    Then a warning is logged mentioning the 401 status
    And no error is thrown

  @adw-g2u55r-adw-d1-client-and-du
  Scenario: HTTP 400 response logs a warning but does not crash
    Given COST_API_URL is set and COST_API_TOKEN is set
    And the fetch request returns status 400 with body "Missing project field"
    When the D1 client is called with PhaseCostRecords
    Then a warning is logged mentioning the 400 status
    And no error is thrown

  @adw-g2u55r-adw-d1-client-and-du
  Scenario: HTTP 500 response logs a warning but does not crash
    Given COST_API_URL is set and COST_API_TOKEN is set
    And the fetch request returns status 500 with body "Internal Server Error"
    When the D1 client is called with PhaseCostRecords
    Then a warning is logged mentioning the 500 status
    And no error is thrown

  # -- 6: D1-only write integration in phaseRunner ---------------------------------

  @adw-g2u55r-adw-d1-client-and-du @regression
  Scenario: phaseRunner writes cost data to D1
    Given the file "adws/core/phaseRunner.ts" is read
    Then the file imports "postCostRecordsToD1" from the cost module

  # -- 7: Environment variable configuration ----------------------------------------

  @adw-g2u55r-adw-d1-client-and-du @regression
  Scenario: COST_API_URL and COST_API_TOKEN are documented in .env.sample
    Given the file ".env.sample" is read
    Then the file contains a COST_API_URL entry
    And the file contains a COST_API_TOKEN entry

  @adw-g2u55r-adw-d1-client-and-du
  Scenario: COST_API_URL and COST_API_TOKEN entries are marked as optional
    Given the file ".env.sample" is read
    Then the COST_API_URL entry is commented out or marked as optional
    And the COST_API_TOKEN entry is commented out or marked as optional

  # -- 8: Unit tests with mocked fetch ----------------------------------------------

  @adw-g2u55r-adw-d1-client-and-du @regression
  Scenario: Unit tests exist for the D1 client module
    Then the directory "adws/cost/__tests__/" contains test files covering the D1 client

  @adw-g2u55r-adw-d1-client-and-du @regression
  Scenario: Unit tests cover payload shape transformation
    Given the D1 client test files are read
    Then there are tests verifying PhaseCostRecord to snake_case payload transformation

  @adw-g2u55r-adw-d1-client-and-du @regression
  Scenario: Unit tests cover auth header inclusion
    Given the D1 client test files are read
    Then there are tests verifying the Authorization header contains the bearer token

  @adw-g2u55r-adw-d1-client-and-du @regression
  Scenario: Unit tests cover skip behavior when COST_API_URL is not set
    Given the D1 client test files are read
    Then there are tests verifying no fetch is called when COST_API_URL is absent

  @adw-g2u55r-adw-d1-client-and-du @regression
  Scenario: Unit tests cover error handling on fetch failure
    Given the D1 client test files are read
    Then there are tests verifying warnings are logged and no errors thrown on fetch failure

  @adw-g2u55r-adw-d1-client-and-du
  Scenario: Unit tests cover error handling for non-2xx responses
    Given the D1 client test files are read
    Then there are tests verifying warnings are logged for 401, 400, and 500 responses

  # -- 9: Type checks pass ----------------------------------------------------------

  @adw-g2u55r-adw-d1-client-and-du @regression
  Scenario: TypeScript type-check passes after D1 client integration
    Given the ADW codebase with the D1 client module added
    When "bunx tsc --noEmit" is run
    Then the command exits with code 0
    And "bunx tsc --noEmit -p adws/tsconfig.json" also exits with code 0
