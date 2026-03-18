@adw-236
Feature: PR slash command does not override GH_TOKEN with GITHUB_PAT

  The /pull_request slash command (.claude/commands/pull_request.md) must not
  instruct the AI to set GH_TOKEN from GITHUB_PAT. The orchestrator already
  sets GH_TOKEN to the correct GitHub App installation token via
  activateGitHubAppAuth() in workflowInit.ts. Overwriting it with GITHUB_PAT
  causes PRs to be authored by the personal user instead of the app bot.

  Background:
    Given the ADW codebase is checked out

  @adw-236 @regression
  Scenario: pull_request.md does not instruct setting GH_TOKEN from GITHUB_PAT
    Given ".claude/commands/pull_request.md" is read
    Then the file does not contain "Set GH_TOKEN environment variable from GITHUB_PAT"

  @adw-236 @regression
  Scenario: pull_request.md does not reference GITHUB_PAT anywhere
    Given ".claude/commands/pull_request.md" is read
    Then the file does not contain "GITHUB_PAT"

  @adw-236
  Scenario: pull_request.md still contains the gh pr create command
    Given ".claude/commands/pull_request.md" is read
    Then the file contains "gh pr create"

  @adw-236
  Scenario: pull_request.md step 5 runs gh pr create directly
    Given ".claude/commands/pull_request.md" is read
    Then step 5 in the Run section starts with "Run `gh pr create"

  @adw-236
  Scenario: workflowInit.ts sets app auth before any GitHub API calls
    Given "adws/phases/workflowInit.ts" is read
    Then the file contains "activateGitHubAppAuth"
