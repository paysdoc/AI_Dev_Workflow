@adw-e5wrpe-csv-migration-script
Feature: CSV migration script: upload historical cost data to D1

  A one-time migration script at workers/cost-api/migrate.ts reads all
  existing CSV cost files from projects/ and uploads them to D1 via the
  Worker's /api/cost ingest endpoint. It handles both old-format CSVs
  (token counts only, no phase breakdown) and new-format per-issue CSVs
  (full PhaseCostRecord data), skips total-cost.csv files, and marks
  all records as migrated.

  Background:
    Given the ADW codebase is checked out

  # -- 1: Migration script file exists ------------------------------------------

  @adw-e5wrpe-csv-migration-script @regression
  Scenario: Migration script exists at workers/cost-api/migrate.ts
    Then the file "workers/cost-api/migrate.ts" exists

  @adw-e5wrpe-csv-migration-script
  Scenario: Migration script is runnable via bunx tsx
    Given the file "workers/cost-api/migrate.ts" is read
    Then the file has an executable entry point that can be invoked with "bunx tsx workers/cost-api/migrate.ts"

  # -- 2: Project directory scanning ---------------------------------------------

  @adw-e5wrpe-csv-migration-script @regression
  Scenario: Migration script scans all three project directories
    Given the migration script source is read
    Then it scans the directories "projects/AI_Dev_Workflow", "projects/Millennium", and "projects/vestmatic"

  @adw-e5wrpe-csv-migration-script
  Scenario: Migration script discovers CSV files in each project directory
    Given the migration script source is read
    Then it reads CSV files from each project subdirectory under "projects/"

  # -- 3: Old-format CSV parsing -------------------------------------------------

  @adw-e5wrpe-csv-migration-script @regression
  Scenario: Old-format CSV rows are parsed with model, token counts, and cost
    Given an old-format CSV with header "Model,Input Tokens,Output Tokens,Cache Read,Cache Write,Cost (USD)"
    And a data row "claude-opus-4-6,1173,5864,390652,24884,0.5033"
    When the old-format CSV parser processes the file
    Then the parsed record has model "claude-opus-4-6"
    And the parsed record has token_usage with "input" = 1173, "output" = 5864, "cache_read" = 390652, and "cache_write" = 24884
    And the parsed record has computed_cost_usd equal to 0.5033

  @adw-e5wrpe-csv-migration-script @regression
  Scenario: Old-format CSV records have phase set to "unknown"
    Given an old-format CSV file is parsed
    When the migration records are assembled
    Then every record from the old-format CSV has phase "unknown"

  @adw-e5wrpe-csv-migration-script @regression
  Scenario: Issue number and description are extracted from old-format filename
    Given an old-format CSV file named "0-bug-52-fix-expo-command-not-found.csv"
    When the filename is parsed for issue metadata
    Then the issue number is 52
    And the issue description is derived from the filename slug

  @adw-e5wrpe-csv-migration-script
  Scenario: Old-format CSV parser skips the total row
    Given an old-format CSV containing a "Total Cost (USD):" summary row
    When the old-format CSV parser processes the file
    Then the summary row is not included as a cost record

  @adw-e5wrpe-csv-migration-script
  Scenario: Old-format CSV parser handles multiple model rows
    Given an old-format CSV with rows for "claude-opus-4-6", "claude-haiku-4-5-20251001", and "claude-sonnet-4-6"
    When the old-format CSV parser processes the file
    Then 3 records are produced, one per model

  # -- 4: New-format CSV parsing -------------------------------------------------

  @adw-e5wrpe-csv-migration-script @regression
  Scenario: New-format per-issue CSVs are parsed with full PhaseCostRecord data
    Given a new-format per-issue CSV with workflow_id, phase, model, and token columns
    When the new-format CSV parser processes the file
    Then the parsed records contain full phase, model, provider, cost, and token data

  @adw-e5wrpe-csv-migration-script
  Scenario: New-format CSV parsing uses existing parseIssueCostCsv function
    Given the migration script source is read
    Then it imports and uses "parseIssueCostCsv" for new-format CSV files

  @adw-e5wrpe-csv-migration-script
  Scenario: New-format CSV records preserve all PhaseCostRecord fields
    Given a new-format CSV with phase "build", model "claude-sonnet-4-6", status "success", and retry_count 1
    When the new-format CSV parser processes the file
    Then the parsed record has phase "build", model "claude-sonnet-4-6", status "success", and retry_count 1

  # -- 5: Skipping total-cost.csv ------------------------------------------------

  @adw-e5wrpe-csv-migration-script @regression
  Scenario: total-cost.csv files are skipped during migration
    Given the migration script scans a project directory containing "total-cost.csv" and per-issue CSV files
    When the migration collects files to process
    Then "total-cost.csv" is not included in the files to parse

  # -- 6: Migrated flag ----------------------------------------------------------

  @adw-e5wrpe-csv-migration-script @regression
  Scenario: All migrated records have migrated set to true
    Given records from both old-format and new-format CSV files
    When the migration payload is assembled
    Then every record in the payload has "migrated" set to true

  # -- 7: Batching and API upload ------------------------------------------------

  @adw-e5wrpe-csv-migration-script @regression
  Scenario: Records are grouped by project and POSTed in batches
    Given CSV files exist in "projects/AI_Dev_Workflow" and "projects/Millennium"
    When the migration assembles payloads
    Then records from "AI_Dev_Workflow" are grouped under project slug "AI_Dev_Workflow"
    And records from "Millennium" are grouped under project slug "Millennium"
    And each project's records are POSTed to "/api/cost" as separate requests

  @adw-e5wrpe-csv-migration-script
  Scenario: Migration POSTs to the Worker's /api/cost endpoint
    Given the migration script source is read
    Then it sends POST requests to the URL from the COST_API_URL environment variable appended with "/api/cost"

  @adw-e5wrpe-csv-migration-script
  Scenario: Migration includes bearer token authentication
    Given the migration script source is read
    Then it includes an Authorization header with the bearer token from COST_API_TOKEN environment variable

  @adw-e5wrpe-csv-migration-script
  Scenario: Migration payload matches the Worker's ingest format
    Given a batch of migration records for project "AI_Dev_Workflow"
    When the migration payload is assembled
    Then the payload has a "project" field set to "AI_Dev_Workflow"
    And the payload has a "records" array containing the cost records
    And each record includes "issue_number", "phase", "model", "computed_cost_usd", "token_usage", and "migrated"

  # -- 8: Environment variable requirements --------------------------------------

  @adw-e5wrpe-csv-migration-script @regression
  Scenario: Migration requires COST_API_URL and COST_API_TOKEN env vars
    Given the migration script source is read
    Then it reads the "COST_API_URL" environment variable
    And it reads the "COST_API_TOKEN" environment variable

  # -- 9: Old-format CSV detection -----------------------------------------------

  @adw-e5wrpe-csv-migration-script
  Scenario: Old-format CSV files are detected by absence of workflow_id header
    Given a CSV file without a "workflow_id" column in the header
    When the migration determines the file format
    Then it classifies the file as old-format

  @adw-e5wrpe-csv-migration-script
  Scenario: New-format CSV files are detected by presence of workflow_id header
    Given a CSV file with a "workflow_id" column in the header
    When the migration determines the file format
    Then it classifies the file as new-format

  # -- 10: Old-format workflow_id handling ----------------------------------------

  @adw-e5wrpe-csv-migration-script
  Scenario: Old-format CSV records have null workflow_id
    Given an old-format CSV file is parsed
    When the migration records are assembled
    Then every record from the old-format CSV has workflow_id set to null or undefined

  # -- 11: Unit test coverage ----------------------------------------------------

  @adw-e5wrpe-csv-migration-script @regression
  Scenario: Unit tests exist for old-format CSV parser
    Then the directory "workers/cost-api/" contains test files covering old-format CSV parsing

  @adw-e5wrpe-csv-migration-script @regression
  Scenario: Unit tests exist for migration payload assembly
    Then the directory "workers/cost-api/" contains test files covering migration payload assembly

  @adw-e5wrpe-csv-migration-script
  Scenario: Unit tests verify issue number extraction from old-format filenames
    Then the directory "workers/cost-api/" contains test cases for extracting issue numbers from filenames like "0-bug-52-fix-expo.csv"

  @adw-e5wrpe-csv-migration-script
  Scenario: Unit tests verify token_usage map construction from old-format CSV rows
    Then the directory "workers/cost-api/" contains test cases for building token_usage maps from old-format CSV columns
