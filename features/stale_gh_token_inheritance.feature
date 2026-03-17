@adw-4kk6lc-bug-orchestrator-chi
Feature: Orchestrator child processes refresh GH_TOKEN via activateGitHubAppAuth

  When a cron or webhook trigger spawns an orchestrator (e.g. adwPlanBuild.tsx,
  adwSdlc.tsx, adwPrReview.tsx) as a detached child process, the child inherits
  `process.env.GH_TOKEN` — a GitHub App installation token that expires after
  1 hour. Without calling `activateGitHubAppAuth()` the child never refreshes
  its token, so all `gh` CLI calls fail with HTTP 401 once the inherited token
  expires.

  The fix calls `activateGitHubAppAuth(owner, repo)` early in both
  `initializeWorkflow()` (adws/phases/workflowInit.ts) and
  `initializePRReviewWorkflow()` (adws/phases/prReviewPhase.ts) so each spawned
  process immediately generates its own fresh 1-hour token. When the GitHub App
  is not configured the call returns false and falls back to `gh auth login`
  credentials — no behaviour change for non-App setups.

  Background:
    Given the ADW codebase is checked out

  @adw-4kk6lc-bug-orchestrator-chi @regression
  Scenario: workflowInit.ts imports activateGitHubAppAuth
    Given "adws/phases/workflowInit.ts" is read
    Then the file contains "activateGitHubAppAuth"

  @adw-4kk6lc-bug-orchestrator-chi @regression
  Scenario: initializeWorkflow calls activateGitHubAppAuth before fetchGitHubIssue
    Given "adws/phases/workflowInit.ts" is read
    Then activateGitHubAppAuth is called before fetchGitHubIssue in initializeWorkflow

  @adw-4kk6lc-bug-orchestrator-chi @regression
  Scenario: prReviewPhase.ts imports activateGitHubAppAuth
    Given "adws/phases/prReviewPhase.ts" is read
    Then the file contains "activateGitHubAppAuth"

  @adw-4kk6lc-bug-orchestrator-chi @regression
  Scenario: initializePRReviewWorkflow calls activateGitHubAppAuth before fetchPRDetails
    Given "adws/phases/prReviewPhase.ts" is read
    Then activateGitHubAppAuth is called before fetchPRDetails in initializePRReviewWorkflow

  @adw-4kk6lc-bug-orchestrator-chi @regression
  Scenario: TypeScript type-check passes after adding activateGitHubAppAuth calls
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes

  @adw-4kk6lc-bug-orchestrator-chi
  Scenario: workflowInit.ts calls activateGitHubAppAuth with owner and repo arguments
    Given "adws/phases/workflowInit.ts" is read
    Then the file contains "activateGitHubAppAuth("

  @adw-4kk6lc-bug-orchestrator-chi
  Scenario: prReviewPhase.ts calls activateGitHubAppAuth with owner and repo arguments
    Given "adws/phases/prReviewPhase.ts" is read
    Then the file contains "activateGitHubAppAuth("

  @adw-4kk6lc-bug-orchestrator-chi
  Scenario: githubAppAuth is imported from the github module in workflowInit.ts
    Given "adws/phases/workflowInit.ts" is read
    Then the file contains "githubAppAuth"

  @adw-4kk6lc-bug-orchestrator-chi
  Scenario: githubAppAuth is imported from the github module in prReviewPhase.ts
    Given "adws/phases/prReviewPhase.ts" is read
    Then the file contains "githubAppAuth"
