@adw-231-scenario-writer-opus-model
Feature: Scenario writer uses opus model in standard mode and sonnet in fast mode

  The /scenario_writer slash command requires deeper reasoning to understand
  issue requirements, analyse existing scenarios, and decide on coverage — making
  it a planning-class command that should run with the opus model by default and
  downgrade to sonnet (not haiku) in fast mode.

  Background:
    Given the ADW codebase contains "adws/core/config.ts"

  @adw-231-scenario-writer-opus-model @regression
  Scenario: SLASH_COMMAND_MODEL_MAP assigns opus to /scenario_writer
    Given "adws/core/config.ts" is read
    When searching for the SLASH_COMMAND_MODEL_MAP entry for "/scenario_writer"
    Then the model is "opus"

  @adw-231-scenario-writer-opus-model @regression
  Scenario: SLASH_COMMAND_MODEL_MAP_FAST assigns sonnet to /scenario_writer
    Given "adws/core/config.ts" is read
    When searching for the SLASH_COMMAND_MODEL_MAP_FAST entry for "/scenario_writer"
    Then the model is "sonnet"

  @adw-231-scenario-writer-opus-model @regression
  Scenario: getModelForCommand returns opus for /scenario_writer in standard mode
    Given the issue body does not contain "/fast" or "/cheap"
    When getModelForCommand is called with "/scenario_writer"
    Then it returns "opus"

  @adw-231-scenario-writer-opus-model @regression
  Scenario: getModelForCommand returns sonnet for /scenario_writer in fast mode
    Given the issue body contains "/fast"
    When getModelForCommand is called with "/scenario_writer"
    Then it returns "sonnet"
