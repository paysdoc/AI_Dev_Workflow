@adw-439
Feature: adw_init invokes depaudit setup and propagates SOCKET_API_TOKEN + SLACK_WEBHOOK_URL

  After cloning the target repo and bootstrapping `.adw/`, `adw_init` must
  invoke `depaudit setup` in the freshly-cloned target repo's working tree,
  and propagate `SOCKET_API_TOKEN` and `SLACK_WEBHOOK_URL` from ADW's process
  environment to the target repo's GitHub Actions secrets via
  `gh secret set --repo <target>`. Missing env values must warn — not fail —
  and be surfaced in the init summary. Assumes `depaudit` is installed
  globally (`npm install -g depaudit`) on the machine running ADW.

  Background:
    Given the ADW codebase is at the current working directory

  # --- adw_init invokes depaudit setup in the target repo's working tree ---

  @adw-439 @regression
  Scenario: adw_init orchestrator invokes depaudit setup after copying target skills and commands
    Given the file "adws/adwInit.tsx" is read
    Then the file contains a call that invokes "depaudit setup"
    And the invocation is sequenced after "copyTargetSkillsAndCommands"
    And the invocation is sequenced before "commitChanges"

  @adw-439 @regression
  Scenario: depaudit setup runs in the target repo's worktree cwd
    Given the file "adws/phases/depauditSetup.ts" is read
    When the depaudit setup invocation is found
    Then it passes "config.worktreePath" as the working directory for the child process

  @adw-439 @regression
  Scenario: adw_init assumes depaudit is installed globally on the host
    Given the file "README.md" is read
    Then the file contains "npm install -g depaudit"

  @adw-439
  Scenario: adws/README.md documents the depaudit setup step
    Given the file "adws/README.md" is read
    Then the file contains "depaudit setup"

  # --- Propagation of SOCKET_API_TOKEN via gh secret set ---

  @adw-439 @regression
  Scenario: adw_init propagates SOCKET_API_TOKEN to target repo GitHub Actions secrets
    Given the file "adws/phases/depauditSetup.ts" is read
    Then the file contains "SOCKET_API_TOKEN"
    And the file contains "gh secret set"

  @adw-439 @regression
  Scenario: gh secret set uses --repo <target> to scope to the target repo
    Given the file "adws/phases/depauditSetup.ts" is read
    When the gh secret set invocation is found
    Then it uses the "--repo" flag
    And it targets the repository identifier for the target repo

  @adw-439 @regression
  Scenario: adw_init propagates SLACK_WEBHOOK_URL to target repo GitHub Actions secrets
    Given the file "adws/phases/depauditSetup.ts" is read
    Then the file contains "SLACK_WEBHOOK_URL"
    And the file contains "gh secret set"

  @adw-439 @regression
  Scenario: Propagated secret values come from ADW's process environment
    Given the file "adws/phases/depauditSetup.ts" is read
    Then the file contains "process.env"
    And the file contains "SOCKET_API_TOKEN"
    And the file contains "SLACK_WEBHOOK_URL"

  # --- Missing env values: warn but do not fail ---

  @adw-439 @regression
  Scenario: Missing SOCKET_API_TOKEN emits a warning and does not abort adw_init
    Given the file "adws/phases/depauditSetup.ts" is read
    When the secret propagation code is found
    Then a warning is logged when "SOCKET_API_TOKEN" is unset
    And the workflow does not throw or exit on the missing value

  @adw-439 @regression
  Scenario: Missing SLACK_WEBHOOK_URL emits a warning and does not abort adw_init
    Given the file "adws/phases/depauditSetup.ts" is read
    When the secret propagation code is found
    Then a warning is logged when "SLACK_WEBHOOK_URL" is unset
    And the workflow does not throw or exit on the missing value

  @adw-439 @regression
  Scenario: adw_init summary notes which secrets were skipped due to missing env values
    Given the file "adws/adwInit.tsx" is read
    When the init summary is produced
    Then any missing env values are listed in the summary as "skipped" or "not set"

  # --- Integration test with a fixture target repo ---

  @adw-439 @regression
  Scenario: Integration test covers depaudit setup invocation against a fixture target repo
    Given the directory "adws/__tests__" exists
    Then an integration test file exists that asserts "depaudit setup" is invoked during adw_init
    And the test uses a fixture target repo

  @adw-439 @regression
  Scenario: Integration test covers SOCKET_API_TOKEN propagation when the env value is set
    Given the directory "adws/__tests__" exists
    Then an integration test asserts that "gh secret set" is called with "SOCKET_API_TOKEN" when the env var is present

  @adw-439 @regression
  Scenario: Integration test covers SLACK_WEBHOOK_URL propagation when the env value is set
    Given the directory "adws/__tests__" exists
    Then an integration test asserts that "gh secret set" is called with "SLACK_WEBHOOK_URL" when the env var is present

  @adw-439 @regression
  Scenario: Integration test covers the missing-env-value warning path
    Given the directory "adws/__tests__" exists
    Then an integration test asserts that when "SOCKET_API_TOKEN" or "SLACK_WEBHOOK_URL" is unset, adw_init logs a warning and completes successfully

  # --- Documentation updates ---

  @adw-439 @regression
  Scenario: README.md documents depaudit setup step in adw_init
    Given the file "README.md" is read
    Then the file contains "depaudit"
    And the file contains "adw_init"

  @adw-439 @regression
  Scenario: README.md documents SOCKET_API_TOKEN propagation behavior
    Given the file "README.md" is read
    Then the file contains "SOCKET_API_TOKEN"
    And the file contains a note that adw_init propagates this value to target repo GitHub Actions secrets

  @adw-439 @regression
  Scenario: README.md documents SLACK_WEBHOOK_URL propagation behavior
    Given the file "README.md" is read
    Then the file contains "SLACK_WEBHOOK_URL"
    And the file contains a note that adw_init propagates this value to target repo GitHub Actions secrets

  @adw-439
  Scenario: .env.sample contains SOCKET_API_TOKEN entry
    Given the file ".env.sample" is read
    Then the file contains "SOCKET_API_TOKEN"

  @adw-439
  Scenario: .env.sample contains SLACK_WEBHOOK_URL entry
    Given the file ".env.sample" is read
    Then the file contains "SLACK_WEBHOOK_URL"

  # --- Build integrity ---

  @adw-439 @regression
  Scenario: TypeScript type-check passes after the depaudit setup and secret propagation wiring
    When the TypeScript compiler is run with --noEmit on "adws/tsconfig.json"
    Then the compiler exits with code 0
    And no type errors are reported
