@adw-1epy28-cucumber-regression
Feature: Cucumber config discovers all feature files and step definitions

  The cucumber.js configuration must use glob patterns so that all feature
  files and step definition files are discovered automatically. A step
  definition file must exist for every feature file.

  Background:
    Given the ADW codebase is checked out

  @adw-1epy28-cucumber-regression @adw-7eqwrp-cucumber-regression @regression
  Scenario: cucumber.js paths config uses a glob pattern to discover all feature files
    Given "cucumber.js" is read
    Then the file contains "features/**/*.feature"

  @adw-1epy28-cucumber-regression @adw-7eqwrp-cucumber-regression @regression
  Scenario: cucumber.js import config uses a glob pattern to discover all step definitions
    Given "cucumber.js" is read
    Then the file contains "features/step_definitions/**/*.ts"

  @adw-1epy28-cucumber-regression @adw-7eqwrp-cucumber-regression @regression
  Scenario: cucumber.js does not hardcode a single feature file path
    Given "cucumber.js" is read
    Then the file does not contain "plan_template_unit_tests_conditional.feature"

  @adw-1epy28-cucumber-regression @adw-7eqwrp-cucumber-regression @regression
  Scenario: cucumber.js does not hardcode a single step definition file path
    Given "cucumber.js" is read
    Then the file does not contain "planTemplateSteps.ts"

  @adw-1epy28-cucumber-regression @adw-7eqwrp-cucumber-regression @regression
  Scenario: Step definition file exists for agent_commands feature
    Given the file "features/step_definitions/agentCommandsSteps.ts" exists

  @adw-1epy28-cucumber-regression @adw-7eqwrp-cucumber-regression @regression
  Scenario: Step definition file exists for cron_pr_review_filter feature
    Given the file "features/step_definitions/cronPrReviewFilterSteps.ts" exists

  @adw-1epy28-cucumber-regression @adw-7eqwrp-cucumber-regression @regression
  Scenario: Step definition file exists for llm_dependency_extraction feature
    Given the file "features/step_definitions/llmDependencyExtractionSteps.ts" exists

  @adw-1epy28-cucumber-regression @adw-7eqwrp-cucumber-regression @regression
  Scenario: Step definition file exists for primed_claude_agent feature
    Given the file "features/step_definitions/primedClaudeAgentSteps.ts" exists

  @adw-1epy28-cucumber-regression @adw-7eqwrp-cucumber-regression @regression
  Scenario: Step definition file exists for push_adw_kpis feature
    Given the file "features/step_definitions/pushAdwKpisSteps.ts" exists

  @adw-1epy28-cucumber-regression @adw-7eqwrp-cucumber-regression @regression
  Scenario: Step definition file exists for remove_unnecessary_exports feature
    Given the file "features/step_definitions/removeUnnecessaryExportsSteps.ts" exists

  @adw-1epy28-cucumber-regression @adw-7eqwrp-cucumber-regression @regression
  Scenario: Step definition file exists for replace_crucial_with_regression feature
    Given the file "features/step_definitions/replaceCrucialWithRegressionSteps.ts" exists

  @adw-1epy28-cucumber-regression @adw-7eqwrp-cucumber-regression @regression
  Scenario: Step definition file exists for review_phase feature
    Given the file "features/step_definitions/reviewPhaseSteps.ts" exists

  @adw-1epy28-cucumber-regression @adw-7eqwrp-cucumber-regression @regression
  Scenario: Step definition file exists for review_retry_patch_implementation feature
    Given the file "features/step_definitions/reviewRetryPatchImplementationSteps.ts" exists

  @adw-1epy28-cucumber-regression @adw-7eqwrp-cucumber-regression @adw-8af0pz-add-issue-level-dedu @regression
  Scenario: Step definition file exists for webhook_issue_dedup_cooldown feature
    Given the file "features/step_definitions/webhookIssueDedupCooldownSteps.ts" exists

  @adw-1epy28-cucumber-regression @adw-7eqwrp-cucumber-regression @adw-ri34ho-bug-cron-process-gua @regression
  Scenario: Step definition file exists for cron_guard_toctou_fix feature
    Given the file "features/step_definitions/cronGuardToctouFixSteps.ts" exists

  @adw-1epy28-cucumber-regression @adw-7eqwrp-cucumber-regression
  Scenario: No feature file retains the deprecated @crucial tag
    Given all feature files in "features/" are scanned for "@crucial"
    Then no feature file contains "@crucial"
