@adw-jjxkk9-plan-templates-inclu
Feature: Plan templates conditionally include unit tests based on project config

  When `.adw/project.md` has `## Unit Tests: disabled`, the feature plan
  template must omit the `### Unit Tests` subsection from `## Testing Strategy`
  so the implement agent does not create unit test files that will never run.
  When unit tests are enabled (or the setting is absent), the section is included
  as before.

  Background:
    Given the ADW codebase contains ".claude/commands/feature.md"
    And the ADW codebase contains "adws/agents/planAgent.ts"
    And a target repository has ".adw/project.md"

  @adw-jjxkk9-plan-templates-inclu @crucial
  Scenario: Feature plan omits Unit Tests section when unit tests are disabled
    Given ".adw/project.md" contains "## Unit Tests: disabled"
    When the plan agent runs the "/feature" command for an issue
    Then the generated plan file does not contain a "### Unit Tests" section
    And the generated plan file still contains an "### Edge Cases" section

  @adw-jjxkk9-plan-templates-inclu @crucial
  Scenario: Feature plan includes Unit Tests section when unit tests are enabled
    Given ".adw/project.md" contains "## Unit Tests: enabled"
    When the plan agent runs the "/feature" command for an issue
    Then the generated plan file contains a "### Unit Tests" section
    And the "### Unit Tests" section describes unit tests needed for the feature

  @adw-jjxkk9-plan-templates-inclu @crucial
  Scenario: Feature plan includes Unit Tests section when no unit tests setting is present
    Given ".adw/project.md" does not contain a "## Unit Tests" setting
    When the plan agent runs the "/feature" command for an issue
    Then the generated plan file contains a "### Unit Tests" section

  @adw-jjxkk9-plan-templates-inclu
  Scenario: feature.md instructs the plan agent to read project config for unit test setting
    Given ".claude/commands/feature.md" is read
    When searching for instructions about unit tests and project config
    Then the file instructs the plan agent to check ".adw/project.md" for the unit tests setting
    And the file instructs the plan agent to omit "### Unit Tests" when unit tests are disabled

  @adw-jjxkk9-plan-templates-inclu
  Scenario: bug.md does not contain a Unit Tests section in its plan format
    Given ".claude/commands/bug.md" is read
    When searching for "### Unit Tests" in the plan format
    Then the bug plan format does not include a "### Unit Tests" subsection
    And no changes are required to bug.md for this issue

  @adw-jjxkk9-plan-templates-inclu
  Scenario: chore.md does not contain a Unit Tests section in its plan format
    Given ".claude/commands/chore.md" is read
    When searching for "### Unit Tests" in the plan format
    Then the chore plan format does not include a "### Unit Tests" subsection
    And no changes are required to chore.md for this issue

  @adw-jjxkk9-plan-templates-inclu
  Scenario: patch.md does not contain a Unit Tests section in its plan format
    Given ".claude/commands/patch.md" is read
    When searching for "### Unit Tests" in the plan format
    Then the patch plan format does not include a "### Unit Tests" subsection
    And no changes are required to patch.md for this issue

  @adw-jjxkk9-plan-templates-inclu
  Scenario: Implement agent does not create unit test files when unit tests are disabled
    Given ".adw/project.md" contains "## Unit Tests: disabled"
    And the plan agent has generated a plan without a "### Unit Tests" section
    When the implement agent executes the plan
    Then no unit test files are created in the repository
    And no test imports or test framework references appear in new files

  @adw-jjxkk9-plan-templates-inclu
  Scenario: Existing unit test gating in testPhase.ts is not modified
    Given "adws/phases/testPhase.ts" is read
    When searching for calls to "runUnitTestsWithRetry"
    Then the call is still gated by "parseUnitTestsEnabled"
    And the gating logic is unchanged from the pre-issue state

  @adw-jjxkk9-plan-templates-inclu
  Scenario: Existing unit test gating in adwTest.tsx is not modified
    Given "adws/adwTest.tsx" is read
    When searching for calls to "runUnitTestsWithRetry"
    Then the call is still gated by "parseUnitTestsEnabled"
    And the gating logic is unchanged from the pre-issue state
