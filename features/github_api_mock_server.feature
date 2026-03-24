@adw-3n5bwi-mock-infrastructure
Feature: GitHub API mock server for behavioral testing

  A local HTTP server mimics api.github.com endpoints during behavioral tests.
  It loads fixture defaults from JSON files, supports programmatic setup via
  Given steps to configure per-scenario state, and records all incoming requests
  so Then steps can assert on what the ADW workflow sent.

  Background:
    Given the GitHub API mock server module exists in the test infrastructure

  # --- Server lifecycle ---

  @adw-3n5bwi-mock-infrastructure @regression
  Scenario: Mock server starts on a configurable port
    Given the mock server is configured to listen on port 9876
    When the mock server is started
    Then the mock server is listening on port 9876
    And the mock server responds to a health check request

  @adw-3n5bwi-mock-infrastructure @regression
  Scenario: Mock server shuts down cleanly
    Given the mock server is running
    When the mock server is stopped
    Then the port is released
    And no background processes remain

  # --- Issue endpoints ---

  @adw-3n5bwi-mock-infrastructure @regression
  Scenario: Mock server returns fixture response for GET /repos/:owner/:repo/issues/:number
    Given the mock server is running with default fixtures
    When a GET request is made to "/repos/test-owner/test-repo/issues/42"
    Then the response status is 200
    And the response body contains a JSON object with "number" equal to 42

  @adw-3n5bwi-mock-infrastructure
  Scenario: Mock server returns 404 for an issue that has no fixture
    Given the mock server is running with default fixtures
    And no fixture is configured for issue 999
    When a GET request is made to "/repos/test-owner/test-repo/issues/999"
    Then the response status is 404

  # --- Comment endpoints ---

  @adw-3n5bwi-mock-infrastructure @regression
  Scenario: Mock server accepts POST to create an issue comment
    Given the mock server is running with default fixtures
    When a POST request is made to "/repos/test-owner/test-repo/issues/42/comments" with body '{"body": "Review complete"}'
    Then the response status is 201
    And the response body contains a JSON object with "body" equal to "Review complete"

  @adw-3n5bwi-mock-infrastructure
  Scenario: Mock server returns fixture comments for GET /repos/:owner/:repo/issues/:number/comments
    Given the mock server is running with default fixtures
    And the fixture for issue 42 has 2 comments
    When a GET request is made to "/repos/test-owner/test-repo/issues/42/comments"
    Then the response status is 200
    And the response body is a JSON array with 2 elements

  # --- PR endpoints ---

  @adw-3n5bwi-mock-infrastructure @regression
  Scenario: Mock server accepts POST to create a pull request
    Given the mock server is running with default fixtures
    When a POST request is made to "/repos/test-owner/test-repo/pulls" with body '{"title": "feat: add widget", "head": "feature-branch", "base": "main"}'
    Then the response status is 201
    And the response body contains a JSON object with "title" equal to "feat: add widget"

  @adw-3n5bwi-mock-infrastructure
  Scenario: Mock server returns fixture response for GET /repos/:owner/:repo/pulls/:number
    Given the mock server is running with default fixtures
    And a fixture is configured for PR 10
    When a GET request is made to "/repos/test-owner/test-repo/pulls/10"
    Then the response status is 200
    And the response body contains a JSON object with "number" equal to 10

  # --- Label endpoints ---

  @adw-3n5bwi-mock-infrastructure
  Scenario: Mock server accepts POST to add labels to an issue
    Given the mock server is running with default fixtures
    When a POST request is made to "/repos/test-owner/test-repo/issues/42/labels" with body '{"labels": ["enhancement"]}'
    Then the response status is 200
    And the response body is a JSON array containing "enhancement"

  # --- Programmatic state setup ---

  @adw-3n5bwi-mock-infrastructure @regression
  Scenario: Mock server supports programmatic fixture configuration at runtime
    Given the mock server is running
    When issue 55 is programmatically configured with state "closed" and title "Bug fix"
    Then a GET request to "/repos/test-owner/test-repo/issues/55" returns status 200
    And the response body contains "state" equal to "closed"
    And the response body contains "title" equal to "Bug fix"

  @adw-3n5bwi-mock-infrastructure
  Scenario: Programmatic setup overrides default fixture for an issue
    Given the mock server is running with default fixtures
    And the default fixture for issue 42 has state "open"
    When issue 42 is programmatically configured with state "closed"
    Then a GET request to "/repos/test-owner/test-repo/issues/42" returns "state" equal to "closed"

  @adw-3n5bwi-mock-infrastructure
  Scenario: Programmatic setup can configure PR review status
    Given the mock server is running
    When PR 10 is programmatically configured with mergeable true and review decision "APPROVED"
    Then a GET request to "/repos/test-owner/test-repo/pulls/10" returns "mergeable" equal to true

  # --- Request recording ---

  @adw-3n5bwi-mock-infrastructure @regression
  Scenario: Mock server records all incoming requests
    Given the mock server is running
    When a GET request is made to "/repos/test-owner/test-repo/issues/42"
    And a POST request is made to "/repos/test-owner/test-repo/issues/42/comments" with body '{"body": "test"}'
    Then the recorded requests list contains 2 entries
    And the first recorded request has method "GET" and path "/repos/test-owner/test-repo/issues/42"
    And the second recorded request has method "POST" and path "/repos/test-owner/test-repo/issues/42/comments"

  @adw-3n5bwi-mock-infrastructure @regression
  Scenario: Recorded requests include headers and body
    Given the mock server is running
    When a POST request is made to "/repos/test-owner/test-repo/issues/42/comments" with body '{"body": "hello"}' and header "Authorization: token ghp_test123"
    Then the recorded request includes the request body '{"body": "hello"}'
    And the recorded request includes the header "Authorization" with value "token ghp_test123"

  @adw-3n5bwi-mock-infrastructure
  Scenario: Recorded requests can be cleared between scenarios
    Given the mock server is running
    And a GET request has been made to any endpoint
    When the recorded requests are cleared
    Then the recorded requests list is empty

  # --- Integration test ---

  @adw-3n5bwi-mock-infrastructure @regression
  Scenario: Integration test for GitHub API mock server lifecycle
    Given the mock server is not running
    When the mock server is started on an available port
    And a GET request is made to the issues endpoint for issue 42
    And the mock server is stopped
    Then the response was 200 with valid issue JSON
    And the request was recorded with the correct method and path
    And the mock server port is no longer in use

  # --- Fixture loading ---

  @adw-3n5bwi-mock-infrastructure
  Scenario: Mock server loads default fixtures from JSON files on startup
    Given fixture JSON files exist in the test fixtures directory
    When the mock server is started with the fixtures directory
    Then the mock server serves responses based on the loaded fixtures

  @adw-3n5bwi-mock-infrastructure
  Scenario: Mock server returns appropriate Content-Type headers
    Given the mock server is running with default fixtures
    When a GET request is made to "/repos/test-owner/test-repo/issues/42"
    Then the response has Content-Type "application/json"
