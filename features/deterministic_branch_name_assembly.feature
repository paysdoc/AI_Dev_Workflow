@adw-7dp24s-orchestrator-resili @adw-455
Feature: Deterministic branch-name assembly in code

  The LLM previously returned full git branch names (e.g. `feature-issue-8-json-reporter-findings`),
  and a post-processing regex extracted/reformatted them on reads. Regex drift between a write path
  and a read path produced the ghost branch `feature-issue-8-json-reporter-findings-output` for
  a run whose real branch was `feature-issue-8-json-reporter-findings`, stranding the orchestrator
  on a worktree that never existed.

  The fix narrows the LLM's responsibility: the `/generate_branch_name` skill returns only the
  semantic slug (e.g. `json-reporter-findings`). The full branch name is assembled deterministically
  in code as `<prefix>-issue-<N>-<slug>` by a single pure function in `adws/vcs/`. Every branch-name
  read and write goes through that same function, so no two code paths can disagree about what the
  branch is called.

  Addresses user story 7 of the orchestrator-coordination-resilience PRD.

  Background:
    Given the ADW codebase is checked out

  # ═══════════════════════════════════════════════════════════════════════════
  # 1. /generate_branch_name skill returns slug only
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-7dp24s-orchestrator-resili @adw-455 @regression
  Scenario: generate_branch_name skill instructs the LLM to return a slug only
    Given ".claude/commands/generate_branch_name.md" is read
    Then the skill instructions require slug-only output with no prefix
    And the skill instructions forbid the LLM from including the issue number
    And the skill instructions forbid the LLM from including a type prefix such as "feature-" or "bugfix-"

  @adw-7dp24s-orchestrator-resili @adw-455 @regression
  Scenario: generate_branch_name skill Report section returns only the slug string
    Given ".claude/commands/generate_branch_name.md" is read
    Then the Report section states that ONLY the slug is returned, not a full branch name

  @adw-7dp24s-orchestrator-resili @adw-455
  Scenario: generate_branch_name skill gives examples that are slugs, not full branch names
    Given ".claude/commands/generate_branch_name.md" is read
    Then the example outputs contain slug-style values like "json-reporter-findings"
    And the example outputs do not contain full branch names like "feature-issue-8-json-reporter-findings"

  # ═══════════════════════════════════════════════════════════════════════════
  # 2. Branch-name assembly is a pure function in adws/vcs/
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-7dp24s-orchestrator-resili @adw-455 @regression
  Scenario: Branch-name assembly function is exported from adws/vcs/
    Given "adws/vcs/branchOperations.ts" is read
    Then the file exports a pure function that assembles a full branch name from an issue type, issue number, and slug

  @adw-7dp24s-orchestrator-resili @adw-455 @regression
  Scenario: Assembly function produces the canonical format
    Given the assembly function is called with issueType "/feature", issueNumber 455, and slug "json-reporter-findings"
    Then it returns "feature-issue-455-json-reporter-findings"

  @adw-7dp24s-orchestrator-resili @adw-455 @regression
  Scenario: Assembly function uses the canonical prefix for each issue type
    Given the assembly function is called with issueType "/bug", issueNumber 42, and slug "login-error"
    Then it returns "bugfix-issue-42-login-error"

  @adw-7dp24s-orchestrator-resili @adw-455
  Scenario: Assembly function uses the canonical prefix for chore issues
    Given the assembly function is called with issueType "/chore", issueNumber 77, and slug "update-deps"
    Then it returns "chore-issue-77-update-deps"

  @adw-7dp24s-orchestrator-resili @adw-455
  Scenario: Assembly function uses the canonical prefix for review issues
    Given the assembly function is called with issueType "/pr_review", issueNumber 88, and slug "fix-failing-tests"
    Then it returns "review-issue-88-fix-failing-tests"

  # ═══════════════════════════════════════════════════════════════════════════
  # 3. Assembly rejects invalid slug inputs
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-7dp24s-orchestrator-resili @adw-455 @regression
  Scenario: Assembly function rejects a slug that already carries a type prefix
    Given the assembly function is called with issueType "/feature", issueNumber 455, and slug "feature-issue-455-json-reporter-findings"
    Then the assembly function throws an error indicating the slug is already prefixed

  @adw-7dp24s-orchestrator-resili @adw-455 @regression
  Scenario: Assembly function rejects a slug that starts with a bare prefix
    Given the assembly function is called with issueType "/feature", issueNumber 455, and slug "feature-json-reporter-findings"
    Then the assembly function throws an error indicating the slug contains a forbidden prefix

  @adw-7dp24s-orchestrator-resili @adw-455 @regression
  Scenario: Assembly function rejects a slug that contains forbidden git-ref characters
    Given the assembly function is called with issueType "/feature", issueNumber 455, and slug "bad~slug"
    Then the assembly function throws an error indicating the slug contains forbidden characters

  @adw-7dp24s-orchestrator-resili @adw-455
  Scenario: Assembly function rejects an empty slug
    Given the assembly function is called with issueType "/feature", issueNumber 455, and slug ""
    Then the assembly function throws an error indicating the slug is empty

  @adw-7dp24s-orchestrator-resili @adw-455
  Scenario: Assembly function rejects a slug containing whitespace
    Given the assembly function is called with issueType "/feature", issueNumber 455, and slug "has space"
    Then the assembly function throws an error indicating the slug contains forbidden characters

  @adw-7dp24s-orchestrator-resili @adw-455
  Scenario: Assembly function rejects a slug containing uppercase characters
    Given the assembly function is called with issueType "/feature", issueNumber 455, and slug "HasCaps"
    Then the assembly function throws an error indicating the slug contains forbidden characters

  # ═══════════════════════════════════════════════════════════════════════════
  # 4. Unit test exists for the assembly function
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-7dp24s-orchestrator-resili @adw-455 @regression
  Scenario: Unit test file exists for branch-name assembly
    Then a unit test file under "adws/vcs/__tests__/" covers the branch-name assembly function

  @adw-7dp24s-orchestrator-resili @adw-455 @regression
  Scenario: Unit test asserts the canonical assembly for each issue type
    Given the unit test for branch-name assembly is read
    Then it asserts correct assembly for "/feature", "/bug", "/chore", and "/pr_review" issue types

  @adw-7dp24s-orchestrator-resili @adw-455 @regression
  Scenario: Unit test asserts rejection of already-prefixed slugs
    Given the unit test for branch-name assembly is read
    Then it asserts the function throws when the slug already contains a type prefix

  @adw-7dp24s-orchestrator-resili @adw-455 @regression
  Scenario: Unit test asserts rejection of forbidden-character slugs
    Given the unit test for branch-name assembly is read
    Then it asserts the function throws when the slug contains forbidden characters

  # ═══════════════════════════════════════════════════════════════════════════
  # 5. All branch-name reads and writes go through the assembly function
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-7dp24s-orchestrator-resili @adw-455 @regression
  Scenario: git agent uses the assembly function after receiving a slug from the LLM
    Given "adws/agents/gitAgent.ts" is read
    Then the branch-name extraction path passes the LLM output through the assembly function from adws/vcs/
    And the module does not construct a branch name by concatenating a prefix and issue number inline

  @adw-7dp24s-orchestrator-resili @adw-455 @regression
  Scenario: workflowInit records the assembled branch name in the top-level state file
    Given "adws/phases/workflowInit.ts" is read
    Then the branchName stored in the top-level workflow state comes from the assembly function's return value

  @adw-7dp24s-orchestrator-resili @adw-455 @regression
  Scenario: createFeatureBranch in branchOperations uses the assembly function
    Given "adws/vcs/branchOperations.ts" is read
    Then createFeatureBranch delegates branch-name construction to the assembly function
    And createFeatureBranch does not build the branch name via string concatenation with "issue-" inline

  @adw-7dp24s-orchestrator-resili @adw-455 @regression
  Scenario: No module constructs a branch name with a handwritten regex or template
    When the adws/ tree is scanned for inline branch-name templates
    Then no non-test source file outside "adws/vcs/" constructs a string matching "<prefix>-issue-<N>-<slug>" except via the assembly function

  # ═══════════════════════════════════════════════════════════════════════════
  # 6. End-to-end regression: branch on disk matches state file
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-7dp24s-orchestrator-resili @adw-455 @regression
  Scenario: End-to-end — branch created on disk matches the branch recorded in the top-level state file
    Given a workflow is initialized for issue number 999 with a generated slug "sample-slug"
    When the workflow creates its worktree and writes the top-level state file
    Then the branch checked out in the worktree equals the branchName in the top-level state file
    And both equal "feature-issue-999-sample-slug"

  @adw-7dp24s-orchestrator-resili @adw-455 @regression
  Scenario: End-to-end — branch pushed to origin matches the branch in the state file
    Given a workflow has run to the point of pushing its first commit
    Then the branch name pushed to origin equals the branchName recorded in the top-level state file

  @adw-7dp24s-orchestrator-resili @adw-455
  Scenario: End-to-end regression guards against regex drift between read and write paths
    Given a workflow generated the slug "json-reporter-findings" for issue 8
    When the orchestrator later reads the branch name from the state file and from the filesystem worktree
    Then both reads return exactly "feature-issue-8-json-reporter-findings"
    And neither read produces the legacy ghost form "feature-issue-8-json-reporter-findings-output"

  # ═══════════════════════════════════════════════════════════════════════════
  # 7. TypeScript compilation
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-7dp24s-orchestrator-resili @adw-455 @regression
  Scenario: TypeScript type-check passes after the assembly refactor
    When "bunx tsc --noEmit" is run
    Then the command exits with code 0
    And "bunx tsc --noEmit -p adws/tsconfig.json" also exits with code 0
