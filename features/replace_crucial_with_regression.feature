@adw-20eum6-replace-crucial-with
Feature: Replace @crucial tag with @regression throughout ADW

  The review mechanism identifies regression-safety-net scenarios by a BDD tag.
  The label `@crucial` is replaced everywhere by the more descriptive `@regression`
  — in configuration files, source code, documentation, and all scenario files.
  This is a pure rename; runtime behaviour is otherwise unchanged.

  Background:
    Given the ADW codebase is at the current working directory

  @adw-20eum6-replace-crucial-with @regression
  Scenario: .adw/scenarios.md Run Regression Scenarios command uses @regression tag
    Given the file ".adw/scenarios.md" is read
    When the "## Run Regression Scenarios" section is found
    Then the command contains "@regression"
    And the command does not contain "@crucial"

  @adw-20eum6-replace-crucial-with @regression
  Scenario: .adw/commands.md Run Regression Scenarios command uses @regression tag
    Given the file ".adw/commands.md" is read
    When the "## Run Regression Scenarios" section is found
    Then the command contains "@regression"
    And the command does not contain "@crucial"

  @adw-20eum6-replace-crucial-with @regression
  Scenario: No feature file retains the @crucial tag
    Given all ".feature" files in the "features/" directory are scanned
    When searching for scenarios tagged "@crucial"
    Then no scenario with the "@crucial" tag is found
    And all scenarios that previously used "@crucial" are now tagged "@regression"

  @adw-20eum6-replace-crucial-with
  Scenario: regressionScenarioProof.ts source file does not reference @crucial and uses config-driven tags
    Given the file "adws/phases/scenarioProof.ts" is read
    When searching for the string "@crucial"
    Then no occurrence of "@crucial" is found
    And the string "ReviewProofConfig" is present where the regression tag is referenced

  @adw-20eum6-replace-crucial-with @regression
  Scenario: projectConfig.ts default for runRegressionScenarios uses @regression
    Given the file "adws/core/projectConfig.ts" is read
    When searching for the default value of the "runRegressionScenarios" field
    Then the default command contains "@regression"
    And the default command does not contain "@crucial"

  @adw-20eum6-replace-crucial-with @regression
  Scenario: reviewPhase.ts log messages reference review not @crucial
    Given the file "adws/phases/reviewPhase.ts" is read
    When searching for log message strings that reference a BDD tag name
    Then the log messages contain "review"
    And no log message contains "@crucial"

  @adw-20eum6-replace-crucial-with
  Scenario: ScenarioProofResult interface uses tagResults instead of crucialPassed
    Given the file "adws/phases/scenarioProof.ts" is read
    When the "ScenarioProofResult" interface definition is found
    Then the interface contains a field named "tagResults"
    And the interface does not contain a field named "crucialPassed"
    And the interface does not contain a field named "regressionPassed"

  @adw-20eum6-replace-crucial-with
  Scenario: runScenarioProof function iterates config-driven tags instead of hardcoded regression
    Given the "runScenarioProof" function in "adws/phases/scenarioProof.ts" is read
    When searching for the call to runScenariosByTag that runs the regression scenarios
    Then it passes "reviewProofConfig" (or the resolved tag from runRegressionCommand) as the tag argument
    And it does not hard-code the string "crucial" as the tag argument

  @adw-20eum6-replace-crucial-with
  Scenario: .adw/review_proof.md replaces @crucial references with @regression
    Given the file ".adw/review_proof.md" is read
    When searching for "@crucial"
    Then no occurrence of "@crucial" is found
    And "@regression" is used in its place wherever the regression tag was referenced

  @adw-20eum6-replace-crucial-with
  Scenario: adws/README.md BDD scenario documentation references @regression
    Given the file "adws/README.md" is read
    When searching for BDD tagging convention documentation
    Then the documentation references "@regression" as the regression-safety-net tag
    And "@crucial" is no longer described as a tagging convention

  @adw-20eum6-replace-crucial-with
  Scenario: Run Scenarios by Tag command is unaffected by the rename
    Given the file ".adw/scenarios.md" is read
    When the "## Run Scenarios by Tag" section is found
    Then the command still uses "{tag}" as the placeholder
    And the section was not changed as part of the @crucial to @regression rename

  @adw-20eum6-replace-crucial-with
  Scenario: No TypeScript file under adws/ contains @crucial in a tag-string context
    Given all TypeScript source files under "adws/" are scanned
    When searching for the literal string "@crucial"
    Then no TypeScript file contains "@crucial" as a tag string
    And files that previously referenced "@crucial" now reference "@regression"
