@adw-sgud8b-copy-target-true-ski
Feature: Copy target: true skills and commands to target repos during adw_init

  ADW skills and commands can declare `target: true` in their YAML frontmatter.
  During `adw_init`, items marked `target: true` are copied to the target
  repository and committed alongside the `.adw/` configuration. During
  `workflowInit`, commands that were previously committed to the target repo
  are not gitignored.

  Background:
    Given the ADW codebase is at the current working directory

  # --- Frontmatter convention on skills ---

  @adw-sgud8b-copy-target-true-ski @regression
  Scenario: grill-me skill has target: true in frontmatter
    Given the skill directory ".claude/skills/grill-me" exists
    When the SKILL.md file is read
    Then its YAML frontmatter contains "target: true"

  @adw-sgud8b-copy-target-true-ski @regression
  Scenario: improve-codebase-architecture skill has target: true in frontmatter
    Given the skill directory ".claude/skills/improve-codebase-architecture" exists
    When the SKILL.md file is read
    Then its YAML frontmatter contains "target: true"

  @adw-sgud8b-copy-target-true-ski @regression
  Scenario: write-a-prd skill has target: true in frontmatter
    Given the skill directory ".claude/skills/write-a-prd" exists
    When the SKILL.md file is read
    Then its YAML frontmatter contains "target: true"

  @adw-sgud8b-copy-target-true-ski @regression
  Scenario: prd-to-issues skill has target: true in frontmatter
    Given the skill directory ".claude/skills/prd-to-issues" exists
    When the SKILL.md file is read
    Then its YAML frontmatter contains "target: true"

  @adw-sgud8b-copy-target-true-ski @regression
  Scenario: tdd skill has target: true in frontmatter
    Given the skill directory ".claude/skills/tdd" exists
    When the SKILL.md file is read
    Then its YAML frontmatter contains "target: true"

  @adw-sgud8b-copy-target-true-ski @regression
  Scenario: ubiquitous-language skill has target: true in frontmatter
    Given the skill directory ".claude/skills/ubiquitous-language" exists
    When the SKILL.md file is read
    Then its YAML frontmatter contains "target: true"

  # --- Frontmatter convention on commands ---

  @adw-sgud8b-copy-target-true-ski @regression
  Scenario: prime command has target: true in frontmatter
    Given the command file ".claude/commands/prime.md" exists
    When the file is read
    Then its YAML frontmatter contains "target: true"

  @adw-sgud8b-copy-target-true-ski @regression
  Scenario: install command has target: true in frontmatter
    Given the command file ".claude/commands/install.md" exists
    When the file is read
    Then its YAML frontmatter contains "target: true"

  @adw-sgud8b-copy-target-true-ski
  Scenario: non-target commands have target: false in frontmatter
    Given the following command files exist in ".claude/commands/":
      | command          |
      | feature.md       |
      | bug.md           |
      | chore.md         |
      | commit.md        |
      | pull_request.md  |
      | test.md          |
      | adw_init.md      |
    When each file is read
    Then each file's YAML frontmatter contains "target: false"

  # --- adw_init scanning ---

  @adw-sgud8b-copy-target-true-ski @regression
  Scenario: adw_init.md instruction includes a step to scan for target: true items
    Given the file ".claude/commands/adw_init.md" is read
    When the content is inspected
    Then it includes an instruction to scan ".claude/skills/" and ".claude/commands/" for "target: true" frontmatter

  # --- adw_init copying skills ---

  @adw-sgud8b-copy-target-true-ski @regression
  Scenario: adw_init copies target: true skill directories to the target repo
    Given adw_init is run on a target repository
    And the ADW skill "grill-me" has "target: true" in its frontmatter
    When the copy step executes
    Then the entire "grill-me" directory is copied to ".claude/skills/grill-me" in the target repo
    And all files in the source skill directory are present in the target

  @adw-sgud8b-copy-target-true-ski @regression
  Scenario: adw_init copies tdd skill including supplementary files
    Given adw_init is run on a target repository
    And the ADW skill "tdd" has "target: true" in its frontmatter
    When the copy step executes
    Then the entire "tdd" directory is copied to ".claude/skills/tdd" in the target repo
    And the following files exist in the target's ".claude/skills/tdd/":
      | file                |
      | SKILL.md            |
      | deep-modules.md     |
      | interface-design.md |
      | mocking.md          |
      | refactoring.md      |
      | tests.md            |

  @adw-sgud8b-copy-target-true-ski @regression
  Scenario: adw_init copies improve-codebase-architecture skill including REFERENCE.md
    Given adw_init is run on a target repository
    And the ADW skill "improve-codebase-architecture" has "target: true" in its frontmatter
    When the copy step executes
    Then the entire "improve-codebase-architecture" directory is copied to ".claude/skills/improve-codebase-architecture" in the target repo
    And "REFERENCE.md" exists in the target's ".claude/skills/improve-codebase-architecture/"

  # --- adw_init copying commands ---

  @adw-sgud8b-copy-target-true-ski @regression
  Scenario: adw_init copies target: true commands to the target repo
    Given adw_init is run on a target repository
    And the ADW command "prime.md" has "target: true" in its frontmatter
    And the ADW command "install.md" has "target: true" in its frontmatter
    When the copy step executes
    Then "prime.md" is copied to ".claude/commands/prime.md" in the target repo
    And "install.md" is copied to ".claude/commands/install.md" in the target repo

  @adw-sgud8b-copy-target-true-ski
  Scenario: adw_init does not copy target: false commands to the target repo
    Given adw_init is run on a target repository
    And the ADW command "feature.md" has "target: false" in its frontmatter
    When the copy step executes
    Then "feature.md" is not present in ".claude/commands/" in the target repo

  # --- Overwrite on re-run ---

  @adw-sgud8b-copy-target-true-ski @regression
  Scenario: adw_init overwrites existing skills on re-run
    Given adw_init was previously run on a target repository
    And ".claude/skills/grill-me/SKILL.md" exists in the target repo with older content
    When adw_init is run again on the same target repository
    Then ".claude/skills/grill-me/SKILL.md" in the target repo matches the current ADW version

  @adw-sgud8b-copy-target-true-ski
  Scenario: adw_init overwrites existing commands on re-run
    Given adw_init was previously run on a target repository
    And ".claude/commands/prime.md" exists in the target repo with older content
    When adw_init is run again on the same target repository
    Then ".claude/commands/prime.md" in the target repo matches the current ADW version

  # --- Single commit ---

  @adw-sgud8b-copy-target-true-ski @regression
  Scenario: adw_init commits skills and commands in the same commit as .adw/ config
    Given adw_init is run on a target repository
    When the commit step executes
    Then the commit contains changes in ".adw/" directory
    And the commit contains changes in ".claude/skills/" directory
    And the commit contains changes in ".claude/commands/" directory
    And all changes are in a single commit

  # --- No content adaptation ---

  @adw-sgud8b-copy-target-true-ski @regression
  Scenario: prime command is copied verbatim without content adaptation
    Given adw_init is run on a target repository
    And the ADW command "prime.md" references "adws/README.md"
    When the copy step executes
    Then "prime.md" in the target repo is byte-identical to the source
    And no path substitution has been applied

  # --- workflowInit gitignore behavior ---

  @adw-sgud8b-copy-target-true-ski @regression
  Scenario: copyClaudeCommandsToWorktree skips gitignoring commands that exist in the target repo
    Given a target repository with "prime.md" committed in ".claude/commands/"
    When copyClaudeCommandsToWorktree runs for a new worktree
    Then "prime.md" is not added to .gitignore in the worktree

  @adw-sgud8b-copy-target-true-ski @regression
  Scenario: copyClaudeCommandsToWorktree still gitignores commands not committed in the target repo
    Given a target repository without "feature.md" in ".claude/commands/"
    When copyClaudeCommandsToWorktree copies "feature.md" to the worktree
    Then "feature.md" is added to .gitignore in the worktree

  @adw-sgud8b-copy-target-true-ski
  Scenario: copyClaudeCommandsToWorktree still copies all commands to the worktree
    Given a target repository with "prime.md" committed in ".claude/commands/"
    And "feature.md" is not committed in ".claude/commands/"
    When copyClaudeCommandsToWorktree runs for a new worktree
    Then both "prime.md" and "feature.md" are present in the worktree's ".claude/commands/"
    And only "feature.md" is listed in .gitignore
