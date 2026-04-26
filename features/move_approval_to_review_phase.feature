@adw-434
Feature: Move PR approval into reviewPhase; autoMergePhase reads approval state

  PR approval moves from autoMergePhase (and inline orchestrator calls) to
  reviewPhase. The approvePR mechanism switches from deleting GH_TOKEN to the
  PAT-swap pattern (set GITHUB_PAT, restore in finally). autoMergePhase now
  reads approval state from GitHub (gh pr view --json reviews) and only merges
  when an APPROVED review exists. Missing approval triggers hitl label and a
  one-time comment. Auth errors are added to NON_RETRYABLE_PATTERNS. Workflow
  startup validates GITHUB_PAT presence when a GitHub App is configured.

  Background:
    Given the ADW codebase is checked out

  # -- approvePR PAT-swap mechanism ----------------------------------------

  @adw-434 @regression
  Scenario: approvePR sets GH_TOKEN to GITHUB_PAT instead of deleting it
    Given "adws/github/prApi.ts" is read
    Then the file does not contain "delete process.env.GH_TOKEN"
    And the file contains "GITHUB_PAT"

  @adw-434 @regression
  Scenario: approvePR imports GITHUB_PAT from core config
    Given "adws/github/prApi.ts" is read
    Then the file contains "GITHUB_PAT"
    And the file contains "from '../core"

  # -- reviewPhase calls approvePR -----------------------------------------

  @adw-434 @regression
  Scenario: reviewPhase imports approvePR
    Given "adws/phases/reviewPhase.ts" is read
    Then the file imports "approvePR"

  @adw-434 @regression
  Scenario: reviewPhase calls approvePR after review passes
    Given "adws/phases/reviewPhase.ts" is read
    Then the file contains "approvePR"
    And the file contains "reviewPassed"

  @adw-434 @regression
  Scenario: reviewPhase does not throw when approvePR fails
    Given "adws/phases/reviewPhase.ts" is read
    Then the file contains "approvePR"
    And the file contains "non-fatal" or "log" near the approvePR call

  # -- autoMergePhase no longer calls approvePR ----------------------------

  @adw-434 @regression
  Scenario: autoMergePhase does not import or call approvePR
    Given "adws/phases/autoMergePhase.ts" is read
    Then the file does not contain "approvePR"

  @adw-434 @regression
  Scenario: autoMergePhase does not reference isGitHubAppConfigured
    Given "adws/phases/autoMergePhase.ts" is read
    Then the file does not contain "isGitHubAppConfigured"

  # -- autoMergePhase reads approval state from GitHub ---------------------

  @adw-434 @regression
  Scenario: autoMergePhase fetches PR reviews via gh pr view
    Given "adws/phases/autoMergePhase.ts" is read
    Then the file contains "gh pr view" and "--json reviews"

  @adw-434 @regression
  Scenario: autoMergePhase checks for APPROVED state in reviews
    Given "adws/phases/autoMergePhase.ts" is read
    Then the file contains "APPROVED"

  @adw-434 @regression
  Scenario: autoMergePhase merges only when an APPROVED review is present
    Given "adws/phases/autoMergePhase.ts" is read
    Then the file contains "APPROVED"
    And the file contains "mergeWithConflictResolution"

  @adw-434 @regression
  Scenario: autoMergePhase applies hitl label when no approved review found
    Given "adws/phases/autoMergePhase.ts" is read
    Then the file contains "hitl"
    And the file contains "addIssueLabel" or "label"

  @adw-434 @regression
  Scenario: autoMergePhase posts awaiting-human-approval comment when no approved review
    Given "adws/phases/autoMergePhase.ts" is read
    Then the file contains "Awaiting human approval"

  @adw-434 @regression
  Scenario: autoMergePhase silently skips on re-entry when hitl label is already present
    Given "adws/phases/autoMergePhase.ts" is read
    Then "issueHasLabel" is called before "mergeWithConflictResolution"
    And the hitl label early-return path does not call "commentOnIssue"

  # -- Orchestrators no longer call approvePR unconditionally ---------------
  # NOTE (issue #496): adwChore.tsx now calls approvePR conditionally — only when
  # the issue does not carry the hitl label. The unconditional removal from #434 is
  # superseded for the chore orchestrator; adwSdlc and adwPlanBuildReview are unchanged.

  @adw-434 @adw-496 @regression
  Scenario: adwChore.tsx calls approvePR only when hitl is not on the issue
    Given "adws/adwChore.tsx" is read
    Then the file imports "approvePR"
    And the file contains "!issueHasLabel("

  @adw-434 @regression
  Scenario: adwSdlc.tsx does not call approvePR
    Given "adws/adwSdlc.tsx" is read
    Then the file does not contain "approvePR"

  @adw-434 @regression
  Scenario: adwPlanBuildReview.tsx does not call approvePR
    Given "adws/adwPlanBuildReview.tsx" is read
    Then the file does not contain "approvePR"

  @adw-434 @regression
  Scenario: adwPlanBuildTestReview.tsx does not call approvePR
    Given "adws/adwPlanBuildTestReview.tsx" is read
    Then the file does not contain "approvePR"

  # -- Startup validation --------------------------------------------------

  @adw-434 @regression
  Scenario: Workflow startup validates GITHUB_PAT when GitHub App is configured
    Given "adws/phases/workflowInit.ts" is read
    Then the file contains "isGitHubAppConfigured"
    And the file contains "GITHUB_PAT"

  @adw-434 @regression
  Scenario: Workflow startup throws when GitHub App is configured without GITHUB_PAT
    Given "adws/phases/workflowInit.ts" is read
    Then the file contains "GITHUB_PAT"
    And the file contains "throw" or "Error"

  # -- Auth errors are non-retryable ---------------------------------------

  @adw-434 @regression
  Scenario: NON_RETRYABLE_PATTERNS includes gh auth login
    Given "adws/core/utils.ts" is read
    Then the file contains "gh auth login"

  @adw-434 @regression
  Scenario: NON_RETRYABLE_PATTERNS includes HTTP 401
    Given "adws/core/utils.ts" is read
    Then the file contains "HTTP 401"

  @adw-434 @regression
  Scenario: NON_RETRYABLE_PATTERNS includes Bad credentials
    Given "adws/core/utils.ts" is read
    Then the file contains "Bad credentials"

  @adw-434 @regression
  Scenario: NON_RETRYABLE_PATTERNS includes GH_TOKEN
    Given "adws/core/utils.ts" is read
    Then the file contains "GH_TOKEN"

  @adw-434 @regression
  Scenario: NON_RETRYABLE_PATTERNS includes authentication
    Given "adws/core/utils.ts" is read
    Then the file contains "authentication"

  # -- TypeScript type-check -----------------------------------------------

  @adw-434 @regression
  Scenario: ADW TypeScript type-check passes after moving approval to review phase
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
