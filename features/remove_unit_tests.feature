@adw-m8wft2-chore-remove-all-uni
Feature: Remove all unit tests and Vitest configuration from the ADW project

  ADW has migrated to BDD scenarios as the primary validation mechanism.
  All Vitest unit test files, configuration, dependencies, and scripts must
  be removed. The project must continue to build and type-check without errors
  after the removal.

  Background:
    Given the ADW codebase is checked out
    And the repository is at the current working directory

  @adw-m8wft2-chore-remove-all-uni @regression
  Scenario: All *.test.ts files are deleted from the repository
    Given the repository contains unit test files under "adws/__tests__/", "adws/agents/__tests__/", and "adws/phases/__tests__/"
    When all unit test files are deleted as part of issue 202
    Then no "*.test.ts" files exist anywhere in the repository
    And the "adws/__tests__/" directory does not exist
    And the "adws/agents/__tests__/" directory does not exist
    And the "adws/phases/__tests__/" directory does not exist

  @adw-m8wft2-chore-remove-all-uni @regression
  Scenario: vitest.config.ts is removed from the project root
    Given "vitest.config.ts" exists at the project root
    When the Vitest configuration file is deleted
    Then "vitest.config.ts" does not exist in the repository

  @adw-m8wft2-chore-remove-all-uni @regression
  Scenario: vitest dependency is removed from package.json
    Given "package.json" lists "vitest" under devDependencies
    When the vitest package and related test dependencies are removed from "package.json"
    Then "package.json" does not contain "vitest" as a dependency
    And "bun.lock" does not reference "vitest"

  @adw-m8wft2-chore-remove-all-uni @regression
  Scenario: test and test:watch scripts are removed from package.json
    Given "package.json" contains a "test" script and a "test:watch" script
    When the test scripts are removed from "package.json"
    Then "package.json" does not contain a "test" script entry
    And "package.json" does not contain a "test:watch" script entry

  @adw-m8wft2-chore-remove-all-uni @regression
  Scenario: TypeScript compilation succeeds after unit test removal
    Given all unit test files and "vitest.config.ts" have been removed
    When "bunx tsc --noEmit" and "bunx tsc --noEmit -p adws/tsconfig.json" are run
    Then both type-check commands exit with code 0
    And no "Cannot find module" or missing-type errors are reported for removed test files

  @adw-m8wft2-chore-remove-all-uni @adw-fla3u2-1773754088098
  Scenario: No vitest imports remain in any source file after removal
    Given all unit test files have been deleted
    When all TypeScript source files under "adws/" are scanned
    Then no file contains an import from "vitest"
    And no file references vitest globals such as "describe", "it", "expect", or "vi" in a test context

  @adw-m8wft2-chore-remove-all-uni @adw-fla3u2-1773754088098
  Scenario: bun install completes without errors after vitest removal
    Given "vitest" has been removed from "package.json" devDependencies
    When "bun install" is run
    Then bun install exits with code 0
    And no missing dependency errors are reported
