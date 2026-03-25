@mock-infrastructure @regression
Feature: Mock Infrastructure Layer
  As an ADW developer
  I want mock implementations for the Claude CLI, GitHub API, and git remote operations
  So that I can write behavioral tests that exercise real orchestration code against
  predictable fixtures without external dependencies

  @mock-infrastructure @regression
  Scenario: Claude CLI stub streams canned JSONL
    Given a JSONL payload fixture exists for the plan agent
    When the Claude CLI stub is invoked with standard CLI args
    Then stdout contains valid JSONL lines
    And the output includes an assistant message with content blocks
    And the output includes a result message with sessionId

  @mock-infrastructure @regression
  Scenario: Claude CLI stub selects payload based on slash command
    Given a JSONL payload fixture exists for the build agent
    When the Claude CLI stub is invoked with a "/implement" prompt
    Then the output includes an assistant message with content blocks

  @mock-infrastructure @regression
  Scenario: GitHub API mock server returns fixture responses
    Given the GitHub API mock server is running
    When a GET request is made to the issue endpoint for issue 1
    Then the response status is 200
    And the response body contains the default issue fixture

  @mock-infrastructure @regression
  Scenario: GitHub API mock server records requests
    Given the GitHub API mock server is running
    When a POST comment request is made to the issue endpoint for issue 1
    Then the request appears in the recorded requests
    And the recorded request has method "POST"

  @mock-infrastructure @regression
  Scenario: GitHub API mock server supports programmatic state setup
    Given the GitHub API mock server is running
    When custom issue state is configured with title "Custom Issue Title"
    And a GET request is made to the issue endpoint for issue 99
    Then the response status is 200
    And the response body contains "Custom Issue Title"

  @mock-infrastructure @regression
  Scenario: GitHub API mock server resets state between scenarios
    Given the GitHub API mock server is running
    When the mock server state is reset
    Then the recorded requests list is empty

  @mock-infrastructure @regression
  Scenario: Git remote mock intercepts push without network access
    Given the git remote mock is on PATH
    When the git mock runs "git push origin main"
    Then the mock git command exits with code 0
    And the output contains "Everything up-to-date"

  @mock-infrastructure @regression
  Scenario: Git remote mock passes through local git operations
    Given the git remote mock is on PATH
    When the git mock runs "git status"
    Then the mock git command exits with code 0
