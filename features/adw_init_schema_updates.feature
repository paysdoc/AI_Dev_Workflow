@adw-405
Feature: adw_init updates for new .adw/commands.md schema

  The `/adw_init` slash command must be updated to reflect the new
  `.adw/commands.md` schema: detection logic for `## Start Dev Server`
  based on the target repo's test runner and project type, a new
  `## Health Check Path` field, and removal of the deprecated
  `## Run E2E Tests` heading.

  Background:
    Given the ADW codebase is at the current working directory

  # --- Detection logic in adw_init.md instruction ---

  @adw-405 @regression
  Scenario: adw_init.md includes CLI-only detection for Start Dev Server
    Given the file ".claude/commands/adw_init.md" is read
    When the step that defines sections for ".adw/commands.md" generation is found
    Then the instruction states that CLI-only target repos must have "## Start Dev Server" set to "N/A"

  @adw-405 @regression
  Scenario: adw_init.md includes Playwright webServer detection for Start Dev Server
    Given the file ".claude/commands/adw_init.md" is read
    When the step that defines sections for ".adw/commands.md" generation is found
    Then the instruction states that when a Playwright config has a "webServer" block, "## Start Dev Server" must be set to "N/A"

  @adw-405 @regression
  Scenario: adw_init.md includes self-managing test runner detection for Start Dev Server
    Given the file ".claude/commands/adw_init.md" is read
    When the step that defines sections for ".adw/commands.md" generation is found
    Then the instruction states that when any test runner self-manages its server, "## Start Dev Server" must be set to "N/A"

  @adw-405 @regression
  Scenario: adw_init.md sets Start Dev Server with {PORT} for web targets without self-managing runners
    Given the file ".claude/commands/adw_init.md" is read
    When the step that defines sections for ".adw/commands.md" generation is found
    Then the instruction states that web framework targets without a self-managing runner must have "## Start Dev Server" set to the framework's dev command with "{PORT}" substituted
    And it provides examples like "bun run dev --port {PORT}" or "bunx next dev --port {PORT}"

  # --- {PORT} substitution documentation ---

  @adw-405 @regression
  Scenario: adw_init.md documents {PORT} substitution requirement for Start Dev Server
    Given the file ".claude/commands/adw_init.md" is read
    When the content is inspected
    Then it contains an explanation that "{PORT}" is a placeholder substituted at runtime by the dev server lifecycle helper
    And it explains that parallel workflows use dynamic ports to avoid collisions

  # --- Health Check Path generation ---

  @adw-405 @regression
  Scenario: adw_init.md includes Health Check Path in commands.md section list
    Given the file ".claude/commands/adw_init.md" is read
    When the step that defines sections for ".adw/commands.md" generation is found
    Then the instruction lists "## Health Check Path" as a required section
    And the instruction specifies a default value of "/" for that section

  @adw-405
  Scenario: adw_init.md documents Health Check Path override
    Given the file ".claude/commands/adw_init.md" is read
    When the content is inspected
    Then it notes that "## Health Check Path" can be overridden per target repo if "/" is slow or redirects

  # --- Run E2E Tests removal ---

  @adw-405 @regression
  Scenario: adw_init.md does not list Run E2E Tests as a generated section
    Given the file ".claude/commands/adw_init.md" is read
    When the step that defines sections for ".adw/commands.md" generation is found
    Then the instruction does NOT list "## Run E2E Tests" as a section to generate

  # --- Generated commands.md shape for CLI targets ---

  @adw-405 @regression
  Scenario: Generated commands.md has Start Dev Server N/A for a CLI-only target
    Given adw_init was run on a CLI-only target repository with no web framework
    When the generated ".adw/commands.md" is read
    Then the "## Start Dev Server" section is set to "N/A"

  # --- Generated commands.md shape for Playwright targets ---

  @adw-405 @regression
  Scenario: Generated commands.md has Start Dev Server N/A for Playwright target with webServer
    Given adw_init was run on a target repository using Playwright
    And the target's "playwright.config.ts" contains a "webServer" block
    When the generated ".adw/commands.md" is read
    Then the "## Start Dev Server" section is set to "N/A"

  # --- Generated commands.md shape for web targets ---

  @adw-405 @regression
  Scenario: Generated commands.md has Start Dev Server with {PORT} for a Next.js target
    Given adw_init was run on a Next.js target repository without a self-managing test runner
    When the generated ".adw/commands.md" is read
    Then the "## Start Dev Server" section contains a command with "{PORT}" placeholder
    And the command resembles "bunx next dev --port {PORT}" or equivalent

  # --- Health Check Path in generated commands.md ---

  @adw-405 @regression
  Scenario: Generated commands.md includes Health Check Path with default /
    Given adw_init was run on any target repository
    When the generated ".adw/commands.md" is read
    Then it contains a "## Health Check Path" section
    And the value under that section is "/"

  # --- Run E2E Tests absent from generated commands.md ---

  @adw-405 @regression
  Scenario: Generated commands.md does not contain Run E2E Tests section
    Given adw_init was run on any target repository
    When the generated ".adw/commands.md" is read
    Then no "## Run E2E Tests" heading exists in the file

  # --- Consistency with projectConfig schema ---

  @adw-405
  Scenario: CommandsConfig interface includes startDevServer field
    Given "adws/core/projectConfig.ts" is read
    When the "CommandsConfig" interface definition is found
    Then the interface contains a "startDevServer" field

  @adw-405
  Scenario: HEADING_TO_KEY map maps Start Dev Server to startDevServer
    Given "adws/core/projectConfig.ts" is read
    When the "HEADING_TO_KEY" map is found
    Then the map contains an entry for "## Start Dev Server" mapping to "startDevServer"

  @adw-405
  Scenario: HEADING_TO_KEY map maps Health Check Path to healthCheckPath
    Given "adws/core/projectConfig.ts" is read
    When the "HEADING_TO_KEY" map is found
    Then the map contains an entry for "## Health Check Path" mapping to "healthCheckPath"

  @adw-405
  Scenario: HEADING_TO_KEY map does not contain Run E2E Tests entry
    Given "adws/core/projectConfig.ts" is read
    When the "HEADING_TO_KEY" map is found
    Then the map does not contain an entry for "## Run E2E Tests"

  # --- Build integrity ---

  @adw-405 @regression
  Scenario: TypeScript type-check passes after adw_init schema updates
    When the TypeScript compiler is run with --noEmit
    Then the compiler exits with code 0
    And no type errors are reported
