@adw-6bi1qq-fixture-target-repo
Feature: Fixture target repo, test harness, and first behavioral review scenario

  Create a minimal fixture target repo at test/fixtures/cli-tool/ with .adw/
  configuration, wire the mock infrastructure into a Cucumber-integrated test
  harness with setup/teardown hooks, and write the first behavioral BDD scenario
  that exercises the review phase end-to-end against canned fixtures.

  # ── 1. Fixture target repo structure ───────────────────────────────────────

  @adw-6bi1qq-fixture-target-repo @regression
  Scenario: Fixture target repo directory exists at the expected path
    Given the ADW codebase is at the current working directory
    Then the directory "test/fixtures/cli-tool" exists
    And the directory "test/fixtures/cli-tool/.adw" exists

  @adw-6bi1qq-fixture-target-repo @regression
  Scenario: Fixture target repo contains .adw/commands.md
    Given the ADW codebase is at the current working directory
    Then the file "test/fixtures/cli-tool/.adw/commands.md" exists
    And the file contains a "## Run E2E Tests" section
    And the file contains a "## Package Manager" section

  @adw-6bi1qq-fixture-target-repo @regression
  Scenario: Fixture target repo contains .adw/project.md with type cli
    Given the ADW codebase is at the current working directory
    Then the file "test/fixtures/cli-tool/.adw/project.md" exists
    And the file contains "## Application Type" with value "cli"

  @adw-6bi1qq-fixture-target-repo
  Scenario: Fixture target repo contains .adw/scenarios.md
    Given the ADW codebase is at the current working directory
    Then the file "test/fixtures/cli-tool/.adw/scenarios.md" exists
    And the file contains a "## Scenario Directory" section

  @adw-6bi1qq-fixture-target-repo
  Scenario: Fixture target repo contains .adw/review_proof.md
    Given the ADW codebase is at the current working directory
    Then the file "test/fixtures/cli-tool/.adw/review_proof.md" exists
    And the file contains a "## Tags" section
    And the file contains a "## Supplementary Checks" section

  @adw-6bi1qq-fixture-target-repo @regression
  Scenario: Fixture target repo contains source files for agents to operate on
    Given the ADW codebase is at the current working directory
    Then at least one source file exists under "test/fixtures/cli-tool/src"
    And the source files are syntactically valid

  @adw-6bi1qq-fixture-target-repo
  Scenario: Fixture target repo has a minimal package.json
    Given the ADW codebase is at the current working directory
    Then the file "test/fixtures/cli-tool/package.json" exists
    And the package.json contains a "name" field

  # ── 2. Git repo initialization during test setup ───────────────────────────

  @adw-6bi1qq-fixture-target-repo @regression
  Scenario: Fixture target repo is initialized as a git repo during test setup
    Given the test harness setup function is called with the fixture path "test/fixtures/cli-tool"
    When the harness initializes the fixture target repo
    Then the fixture directory contains a ".git" directory
    And at least one commit exists in the fixture repo's history

  @adw-6bi1qq-fixture-target-repo
  Scenario: Git initialization is idempotent across multiple test runs
    Given the test harness has already initialized the fixture repo once
    When the test harness setup is called again for the same fixture
    Then the fixture repo retains its existing commits
    And no duplicate initialization occurs

  # ── 3. Test harness setup ──────────────────────────────────────────────────

  @adw-6bi1qq-fixture-target-repo @regression
  Scenario: Test harness starts all mocks and configures environment before scenarios
    Given the test harness is not yet set up
    When the test harness setup is called
    Then the GitHub API mock server is running on an available port
    And CLAUDE_CODE_PATH points to the Claude CLI stub
    And the git remote mock is on PATH
    And GH_TOKEN is set to a mock value
    And MOCK_GITHUB_API_URL is set to the mock server URL

  @adw-6bi1qq-fixture-target-repo @regression
  Scenario: Test harness configures the working directory to the fixture repo
    Given the test harness is configured for fixture "test/fixtures/cli-tool"
    When the test harness setup is called
    Then the harness sets the working directory context to the fixture repo path
    And subsequent operations resolve file paths relative to the fixture repo

  @adw-6bi1qq-fixture-target-repo
  Scenario: Test harness setup is idempotent
    Given the test harness has already been set up
    When setup is called a second time without teardown
    Then the existing mock context is returned
    And no duplicate servers are started

  # ── 4. Test harness teardown ───────────────────────────────────────────────

  @adw-6bi1qq-fixture-target-repo @regression
  Scenario: Test harness tears down mocks cleanly after scenarios
    Given the test harness has been set up with all mocks running
    When the test harness teardown is called
    Then the GitHub API mock server is stopped
    And the mock server port is released
    And the git mock temporary directory is removed
    And CLAUDE_CODE_PATH is restored to its original value
    And PATH is restored to its original value

  @adw-6bi1qq-fixture-target-repo
  Scenario: Test harness teardown is safe to call multiple times
    Given the test harness teardown has already been called
    When teardown is called again
    Then no error is thrown
    And the environment remains in its original state

  @adw-6bi1qq-fixture-target-repo @regression
  Scenario: Mock server state is reset between scenarios
    Given the test harness is set up and a scenario has recorded requests
    When the harness resets state between scenarios
    Then the mock server recorded requests list is empty
    And programmatic state overrides are cleared
    And the mock server is still running

  # ── 5. Host execution (no Docker required) ─────────────────────────────────

  @adw-6bi1qq-fixture-target-repo @regression
  Scenario: Harness works on host without Docker
    Given the test harness is configured for host execution
    When the test harness setup is called
    Then no Docker commands are invoked
    And all mocks run as in-process or child-process services
    And the harness completes setup successfully

  # ── 6. First behavioral review scenario (end-to-end) ───────────────────────

  @adw-6bi1qq-fixture-target-repo @regression
  Scenario: Review phase executes end-to-end with mocked boundaries
    Given the test harness is set up with the "test/fixtures/cli-tool" fixture
    And the GitHub API mock has an open issue 42 with title "Test feature"
    And the Claude CLI stub is configured with a review agent JSONL fixture
    And the fixture repo has a feature branch with committed changes
    When the review phase is executed against the fixture repo
    Then the Claude CLI stub is invoked with review-related arguments
    And the review phase completes without errors

  @adw-6bi1qq-fixture-target-repo @regression
  Scenario: Review phase posts a comment to the mocked GitHub API
    Given the test harness is set up with the "test/fixtures/cli-tool" fixture
    And the GitHub API mock has an open issue 42 with title "Test feature"
    And the Claude CLI stub is configured with a passing review JSONL fixture
    When the review phase is executed against the fixture repo for issue 42
    Then the mock server recorded requests contain a POST to the issue comments endpoint
    And the posted comment body contains proof data
    And the posted comment body contains a review status

  @adw-6bi1qq-fixture-target-repo @regression
  Scenario: Review phase generates scenario proof with correct severity classification
    Given the test harness is set up with the "test/fixtures/cli-tool" fixture
    And the fixture repo has ".adw/review_proof.md" with @review-proof as blocker
    And the Claude CLI stub is configured with a review JSONL fixture
    When the review phase is executed against the fixture repo
    Then a scenario proof file is generated in the agents output directory
    And the scenario proof classifies @review-proof results with blocker severity
    And the scenario proof includes pass/fail counts

  @adw-6bi1qq-fixture-target-repo
  Scenario: Review phase records all GitHub API interactions for assertion
    Given the test harness is set up with the "test/fixtures/cli-tool" fixture
    And the GitHub API mock has an open issue 42
    When the review phase is executed against the fixture repo for issue 42
    Then the mock server recorded requests can be inspected by the scenario
    And each recorded request includes method, path, headers, and body

  # ── 7. Deterministic behavior with canned fixtures ─────────────────────────

  @adw-6bi1qq-fixture-target-repo @regression
  Scenario: Scenarios pass deterministically with canned fixtures
    Given the test harness is set up with the "test/fixtures/cli-tool" fixture
    And all external boundaries are mocked with canned responses
    When the review phase scenario is executed twice in sequence
    Then both executions produce the same observable outcomes
    And the mock server recordings match between runs

  @adw-6bi1qq-fixture-target-repo
  Scenario: No external network requests are made during test execution
    Given the test harness is set up with all mocks active
    When the review phase is executed against the fixture repo
    Then no HTTP requests are made to api.github.com
    And no git push or fetch reaches a remote server
    And the Claude CLI stub handles all CLI invocations locally

  # ── 8. Cucumber hook integration ───────────────────────────────────────────

  @adw-6bi1qq-fixture-target-repo
  Scenario: Cucumber Before hook wires up the test harness
    Given a Cucumber support file exists for the test harness
    Then it registers a Before hook that calls the test harness setup
    And the Before hook makes the mock context available to step definitions

  @adw-6bi1qq-fixture-target-repo
  Scenario: Cucumber After hook tears down the test harness
    Given a Cucumber support file exists for the test harness
    Then it registers an After hook that calls the test harness teardown
    And the After hook ensures cleanup even if a scenario fails

  # ── 9. TypeScript integrity ────────────────────────────────────────────────

  @adw-6bi1qq-fixture-target-repo @regression
  Scenario: TypeScript type-check passes after all changes for issue 279
    Given the ADW codebase has been modified for issue 279
    When "bunx tsc --noEmit" and "bunx tsc --noEmit -p adws/tsconfig.json" are run
    Then both type-check commands exit with code 0
