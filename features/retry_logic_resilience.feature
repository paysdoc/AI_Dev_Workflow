@adw-315
Feature: Robustness hardening — retry logic, pre-flight checks, and graceful degradation
  Multiple classes of transient failures crash ADW workflows unnecessarily.
  This feature adds retry logic, pre-flight validation, and graceful degradation
  to prevent workflow crashes from transient failures.

  # ── 1. execWithRetry utility for gh CLI calls ──────────────────────────

  @adw-gcisck-robustness-hardening @regression
  Scenario: execWithRetry retries a failing gh CLI command with exponential backoff
    Given an execWithRetry utility wrapping execSync
    When a gh CLI command fails on the first two attempts with a transient error
    And succeeds on the third attempt
    Then the command is executed exactly 3 times
    And the delays between attempts follow exponential backoff of 500ms, 1000ms

  @adw-gcisck-robustness-hardening @regression
  Scenario: execWithRetry gives up after 3 failed attempts
    Given an execWithRetry utility wrapping execSync
    When a gh CLI command fails on all 3 attempts with a transient error
    Then the utility throws the last error after 3 attempts
    And all 3 attempts are logged with their attempt number

  @adw-gcisck-robustness-hardening @adw-643xf3-fix-is-not-mergeable
  Scenario: execWithRetry does not retry on non-transient errors
    Given an execWithRetry utility wrapping execSync
    When a gh CLI command fails with a non-transient error such as "not found"
    Then the utility throws immediately without retrying

  @adw-gcisck-robustness-hardening @regression
  Scenario: gh CLI calls in issueApi use execWithRetry
    Given the issueApi module
    When any gh CLI call is made through issueApi
    Then the call is routed through execWithRetry
    And transient failures are retried up to 3 times

  @adw-gcisck-robustness-hardening @regression
  Scenario: gh CLI calls in prApi use execWithRetry
    Given the prApi module
    When any gh CLI call is made through prApi
    Then the call is routed through execWithRetry
    And transient failures are retried up to 3 times

  @adw-gcisck-robustness-hardening @regression
  Scenario: gh CLI calls in githubApi use execWithRetry
    Given the githubApi module
    When any gh CLI call is made through githubApi
    Then the call is routed through execWithRetry
    And transient failures are retried up to 3 times

  @adw-gcisck-robustness-hardening @regression
  Scenario: gh CLI calls in githubCodeHost use execWithRetry
    Given the githubCodeHost module
    When any gh CLI call is made through githubCodeHost
    Then the call is routed through execWithRetry
    And transient failures are retried up to 3 times

  # ── 2. Claude CLI ENOENT retry upgrade ─────────────────────────────────

  @adw-gcisck-robustness-hardening @regression
  Scenario: Claude CLI ENOENT retries 3 times with exponential backoff
    Given the claudeAgent spawns a Claude CLI process
    When the spawn fails with ENOENT on the first two attempts
    And the CLI becomes available on the third attempt
    Then the agent retries up to 3 times with exponential backoff of 500ms, 1000ms
    And the agent successfully spawns on the third attempt

  @adw-gcisck-robustness-hardening @regression
  Scenario: Claude CLI path is re-resolved on every ENOENT retry attempt
    Given the claudeAgent spawns a Claude CLI process
    And the Claude CLI symlink target changes between attempts
    When the spawn fails with ENOENT on the first attempt
    Then resolveClaudeCodePath is called again before the second attempt
    And resolveClaudeCodePath is called again before the third attempt
    And later attempts pick up the new symlink target

  @adw-gcisck-robustness-hardening
  Scenario: Claude CLI ENOENT exhausts all retries
    Given the claudeAgent spawns a Claude CLI process
    When the spawn fails with ENOENT on all 3 attempts
    Then the agent throws an error indicating the Claude CLI was not found
    And all 3 retry attempts are logged

  # ── 3. Pre-flight CLI validation ───────────────────────────────────────

  @adw-gcisck-robustness-hardening @regression
  Scenario: Workflow fails fast when Claude CLI is not found at startup
    Given initializeWorkflow is called
    When resolveClaudeCodePath returns no valid path
    Then the workflow fails immediately with a clear error message
    And no pipeline phases are started

  @adw-gcisck-robustness-hardening @regression
  Scenario: Workflow verifies Claude CLI binary is executable at startup
    Given initializeWorkflow is called
    And resolveClaudeCodePath returns a valid path
    When the binary at that path is not executable
    Then the workflow fails immediately with a clear error message
    And no pipeline phases are started

  @adw-gcisck-robustness-hardening
  Scenario: Workflow proceeds when Claude CLI passes pre-flight check
    Given initializeWorkflow is called
    And resolveClaudeCodePath returns a valid executable path
    Then the pre-flight CLI validation passes
    And the workflow continues to the next phase

  # ── 4. Worktree creation from origin/<default> ─────────────────────────

  @adw-gcisck-robustness-hardening @regression
  Scenario: New worktree is created from origin/<default> instead of local branch
    Given a repository with a default branch "main"
    When a new worktree is created for a feature branch
    Then the git worktree add command uses "origin/main" as the base ref
    And the worktree starts clean from the remote state

  @adw-gcisck-robustness-hardening @regression
  Scenario: Worktree creation succeeds even when local default branch is dirty
    Given a repository with a default branch "main"
    And the local "main" branch has uncommitted changes
    When a new worktree is created for a feature branch
    Then the worktree is created successfully from "origin/main"
    And the worktree does not contain the local dirty state

  @adw-gcisck-robustness-hardening
  Scenario: Warning logged when local default branch differs from remote
    Given a repository with a default branch "main"
    And the local "main" branch is behind "origin/main"
    When a new worktree is created for a feature branch
    Then a warning is logged indicating the local branch differs from remote
    And the worktree creation still succeeds using "origin/main"

  # ── 5. PR creation: check for existing PR ──────────────────────────────

  @adw-gcisck-robustness-hardening @regression
  Scenario: PR creation reuses existing PR instead of creating a duplicate
    Given a feature branch "feature-issue-123" already has an open PR
    When the workflow attempts to create a PR for that branch
    Then the existing PR URL and number are returned
    And no new PR is created

  @adw-gcisck-robustness-hardening @regression
  Scenario: PR creation creates a new PR when none exists
    Given a feature branch "feature-issue-456" has no open PR
    When the workflow attempts to create a PR for that branch
    Then a new PR is created via gh pr create
    And the new PR URL and number are returned

  @adw-gcisck-robustness-hardening
  Scenario: Existing PR check uses gh pr list with head branch filter
    Given the githubCodeHost module
    When checking for an existing PR for branch "feature-issue-789"
    Then the command "gh pr list --head feature-issue-789 --json url,number" is executed
    And the result determines whether to create or reuse a PR

  # ── 6. JSON parse retry + graceful degradation ─────────────────────────

  @adw-gcisck-robustness-hardening @adw-u8xr9v-add-output-validatio @regression
  Scenario: Resolution agent delegates output validation retries to commandAgent
    Given the resolution agent uses commandAgent with extractOutput and outputSchema
    When the agent output fails JSON Schema validation
    Then the commandAgent retry loop handles retries with a Haiku corrective prompt
    And the resolution agent does not implement its own retry-on-parse-failure logic

  @adw-gcisck-robustness-hardening @adw-u8xr9v-add-output-validatio @regression
  Scenario: Resolution phase degrades gracefully when commandAgent retries are exhausted
    Given the resolution agent output fails validation on all retry attempts
    When the commandAgent retry loop throws after exhausting retries
    Then the resolution phase catches the error and returns resolved=false with decisions=[]
    And the orchestrator handles the unresolved result

  @adw-gcisck-robustness-hardening @adw-u8xr9v-add-output-validatio @regression
  Scenario: Validation agent delegates output validation retries to commandAgent
    Given the validation agent uses commandAgent with extractOutput and outputSchema
    When the agent output fails JSON Schema validation
    Then the commandAgent retry loop handles retries with a Haiku corrective prompt
    And the validation agent does not implement its own retry-on-parse-failure logic

  @adw-gcisck-robustness-hardening @adw-u8xr9v-add-output-validatio @regression
  Scenario: Validation phase degrades gracefully when commandAgent retries are exhausted
    Given the validation agent output fails validation on all retry attempts
    When the commandAgent retry loop throws after exhausting retries
    Then the validation phase returns a failed validation result
    And the orchestrator retries up to MAX_VALIDATION_RETRY_ATTEMPTS

  @adw-gcisck-robustness-hardening @regression
  Scenario: Review issue arrays filter out undefined elements before access
    Given the reviewPhase module processes review results
    When the review issue array contains undefined or null entries
    Then undefined and null entries are filtered out before processing
    And no TypeError is thrown when accessing issueDescription

  @adw-gcisck-robustness-hardening
  Scenario: Review issue arrays with all valid entries are unaffected by filter
    Given the reviewPhase module processes review results
    When the review issue array contains only valid entries
    Then all entries are processed normally
    And the filter has no effect on the result

  # ── 7. Empty log directory logging ─────────────────────────────────────

  @adw-gcisck-robustness-hardening
  Scenario: Auto-merge handler writes skip reason on early return — PR already merged
    Given the auto-merge handler creates a log directory
    When the handler detects the PR is already merged and exits early
    Then a skip_reason.txt file is written to the log directory
    And the file contains the reason "PR already merged"

  @adw-gcisck-robustness-hardening
  Scenario: Auto-merge handler writes skip reason on early return — worktree failure
    Given the auto-merge handler creates a log directory
    When the handler fails to create a worktree and exits early
    Then a skip_reason.txt file is written to the log directory
    And the file contains the reason for the worktree failure

  @adw-gcisck-robustness-hardening
  Scenario: Auto-merge handler writes skip reason on early return — missing PR URL
    Given the auto-merge handler creates a log directory
    When the handler has no PR URL and exits early
    Then a skip_reason.txt file is written to the log directory
    And the file contains the reason "missing PR URL"

  @adw-gcisck-robustness-hardening
  Scenario: Auto-merge handler writes skip reason on early return — missing repo context
    Given the auto-merge handler creates a log directory
    When the handler has no repo context and exits early
    Then a skip_reason.txt file is written to the log directory
    And the file contains the reason "missing repo context"

  @adw-gcisck-robustness-hardening @regression
  Scenario: Auto-merge phase writes skip reason on early return — no PR URL
    Given the auto-merge phase is invoked
    When the phase context has no PR URL and exits early
    Then a skip_reason.txt file is written to the log directory
    And the file contains the reason "no PR URL in context"

  @adw-gcisck-robustness-hardening
  Scenario: Auto-merge phase writes skip reason on early return — no repo context
    Given the auto-merge phase is invoked
    When the phase context has no repo context and exits early
    Then a skip_reason.txt file is written to the log directory
    And the file contains the reason "no repo context"

  # ── Cross-cutting: TypeScript compilation ──────────────────────────────

  @adw-gcisck-robustness-hardening @regression
  Scenario: All changes pass TypeScript type checking
    Given all robustness hardening changes are applied
    When the TypeScript compiler runs with --noEmit
    Then the compilation succeeds with zero errors
