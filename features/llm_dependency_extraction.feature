@adw-91v6qi-llm-based-issue-depe
Feature: LLM-Based Issue Dependency Extraction

  The dependency extraction logic replaces rigid regex parsing with an LLM-based
  approach that understands natural-language dependency expressions. A regex fallback
  is retained for cases where the LLM call fails.

  Background:
    Given the ADW workflow is configured for a target repository
    And the `/extract_dependencies` Claude command exists at ".claude/commands/extract_dependencies.md"

  @adw-91v6qi-llm-based-issue-depe @regression
  Scenario: extract_dependencies command returns a JSON array for explicit section dependencies
    Given an issue body with a "## Dependencies" heading listing "#42 and #10"
    When the `/extract_dependencies` command is invoked with that issue body
    Then the output is a valid JSON array
    And the array contains 42 and 10
    And the output contains no surrounding explanation or prose

  @adw-91v6qi-llm-based-issue-depe @regression
  Scenario: extract_dependencies detects natural-language blocking relationship
    Given an issue body containing "blocked by #42"
    When the `/extract_dependencies` command is invoked with that issue body
    Then the output is the JSON array "[42]"

  @adw-91v6qi-llm-based-issue-depe @regression
  Scenario: extract_dependencies detects prerequisite expressions
    Given an issue body containing "prerequisite: #7" and "can't start until #10 lands"
    When the `/extract_dependencies` command is invoked with that issue body
    Then the output is a valid JSON array
    And the array contains 7 and 10

  @adw-91v6qi-llm-based-issue-depe
  Scenario: extract_dependencies detects dependency in task list items
    Given an issue body containing a task list item "- [ ] #55 auth refactor must be merged first"
    When the `/extract_dependencies` command is invoked with that issue body
    Then the output is a valid JSON array
    And the array contains 55

  @adw-91v6qi-llm-based-issue-depe
  Scenario: extract_dependencies detects full GitHub issue URL as dependency
    Given an issue body containing "this requires https://github.com/org/repo/issues/33 to be merged"
    When the `/extract_dependencies` command is invoked with that issue body
    Then the output is a valid JSON array
    And the array contains 33

  @adw-91v6qi-llm-based-issue-depe @regression
  Scenario: extract_dependencies excludes mere mentions (related to, see also)
    Given an issue body containing "related to #5" and "see also #8"
    And the issue body does not express a blocking or prerequisite relationship
    When the `/extract_dependencies` command is invoked with that issue body
    Then the output is the JSON array "[]"

  @adw-91v6qi-llm-based-issue-depe
  Scenario: extract_dependencies excludes fix and close references
    Given an issue body containing "fixes #12" and "closes #15"
    When the `/extract_dependencies` command is invoked with that issue body
    Then the output is the JSON array "[]"

  @adw-91v6qi-llm-based-issue-depe @regression
  Scenario: extract_dependencies returns empty array when no dependencies are present
    Given an issue body with no dependency language
    When the `/extract_dependencies` command is invoked with that issue body
    Then the output is the JSON array "[]"

  @adw-91v6qi-llm-based-issue-depe
  Scenario: extract_dependencies returns deduplicated array of positive integers
    Given an issue body mentioning "#42 blocked by #42 and also requires #42"
    When the `/extract_dependencies` command is invoked with that issue body
    Then the output is the JSON array "[42]"
    And the array contains no duplicate entries

  @adw-91v6qi-llm-based-issue-depe @regression
  Scenario: runDependencyExtractionAgent calls the command with the haiku model
    Given the `runDependencyExtractionAgent` function is invoked with a non-empty issue body
    When the agent executes
    Then `runClaudeAgentWithCommand` is called with the "/extract_dependencies" command
    And the model parameter is "haiku"
    And the issue body is passed as the single argument to the command

  @adw-91v6qi-llm-based-issue-depe @regression
  Scenario: runDependencyExtractionAgent parses the JSON array from agent output
    Given the agent output contains the text "[42, 10, 7]"
    When `runDependencyExtractionAgent` parses the output
    Then the returned `dependencies` field equals [42, 10, 7]
    And the standard AgentResult fields (success, output) are also returned

  @adw-91v6qi-llm-based-issue-depe
  Scenario: runDependencyExtractionAgent handles malformed JSON output gracefully
    Given the agent output contains malformed text that is not valid JSON
    When `runDependencyExtractionAgent` attempts to parse the output
    Then a warning is logged describing the parse failure
    And the returned `dependencies` field is an empty array
    And the agent does not throw an exception

  @adw-91v6qi-llm-based-issue-depe @regression
  Scenario: findOpenDependencies uses LLM extraction as the primary path
    Given an issue body containing "blocked by #42"
    And issue #42 is OPEN in the repository
    When `findOpenDependencies` is called with that issue body
    Then `runDependencyExtractionAgent` is invoked to extract dependencies
    And the result includes issue number 42

  @adw-91v6qi-llm-based-issue-depe @regression
  Scenario: findOpenDependencies falls back to regex when LLM extraction fails
    Given an issue body with a "## Dependencies" section listing "#10"
    And the LLM agent call throws an error
    And issue #10 is OPEN in the repository
    When `findOpenDependencies` is called with that issue body
    Then the regex-based parser is used as a fallback
    And the result includes issue number 10
    And a warning is logged indicating the LLM fallback was triggered

  @adw-91v6qi-llm-based-issue-depe
  Scenario: findOpenDependencies returns only open dependencies
    Given an issue body containing "blocked by #42 and #99"
    And issue #42 is OPEN and issue #99 is CLOSED in the repository
    When `findOpenDependencies` is called with that issue body
    Then the result contains only issue number 42
    And issue number 99 is not in the result

  @adw-91v6qi-llm-based-issue-depe
  Scenario: findOpenDependencies return type is unchanged
    Given `findOpenDependencies` is called with any issue body
    When it resolves
    Then the return type is `Promise<number[]>`
    And the eligibility evaluation contract is preserved
