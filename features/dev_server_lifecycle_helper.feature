@adw-395
Feature: Dev server lifecycle helper and health check path schema

  A generic helper module `adws/core/devServerLifecycle.ts` exports
  `withDevServer({ startCommand, port, healthPath, cwd }, work)`. It spawns a
  dev server in a detached process group, HTTP-probes its health endpoint,
  retries on failure, and tears down the process group on cleanup. A new
  `## Health Check Path` field in `adws/core/projectConfig.ts` stores the
  probe target path, defaulting to `/`.

  Background:
    Given the ADW codebase is at the current working directory

  # --- Module existence and exports ---

  @adw-395 @regression
  Scenario: devServerLifecycle.ts exports withDevServer function
    Given "adws/core/devServerLifecycle.ts" is read
    When the module exports are inspected
    Then the module exports a function named "withDevServer"

  # --- Port substitution ---

  @adw-395 @regression
  Scenario: withDevServer substitutes {PORT} in the start command
    Given a start command "bun run dev --port {PORT}"
    And port is set to 3456
    When withDevServer spawns the process
    Then the spawned command contains "bun run dev --port 3456"

  # --- Detached process group ---

  @adw-395 @regression
  Scenario: withDevServer spawns in a detached process group
    Given a valid start command and port
    When withDevServer spawns the process
    Then child_process.spawn is called with detached set to true

  # --- HTTP health probe ---

  @adw-395 @regression
  Scenario: withDevServer probes health endpoint at 1-second intervals
    Given a dev server that becomes healthy after 3 seconds
    When withDevServer starts the server on port 4000 with healthPath "/healthz"
    Then HTTP GET requests are sent to "http://localhost:4000/healthz"
    And the interval between probes is 1 second

  @adw-395 @regression
  Scenario: withDevServer times out after 20 seconds of failed probes
    Given a dev server that never becomes healthy
    When withDevServer starts the server on port 4000
    Then the health probe loop gives up after 20 seconds
    And the start attempt is counted as a failure

  # --- Retry behavior ---

  @adw-395 @regression
  Scenario: withDevServer retries startup up to 3 times on probe failure
    Given a dev server that never becomes healthy
    When withDevServer is called
    Then the server is started exactly 3 times
    And each attempt waits for health probes to time out before retrying

  @adw-395 @regression
  Scenario: withDevServer runs wrapped work on successful health probe
    Given a dev server that becomes healthy on the first attempt
    When withDevServer is called with a work function
    Then the work function is invoked exactly once

  @adw-395 @regression
  Scenario: withDevServer falls back to running work after 3 failed starts
    Given a dev server that never becomes healthy
    When withDevServer is called with a work function
    Then the work function is still invoked after all 3 start attempts fail

  # --- Process group cleanup ---

  @adw-395 @regression
  Scenario: withDevServer kills the entire process group on cleanup
    Given a dev server is running with process ID 12345
    When cleanup is triggered
    Then process.kill is called with -12345 and "SIGTERM"
    And the signal targets the process group, not just the PID

  @adw-395 @regression
  Scenario: withDevServer escalates to SIGKILL after grace period
    Given a dev server process group that does not exit on SIGTERM
    When cleanup sends SIGTERM and waits the grace period
    Then process.kill is called with -12345 and "SIGKILL"

  # --- Finally-block cleanup ---

  @adw-395 @regression
  Scenario: withDevServer cleans up when wrapped work throws
    Given a dev server that is healthy
    And a work function that throws an error
    When withDevServer is called
    Then the dev server process group is killed
    And the error from the work function is re-thrown

  @adw-395 @regression
  Scenario: withDevServer cleans up when wrapped work succeeds
    Given a dev server that is healthy
    And a work function that completes successfully
    When withDevServer is called
    Then the dev server process group is killed after work completes

  # --- Health Check Path in projectConfig.ts ---

  @adw-395 @regression
  Scenario: CommandsConfig interface includes healthCheckPath field
    Given "adws/core/projectConfig.ts" is read
    When the "CommandsConfig" interface definition is found
    Then the interface contains a "healthCheckPath" field

  @adw-395 @regression
  Scenario: Health Check Path defaults to "/" when absent from commands.md
    Given a ".adw/commands.md" file without a "## Health Check Path" section
    When parseCommandsMd is called with the file content
    Then the returned healthCheckPath is "/"

  @adw-395 @regression
  Scenario: Health Check Path is read from commands.md when present
    Given a ".adw/commands.md" file with "## Health Check Path" set to "/api/health"
    When parseCommandsMd is called with the file content
    Then the returned healthCheckPath is "/api/health"

  @adw-395 @regression
  Scenario: loadProjectConfig returns healthCheckPath from .adw/commands.md
    Given a target repository with ".adw/commands.md" containing "## Health Check Path\n/ready"
    When loadProjectConfig is called for that repository
    Then the returned ProjectConfig commands has healthCheckPath set to "/ready"

  # --- No production consumers ---

  @adw-395
  Scenario: withDevServer is not imported in any orchestrator
    Given the ADW codebase is at the current working directory
    When all orchestrator files in "adws/" are scanned for imports
    Then none of them import from "adws/core/devServerLifecycle"

  # --- TypeScript type-check ---

  @adw-395 @regression
  Scenario: TypeScript type-check passes with dev server lifecycle changes
    When the TypeScript compiler is run with --noEmit
    Then the compiler exits with code 0
    And no type errors are reported
