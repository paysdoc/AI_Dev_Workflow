@adw-lv8mwj-remove-run-bdd-scena
Feature: Remove ## Run BDD Scenarios command and consolidate into ## Run Scenarios by Tag

  `## Run BDD Scenarios` in `.adw/commands.md` is a redundant special case of
  `## Run Scenarios by Tag`. The scenario writer always tags scenarios with
  `@adw-{issueNumber}`, so issue-scoped BDD scenarios can be run via
  `## Run Scenarios by Tag` with tag `adw-{issueNumber}`. The dedicated config
  section, its backing function `runBddScenarios()`, and all callers must be
  removed so that the codebase has a single consistent scenario execution path.

  Background:
    Given the ADW codebase is at the current working directory

  # ── 1. Config cleanup ────────────────────────────────────────────────────────

  @adw-lv8mwj-remove-run-bdd-scena @regression
  Scenario: ## Run BDD Scenarios section is removed from .adw/commands.md
    Given ".adw/commands.md" is read
    When searching for the "## Run BDD Scenarios" heading
    Then no "## Run BDD Scenarios" heading exists in ".adw/commands.md"
    And the "## Run Scenarios by Tag" section is still present in ".adw/commands.md"

  @adw-lv8mwj-remove-run-bdd-scena @regression
  Scenario: runBddScenarios field is removed from CommandsConfig interface in projectConfig.ts
    Given "adws/core/projectConfig.ts" is read
    When searching for the "CommandsConfig" interface definition
    Then the interface does not contain a "runBddScenarios" field
    And the interface still contains a "runScenariosByTag" field

  @adw-lv8mwj-remove-run-bdd-scena @adw-fla3u2-1773754088098
  Scenario: runBddScenarios is removed from HEADING_TO_KEY map in projectConfig.ts
    Given "adws/core/projectConfig.ts" is read
    When searching for the "HEADING_TO_KEY" map
    Then the map does not contain an entry mapping to "runBddScenarios"
    And the map still contains an entry mapping to "runScenariosByTag"

  @adw-lv8mwj-remove-run-bdd-scena @adw-fla3u2-1773754088098
  Scenario: runBddScenarios is removed from getDefaultCommandsConfig in projectConfig.ts
    Given "adws/core/projectConfig.ts" is read
    When searching for the "getDefaultCommandsConfig" function body
    Then the returned object does not contain a "runBddScenarios" property
    And the returned object still contains a "runScenariosByTag" property

  # ── 2. Function deletion ──────────────────────────────────────────────────────

  @adw-lv8mwj-remove-run-bdd-scena @regression
  Scenario: runBddScenarios function is deleted from bddScenarioRunner.ts
    Given "adws/agents/bddScenarioRunner.ts" is read
    When searching for the "runBddScenarios" function definition
    Then "runBddScenarios" is not defined in "adws/agents/bddScenarioRunner.ts"
    And "runScenariosByTag" is still defined and exported from "adws/agents/bddScenarioRunner.ts"

  @adw-lv8mwj-remove-run-bdd-scena @regression
  Scenario: runBddScenarios is not re-exported from the agents barrel
    Given "adws/agents/index.ts" is read
    When searching for "runBddScenarios" in export statements
    Then "runBddScenarios" does not appear in any export statement in "adws/agents/index.ts"

  # ── 3. Caller refactoring ─────────────────────────────────────────────────────

  @adw-lv8mwj-remove-run-bdd-scena @regression
  Scenario: testPhase.ts uses runScenariosByTag with adw-issueNumber tag instead of runBddScenarios
    Given "adws/phases/testPhase.ts" is read
    When searching for BDD scenario execution calls
    Then "runBddScenarios" is not called in "adws/phases/testPhase.ts"
    And "runBddScenariosWithRetry" is not called in "adws/phases/testPhase.ts"
    And the BDD scenario execution uses "projectConfig.commands.runScenariosByTag" as the command
    And the tag passed to the scenario runner is constructed from the issue number (e.g. "adw-{issueNumber}")

  @adw-lv8mwj-remove-run-bdd-scena @adw-fla3u2-1773754088098
  Scenario: adwTest.tsx uses runScenariosByTag with adw-issueNumber tag instead of runBddScenarios
    Given "adws/adwTest.tsx" is read
    When searching for BDD scenario execution calls
    Then "runBddScenarios" is not called in "adws/adwTest.tsx"
    And the BDD scenario execution uses the "runScenariosByTag" command from project config
    And the tag argument is derived from the issue number

  # ── 4. Retry infrastructure ───────────────────────────────────────────────────

  @adw-lv8mwj-remove-run-bdd-scena @regression
  Scenario: testRetry.ts implements BDD retry via runScenariosByTag not runBddScenarios
    Given "adws/agents/testRetry.ts" is read
    When searching for BDD scenario execution calls in the retry path
    Then "runBddScenarios" is not imported in "adws/agents/testRetry.ts"
    And the BDD scenario retry function calls "runScenariosByTag" internally
    And the tag passed is "adw-{issueNumber}" constructed from the issueNumber option

  @adw-lv8mwj-remove-run-bdd-scena @regression
  Scenario: BddScenarioRetryOptions uses runScenariosByTag command field not scenarioCommand
    Given "adws/agents/testRetry.ts" is read
    When searching for the "BddScenarioRetryOptions" interface or type definition
    Then the options type does not contain a "scenarioCommand" field sourced from "runBddScenarios" config
    And the options type contains a field for the "runScenariosByTag" command
    And the options type still contains an "issueNumber" field

  # ── 5. No remaining runBddScenarios references ────────────────────────────────

  @adw-lv8mwj-remove-run-bdd-scena @regression
  Scenario: No TypeScript file under adws/ calls or imports runBddScenarios
    Given all TypeScript source files under "adws/" are scanned
    When searching for the identifier "runBddScenarios"
    Then no file contains a call to "runBddScenarios"
    And no file contains an import of "runBddScenarios"

  # ── 6. Documentation ─────────────────────────────────────────────────────────

  @adw-lv8mwj-remove-run-bdd-scena @adw-fla3u2-1773754088098
  Scenario: .adw/conditional_docs.md does not reference ## Run BDD Scenarios
    Given ".adw/conditional_docs.md" is read
    When searching for "## Run BDD Scenarios"
    Then no reference to "## Run BDD Scenarios" is found in ".adw/conditional_docs.md"
    And "## Run Scenarios by Tag" is referenced in its place where applicable

  # ── 7. Build integrity ────────────────────────────────────────────────────────

  @adw-lv8mwj-remove-run-bdd-scena @regression
  Scenario: TypeScript compilation succeeds after removing runBddScenarios
    Given "runBddScenarios" has been removed from bddScenarioRunner.ts, projectConfig.ts, testRetry.ts, and all callers
    When "bunx tsc --noEmit" and "bunx tsc --noEmit -p adws/tsconfig.json" are run
    Then both type-check commands exit with code 0
    And no "Property 'runBddScenarios' does not exist" or "Cannot find name 'runBddScenarios'" errors are reported
