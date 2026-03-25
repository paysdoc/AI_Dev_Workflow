@adw-yxq5og-review-phase-step-de
Feature: Review phase step definition independence verification

  The review phase must verify that step definitions generated during the build
  phase actually test behavior through public interfaces rather than
  tautologically asserting what the build agent wrote. This prevents
  accommodating step definitions that would pass regardless of whether the
  intended behavior works.

  # ── 1. review.md includes step definition independence verification ──

  @adw-yxq5og-review-phase-step-de @regression
  Scenario: review.md contains a step definition independence verification section
    Given the file ".claude/commands/review.md" exists
    Then it should contain a section for step definition independence verification
    And the section should appear after proof production and before the final report

  @adw-yxq5og-review-phase-step-de @regression
  Scenario: review.md instructs reading step definition files from the worktree
    Given the file ".claude/commands/review.md" exists
    Then the step definition independence section should instruct reading step definition files changed in the current branch
    And it should instruct reading the corresponding feature files for context

  # ── 2. Review agent checks behavior through public interfaces ──

  @adw-yxq5og-review-phase-step-de @regression
  Scenario: review.md instructs checking step definitions test observable behavior
    Given the file ".claude/commands/review.md" exists
    Then the independence verification should instruct checking that each step definition asserts on observable behavior
    And it should instruct checking that assertions use public interfaces of the implementation

  @adw-yxq5og-review-phase-step-de
  Scenario: review.md defines what constitutes testing through public interfaces
    Given the file ".claude/commands/review.md" exists
    Then the independence verification should define public interface assertions as those that:
      | criterion                                                        |
      | Call exported functions, methods, or API endpoints                |
      | Assert on return values, output, or externally visible state     |
      | Do not reach into private methods, internal variables, or module internals |

  # ── 3. Review agent flags accommodating/tautological step definitions ──

  @adw-yxq5og-review-phase-step-de @regression
  Scenario: review.md instructs flagging step definitions that assert on implementation internals
    Given the file ".claude/commands/review.md" exists
    Then the independence verification should instruct flagging step definitions that assert on implementation internals rather than observable behavior
    And flagged issues should describe which internal is being asserted on

  @adw-yxq5og-review-phase-step-de @regression
  Scenario: review.md instructs flagging step definitions that would pass regardless of behavior
    Given the file ".claude/commands/review.md" exists
    Then the independence verification should instruct flagging step definitions that would pass regardless of whether the intended behavior works
    And flagged issues should explain why the assertion is tautological

  @adw-yxq5og-review-phase-step-de
  Scenario: review.md instructs flagging step definitions that mirror implementation structure
    Given the file ".claude/commands/review.md" exists
    Then the independence verification should instruct flagging step definitions that mirror the implementation structure rather than the scenario's behavioral specification
    And flagged issues should contrast the step definition with the scenario intent

  # ── 4. Independence violations classified with appropriate severity ──

  @adw-yxq5og-review-phase-step-de @regression
  Scenario: Tautological step definitions that always pass are classified as blocker
    Given the file ".claude/commands/review.md" exists
    Then the independence verification should classify step definitions that would pass regardless of behavior as "blocker" severity
    And the rationale should state that tautological assertions provide no verification value

  @adw-yxq5og-review-phase-step-de @regression
  Scenario: Step definitions testing internals are classified as tech-debt
    Given the file ".claude/commands/review.md" exists
    Then the independence verification should classify step definitions that assert on implementation internals as "tech-debt" severity
    And the rationale should state that internal coupling makes tests brittle but they still provide some verification

  @adw-yxq5og-review-phase-step-de
  Scenario: Independence violations are reported as reviewIssues in the output JSON
    Given the file ".claude/commands/review.md" exists
    Then independence violations should be reported using the existing reviewIssues structure
    And each violation should include the step definition file, the scenario name, and the specific assertion

  # ── 5. Check does not trigger when no step definitions exist ──

  @adw-yxq5og-review-phase-step-de @regression
  Scenario: Independence check is skipped when no step definition files exist in the diff
    Given the file ".claude/commands/review.md" exists
    Then the independence verification should instruct skipping the check when no step definition files are found in the branch diff
    And no reviewIssues related to step definition independence should be created

  @adw-yxq5og-review-phase-step-de
  Scenario: Independence check is skipped when scenarios.md is absent
    Given the file ".claude/commands/review.md" exists
    Then the independence verification should instruct skipping the check when ".adw/scenarios.md" is absent from the target repository

  # ── 6. Existing regression safety ──

  @adw-yxq5og-review-phase-step-de @regression
  Scenario: TypeScript type-check passes after all changes for issue 307
    Given the ADW codebase has been modified for issue 307
    When "bunx tsc --noEmit" and "bunx tsc --noEmit -p adws/tsconfig.json" are run
    Then both type-check commands exit with code 0
