@adw-viahyb-cost-api-worker-d1-s
Feature: Cost API Worker: D1 schema, auth, and ingest endpoint

  A Cloudflare Worker at workers/cost-api/ accepts cost records via
  POST /api/cost and persists them to a D1 database (adw-costs).
  The Worker validates bearer token auth, resolves project slugs
  (auto-creating rows for unknown slugs), inserts cost records, and
  fans out token usage into a separate table.

  Background:
    Given the ADW codebase is checked out

  # ── 1: Worker scaffold ────────────────────────────────────────────────────

  @adw-viahyb-cost-api-worker-d1-s @regression
  Scenario: Worker directory exists with required files
    Then the directory "workers/cost-api/" exists
    And the file "workers/cost-api/wrangler.toml" exists
    And the file "workers/cost-api/src/index.ts" exists

  @adw-viahyb-cost-api-worker-d1-s @regression
  Scenario: D1 schema SQL file exists
    Then the file "workers/cost-api/src/schema.sql" exists
    And the schema SQL defines a "projects" table
    And the schema SQL defines a "cost_records" table
    And the schema SQL defines a "token_usage" table

  @adw-viahyb-cost-api-worker-d1-s
  Scenario: Wrangler config binds D1 database and routes to costs.paysdoc.nl
    Given the file "workers/cost-api/wrangler.toml" is read
    Then the config contains a D1 binding for "adw-costs"
    And the config routes to "costs.paysdoc.nl/*"

  # ── 2: D1 schema structure ────────────────────────────────────────────────

  @adw-viahyb-cost-api-worker-d1-s @regression
  Scenario: Projects table has required columns
    Given the file "workers/cost-api/src/schema.sql" is read
    Then the "projects" table has columns "id", "slug", "name", "repo_url", and "created_at"
    And the "slug" column has a UNIQUE constraint

  @adw-viahyb-cost-api-worker-d1-s @regression
  Scenario: Cost records table has required columns
    Given the file "workers/cost-api/src/schema.sql" is read
    Then the "cost_records" table has columns "id", "project_id", "workflow_id", "issue_number", "phase", "model", "provider", "computed_cost_usd", "reported_cost_usd", "status", "retry_count", "continuation_count", "duration_ms", "timestamp", and "migrated"
    And the "project_id" column references "projects(id)"

  @adw-viahyb-cost-api-worker-d1-s @regression
  Scenario: Token usage table has required columns
    Given the file "workers/cost-api/src/schema.sql" is read
    Then the "token_usage" table has columns "id", "cost_record_id", "token_type", and "count"
    And the "cost_record_id" column references "cost_records(id)"

  @adw-viahyb-cost-api-worker-d1-s
  Scenario: Cost records table includes issue_description column
    Given the file "workers/cost-api/src/schema.sql" is read
    Then the "cost_records" table has an "issue_description" column

  # ── 3: Bearer token auth ──────────────────────────────────────────────────

  @adw-viahyb-cost-api-worker-d1-s @regression
  Scenario: Missing bearer token returns 401
    Given the Cost API Worker is running
    When a POST request is sent to "/api/cost" without an Authorization header
    Then the response status is 401
    And the response body contains "Unauthorized"

  @adw-viahyb-cost-api-worker-d1-s @regression
  Scenario: Invalid bearer token returns 401
    Given the Cost API Worker is running
    When a POST request is sent to "/api/cost" with an invalid bearer token
    Then the response status is 401
    And the response body contains "Unauthorized"

  @adw-viahyb-cost-api-worker-d1-s
  Scenario: Valid bearer token allows request to proceed
    Given the Cost API Worker is running
    When a POST request is sent to "/api/cost" with a valid bearer token and a valid payload
    Then the response status is 201

  # ── 4: Malformed payload handling ─────────────────────────────────────────

  @adw-viahyb-cost-api-worker-d1-s @regression
  Scenario: Missing project field returns 400
    Given the Cost API Worker is running and authenticated
    When a POST request is sent to "/api/cost" with a payload missing the "project" field
    Then the response status is 400
    And the response body contains a descriptive error message

  @adw-viahyb-cost-api-worker-d1-s
  Scenario: Missing records array returns 400
    Given the Cost API Worker is running and authenticated
    When a POST request is sent to "/api/cost" with a payload missing the "records" array
    Then the response status is 400
    And the response body contains a descriptive error message

  @adw-viahyb-cost-api-worker-d1-s
  Scenario: Empty records array returns 400
    Given the Cost API Worker is running and authenticated
    When a POST request is sent to "/api/cost" with an empty "records" array
    Then the response status is 400
    And the response body contains a descriptive error message

  @adw-viahyb-cost-api-worker-d1-s
  Scenario: Non-JSON body returns 400
    Given the Cost API Worker is running and authenticated
    When a POST request is sent to "/api/cost" with a non-JSON body
    Then the response status is 400
    And the response body contains a descriptive error message

  # ── 5: Successful ingest ──────────────────────────────────────────────────

  @adw-viahyb-cost-api-worker-d1-s @regression
  Scenario: Single record insert returns 201 with inserted count
    Given the Cost API Worker is running and authenticated
    When a POST request is sent to "/api/cost" with a single valid cost record
    Then the response status is 201
    And the response body contains "inserted" equal to 1

  @adw-viahyb-cost-api-worker-d1-s @regression
  Scenario: Batch insert returns 201 with correct inserted count
    Given the Cost API Worker is running and authenticated
    When a POST request is sent to "/api/cost" with 3 valid cost records
    Then the response status is 201
    And the response body contains "inserted" equal to 3

  @adw-viahyb-cost-api-worker-d1-s
  Scenario: Inserted cost record is persisted in the cost_records table
    Given the Cost API Worker is running and authenticated
    When a valid cost record is POSTed for project "test-project" with phase "build" and model "claude-sonnet-4-6"
    Then the D1 cost_records table contains a row with phase "build" and model "claude-sonnet-4-6"

  # ── 6: Project auto-creation ──────────────────────────────────────────────

  @adw-viahyb-cost-api-worker-d1-s @regression
  Scenario: Unknown project slug auto-creates a project row
    Given the Cost API Worker is running and authenticated
    And no project with slug "new-project" exists in D1
    When a POST request is sent to "/api/cost" with project slug "new-project"
    Then a project row with slug "new-project" is created in D1
    And the response status is 201

  @adw-viahyb-cost-api-worker-d1-s @regression
  Scenario: Auto-created project defaults name to slug when name not provided
    Given the Cost API Worker is running and authenticated
    When a POST request is sent to "/api/cost" with project slug "auto-name-test" and no "name" field
    Then the project row for "auto-name-test" has name equal to "auto-name-test"

  @adw-viahyb-cost-api-worker-d1-s
  Scenario: Optional name field enriches auto-created project row
    Given the Cost API Worker is running and authenticated
    When a POST request is sent to "/api/cost" with project slug "enriched-project" and name "Enriched Project"
    Then the project row for "enriched-project" has name equal to "Enriched Project"

  @adw-viahyb-cost-api-worker-d1-s
  Scenario: Optional repo_url field enriches auto-created project row
    Given the Cost API Worker is running and authenticated
    When a POST request is sent to "/api/cost" with project slug "repo-test" and repo_url "https://github.com/test/repo"
    Then the project row for "repo-test" has repo_url equal to "https://github.com/test/repo"

  @adw-viahyb-cost-api-worker-d1-s @regression
  Scenario: Duplicate project slug resolves to existing project
    Given the Cost API Worker is running and authenticated
    And a project with slug "existing-project" already exists in D1
    When a POST request is sent to "/api/cost" with project slug "existing-project"
    Then the cost record is linked to the existing project row
    And no duplicate project row is created

  # ── 7: Token usage fan-out ────────────────────────────────────────────────

  @adw-viahyb-cost-api-worker-d1-s @regression
  Scenario: Token usage map is fanned out into token_usage rows
    Given the Cost API Worker is running and authenticated
    When a cost record is POSTed with token_usage containing "input" = 500, "output" = 25000, "cache_read" = 1500000, and "cache_write" = 80000
    Then the D1 token_usage table contains 4 rows for that cost record
    And the rows have token_type values "input", "output", "cache_read", and "cache_write"
    And the counts match the posted values

  @adw-viahyb-cost-api-worker-d1-s
  Scenario: Token usage with a single token type creates one row
    Given the Cost API Worker is running and authenticated
    When a cost record is POSTed with token_usage containing only "output" = 1000
    Then the D1 token_usage table contains 1 row for that cost record
    And the row has token_type "output" and count 1000

  @adw-viahyb-cost-api-worker-d1-s
  Scenario: Batch insert fans out token usage for each record independently
    Given the Cost API Worker is running and authenticated
    When 2 cost records are POSTed, each with different token_usage maps
    Then each cost record has its own set of token_usage rows in D1

  # ── 8: Vitest + Miniflare test coverage ───────────────────────────────────

  @adw-viahyb-cost-api-worker-d1-s @regression
  Scenario: Vitest tests exist for the Cost API Worker
    Then the directory "workers/cost-api/" contains test files
    And the test files use Vitest and Miniflare for Worker testing

  @adw-viahyb-cost-api-worker-d1-s @regression
  Scenario: Tests cover successful insert, auth rejection, and malformed payload
    Given the Cost API Worker test files are read
    Then there are tests for successful record insertion
    And there are tests for authentication rejection
    And there are tests for malformed payload handling

  @adw-viahyb-cost-api-worker-d1-s @regression
  Scenario: Tests cover project auto-creation and token_usage fan-out
    Given the Cost API Worker test files are read
    Then there are tests for project auto-creation on unknown slug
    And there are tests for token_usage fan-out into the token_usage table

  @adw-viahyb-cost-api-worker-d1-s
  Scenario: Tests cover duplicate project slug resolution
    Given the Cost API Worker test files are read
    Then there are tests for duplicate project slug resolving to the same project_id
