@mock-infrastructure @regression
Feature: Chore workflow end-to-end through mock infrastructure

  Validates the full mock infrastructure chain: Docker startup, mock creation,
  fixture repo setup, agent stub invocation, JSONL parsing, GitHub API mock
  interaction, and git mock interception. This is the foundational E2E test
  that proves the test infrastructure works as a unit.

  Background:
    Given mock infrastructure is running with all components

  Scenario: Claude CLI stub returns plan agent payload for chore command
    When the stub is invoked with prompt "/chore Rename config key"
    Then the stub process exits successfully
    And the stub output contains valid JSONL with an assistant message
    And the assistant message contains a tool_use block for "Write"

  Scenario: Claude CLI stub returns build agent payload for implement command
    When the stub is invoked with prompt "/implement the plan"
    Then the stub process exits successfully
    And the stub output contains valid JSONL with an assistant message
    And the assistant message contains a tool_use block for "Edit"

  Scenario: JSONL output from plan stub can be parsed into text and tool calls
    When the stub is invoked with prompt "/chore Rename config key"
    Then the parsed JSONL contains at least 1 text block
    And the parsed JSONL contains at least 1 tool_use block

  Scenario: Fixture repo initializes with .adw config and git history
    Given a fixture repo "cli-tool" is set up
    Then the fixture repo contains ".adw/project.md"
    And the fixture repo contains ".adw/commands.md"
    And the fixture repo has at least 1 git commit

  Scenario: GitHub API mock accepts workflow status comments
    When a workflow comment "## :rocket: ADW Workflow Started" is posted to issue 1
    And a workflow comment "## :mag: Issue Classified" is posted to issue 1
    And a workflow comment "## :tada: ADW Workflow Completed" is posted to issue 1
    Then the mock API recorded at least 3 POST requests to the comments endpoint

  Scenario: GitHub API mock accepts PR creation
    When a PR is created via the mock API with title "chore-issue-1: Rename config key"
    Then the mock API recorded a POST request to the pulls endpoint
    And the PR response contains a number field

  Scenario: Git mock intercepts push without network access
    Given a fixture repo "cli-tool" is set up
    When "git push origin main" is run in the fixture repo
    Then the push exits with code 0
    And no actual network request was made

  Scenario: Full chore artifact chain through mock infrastructure
    Given a fixture repo "cli-tool" is set up
    When the stub is invoked with prompt "/chore Rename config key"
    And the JSONL plan output is captured
    And the stub is invoked with prompt "/implement the plan"
    And a workflow comment "## :tada: ADW Workflow Completed" is posted to issue 1
    And a PR is created via the mock API with title "chore-issue-1: Rename config key"
    And "git push origin main" is run in the fixture repo
    Then the mock API recorded requests for comments and PR creation
    And the push exits with code 0
