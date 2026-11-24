@regression @proof-without-junit-report
Feature: When the repository's scenario runner writes no JUnit report to "ADW_JUNIT_REPORT_PATH", the BDD Proof comment shows "no report" and says the counts are unavailable instead of "0 passed, 0 failed", it and the scenario proof warn that the tag passed on the exit code only, the pass/fail decision is unchanged, and a run with a report is shown as before

  The BDD Proof comment is the "## :camera: BDD Proof" comment that the proof publish phase posts on the pull request, with a tally line and a summary table of one row per suite.

  Background:
    Given the ADW codebase is checked out

  Scenario: A scenario runner that exits 0 and writes no JUnit report still passes "@regression" and the issue's tag, and the scenario proof warns in the section of each tag that it passed based on the exit code only
    Given a workflow for issue 110201 whose worktree's ".adw/project.md" declares the application type "cli"
    And the worktree's ".adw/" runs scenarios by tag with a stand-in that records each run, exits 0, and writes no JUnit report
    And the worktree holds a feature tagged "@regression" and steps for it in the step definition directory ".adw/scenarios.md" names
    And the worktree holds a feature tagged "@adw-110201" and steps for it in the step definition directory ".adw/scenarios.md" names
    When the workflow's scenario test phase runs
    Then the scenario proof records the tag "@regression" as passed
    And the scenario proof records the tag "@adw-110201" as passed
    And the scenario proof records no blocker failures
    And the scenario proof's section for the tag "@regression" has the warning "passed based on the exit code only; the repository's scenario runner writes no JUnit report to `ADW_JUNIT_REPORT_PATH`"
    And the scenario proof's section for the tag "@adw-110201" has the warning "passed based on the exit code only; the repository's scenario runner writes no JUnit report to `ADW_JUNIT_REPORT_PATH`"

  Scenario: The BDD Proof comment of a run whose scenario runner exits 0 and writes no JUnit report shows "no report" for "@regression" and the issue's tag, says the counts are unavailable, carries the exit-code-only warning, and never says "0 passed, 0 failed"
    Given a workflow for issue 110202 whose worktree's ".adw/project.md" declares the application type "cli"
    And the worktree's ".adw/" runs scenarios by tag with a stand-in that records each run, exits 0, and writes no JUnit report
    And the worktree holds a feature tagged "@regression" and steps for it in the step definition directory ".adw/scenarios.md" names
    And the worktree holds a feature tagged "@adw-110202" and steps for it in the step definition directory ".adw/scenarios.md" names
    When the workflow's scenario test phase runs
    And the workflow's proof publish phase runs for pull request 157
    Then the recorded comment on pull request 157 contains "## :camera: BDD Proof"
    And the recorded comment on pull request 157 contains "All blocker suites passed"
    And the recorded comment on pull request 157 has exactly these rows in its summary table:
      | suite       | scenarios | status |
      | @regression | no report | passed |
      | @adw-110202 | no report | passed |
    And the recorded comment on pull request 157 contains "**Counts unavailable: no JUnit report at ADW_JUNIT_REPORT_PATH**"
    And the recorded comment on pull request 157 contains "passed based on the exit code only; the repository's scenario runner writes no JUnit report to `ADW_JUNIT_REPORT_PATH`"
    And the recorded comment on pull request 157 does not contain "0 passed, 0 failed"

  Scenario: The BDD Proof comment of a run whose scenario runner writes a JUnit report in which every scenario passes still gives the pass tally and each suite's passed scenarios out of its total, and neither it nor the scenario proof says "no report", that the counts are unavailable, or that a tag passed on the exit code only
    Given a workflow for issue 110203 whose worktree's ".adw/project.md" declares the application type "cli"
    And the worktree's ".adw/" runs scenarios by tag with a stand-in that records each run and writes a JUnit report in which every scenario passes
    And the worktree holds a feature tagged "@regression" and steps for it in the step definition directory ".adw/scenarios.md" names
    And the worktree holds a feature tagged "@adw-110203" and steps for it in the step definition directory ".adw/scenarios.md" names
    When the workflow's scenario test phase runs
    And the workflow's proof publish phase runs for pull request 157
    Then the scenario proof records no blocker failures
    And the recorded comment on pull request 157 contains "All blocker suites passed"
    And the recorded comment on pull request 157 contains "**2 passed, 0 failed**"
    And the recorded comment on pull request 157 has exactly these rows in its summary table:
      | suite       | scenarios | status |
      | @regression | 1/1       | passed |
      | @adw-110203 | 1/1       | passed |
    And the recorded comment on pull request 157 does not contain "no report"
    And the recorded comment on pull request 157 does not contain "Counts unavailable"
    And the recorded comment on pull request 157 does not contain "exit code only"
    And the scenario proof does not contain "exit code only"

  Scenario: When no scenario carries the issue's tag, the BDD Proof comment still shows that tag as skipped with "-", while "@regression", whose scenario runner wrote no JUnit report, shows "no report", and only the section of "@regression" in the scenario proof carries the exit-code-only warning
    Given a workflow for issue 110204 whose worktree's ".adw/project.md" declares the application type "cli"
    And the worktree's ".adw/" runs scenarios by tag with a stand-in that records each run, exits 0, and writes no JUnit report
    And the worktree holds a feature tagged "@regression" and steps for it in the step definition directory ".adw/scenarios.md" names
    When the workflow's scenario test phase runs
    And the workflow's proof publish phase runs for pull request 157
    Then the scenario proof records the tag "@regression" as passed
    And the scenario proof records no blocker failures
    And the recorded comment on pull request 157 has exactly these rows in its summary table:
      | suite       | scenarios | status  |
      | @regression | no report | passed  |
      | @adw-110204 | -         | skipped |
    And the recorded comment on pull request 157 contains "**Counts unavailable: no JUnit report at ADW_JUNIT_REPORT_PATH**"
    And the recorded comment on pull request 157 contains "passed based on the exit code only; the repository's scenario runner writes no JUnit report to `ADW_JUNIT_REPORT_PATH`"
    And the scenario proof's section for the tag "@regression" has the warning "passed based on the exit code only; the repository's scenario runner writes no JUnit report to `ADW_JUNIT_REPORT_PATH`"
    And the scenario proof's section for the tag "@adw-110204" has no warning

  Scenario: A scenario runner that exits 1 and writes no JUnit report still fails "@regression" and the issue's tag as blockers, and the BDD Proof comment says a blocker suite failed, shows "no report" for both and says the counts are unavailable, not "0 passed, 0 failed"
    Given a workflow for issue 110205 whose worktree's ".adw/project.md" declares the application type "cli"
    And the worktree's ".adw/" runs scenarios by tag with a stand-in that records each run, exits 1, and writes no JUnit report
    And the worktree holds a feature tagged "@regression" and steps for it in the step definition directory ".adw/scenarios.md" names
    And the worktree holds a feature tagged "@adw-110205" and steps for it in the step definition directory ".adw/scenarios.md" names
    When the workflow's scenario test phase runs
    And the workflow's proof publish phase runs for pull request 157
    Then the scenario proof records a blocker failure for the tag "@regression"
    And the scenario proof records a blocker failure for the tag "@adw-110205"
    And the recorded comment on pull request 157 contains "One or more blocker suites failed"
    And the recorded comment on pull request 157 has exactly these rows in its summary table:
      | suite       | scenarios | status |
      | @regression | no report | failed |
      | @adw-110205 | no report | failed |
    And the recorded comment on pull request 157 contains "**Counts unavailable: no JUnit report at ADW_JUNIT_REPORT_PATH**"
    And the recorded comment on pull request 157 does not contain "0 passed, 0 failed"

  Scenario: A scenario runner that exits 0 and writes a JUnit report with no test case has written a report, so "@regression" and the issue's tag still fail as blockers, the BDD Proof comment shows them with "-" as before, and neither it nor the scenario proof says "no report", that the counts are unavailable, or that a tag passed on the exit code only
    Given a workflow for issue 110206 whose worktree's ".adw/project.md" declares the application type "cli"
    And the worktree's ".adw/" runs scenarios by tag with a stand-in that records each run, exits 0, and writes a JUnit report with no test case
    And the worktree holds a feature tagged "@regression" and steps for it in the step definition directory ".adw/scenarios.md" names
    And the worktree holds a feature tagged "@adw-110206" and steps for it in the step definition directory ".adw/scenarios.md" names
    When the workflow's scenario test phase runs
    And the workflow's proof publish phase runs for pull request 157
    Then the scenario proof records a blocker failure for the tag "@regression"
    And the scenario proof records a blocker failure for the tag "@adw-110206"
    And the recorded comment on pull request 157 has exactly these rows in its summary table:
      | suite       | scenarios | status |
      | @regression | -         | failed |
      | @adw-110206 | -         | failed |
    And the recorded comment on pull request 157 does not contain "no report"
    And the recorded comment on pull request 157 does not contain "Counts unavailable"
    And the recorded comment on pull request 157 does not contain "exit code only"
    And the scenario proof does not contain "exit code only"

  Scenario: The ADW TypeScript type-check passes once a tag run without a JUnit report is marked as such in the scenario proof and the BDD Proof comment
    Then the ADW TypeScript type-check passes
