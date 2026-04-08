@adw-221
Feature: adw_init generates complete commands.md including scenario runner sections

  When `/adw_init` is run on a target repository it must generate `.adw/commands.md`
  with ALL required sections, including `## Run Scenarios by Tag` and
  `## Run Regression Scenarios`. These sections are used by workflow phase commands
  to execute BDD scenarios and must be present from the moment the configuration is
  bootstrapped.

  Background:
    Given the ADW codebase is at the current working directory

  @adw-221 @regression
  Scenario: adw_init.md instruction includes ## Run Scenarios by Tag in the commands.md generation step
    Given the file ".claude/commands/adw_init.md" is read
    When the step that defines sections for ".adw/commands.md" generation is found
    Then the instruction lists "## Run Scenarios by Tag" as a required section
    And the instruction specifies a command with a "{tag}" placeholder for that section

  @adw-221 @regression
  Scenario: adw_init.md instruction includes ## Run Regression Scenarios in the commands.md generation step
    Given the file ".claude/commands/adw_init.md" is read
    When the step that defines sections for ".adw/commands.md" generation is found
    Then the instruction lists "## Run Regression Scenarios" as a required section
    And the instruction specifies a command that runs "@regression"-tagged scenarios

  @adw-221 @regression
  Scenario: generated commands.md contains ## Run Scenarios by Tag section
    Given ".adw/commands.md" exists in a repository where adw_init was run
    When the file is read
    Then it contains a "## Run Scenarios by Tag" section
    And the value under that section includes a "{tag}" placeholder

  @adw-221 @regression
  Scenario: generated commands.md contains ## Run Regression Scenarios section
    Given ".adw/commands.md" exists in a repository where adw_init was run
    When the file is read
    Then it contains a "## Run Regression Scenarios" section
    And the value under that section includes "@regression"

  @adw-221 @regression
  Scenario: Run Scenarios by Tag in commands.md matches the E2E tool used in scenarios.md
    Given adw_init was run on a repository that uses Playwright for E2E tests
    When ".adw/commands.md" and ".adw/scenarios.md" are read
    Then both files specify a "## Run Scenarios by Tag" command using the same E2E tool
    And the "{tag}" placeholder appears in both commands

  @adw-221 @adw-405 @regression
  Scenario: Run Scenarios by Tag in commands.md defaults to Cucumber when no E2E tool is detected
    Given adw_init was run on a repository where no E2E tool is detected
    When ".adw/commands.md" is read
    Then the "## Run Scenarios by Tag" section uses a cucumber-js command
    And the "## Run Regression Scenarios" section uses a cucumber-js command with "@regression"

  @adw-221
  Scenario: projectConfig.ts CommandsConfig interface contains runScenariosByTag and runRegressionScenarios fields
    Given "adws/core/projectConfig.ts" is read
    When the "CommandsConfig" interface definition is found
    Then the interface contains a "runScenariosByTag" field
    And the interface contains a "runRegressionScenarios" field

  @adw-221
  Scenario: projectConfig.ts HEADING_TO_KEY map maps ## Run Scenarios by Tag to runScenariosByTag
    Given "adws/core/projectConfig.ts" is read
    When the "HEADING_TO_KEY" map is found
    Then the map contains an entry for "## Run Scenarios by Tag" mapping to "runScenariosByTag"
    And the map contains an entry for "## Run Regression Scenarios" mapping to "runRegressionScenarios"
