@adw-237
Feature: PRs target the repo's default branch and use qualified issue references

  When creating PRs for foreign target repos, the PR must target the repo's
  actual default branch (e.g., master, develop) instead of hardcoding "main".
  Issue references in the PR body must use the fully-qualified form
  (owner/repo#N) so that GitHub auto-links cross-repo PRs to their issues.

  Both bugs stem from missing target repo context in the PR creation path:
  prPhase.ts has access to config.repoContext.repoId but does not pass it
  to runPullRequestAgent(), and the /pull_request slash command defaults to
  "main" if $5 is empty.

  Background:
    Given the ADW codebase is checked out

  # ── Repo context passed through PR agent ──────────────────────────────────

  @adw-237 @regression
  Scenario: runPullRequestAgent accepts repoOwner and repoName parameters
    Given "adws/agents/prAgent.ts" is read
    Then the runPullRequestAgent function signature includes a repoOwner parameter
    And the runPullRequestAgent function signature includes a repoName parameter

  @adw-237 @regression
  Scenario: formatPullRequestArgs includes repoOwner and repoName in the args array
    Given "adws/agents/prAgent.ts" is read
    Then formatPullRequestArgs includes repoOwner in its parameter list
    And formatPullRequestArgs includes repoName in its parameter list

  @adw-237 @regression
  Scenario: prPhase.ts passes repoContext repoId to runPullRequestAgent
    Given "adws/phases/prPhase.ts" is read
    Then the runPullRequestAgent call in prPhase.ts includes repo owner from repoContext
    And the runPullRequestAgent call in prPhase.ts includes repo name from repoContext

  # ── Slash command uses qualified issue references ─────────────────────────

  @adw-237 @regression
  Scenario: pull_request.md declares repoOwner and repoName variables
    Given ".claude/commands/pull_request.md" is read
    Then the file contains "repoOwner"
    And the file contains "repoName"

  @adw-237 @regression
  Scenario: pull_request.md uses qualified issue reference format
    Given ".claude/commands/pull_request.md" is read
    Then the file contains "owner/repo#N" or instructs to use qualified issue references

  @adw-237
  Scenario: pull_request.md does not hardcode "main" as the sole default branch
    Given ".claude/commands/pull_request.md" is read
    Then the file does not contain "defaults to 'main' if not provided"

  # ── pullRequestCreator uses qualified references ──────────────────────────

  @adw-237 @regression
  Scenario: generatePrBody does not use bare issue number references
    Given "adws/github/pullRequestCreator.ts" is read
    Then the file does not contain "Implements #${issue.number}"

  @adw-237 @regression
  Scenario: generatePrBody produces qualified owner/repo#N references when both params are provided
    Given "adws/github/pullRequestCreator.ts" is read
    Then generatePrBody uses repoOwner and repoName to build a qualified issue reference

  @adw-237 @regression
  Scenario: generatePrBody falls back to bare #N when repoOwner and repoName are absent
    Given "adws/github/pullRequestCreator.ts" is read
    Then generatePrBody falls back to bare issue reference when repo params are missing

  @adw-237 @regression
  Scenario: createPullRequest accepts repoOwner and repoName parameters
    Given "adws/github/pullRequestCreator.ts" is read
    Then createPullRequest function signature includes repoOwner parameter
    And createPullRequest function signature includes repoName parameter

  # ── Default branch detection ──────────────────────────────────────────────

  @adw-237
  Scenario: getDefaultBranch uses gh repo view to detect the actual default branch
    Given "adws/vcs/branchOperations.ts" is read
    Then the file contains "gh repo view --json defaultBranchRef"

  @adw-237
  Scenario: pull_request.md instructs fallback to gh repo view for default branch
    Given ".claude/commands/pull_request.md" is read
    Then the file contains "gh repo view" or references defaultBranch variable without hardcoded main

  # ── Type safety ───────────────────────────────────────────────────────────

  @adw-237 @regression
  Scenario: TypeScript type-check passes after PR default branch and linking fix
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
