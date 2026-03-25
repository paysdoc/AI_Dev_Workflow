@adw-303 @adw-y55dlm-remove-ungeneratable
Feature: Remove ungeneratable classification from step definition generator

  The step definition generator previously classified scenarios as generatable
  or ungeneratable and removed those it deemed ungeneratable. Now that the test
  harness (test/mocks/test-harness.ts) provides mock GitHub API server, Claude
  CLI stub, git remote mock, and fixture repo setup, all scenarios can have step
  definitions generated. The classification and removal logic is removed, and
  the generator is made aware of the test harness infrastructure.

  # ── 1. Classification removal ──────────────────────────────────────────────

  @adw-y55dlm-remove-ungeneratable @regression
  Scenario: generate_step_definitions.md does not contain generatable/ungeneratable classification
    Given the file ".claude/commands/generate_step_definitions.md" exists
    Then it should not contain a section that classifies scenarios as "generatable" or "ungeneratable"
    And it should not contain instructions to determine whether a scenario requires runtime infrastructure

  @adw-y55dlm-remove-ungeneratable @regression
  Scenario: generate_step_definitions.md does not instruct removing scenarios from feature files
    Given the file ".claude/commands/generate_step_definitions.md" exists
    Then it should not contain instructions to remove scenarios from ".feature" files
    And it should not contain instructions to delete feature files that have no remaining scenarios

  @adw-y55dlm-remove-ungeneratable @regression
  Scenario: generate_step_definitions.md generates step definitions for all tagged scenarios
    Given the file ".claude/commands/generate_step_definitions.md" exists
    Then it should instruct generating step definitions for every scenario tagged with the issue tag
    And it should not skip any scenarios based on infrastructure requirements

  # ── 2. Test harness documentation in generator ─────────────────────────────

  @adw-y55dlm-remove-ungeneratable @regression
  Scenario: generate_step_definitions.md documents the mock GitHub API server
    Given the file ".claude/commands/generate_step_definitions.md" exists
    Then it should document that the test harness provides a mock GitHub API server
    And it should describe that the mock server handles issue, comment, PR, and label endpoints
    And it should describe that the mock server supports programmatic state setup and request recording

  @adw-y55dlm-remove-ungeneratable @regression
  Scenario: generate_step_definitions.md documents the Claude CLI stub
    Given the file ".claude/commands/generate_step_definitions.md" exists
    Then it should document that the test harness provides a Claude CLI stub
    And it should describe that the stub streams canned JSONL fixtures to stdout
    And it should describe that the stub is activated via the CLAUDE_CODE_PATH environment variable

  @adw-y55dlm-remove-ungeneratable @regression
  Scenario: generate_step_definitions.md documents the git remote mock
    Given the file ".claude/commands/generate_step_definitions.md" exists
    Then it should document that the test harness provides a git remote mock
    And it should describe that the mock intercepts push, fetch, and clone without network access
    And it should describe that local git operations work normally

  @adw-y55dlm-remove-ungeneratable @regression
  Scenario: generate_step_definitions.md documents the fixture repo setup
    Given the file ".claude/commands/generate_step_definitions.md" exists
    Then it should document that the test harness provides fixture repo initialization
    And it should describe that setupFixtureRepo copies a fixture template and initializes a git repo
    And it should describe that the fixture repo is used as the working directory during tests

  @adw-y55dlm-remove-ungeneratable @regression
  Scenario: generate_step_definitions.md instructs using test harness for infrastructure-dependent scenarios
    Given the file ".claude/commands/generate_step_definitions.md" exists
    Then it should instruct the agent to import and use the test harness setup/teardown functions
    And it should instruct the agent to use mock infrastructure for scenarios requiring running servers
    And it should instruct the agent to use mock infrastructure for scenarios requiring mocked LLM calls
    And it should instruct the agent to use mock infrastructure for scenarios requiring external service dependencies

  # ── 3. removedScenarios backward compatibility ─────────────────────────────

  @adw-y55dlm-remove-ungeneratable @regression
  Scenario: generate_step_definitions.md retains removedScenarios in output schema
    Given the file ".claude/commands/generate_step_definitions.md" exists
    Then the output JSON schema should contain a "removedScenarios" field
    And the output instructions should specify that "removedScenarios" is always an empty array

  @adw-y55dlm-remove-ungeneratable
  Scenario: generate_step_definitions.md output schema preserves generatedFiles field
    Given the file ".claude/commands/generate_step_definitions.md" exists
    Then the output JSON schema should contain a "generatedFiles" field
    And the output format should remain valid JSON without markdown fences

  # ── 4. Existing command structure preserved ────────────────────────────────

  @adw-y55dlm-remove-ungeneratable
  Scenario: generate_step_definitions.md still reads configuration from scenarios.md
    Given the file ".claude/commands/generate_step_definitions.md" exists
    Then it should instruct reading ".adw/scenarios.md" for the scenario directory path

  @adw-y55dlm-remove-ungeneratable
  Scenario: generate_step_definitions.md still reads existing step definitions to avoid duplicates
    Given the file ".claude/commands/generate_step_definitions.md" exists
    Then it should instruct reading all existing step definition files to avoid duplicate patterns

  @adw-y55dlm-remove-ungeneratable
  Scenario: generate_step_definitions.md still reads implementation code from worktree
    Given the file ".claude/commands/generate_step_definitions.md" exists
    Then it should instruct reading implementation code from the worktree

  # ── 5. TypeScript integrity ────────────────────────────────────────────────

  @adw-y55dlm-remove-ungeneratable @regression
  Scenario: TypeScript type-check passes after all changes for issue 303
    Given the ADW codebase has been modified for issue 303
    When "bunx tsc --noEmit" and "bunx tsc --noEmit -p adws/tsconfig.json" are run
    Then both type-check commands exit with code 0
