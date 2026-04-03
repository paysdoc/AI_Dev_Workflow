@adw-chpy1a-orchestrator-refacto
Feature: Cron Trigger Issue Re-evaluation and Improvements

  The cron trigger re-evaluates previously-failed and paused issues instead
  of blanket-filtering all issues with ADW comments. Verbose poll logging
  shows why each issue was considered or filtered. Dependency extraction
  uses regex with keyword proximity as the primary parser, falling back
  to LLM only when some references remain unclassified.

  Background:
    Given the ADW codebase is checked out

  # ===================================================================
  # 1. Issue re-evaluation logic
  # ===================================================================

  @adw-chpy1a-orchestrator-refacto @regression
  Scenario: hasAdwWorkflowComment blanket filter is removed
    Given the file "adws/triggers/trigger_cron.ts" is read
    Then eligible issue filtering does not use hasAdwWorkflowComment as a blanket exclusion

  @adw-chpy1a-orchestrator-refacto
  Scenario: Cron checks latest ADW comment status for re-eligibility
    Given an issue with multiple ADW workflow comments
    When the cron trigger evaluates the issue
    Then it inspects the status of the most recent ADW comment

  @adw-chpy1a-orchestrator-refacto
  Scenario Outline: Issue with latest status "<status>" is re-eligible
    Given an issue whose latest ADW comment indicates status "<status>"
    When the cron trigger evaluates eligibility
    Then the issue is considered eligible for re-processing

    Examples:
      | status         |
      | error          |
      | paused         |
      | review_failed  |
      | build_failed   |

  @adw-chpy1a-orchestrator-refacto
  Scenario: Completed issues are excluded from re-evaluation
    Given an issue whose latest ADW comment indicates status "completed"
    When the cron trigger evaluates eligibility
    Then the issue is not eligible for re-processing

  @adw-chpy1a-orchestrator-refacto @adw-fequcj-fix-fail-open-depend @regression
  Scenario: Dependency-deferred issues are not added to processedIssues
    Given an issue that is deferred because its dependencies are still open
    When the cron trigger skips the issue
    Then the issue number is not added to the processedIssues set

  @adw-chpy1a-orchestrator-refacto @regression
  Scenario: Only spawned issues are added to processedIssues
    Given an issue that passes all eligibility checks
    When the cron trigger spawns a workflow for the issue
    Then the issue number is added to the processedIssues set

  # ===================================================================
  # 2. Verbose poll logging
  # ===================================================================

  @adw-chpy1a-orchestrator-refacto @regression
  Scenario: Cron logs verbose poll summary each cycle
    Given the cron trigger polls and finds 12 open issues
    And 5 pass initial filtering as candidates
    And 3 are filtered out with reasons such as adw_comment, processed, or grace_period
    When the poll cycle completes evaluation
    Then it logs a one-liner in format "POLL: N open, N candidates [#list], filtered: #N(reason) ..."

  # ===================================================================
  # 3. Dependency extraction improvements
  # ===================================================================

  @adw-chpy1a-orchestrator-refacto @regression
  Scenario: Primary parser uses regex to find all #N references in body
    Given an issue body text "#42, #43, and see #44"
    When the dependency proximity extractor parses the body
    Then it finds issue references [42, 43, 44]

  @adw-chpy1a-orchestrator-refacto @regression
  Scenario: Static keyword proximity check classifies dependency references
    Given a dependency extraction body with keyword ref and plain ref
    When the proximity extractor applies keyword analysis
    Then the keyword-adjacent ref is a detected dependency
    And the distant plain ref is not a detected dependency

  @adw-chpy1a-orchestrator-refacto @regression
  Scenario Outline: Keyword "<keyword>" near #N classifies it as a dependency
    Given an issue body text "<keyword> #99"
    When the proximity extractor applies keyword analysis
    Then issue #99 is a detected dependency

    Examples:
      | keyword        |
      | blocked by     |
      | depends on     |
      | requires       |
      | prerequisite   |
      | after          |

  @adw-chpy1a-orchestrator-refacto @regression
  Scenario: Heading regex matches "## Blocked by" section
    Given an issue body text with a "## Blocked by" heading listing "#50"
    When the dependency proximity extractor parses the body
    Then issue #50 is a detected dependency

  @adw-chpy1a-orchestrator-refacto @regression
  Scenario: LLM fallback only when fewer dependencies matched than total references
    Given an issue body text with 5 hash-N references
    And the regex parser classified 3 of them as dependencies
    And 2 of the references remain unclassified
    When the dependency extractor evaluates whether LLM fallback is needed
    Then LLM extraction is triggered for the unclassified references

  @adw-chpy1a-orchestrator-refacto @regression
  Scenario: No LLM fallback when all references are classified by regex
    Given an issue body text with 3 hash-N references
    And the regex parser classified all 3 references as dependencies
    When the dependency extractor evaluates whether LLM fallback is needed
    Then LLM extraction is not triggered

  @adw-chpy1a-orchestrator-refacto @regression
  Scenario: In-memory cache prevents repeated dependency extraction per issue
    Given dependency extraction was performed for issue 42 with body hash "abc123"
    When the cron trigger re-evaluates issue 42 with the same body hash
    Then the cached extraction result is returned
    And no regex parsing or LLM call is performed

  @adw-chpy1a-orchestrator-refacto @regression
  Scenario: Cache is invalidated when issue body changes
    Given dependency extraction was cached for issue 42 with body hash "abc123"
    When the issue body changes and the hash becomes "def456"
    Then the cache miss triggers fresh dependency extraction

  # ===================================================================
  # 4. TypeScript compilation
  # ===================================================================

  @adw-chpy1a-orchestrator-refacto @regression
  Scenario: TypeScript type-check passes after cron trigger improvements
    When "bunx tsc --noEmit" is run
    Then the command exits with code 0
    And "bunx tsc --noEmit -p adws/tsconfig.json" also exits with code 0
