@adw-377
Feature: Fix non-retryable merge error retry and ENOENT commit message leak
  Two independent bug fixes:
  1. "is not mergeable" errors are retried by execWithRetry despite never succeeding
  2. When the commit agent fails (ENOENT), the error string leaks into the commit message

  # ── 1. "is not mergeable" added to NON_RETRYABLE_PATTERNS ─────────────

  @adw-643xf3-fix-is-not-mergeable @regression
  Scenario: execWithRetry fails immediately on "is not mergeable" error
    Given an execWithRetry utility wrapping execSync
    When a gh CLI command fails with an error containing "is not mergeable"
    Then the utility throws immediately without retrying
    And the log contains "non-retryable error, failing immediately"

  @adw-643xf3-fix-is-not-mergeable
  Scenario: "is not mergeable" is listed in NON_RETRYABLE_PATTERNS
    Given the file "adws/core/utils.ts" is read
    When the NON_RETRYABLE_PATTERNS constant is inspected
    Then it contains the pattern "is not mergeable"

  @adw-643xf3-fix-is-not-mergeable
  Scenario: execWithRetry still retries transient errors after adding new pattern
    Given an execWithRetry utility wrapping execSync
    When a gh CLI command fails on the first two attempts with a transient network error
    And succeeds on the third attempt
    Then the command is executed exactly 3 times
    And the delays between attempts follow exponential backoff

  # ── 2. Commit agent failure must not produce a garbage commit ──────────

  @adw-643xf3-fix-is-not-mergeable @regression
  Scenario: Commit agent ENOENT failure does not produce a commit
    Given the commit agent is invoked via runCommitAgent
    When the underlying Claude CLI spawn fails with ENOENT
    Then no git commit is created with the error string as the message
    And the function throws an error indicating the commit agent failed

  @adw-643xf3-fix-is-not-mergeable @regression
  Scenario: Commit agent checks result.success before using output as commit message
    Given the commit agent is invoked via runCommitAgent
    When the agent returns a result with success=false
    Then the error string is not used as a commit message
    And the function throws rather than committing garbage output

  @adw-643xf3-fix-is-not-mergeable
  Scenario: Commit agent succeeds and produces a valid commit message
    Given the commit agent is invoked via runCommitAgent
    When the agent returns a result with success=true
    And the output contains a valid commit message
    Then the commit message is extracted and validated against the expected prefix
    And the function returns the commit message in the result

  # ── 3. Known issues registry updated ───────────────────────────────────

  @adw-643xf3-fix-is-not-mergeable
  Scenario: known_issues.md updated with "is not mergeable" pattern
    Given the file "adws/known_issues.md" is read
    When the "non-retryable-error-retried" entry is inspected
    Then the description or patterns list includes "is not mergeable"

  @adw-643xf3-fix-is-not-mergeable
  Scenario: known_issues.md has entry for ENOENT-in-commit-message
    Given the file "adws/known_issues.md" is read
    Then there is an entry describing ENOENT error leaking into commit messages
    And the entry includes the pattern "spawn claude ENOENT" or similar
    And the entry status reflects the fix

  # ── 4. Existing tests still pass ───────────────────────────────────────

  @adw-643xf3-fix-is-not-mergeable
  Scenario: Existing phaseRunner tests still pass after changes
    Given all bug fixes for issue #377 are applied
    When the existing test suite is run
    Then phaseRunner.test.ts tests pass with zero failures

  # ── 5. TypeScript compilation ──────────────────────────────────────────

  @adw-643xf3-fix-is-not-mergeable
  Scenario: All changes pass TypeScript type checking
    Given all bug fixes for issue #377 are applied
    When "bunx tsc --noEmit" is run
    Then the compilation succeeds with zero errors
