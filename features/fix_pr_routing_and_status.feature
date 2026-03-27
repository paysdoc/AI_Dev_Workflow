@adw-7sunv4-fix-issue-status-pro
Feature: Fix issue status propagation, PR routing, and PR-to-issue linking

  Three related bugs affect issue lifecycle management:
  1. Issues never reach 'Review' status after PR creation in main workflows
  2. PRs sometimes target wrong base branch because LLM agent controls git push and gh pr create
  3. PR-to-issue linking is fragile due to dual extraction (body + branch) with mismatched patterns

  The fix splits LLM text generation from programmatic PR creation, adds the Review
  status transition, and simplifies webhook PR-to-issue linking to branch-only extraction.

  Background:
    Given the ADW codebase is checked out

  # ── A: Review status transition in PR phase ──────────────────────────────────

  @adw-7sunv4-fix-issue-status-pro @regression
  Scenario: prPhase.ts calls moveToStatus with BoardStatus.Review after PR creation
    Given "adws/phases/prPhase.ts" is read
    Then the file contains "moveToStatus"
    And the file contains "BoardStatus.Review"

  @adw-7sunv4-fix-issue-status-pro @regression
  Scenario: prPhase.ts imports BoardStatus from providers types
    Given "adws/phases/prPhase.ts" is read
    Then the file contains "BoardStatus"
    And the file contains "import" referencing BoardStatus

  # ── B: Refactored PR creation — LLM generates text only ─────────────────────

  @adw-7sunv4-fix-issue-status-pro @regression
  Scenario: pull_request.md does not instruct the agent to run git push
    Given ".claude/commands/pull_request.md" is read
    Then the file does not contain "git push"

  @adw-7sunv4-fix-issue-status-pro @regression
  Scenario: pull_request.md does not instruct the agent to run gh pr create
    Given ".claude/commands/pull_request.md" is read
    Then the file does not contain "gh pr create"

  @adw-7sunv4-fix-issue-status-pro @regression
  Scenario: pull_request.md instructs the agent to return JSON with title and body
    Given ".claude/commands/pull_request.md" is read
    Then the file contains "JSON"
    And the file contains "title"
    And the file contains "body"

  @adw-7sunv4-fix-issue-status-pro @regression
  Scenario: prAgent.ts parses JSON title and body from agent output instead of extracting a PR URL
    Given "adws/agents/prAgent.ts" is read
    Then the file does not contain "extractPrUrlFromOutput"
    And the extractOutput function parses JSON with title and body fields

  @adw-7sunv4-fix-issue-status-pro @regression
  Scenario: prPhase.ts pushes the branch programmatically before creating the PR
    Given "adws/phases/prPhase.ts" is read
    Then the file contains "pushBranch" or a programmatic git push call before createPullRequest

  @adw-7sunv4-fix-issue-status-pro @regression
  Scenario: prPhase.ts calls codeHost.createPullRequest to create the PR
    Given "adws/phases/prPhase.ts" is read
    Then the file contains "createPullRequest"

  @adw-7sunv4-fix-issue-status-pro @regression
  Scenario: prPhase.ts stores PR url and number from createPullRequest result
    Given "adws/phases/prPhase.ts" is read
    Then ctx receives prUrl from the createPullRequest result
    And ctx receives a PR number from the createPullRequest result

  # ── C: CodeHost interface and implementation fixes ───────────────────────────

  @adw-7sunv4-fix-issue-status-pro @regression
  Scenario: CodeHost.createPullRequest returns an object with url and number
    Given "adws/providers/types.ts" is read
    Then the createPullRequest return type includes url and number fields

  @adw-7sunv4-fix-issue-status-pro @regression
  Scenario: GitHubCodeHost.createPullRequest does not delegate to pullRequestCreator
    Given "adws/providers/github/githubCodeHost.ts" is read
    Then the file does not contain "pullRequestCreator"
    And the file does not contain "import" referencing "pullRequestCreator"

  @adw-7sunv4-fix-issue-status-pro @regression
  Scenario: GitHubCodeHost.createPullRequest calls gh pr create directly
    Given "adws/providers/github/githubCodeHost.ts" is read
    Then the file contains "gh pr create"

  @adw-7sunv4-fix-issue-status-pro @regression
  Scenario: GitHubCodeHost.createPullRequest returns an object with url and number
    Given "adws/providers/github/githubCodeHost.ts" is read
    Then the createPullRequest method returns an object with url and number properties

  @adw-7sunv4-fix-issue-status-pro @regression
  Scenario: GitLabCodeHost.createPullRequest returns an object with url and number
    Given "adws/providers/gitlab/gitlabCodeHost.ts" is read
    Then the createPullRequest method returns an object with url and number properties

  @adw-7sunv4-fix-issue-status-pro @regression
  Scenario: pullRequestCreator.ts has been deleted
    Given the ADW codebase is checked out
    Then the file "adws/github/pullRequestCreator.ts" does not exist

  @adw-7sunv4-fix-issue-status-pro @regression
  Scenario: github/index.ts does not re-export from pullRequestCreator
    Given "adws/github/index.ts" is read
    Then the file does not contain "pullRequestCreator"

  @adw-7sunv4-fix-issue-status-pro @regression
  Scenario: adws/index.ts does not re-export createPullRequest
    Given "adws/index.ts" is read
    Then the file does not contain "createPullRequest"

  # ── D: Simplified webhook PR-to-issue linking ────────────────────────────────

  @adw-7sunv4-fix-issue-status-pro @regression
  Scenario: webhookHandlers.ts does not contain extractIssueNumberFromPRBody
    Given "adws/triggers/webhookHandlers.ts" is read
    Then the file does not contain "extractIssueNumberFromPRBody"

  @adw-7sunv4-fix-issue-status-pro @regression
  Scenario: handlePullRequestEvent uses only branch-based issue number extraction
    Given "adws/triggers/webhookHandlers.ts" is read
    Then the file contains "extractIssueNumberFromBranch"
    And the file does not contain "Implements #"

  @adw-7sunv4-fix-issue-status-pro @regression
  Scenario: extractIssueNumberFromBranch uses only the issue-N pattern
    Given "adws/triggers/webhookHandlers.ts" is read
    Then extractIssueNumberFromBranch contains the "issue-(\d+)" pattern
    And extractIssueNumberFromBranch does not contain the ADW branch format regex

