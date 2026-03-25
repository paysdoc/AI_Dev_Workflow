@adw-304-implement-tdd
Feature: /implement_tdd skill with core TDD workflow

  The `/implement_tdd` skill is an autonomous TDD meta-prompt for the build agent.
  It follows the same pattern as `/implement` (shapes how the agent works; the plan
  content shapes what it builds), but instructs the agent to follow red-green-refactor
  using BDD scenarios as RED tests.

  Background:
    Given the ADW codebase is at the current working directory

  # --- Skill directory and frontmatter ---

  @adw-304-implement-tdd @regression
  Scenario: implement-tdd skill directory exists with SKILL.md
    Given the skill directory ".claude/skills/implement-tdd" exists
    When the SKILL.md file is read
    Then the file is not empty

  @adw-304-implement-tdd @regression
  Scenario: implement-tdd SKILL.md has target: true in frontmatter
    Given the skill directory ".claude/skills/implement-tdd" exists
    When the SKILL.md file is read
    Then its YAML frontmatter contains "target: true"

  # --- TDD reference files travel with the skill ---

  @adw-304-implement-tdd @regression
  Scenario: TDD reference files are present in the implement-tdd skill directory
    Given the skill directory ".claude/skills/implement-tdd" exists
    Then the following files exist in ".claude/skills/implement-tdd/":
      | file                |
      | SKILL.md            |
      | tests.md            |
      | mocking.md          |
      | interface-design.md |
      | deep-modules.md     |
      | refactoring.md      |

  # --- Autonomous TDD workflow content ---

  @adw-304-implement-tdd @regression
  Scenario: SKILL.md instructs reading the plan as input
    Given the file ".claude/skills/implement-tdd/SKILL.md" is read
    When the content is inspected
    Then it contains instructions to read the plan provided as input
    And it references plan tasks or plan structure as the work to implement

  @adw-304-implement-tdd @regression
  Scenario: SKILL.md instructs reading .feature files tagged with the issue number
    Given the file ".claude/skills/implement-tdd/SKILL.md" is read
    When the content is inspected
    Then it contains instructions to read ".feature" files tagged with "@adw-{issueNumber}"
    And it describes these scenarios as the RED tests for the TDD loop

  @adw-304-implement-tdd @regression
  Scenario: SKILL.md contains red-green-refactor loop instructions
    Given the file ".claude/skills/implement-tdd/SKILL.md" is read
    When the content is inspected
    Then it contains instructions for the RED phase: write or complete step definitions
    And it contains instructions for verifying the test fails (RED confirmation)
    And it contains instructions for the GREEN phase: implement code to pass
    And it contains instructions for verifying the test passes (GREEN confirmation)
    And it contains instructions for the REFACTOR phase

  # --- Vertical slicing ---

  @adw-304-implement-tdd @regression
  Scenario: SKILL.md instructs vertical slicing and warns against horizontal slicing
    Given the file ".claude/skills/implement-tdd/SKILL.md" is read
    When the content is inspected
    Then it instructs vertical slicing: one test then one implementation then repeat
    And it explicitly warns against horizontal slicing
    And it warns against writing all tests first then all implementation

  # --- Test harness awareness ---

  @adw-304-implement-tdd @regression
  Scenario: SKILL.md references test harness infrastructure for step definitions
    Given the file ".claude/skills/implement-tdd/SKILL.md" is read
    When the content is inspected
    Then it references test harness or mock infrastructure for step definitions
    And it acknowledges that step definitions may need runtime support from the test harness

  # --- Unit test conditional logic ---

  @adw-304-implement-tdd
  Scenario: SKILL.md includes conditional unit test instructions based on project config
    Given the file ".claude/skills/implement-tdd/SKILL.md" is read
    When the content is inspected
    Then it contains instructions to check ".adw/project.md" for unit test configuration
    And it describes writing unit tests when unit tests are enabled
    And it describes skipping unit tests when unit tests are disabled

  # --- Verification frequency ---

  @adw-304-implement-tdd
  Scenario: SKILL.md lets the agent decide verification frequency
    Given the file ".claude/skills/implement-tdd/SKILL.md" is read
    When the content is inspected
    Then it allows the agent to decide when to run verification based on plan task structure
    And it does not mandate running tests after every single line of code

  # --- No interactive approval ---

  @adw-304-implement-tdd @regression
  Scenario: SKILL.md does not include interactive approval steps
    Given the file ".claude/skills/implement-tdd/SKILL.md" is read
    When the content is inspected
    Then it does not contain instructions to ask the user for approval
    And it does not contain instructions to confirm with the user before proceeding
    And it treats the plan as the specification that authorizes implementation

  # --- Reporting ---

  @adw-304-implement-tdd @regression
  Scenario: SKILL.md instructs reporting completed work with git diff --stat
    Given the file ".claude/skills/implement-tdd/SKILL.md" is read
    When the content is inspected
    Then it contains instructions to report completed work
    And it includes "git diff --stat" as part of the reporting step

  # --- Invocation pattern ---

  @adw-304-implement-tdd
  Scenario: SKILL.md accepts a plan as input argument
    Given the file ".claude/skills/implement-tdd/SKILL.md" is read
    When the content is inspected
    Then it references "$ARGUMENTS" or an equivalent mechanism for receiving the plan
    And the plan content drives what the agent builds

  # --- Distinct from existing /implement ---

  @adw-304-implement-tdd
  Scenario: implement-tdd skill is distinct from the implement command
    Given the file ".claude/skills/implement-tdd/SKILL.md" is read
    And the file ".claude/commands/implement.md" is read
    When both files are compared
    Then the implement-tdd skill includes TDD-specific instructions not present in implement
    And the implement-tdd skill references BDD scenarios as test inputs
    And the implement command does not reference red-green-refactor

  # --- Reference file content matches tdd skill ---

  @adw-304-implement-tdd
  Scenario: Reference files in implement-tdd match those in the tdd skill
    Given the skill directory ".claude/skills/implement-tdd" exists
    And the skill directory ".claude/skills/tdd" exists
    Then "tests.md" in ".claude/skills/implement-tdd/" matches "tests.md" in ".claude/skills/tdd/"
    And "mocking.md" in ".claude/skills/implement-tdd/" matches "mocking.md" in ".claude/skills/tdd/"
    And "interface-design.md" in ".claude/skills/implement-tdd/" matches "interface-design.md" in ".claude/skills/tdd/"
    And "deep-modules.md" in ".claude/skills/implement-tdd/" matches "deep-modules.md" in ".claude/skills/tdd/"
    And "refactoring.md" in ".claude/skills/implement-tdd/" matches "refactoring.md" in ".claude/skills/tdd/"
