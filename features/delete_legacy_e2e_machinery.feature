@adw-403
Feature: Delete legacy E2E machinery

  Now that all orchestrators have been migrated to scenarioTestPhase (#400),
  the legacy E2E machinery is dead code. The E2E test discovery, Playwright
  execution, E2E retry loop, BDD scenario retry wrapper, and the standalone
  regressionScenarioProof agent must all be deleted. The `runE2ETests` config
  field, its heading mapping, and default value are removed from projectConfig.
  Re-exports and documentation references are cleaned up. No remaining
  references to deleted symbols may exist anywhere in `adws/` or
  `.claude/commands/`.

  Background:
    Given the ADW codebase is at the current working directory

  # ── 1. Function deletion from agents/testRetry.ts ──────────────────────────

  @adw-403 @regression
  Scenario: runE2ETestsWithRetry is deleted from testRetry.ts
    Given "adws/agents/testRetry.ts" is read
    When searching for the "runE2ETestsWithRetry" function definition
    Then "runE2ETestsWithRetry" is not defined in "adws/agents/testRetry.ts"
    And "runUnitTestsWithRetry" is still defined in "adws/agents/testRetry.ts"

  @adw-403 @regression
  Scenario: runBddScenariosWithRetry is deleted from testRetry.ts
    Given "adws/agents/testRetry.ts" is read
    When searching for the "runBddScenariosWithRetry" function definition
    Then "runBddScenariosWithRetry" is not defined in "adws/agents/testRetry.ts"

  @adw-403
  Scenario: BddScenarioRetryOptions type is deleted from testRetry.ts
    Given "adws/agents/testRetry.ts" is read
    When searching for the "BddScenarioRetryOptions" type definition
    Then "BddScenarioRetryOptions" is not defined in "adws/agents/testRetry.ts"

  # ── 2. File deletion: agents/testDiscovery.ts ──────────────────────────────

  @adw-403 @regression
  Scenario: agents/testDiscovery.ts is deleted entirely
    Then the file "adws/agents/testDiscovery.ts" does NOT exist

  # ── 3. File deletion: agents/regressionScenarioProof.ts ────────────────────

  @adw-403 @regression
  Scenario: agents/regressionScenarioProof.ts is deleted entirely
    Then the file "adws/agents/regressionScenarioProof.ts" does NOT exist

  # ── 4. Config cleanup: core/projectConfig.ts ────────────────────────────────

  @adw-403 @regression
  Scenario: runE2ETests field is removed from CommandsConfig interface
    Given "adws/core/projectConfig.ts" is read
    When searching for the "CommandsConfig" interface definition
    Then the interface does not contain a "runE2ETests" field
    And the interface still contains a "runScenariosByTag" field

  @adw-403
  Scenario: runE2ETests is removed from HEADING_TO_KEY map
    Given "adws/core/projectConfig.ts" is read
    When searching for the "HEADING_TO_KEY" map
    Then the map does not contain an entry mapping to "runE2ETests"
    And the map still contains an entry mapping to "runScenariosByTag"

  @adw-403
  Scenario: runE2ETests is removed from getDefaultCommandsConfig
    Given "adws/core/projectConfig.ts" is read
    When searching for the "getDefaultCommandsConfig" function body
    Then the returned object does not contain a "runE2ETests" property
    And the returned object still contains a "runScenariosByTag" property

  @adw-403
  Scenario: Tests referencing the runE2ETests field are updated or removed
    Given all test files under "adws/" are scanned
    When searching for the string "runE2ETests"
    Then no test file asserts against the "runE2ETests" field
    And existing config-related tests still pass

  # ── 5. Re-export cleanup: agents/index.ts ───────────────────────────────────

  @adw-403 @regression
  Scenario: E2E test discovery symbols are not re-exported from agents barrel
    Given "adws/agents/index.ts" is read
    When searching for export statements
    Then "discoverE2ETestFiles" does not appear in any export statement
    And "runPlaywrightE2ETests" does not appear in any export statement
    And "isValidE2ETestResult" does not appear in any export statement
    And "E2ETestResult" type does not appear in any export statement
    And "PlaywrightE2EResult" type does not appear in any export statement

  @adw-403 @regression
  Scenario: E2E retry and BDD retry symbols are not re-exported from agents barrel
    Given "adws/agents/index.ts" is read
    When searching for export statements
    Then "runE2ETestsWithRetry" does not appear in any export statement
    And "runBddScenariosWithRetry" does not appear in any export statement
    And "BddScenarioRetryOptions" type does not appear in any export statement
    And "runUnitTestsWithRetry" is still re-exported from the agents barrel

  @adw-403 @regression
  Scenario: regressionScenarioProof symbols are not re-exported from agents barrel
    Given "adws/agents/index.ts" is read
    When searching for export statements from "./regressionScenarioProof"
    Then no export block from "./regressionScenarioProof" exists

  # ── 6. Re-export cleanup: agents/testAgent.ts ──────────────────────────────

  @adw-403 @regression
  Scenario: testAgent.ts does not re-export E2E test discovery symbols
    Given "adws/agents/testAgent.ts" is read
    When searching for export statements from "./testDiscovery"
    Then no export block from "./testDiscovery" exists
    And "runResolveScenarioAgent" is still exported from "adws/agents/testAgent.ts"

  # ── 7. No remaining references to deleted symbols ──────────────────────────

  @adw-403 @regression
  Scenario: No TypeScript file under adws/ references runE2ETestsWithRetry
    Given all TypeScript source files under "adws/" are scanned
    When searching for the identifier "runE2ETestsWithRetry"
    Then no file contains a call to or import of "runE2ETestsWithRetry"

  @adw-403 @regression
  Scenario: No TypeScript file under adws/ references runPlaywrightE2ETests
    Given all TypeScript source files under "adws/" are scanned
    When searching for the identifier "runPlaywrightE2ETests"
    Then no file contains a call to or import of "runPlaywrightE2ETests"

  @adw-403 @regression
  Scenario: No TypeScript file under adws/ references discoverE2ETestFiles
    Given all TypeScript source files under "adws/" are scanned
    When searching for the identifier "discoverE2ETestFiles"
    Then no file contains a call to or import of "discoverE2ETestFiles"

  @adw-403 @regression
  Scenario: No TypeScript file under adws/ references runBddScenariosWithRetry
    Given all TypeScript source files under "adws/" are scanned
    When searching for the identifier "runBddScenariosWithRetry"
    Then no file contains a call to or import of "runBddScenariosWithRetry"

  @adw-403
  Scenario: No file under .claude/commands/ references deleted E2E symbols
    Given all markdown files under ".claude/commands/" are scanned
    When searching for "runE2ETestsWithRetry", "runPlaywrightE2ETests", "discoverE2ETestFiles", and "runBddScenariosWithRetry"
    Then no file references any of those symbols

  # ── 8. e2e-tests/ convention removed ────────────────────────────────────────

  @adw-403
  Scenario: No TypeScript file under adws/ references the e2e-tests directory
    Given all TypeScript source files under "adws/" are scanned
    When searching for the string "e2e-tests"
    Then no file references the "e2e-tests" directory path

  @adw-403
  Scenario: No command file references e2e-tests convention
    Given all markdown files under ".claude/commands/" are scanned
    When searching for "e2e-tests"
    Then no command file references the "e2e-tests" directory convention

  # ── 9. ## Run E2E Tests heading removed from commands config ────────────────

  @adw-403
  Scenario: ## Run E2E Tests section is removed from .adw/commands.md
    Given ".adw/commands.md" is read
    When searching for the "## Run E2E Tests" heading
    Then no "## Run E2E Tests" heading exists in ".adw/commands.md"
    And the "## Run Scenarios by Tag" section is still present in ".adw/commands.md"

  # ── 10. Build integrity ─────────────────────────────────────────────────────

  @adw-403 @regression
  Scenario: TypeScript compilation succeeds after deleting legacy E2E machinery
    Given all legacy E2E functions, files, and config entries have been deleted
    When "bunx tsc --noEmit" and "bunx tsc --noEmit -p adws/tsconfig.json" are run
    Then both type-check commands exit with code 0

  @adw-403 @regression
  Scenario: Existing tests pass after deleting legacy E2E machinery
    Given all legacy E2E functions, files, and config entries have been deleted
    When "bun run test" is run
    Then all tests pass

  @adw-403 @regression
  Scenario: Lint passes after deleting legacy E2E machinery
    Given all legacy E2E functions, files, and config entries have been deleted
    When "bun run lint" is run
    Then lint exits with code 0
