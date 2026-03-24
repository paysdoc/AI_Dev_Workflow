@adw-3n5bwi-mock-infrastructure
Feature: Claude CLI stub streams canned JSONL fixtures

  A stub script replaces the real Claude Code CLI during behavioral testing.
  It accepts the same CLI arguments, reads canned JSONL fixture files, and
  streams them to stdout. The stub is activated by setting the CLAUDE_CODE_PATH
  environment variable. Fixtures are split into envelope (JSONL message
  structure) and payload (agent-specific content).

  Background:
    Given the ADW codebase is checked out
    And the Claude CLI stub script exists

  # --- Stub script existence and invocation ---

  @adw-3n5bwi-mock-infrastructure @regression
  Scenario: Claude CLI stub script exists at a known path
    Then the stub script is an executable file
    And it can be invoked without errors when given a fixture path

  # --- CLI argument acceptance ---

  @adw-3n5bwi-mock-infrastructure @regression
  Scenario: Stub accepts --print argument
    When the stub is invoked with "--print"
    Then the stub does not exit with an error

  @adw-3n5bwi-mock-infrastructure
  Scenario: Stub accepts --verbose argument
    When the stub is invoked with "--verbose"
    Then the stub does not exit with an error

  @adw-3n5bwi-mock-infrastructure
  Scenario: Stub accepts --output-format stream-json argument
    When the stub is invoked with "--output-format stream-json"
    Then the stub does not exit with an error

  @adw-3n5bwi-mock-infrastructure
  Scenario: Stub accepts --model argument
    When the stub is invoked with "--model claude-sonnet-4-5-20250514"
    Then the stub does not exit with an error

  @adw-3n5bwi-mock-infrastructure
  Scenario: Stub accepts combined CLI arguments matching real Claude invocation
    When the stub is invoked with "--print --verbose --output-format stream-json --model claude-sonnet-4-5-20250514"
    Then the stub does not exit with an error

  # --- JSONL streaming ---

  @adw-3n5bwi-mock-infrastructure @regression
  Scenario: Stub streams canned JSONL fixture to stdout
    Given a JSONL fixture file for a plan agent response
    When the stub is invoked with the fixture path
    Then the stub writes the fixture content to stdout line by line
    And each line is valid JSON

  @adw-3n5bwi-mock-infrastructure @regression
  Scenario: Stub streams output in the same format as the real CLI
    Given a JSONL fixture file for a build agent response
    When the stub is invoked with "--output-format stream-json"
    Then the output contains JSONL messages with a "type" field
    And the output ends with a result message

  @adw-3n5bwi-mock-infrastructure
  Scenario: Stub exits with code 0 after streaming all fixture lines
    Given a JSONL fixture file for a review agent response
    When the stub is invoked with the fixture path
    Then the stub exits with code 0

  # --- Fixture files ---

  @adw-3n5bwi-mock-infrastructure @regression
  Scenario: JSONL fixtures exist for plan agent responses
    Then a JSONL fixture file exists for the plan agent
    And the fixture contains at least one assistant message and a result message

  @adw-3n5bwi-mock-infrastructure @regression
  Scenario: JSONL fixtures exist for build agent responses
    Then a JSONL fixture file exists for the build agent
    And the fixture contains at least one assistant message and a result message

  @adw-3n5bwi-mock-infrastructure @regression
  Scenario: JSONL fixtures exist for review agent responses
    Then a JSONL fixture file exists for the review agent
    And the fixture contains at least one assistant message and a result message

  # --- Envelope / payload split ---

  @adw-3n5bwi-mock-infrastructure @regression
  Scenario: Fixtures are split into envelope and payload
    Given a JSONL fixture directory
    Then envelope files define the JSONL message structure with type and metadata fields
    And payload files define the agent-specific content
    And the stub combines envelope and payload when streaming

  @adw-3n5bwi-mock-infrastructure
  Scenario: Envelope structure matches real Claude CLI JSONL format
    Given an envelope fixture file
    Then each message has a "type" field
    And messages include types "system", "assistant", and "result"
    And the result message includes a "subtype" field

  @adw-3n5bwi-mock-infrastructure
  Scenario: Payload files contain agent-specific response content
    Given a payload fixture file for the plan agent
    Then it contains plan-specific content such as implementation steps or file paths
    And the content is valid JSON
