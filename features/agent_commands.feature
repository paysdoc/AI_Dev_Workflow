@adw-cahdcr-fix-validation-and-r
Feature: Validation and resolution agents use slash commands

  The validation and resolution agents must delegate to slash commands via
  runClaudeAgentWithCommand rather than constructing raw prompts with runClaudeAgent.
  The runClaudeAgent function must be removed entirely to prevent inconsistency.

  Background:
    Given the ADW workflow is configured for a target repository
    And the target repository has a plan file and BDD scenario files

  @adw-cahdcr-fix-validation-and-r @regression
  Scenario: Validation agent delegates to /validate_plan_scenarios command
    Given the plan validation phase is executing
    When the validation agent runs
    Then it calls runClaudeAgentWithCommand with command "/validate_plan_scenarios"
    And it does not call runClaudeAgent directly

  @adw-cahdcr-fix-validation-and-r @regression
  Scenario: Resolution agent delegates to /resolve_plan_scenarios command
    Given the plan validation phase has found mismatches
    When the resolution agent runs
    Then it calls runClaudeAgentWithCommand with command "/resolve_plan_scenarios"
    And it does not call runClaudeAgent directly

  @adw-cahdcr-fix-validation-and-r @regression
  Scenario: runClaudeAgent function is removed from the codebase
    Given the ADW codebase
    When searching for usages of runClaudeAgent
    Then runClaudeAgent is not defined anywhere in the codebase
    And runClaudeAgent is not called anywhere in the codebase

  @adw-cahdcr-fix-validation-and-r
  Scenario: Validation agent passes adwId, issueNumber, planFilePath, and scenarioGlob as args
    Given the validation agent is invoked with adwId "test-id", issueNumber "183", planFilePath "/path/to/plan.md", and scenarioGlob "features/"
    When the validation agent runs
    Then runClaudeAgentWithCommand receives the args ["test-id", "183", "/path/to/plan.md", "features/"] in order

  @adw-cahdcr-fix-validation-and-r
  Scenario: Resolution agent passes adwId, issueNumber, planFilePath, scenarioGlob, issueJson, and mismatches as args
    Given the resolution agent is invoked with adwId "test-id", issueNumber "183", planFilePath "/path/to/plan.md", scenarioGlob "features/", issueJson, and a mismatches list
    When the resolution agent runs
    Then runClaudeAgentWithCommand receives all six args to "/resolve_plan_scenarios" in the correct order

  @adw-cahdcr-fix-validation-and-r
  Scenario: Validation agent still returns a ValidationResult after switching to command
    Given the validation agent is configured to use "/validate_plan_scenarios"
    When the validation agent runs and the command returns aligned JSON
    Then the validation agent returns a ValidationResult with aligned true and an empty mismatches list

  @adw-cahdcr-fix-validation-and-r
  Scenario: Resolution agent still returns a ResolutionResult after switching to command
    Given the resolution agent is configured to use "/resolve_plan_scenarios"
    When the resolution agent runs and the command returns resolved JSON
    Then the resolution agent returns a ResolutionResult with resolved true and a decisions list
