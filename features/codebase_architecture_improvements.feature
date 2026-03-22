@adw-btrko8-architectural-improv
Feature: Codebase architecture improvements
  As a developer working on the ADW codebase
  I want modules to have clear boundaries, deep abstractions, and minimal coupling
  So that the codebase is testable, extensible, and easy to navigate

  # -------------------------------------------------------------------
  # Phase decoupling from GitHub module
  # -------------------------------------------------------------------

  @regression
  Scenario: Phase files do not import directly from the GitHub module
    Given the ADW codebase
    When I scan all TypeScript files in "adws/phases/"
    Then none of them should contain imports from "../github" or "../github/"
    And all platform interactions should go through RepoContext

  @regression
  Scenario: Phase comment helpers use RepoContext instead of GitHub formatters
    Given the ADW codebase
    When I read "adws/phases/phaseCommentHelpers.ts"
    Then it should not import from "../github/workflowCommentsIssue"
    And it should use "repoContext.issueTracker" for posting comments

  Scenario: Auto-merge phase uses CodeHost interface for PR operations
    Given the ADW codebase
    When I read "adws/phases/autoMergePhase.ts"
    Then it should not import "commentOnPR" from "../github"
    And it should not import "approvePR" from "../github"
    And it should use "repoContext.codeHost" for all PR operations

  Scenario: PR review phase uses CodeHost interface for review operations
    Given the ADW codebase
    When I read the PR review phase files in "adws/phases/"
    Then they should not import directly from "../github/prApi"
    And they should use "repoContext.codeHost" for fetching review comments
    And they should use "repoContext.codeHost" for posting review feedback

  # -------------------------------------------------------------------
  # CodeHost interface completeness
  # -------------------------------------------------------------------

  @regression
  Scenario: CodeHost interface includes all PR lifecycle methods
    Given the ADW codebase
    When I read the CodeHost interface in "adws/providers/types.ts"
    Then it should declare a method for commenting on a pull request
    And it should declare a method for approving a pull request
    And it should declare a method for fetching pull request details
    And it should declare a method for fetching review comments
    And it should declare a method for merging a pull request

  Scenario: GitHub CodeHost implements all PR lifecycle methods
    Given the ADW codebase
    When I read the GitHub CodeHost implementation
    Then it should implement the "commentOnMergeRequest" method
    And it should implement the "approveMergeRequest" method
    And it should implement the "fetchMergeRequestDetails" method
    And it should implement the "fetchReviewComments" method
    And it should implement the "mergeMergeRequest" method

  Scenario: GitLab CodeHost implements all PR lifecycle methods
    Given the ADW codebase
    When I read the GitLab CodeHost implementation
    Then it should implement the "commentOnMergeRequest" method
    And it should implement the "approveMergeRequest" method
    And it should implement the "fetchMergeRequestDetails" method
    And it should implement the "fetchReviewComments" method
    And it should implement the "mergeMergeRequest" method

  # -------------------------------------------------------------------
  # WorkflowConfig decomposition
  # -------------------------------------------------------------------

  @regression
  Scenario: WorkflowConfig is decomposed into focused context objects
    Given the ADW codebase
    When I read the workflow configuration types
    Then there should be an "IssueContext" type for issue-related data
    And there should be a "WorkspaceContext" type for file system paths
    And there should be a "PlatformContext" type for provider interactions
    And "WorkflowConfig" should compose these focused contexts

  Scenario: IssueContext contains only issue-related properties
    Given the ADW codebase
    When I read the "IssueContext" type definition
    Then it should include "issueNumber"
    And it should include "issue"
    And it should include "issueType"
    And it should not include file system paths like "worktreePath" or "logsDir"

  Scenario: WorkspaceContext contains only file system properties
    Given the ADW codebase
    When I read the "WorkspaceContext" type definition
    Then it should include "worktreePath"
    And it should include "logsDir"
    And it should include "orchestratorStatePath"
    And it should not include issue tracking properties

  # -------------------------------------------------------------------
  # Phase abstraction: AgentPhaseRunner
  # -------------------------------------------------------------------

  @regression
  Scenario: An AgentPhaseRunner abstraction unifies phase execution
    Given the ADW codebase
    When I look for the AgentPhaseRunner module
    Then it should exist in "adws/phases/"
    And it should handle cost tracking for all phases
    And it should handle state management for all phases
    And it should handle comment posting for all phases

  Scenario: Plan phase uses AgentPhaseRunner
    Given the ADW codebase
    When I read "adws/phases/planPhase.ts"
    Then it should delegate execution to AgentPhaseRunner
    And it should not duplicate cost tracking logic
    And it should not duplicate comment posting logic

  Scenario: Build phase uses AgentPhaseRunner
    Given the ADW codebase
    When I read "adws/phases/buildPhase.ts"
    Then it should delegate execution to AgentPhaseRunner
    And it should not duplicate cost tracking logic
    And it should not duplicate comment posting logic

  Scenario: Test phase uses AgentPhaseRunner
    Given the ADW codebase
    When I read "adws/phases/testPhase.ts"
    Then it should delegate execution to AgentPhaseRunner
    And it should not duplicate cost tracking logic
    And it should not duplicate comment posting logic

  # -------------------------------------------------------------------
  # Import direction enforcement
  # -------------------------------------------------------------------

  @regression
  Scenario: No circular dependencies exist between core modules
    Given the ADW codebase
    When I analyze import dependencies across all modules
    Then "adws/core/" should not import from "adws/phases/"
    And "adws/core/" should not import from "adws/agents/"
    And "adws/agents/" should not import from "adws/phases/"
    And "adws/providers/" should not import from "adws/phases/"

  Scenario: Phases only import from allowed modules
    Given the ADW codebase
    When I scan all TypeScript files in "adws/phases/"
    Then they should only import from "adws/core/", "adws/agents/", "adws/providers/", "adws/cost/", and "adws/vcs/"
    And they should not import from "adws/triggers/"
    And they should not import from sibling orchestrator scripts

  # -------------------------------------------------------------------
  # Cost module type unification
  # -------------------------------------------------------------------

  @regression
  Scenario: Cost module uses a single unified type system
    Given the ADW codebase
    When I read "adws/cost/index.ts"
    Then it should not re-export legacy type aliases
    And there should be a single canonical "TokenUsageMap" type
    And there should be no "LegacyModelUsage" or "LegacyModelUsageMap" exports

  Scenario: All cost consumers use the canonical token usage types
    Given the ADW codebase
    When I scan all TypeScript files that import from "adws/cost/"
    Then none of them should reference "ModelUsage" as a legacy alias
    And all of them should use "TokenUsageMap" or the canonical type name

  # -------------------------------------------------------------------
  # Testability infrastructure
  # -------------------------------------------------------------------

  @regression
  Scenario: Test factory utilities exist for core types
    Given the ADW codebase
    When I look for test utility modules
    Then there should be a "createTestWorkflowConfig" factory function
    And there should be a "createTestRepoContext" factory function
    And they should produce minimal valid instances for unit testing

  Scenario: Agent execution can be mocked for phase testing
    Given the ADW codebase
    When I look for agent mocking infrastructure
    Then there should be an agent mock or stub that returns configurable results
    And phase tests should be able to run without spawning Claude CLI

  # -------------------------------------------------------------------
  # Worktree lifecycle management
  # -------------------------------------------------------------------

  Scenario: A WorktreeManager abstraction encapsulates VCS worktree operations
    Given the ADW codebase
    When I look for the WorktreeManager module
    Then it should exist in "adws/vcs/"
    And it should encapsulate worktree creation, branch setup, and cleanup
    And phases should use WorktreeManager instead of importing individual VCS functions

  # -------------------------------------------------------------------
  # TypeScript strict compliance
  # -------------------------------------------------------------------

  Scenario: All TypeScript files pass strict type checking
    Given the ADW codebase
    When I run "bunx tsc --noEmit"
    Then the command should exit with code 0
    And there should be no type errors
