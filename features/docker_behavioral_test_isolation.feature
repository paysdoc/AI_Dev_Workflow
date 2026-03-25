@adw-78celh-docker-image-for-beh
Feature: Docker image for behavioral test isolation

  A generic Docker image that provides an isolated environment for running
  behavioral tests. The image includes Bun runtime, Git, mock infrastructure
  (Claude CLI stub, GitHub API mock server, git remote mock), and the Cucumber
  test runner. ADW source is mounted or copied at test time. A flag/env var
  switches between Docker and host execution so the test suite runs identically
  in both modes.

  # ── 1. Dockerfile existence and build ────────────────────────────────────

  @adw-78celh-docker-image-for-beh @regression
  Scenario: Dockerfile exists at the expected path
    Given the ADW codebase is at the current working directory
    Then a Dockerfile for behavioral test isolation exists in the repository
    And the Dockerfile path matches one of "test/Dockerfile" or "docker/Dockerfile"

  @adw-78celh-docker-image-for-beh @regression
  Scenario: Docker image builds successfully
    Given the Dockerfile for behavioral test isolation exists
    When "docker build" is run against the Dockerfile
    Then the build exits with code 0
    And a Docker image is produced with the expected tag

  # ── 2. Image contents ───────────────────────────────────────────────────

  @adw-78celh-docker-image-for-beh @regression
  Scenario: Docker image includes Bun runtime
    Given the behavioral test Docker image has been built
    When "bun --version" is run inside the container
    Then the command exits with code 0
    And the output contains a valid Bun version string

  @adw-78celh-docker-image-for-beh @regression
  Scenario: Docker image includes Git
    Given the behavioral test Docker image has been built
    When "git --version" is run inside the container
    Then the command exits with code 0
    And the output contains a valid Git version string

  @adw-78celh-docker-image-for-beh @regression
  Scenario: Docker image includes Cucumber test runner
    Given the behavioral test Docker image has been built
    When "bunx cucumber-js --version" is run inside the container
    Then the command exits with code 0

  @adw-78celh-docker-image-for-beh @regression
  Scenario: Docker image includes mock infrastructure dependencies
    Given the behavioral test Docker image has been built
    When the container's installed packages are inspected
    Then the packages required for the Claude CLI stub are present
    And the packages required for the GitHub API mock server are present
    And the packages required for the git remote mock are present

  # ── 3. Genericity — no ADW-specific code baked in ───────────────────────

  @adw-78celh-docker-image-for-beh @regression
  Scenario: Docker image contains no ADW application source code
    Given the behavioral test Docker image has been built
    When the container filesystem is inspected
    Then no ADW source files (adws/, .claude/) are present in the image
    And the image only contains runtime tooling and test infrastructure

  @adw-78celh-docker-image-for-beh
  Scenario: Dockerfile does not reference ADW-specific file paths
    Given the Dockerfile for behavioral test isolation exists
    When the Dockerfile contents are inspected
    Then it does not COPY or ADD ADW application source directories
    And it does not reference ADW-specific environment variables

  @adw-78celh-docker-image-for-beh
  Scenario: Docker image is reusable by other repositories
    Given the behavioral test Docker image has been built
    When a non-ADW project with Cucumber tests is mounted into the container
    Then the test runner can execute scenarios from the mounted project
    And the mock infrastructure is available to the mounted project

  # ── 4. Execution mode switching ─────────────────────────────────────────

  @adw-78celh-docker-image-for-beh @regression
  Scenario: Environment variable controls Docker vs host execution
    Given the ADW codebase is at the current working directory
    Then a flag or environment variable exists to switch between Docker and host execution
    And the flag defaults to host execution when not set

  @adw-78celh-docker-image-for-beh @regression
  Scenario: Test suite runs on host when Docker execution is disabled
    Given the execution mode flag is set to "host"
    When the behavioral test suite is executed
    Then no Docker commands are invoked
    And the test runner executes scenarios directly on the host
    And the tests complete successfully

  @adw-78celh-docker-image-for-beh @regression
  Scenario: Test suite runs in Docker when Docker execution is enabled
    Given the execution mode flag is set to "docker"
    And the behavioral test Docker image has been built
    When the behavioral test suite is executed
    Then the test runner starts a Docker container from the behavioral test image
    And the tests execute inside the container
    And the tests complete successfully

  @adw-78celh-docker-image-for-beh
  Scenario: Execution mode flag accepts known values only
    Given the execution mode flag is set to an invalid value "cloud"
    When the behavioral test suite is executed
    Then an error message indicates the invalid execution mode
    And the test suite does not proceed

  # ── 5. ADW source mounting ──────────────────────────────────────────────

  @adw-78celh-docker-image-for-beh @regression
  Scenario: ADW source is mounted into the container as read-only
    Given the execution mode flag is set to "docker"
    And the behavioral test Docker image has been built
    When the behavioral test suite is executed
    Then the ADW source directory is mounted into the container
    And the mount is read-only or the source is copied without modification

  @adw-78celh-docker-image-for-beh
  Scenario: ADW source modifications inside the container do not affect the host
    Given the execution mode flag is set to "docker"
    And the behavioral test Docker image has been built
    When a test scenario modifies a file in the mounted ADW source
    Then the corresponding file on the host remains unchanged

  # ── 6. Fixture target repo initialization inside container ──────────────

  @adw-78celh-docker-image-for-beh @regression
  Scenario: Fixture target repo is initialized inside the container at test time
    Given the execution mode flag is set to "docker"
    And the behavioral test Docker image has been built
    When the test harness setup runs inside the container
    Then the fixture target repo is initialized as a git repository inside the container
    And at least one commit exists in the fixture repo's history

  @adw-78celh-docker-image-for-beh
  Scenario: Fixture repo state does not persist between container runs
    Given a behavioral test run has completed inside a container
    When a new container is started for another test run
    Then the fixture repo is freshly initialized
    And no state from the previous run is present

  # ── 7. Container lifecycle ──────────────────────────────────────────────

  @adw-78celh-docker-image-for-beh @regression
  Scenario: Container starts cleanly for test execution
    Given the behavioral test Docker image has been built
    When a container is started from the image with the ADW source mounted
    Then the container enters a running state
    And the container's entrypoint or command is ready to execute tests

  @adw-78celh-docker-image-for-beh @regression
  Scenario: Container tears down cleanly after test execution
    Given the behavioral test Docker image has been built
    And a container is running with tests executing
    When the test execution completes
    Then the container stops with exit code 0
    And no orphan processes remain from the container
    And the container can be removed without errors

  @adw-78celh-docker-image-for-beh
  Scenario: Container tears down cleanly even when tests fail
    Given the behavioral test Docker image has been built
    And a container is running with a failing test scenario
    When the test execution completes with failures
    Then the container stops with a non-zero exit code
    And no orphan processes remain from the container
    And the container can be removed without errors

  # ── 8. Parity between Docker and host execution ─────────────────────────

  @adw-78celh-docker-image-for-beh @regression
  Scenario: Behavioral test suite produces the same results in Docker and on host
    Given the behavioral test Docker image has been built
    When the same scenario suite is executed on the host
    And the same scenario suite is executed in Docker
    Then both runs produce the same pass/fail results
    And no scenario changes behavior based on execution environment

  @adw-78celh-docker-image-for-beh
  Scenario: Mock infrastructure behaves identically in Docker and on host
    Given the behavioral test Docker image has been built
    When the mock infrastructure is started inside the container
    And the mock infrastructure is started on the host
    Then the Claude CLI stub produces the same output in both environments
    And the GitHub API mock server responds identically in both environments
    And the git remote mock intercepts the same commands in both environments

  # ── 9. Documentation ───────────────────────────────────────────────────

  @adw-78celh-docker-image-for-beh @regression
  Scenario: Documentation exists for building and running tests in Docker
    Given the ADW codebase is at the current working directory
    Then documentation exists explaining how to build the Docker image
    And documentation exists explaining how to run tests in Docker
    And documentation exists explaining the execution mode flag

  @adw-78celh-docker-image-for-beh
  Scenario: Documentation covers the generic nature of the Docker image
    Given the ADW codebase is at the current working directory
    Then the Docker documentation explains that the image is not ADW-specific
    And the documentation describes how other projects can use the image

  # ── 10. TypeScript integrity ────────────────────────────────────────────

  @adw-78celh-docker-image-for-beh @regression
  Scenario: TypeScript type-check passes after all changes for issue 281
    Given the ADW codebase has been modified for issue 281
    When "bunx tsc --noEmit" and "bunx tsc --noEmit -p adws/tsconfig.json" are run
    Then both type-check commands exit with code 0
