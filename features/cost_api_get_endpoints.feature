@adw-48ki7w-add-get-endpoints-fo
Feature: Cost API Worker: GET endpoints for projects, breakdown, and issues

  The cost-api worker exposes three authenticated GET endpoints so
  the paysdoc.nl marketing site can consume cost data via HTTP
  instead of querying D1 directly. All endpoints live under /api,
  use bearer-token auth (COST_API_TOKEN), return camelCase JSON,
  and include CORS headers.

  Background:
    Given the ADW codebase is checked out

  # ── 1: Router and handler structure ──────────────────────────────────────

  @adw-48ki7w-add-get-endpoints-fo @regression
  Scenario: Worker uses itty-router for route handling
    Then the file "workers/cost-api/src/index.ts" exists
    And the source imports "itty-router"

  @adw-48ki7w-add-get-endpoints-fo @regression
  Scenario: Read handlers are defined in a single queries module
    Then the file "workers/cost-api/src/queries.ts" exists
    And the module exports a handler for GET /api/projects
    And the module exports a handler for GET /api/projects/:id/costs/breakdown
    And the module exports a handler for GET /api/projects/:id/costs/issues

  # ── 2: CORS middleware ───────────────────────────────────────────────────

  @adw-48ki7w-add-get-endpoints-fo @regression
  Scenario: CORS headers are present on GET responses
    Given the Cost API Worker is running
    When an authenticated GET request is sent to "/api/projects"
    Then the response includes an "Access-Control-Allow-Origin" header

  @adw-48ki7w-add-get-endpoints-fo
  Scenario: CORS preflight OPTIONS request returns 204
    Given the Cost API Worker is running
    When an OPTIONS request is sent to "/api/projects" with an Origin header
    Then the response status is 204
    And the response includes "Access-Control-Allow-Methods" header
    And the response includes "Access-Control-Allow-Headers" header

  @adw-48ki7w-add-get-endpoints-fo
  Scenario: ALLOWED_ORIGINS env var configures permitted origins
    Given the file "workers/cost-api/src/types.ts" is read
    Then the Env type includes an optional "ALLOWED_ORIGINS" property of type string

  @adw-48ki7w-add-get-endpoints-fo
  Scenario: CORS defaults to paysdoc.nl when ALLOWED_ORIGINS is not set
    Given the Cost API Worker is running without ALLOWED_ORIGINS configured
    When an authenticated GET request is sent to "/api/projects" with Origin "https://paysdoc.nl"
    Then the "Access-Control-Allow-Origin" header is "https://paysdoc.nl"

  @adw-48ki7w-add-get-endpoints-fo
  Scenario: CORS allows multiple comma-separated origins
    Given the Cost API Worker is running with ALLOWED_ORIGINS set to "https://paysdoc.nl,https://staging.paysdoc.nl"
    When an authenticated GET request is sent to "/api/projects" with Origin "https://staging.paysdoc.nl"
    Then the "Access-Control-Allow-Origin" header is "https://staging.paysdoc.nl"

  # ── 3: Authentication on GET endpoints ───────────────────────────────────

  @adw-48ki7w-add-get-endpoints-fo @regression
  Scenario: GET /api/projects without auth returns 401
    Given the Cost API Worker is running
    When a GET request is sent to "/api/projects" without an Authorization header
    Then the response status is 401
    And the response body contains "Unauthorized"

  @adw-48ki7w-add-get-endpoints-fo
  Scenario: GET /api/projects/:id/costs/breakdown without auth returns 401
    Given the Cost API Worker is running
    When a GET request is sent to "/api/projects/1/costs/breakdown" without an Authorization header
    Then the response status is 401
    And the response body contains "Unauthorized"

  @adw-48ki7w-add-get-endpoints-fo
  Scenario: GET /api/projects/:id/costs/issues without auth returns 401
    Given the Cost API Worker is running
    When a GET request is sent to "/api/projects/1/costs/issues" without an Authorization header
    Then the response status is 401
    And the response body contains "Unauthorized"

  # ── 4: GET /api/projects ─────────────────────────────────────────────────

  @adw-48ki7w-add-get-endpoints-fo @regression
  Scenario: GET /api/projects returns all projects sorted by name ASC
    Given the Cost API Worker is running and authenticated
    And the following projects exist in D1:
      | slug          | name          | repo_url                              |
      | zeta-project  | Zeta Project  | https://github.com/paysdoc/zeta       |
      | alpha-project | Alpha Project | https://github.com/paysdoc/alpha      |
    When an authenticated GET request is sent to "/api/projects"
    Then the response status is 200
    And the response is a JSON array with 2 items
    And the first item has name "Alpha Project"
    And the second item has name "Zeta Project"

  @adw-48ki7w-add-get-endpoints-fo @regression
  Scenario: GET /api/projects returns camelCase keys
    Given the Cost API Worker is running and authenticated
    And a project with slug "test-project" and repo_url "https://github.com/test/repo" exists in D1
    When an authenticated GET request is sent to "/api/projects"
    Then the response status is 200
    And each item contains keys "id", "slug", "name", and "repoUrl"
    And no item contains snake_case keys like "repo_url"

  @adw-48ki7w-add-get-endpoints-fo
  Scenario: GET /api/projects returns empty array when no projects exist
    Given the Cost API Worker is running and authenticated
    And no projects exist in D1
    When an authenticated GET request is sent to "/api/projects"
    Then the response status is 200
    And the response is a JSON array with 0 items

  # ── 5: GET /api/projects/:id/costs/breakdown ─────────────────────────────

  @adw-48ki7w-add-get-endpoints-fo @regression
  Scenario: Breakdown returns cost aggregated by model and provider sorted by totalCost DESC
    Given the Cost API Worker is running and authenticated
    And a project with id 1 exists in D1
    And the following cost records exist for project 1:
      | model                        | provider  | computed_cost_usd | reported_cost_usd |
      | claude-sonnet-4-20250514     | anthropic | 5.00              |                   |
      | claude-sonnet-4-20250514     | anthropic | 7.50              |                   |
      | gpt-4o                       | openai    | 3.20              |                   |
    When an authenticated GET request is sent to "/api/projects/1/costs/breakdown"
    Then the response status is 200
    And the response is a JSON array with 2 items
    And the first item has model "claude-sonnet-4-20250514", provider "anthropic", and totalCost 12.50
    And the second item has model "gpt-4o", provider "openai", and totalCost 3.20

  @adw-48ki7w-add-get-endpoints-fo @regression
  Scenario: Breakdown uses COALESCE(reported_cost_usd, computed_cost_usd) for cost
    Given the Cost API Worker is running and authenticated
    And a project with id 1 exists in D1
    And the following cost records exist for project 1:
      | model       | provider  | computed_cost_usd | reported_cost_usd |
      | claude-opus | anthropic | 5.00              | 8.00              |
    When an authenticated GET request is sent to "/api/projects/1/costs/breakdown"
    Then the response status is 200
    And the first item has totalCost 8.00

  @adw-48ki7w-add-get-endpoints-fo
  Scenario: Breakdown returns camelCase keys
    Given the Cost API Worker is running and authenticated
    And a project with id 1 and cost records exists in D1
    When an authenticated GET request is sent to "/api/projects/1/costs/breakdown"
    Then each item contains keys "model", "provider", and "totalCost"
    And no item contains snake_case keys like "total_cost"

  @adw-48ki7w-add-get-endpoints-fo
  Scenario: Breakdown returns empty array for project with no cost records
    Given the Cost API Worker is running and authenticated
    And a project with id 1 exists in D1 with no cost records
    When an authenticated GET request is sent to "/api/projects/1/costs/breakdown"
    Then the response status is 200
    And the response is a JSON array with 0 items

  # ── 6: GET /api/projects/:id/costs/issues ────────────────────────────────

  @adw-48ki7w-add-get-endpoints-fo @regression
  Scenario: Issues endpoint returns per-issue cost sorted by issueNumber ASC
    Given the Cost API Worker is running and authenticated
    And a project with id 1 exists in D1
    And cost records exist for project 1 with issue numbers 10 and 5
    When an authenticated GET request is sent to "/api/projects/1/costs/issues"
    Then the response status is 200
    And the response is a JSON array with 2 items
    And the first item has issueNumber 5
    And the second item has issueNumber 10

  @adw-48ki7w-add-get-endpoints-fo @regression
  Scenario: Issues endpoint returns totalCost using COALESCE per issue
    Given the Cost API Worker is running and authenticated
    And a project with id 1 exists in D1
    And the following cost records exist for project 1:
      | issue_number | phase | computed_cost_usd | reported_cost_usd |
      | 6            | plan  | 2.00              | 2.10              |
      | 6            | build | 5.00              | 6.30              |
    When an authenticated GET request is sent to "/api/projects/1/costs/issues"
    Then the first item has totalCost 8.40

  @adw-48ki7w-add-get-endpoints-fo @regression
  Scenario: Issues endpoint includes per-phase token usage breakdown
    Given the Cost API Worker is running and authenticated
    And a project with id 1 exists in D1
    And a cost record exists for project 1, issue 6, phase "plan" with token_usage input=30000 and output=1200
    And a cost record exists for project 1, issue 6, phase "build" with token_usage input=22000 and output=1900
    When an authenticated GET request is sent to "/api/projects/1/costs/issues"
    Then the first item has issueNumber 6
    And the first item has a "phases" array
    And the phases array contains an entry for phase "plan" with cost and tokenUsage
    And the tokenUsage for "plan" includes tokenType "input" with count 30000
    And the tokenUsage for "plan" includes tokenType "output" with count 1200

  @adw-48ki7w-add-get-endpoints-fo @regression
  Scenario: Phases are sorted in workflow lifecycle order
    Given the Cost API Worker is running and authenticated
    And a project with id 1 exists in D1
    And cost records exist for project 1, issue 1 with phases "review", "plan", "build", "document", "test"
    When an authenticated GET request is sent to "/api/projects/1/costs/issues"
    Then the phases for issue 1 are ordered as "plan", "build", "test", "review", "document"

  @adw-48ki7w-add-get-endpoints-fo
  Scenario: Phase ordering constant is defined in source code
    Then the source code contains a phase ordering constant with values "plan", "build", "test", "review", "document"

  @adw-48ki7w-add-get-endpoints-fo
  Scenario: Issues endpoint returns camelCase keys
    Given the Cost API Worker is running and authenticated
    And a project with id 1 and cost records with token usage exists in D1
    When an authenticated GET request is sent to "/api/projects/1/costs/issues"
    Then each item contains keys "issueNumber", "totalCost", and "phases"
    And each phase contains keys "phase", "cost", and "tokenUsage"
    And each tokenUsage entry contains keys "tokenType" and "count"

  @adw-48ki7w-add-get-endpoints-fo
  Scenario: Token aggregation is per issue per phase, not per model
    Given the Cost API Worker is running and authenticated
    And a project with id 1 exists in D1
    And the following cost records exist for project 1:
      | issue_number | phase | model        | token_usage_input | token_usage_output |
      | 6            | build | claude-sonnet| 10000             | 500                |
      | 6            | build | gpt-4o       | 5000              | 300                |
    When an authenticated GET request is sent to "/api/projects/1/costs/issues"
    Then for issue 6, phase "build", the tokenUsage for "input" has count 15000
    And for issue 6, phase "build", the tokenUsage for "output" has count 800

  # ── 7: Invalid project ID handling ───────────────────────────────────────

  @adw-48ki7w-add-get-endpoints-fo @regression
  Scenario: Breakdown for non-existent project returns 404
    Given the Cost API Worker is running and authenticated
    When an authenticated GET request is sent to "/api/projects/9999/costs/breakdown"
    Then the response status is 404
    And the response body is JSON with error "Project not found"

  @adw-48ki7w-add-get-endpoints-fo @regression
  Scenario: Issues endpoint for non-existent project returns 404
    Given the Cost API Worker is running and authenticated
    When an authenticated GET request is sent to "/api/projects/9999/costs/issues"
    Then the response status is 404
    And the response body is JSON with error "Project not found"

  # ── 8: Backward compatibility ────────────────────────────────────────────

  @adw-48ki7w-add-get-endpoints-fo @regression
  Scenario: Existing POST /api/cost endpoint continues to work
    Given the Cost API Worker is running and authenticated
    When a POST request is sent to "/api/cost" with a valid bearer token and a valid payload
    Then the response status is 201

  # ── 9: Integration test coverage ─────────────────────────────────────────

  @adw-48ki7w-add-get-endpoints-fo @regression
  Scenario: Integration tests exist for GET endpoints
    Then the directory "workers/cost-api/test/" contains test files for GET endpoints
    And the test files use Vitest and @cloudflare/vitest-pool-workers

  @adw-48ki7w-add-get-endpoints-fo
  Scenario: Tests cover GET /api/projects response format and sorting
    Given the Cost API Worker test files are read
    Then there are tests for GET /api/projects returning projects sorted by name
    And there are tests for camelCase response keys

  @adw-48ki7w-add-get-endpoints-fo
  Scenario: Tests cover GET /api/projects/:id/costs/breakdown aggregation
    Given the Cost API Worker test files are read
    Then there are tests for cost aggregation by model and provider
    And there are tests for COALESCE cost column logic
    And there are tests for totalCost DESC sorting

  @adw-48ki7w-add-get-endpoints-fo
  Scenario: Tests cover GET /api/projects/:id/costs/issues with phase breakdown
    Given the Cost API Worker test files are read
    Then there are tests for per-issue cost with phase breakdown
    And there are tests for phase lifecycle ordering
    And there are tests for per-phase token usage aggregation

  @adw-48ki7w-add-get-endpoints-fo
  Scenario: Tests cover CORS headers and 404 responses
    Given the Cost API Worker test files are read
    Then there are tests for CORS header presence
    And there are tests for 404 on non-existent project ID
