@adw-988 @adw-84aif7-feat-static-checks-r
Feature: Static checks run as deterministic gates in the unit-test phase

  Static checks are the type check, the additional type checks, the lint and the build that ".adw/commands.md" configures.

  Background:
    Given the ADW codebase is checked out

  @adw-988 @adw-84aif7-feat-static-checks-r
  Scenario: The check runner runs the type check, the additional type checks, the lint and the build in that order, whichever order ".adw/commands.md" lists them in
    Given a working directory whose ".adw/commands.md" configures these static checks, in this order:
      | check                  | command                             |
      | build                  | prints "build finished" and exits 0 |
      | lint                   | prints "0 problems" and exits 0     |
      | additional type checks | prints "adws: 0 errors" and exits 0 |
      | type check             | prints "src: 0 errors" and exits 0  |
    When the check runner runs the static checks configured in that working directory
    Then exactly these static checks ran, in this order:
      | check                  |
      | type check             |
      | additional type checks |
      | lint                   |
      | build                  |
    And the check runner reported these verdicts, in this order:
      | check                  | verdict | exit code | output includes |
      | type check             | passed  | 0         | src: 0 errors   |
      | additional type checks | passed  | 0         | adws: 0 errors  |
      | lint                   | passed  | 0         | 0 problems      |
      | build                  | passed  | 0         | build finished  |

  @adw-988 @adw-84aif7-feat-static-checks-r
  Scenario: Each static check's verdict is its own exit code, whatever its output says, and a failing check does not stop the checks after it
    Given a working directory whose ".adw/commands.md" configures these static checks, in this order:
      | check                  | command                                                                                |
      | type check             | prints "error TS2322: Type 'string' is not assignable to type 'number'." and exits 0 |
      | additional type checks | prints "adws: 0 errors" and exits 0                                                    |
      | lint                   | prints "All files pass linting." and exits 1                                           |
      | build                  | prints "build finished" and exits 0                                                    |
    When the check runner runs the static checks configured in that working directory
    Then exactly these static checks ran, in this order:
      | check                  |
      | type check             |
      | additional type checks |
      | lint                   |
      | build                  |
    And the check runner reported these verdicts, in this order:
      | check                  | verdict | exit code | output includes         |
      | type check             | passed  | 0         | error TS2322            |
      | additional type checks | passed  | 0         | adws: 0 errors          |
      | lint                   | failed  | 1         | All files pass linting. |
      | build                  | passed  | 0         | build finished          |

  @adw-988 @adw-84aif7-feat-static-checks-r
  Scenario: A static check whose command is N/A is not run and is reported as skipped, and the other static checks still run
    Given a working directory whose ".adw/commands.md" configures these static checks, in this order:
      | check                  | command                            |
      | type check             | prints "src: 0 errors" and exits 0 |
      | additional type checks | N/A                                |
      | lint                   | prints "0 problems" and exits 0    |
      | build                  | N/A                                |
    When the check runner runs the static checks configured in that working directory
    Then exactly these static checks ran, in this order:
      | check      |
      | type check |
      | lint       |
    And the check runner reported these verdicts, in this order:
      | check                  | verdict | exit code | output includes |
      | type check             | passed  | 0         | src: 0 errors   |
      | additional type checks | skipped |           |                 |
      | lint                   | passed  | 0         | 0 problems      |
      | build                  | skipped |           |                 |

  @adw-988 @adw-84aif7-feat-static-checks-r
  Scenario: The check runner captures what a static check writes to standard output and what it writes to standard error
    Given a working directory whose ".adw/commands.md" configures these static checks, in this order:
      | check                  | command                                                                       |
      | type check             | prints "src/cli.ts(3,7): error TS2322" and exits 2                            |
      | additional type checks | prints "adws: 0 errors" and exits 0                                           |
      | lint                   | prints "0 problems" and exits 0                                               |
      | build                  | prints "error: Could not resolve './missing'" to standard error and exits 1 |
    When the check runner runs the static checks configured in that working directory
    Then the check runner reported these verdicts, in this order:
      | check                  | verdict | exit code | output includes                      |
      | type check             | failed  | 2         | src/cli.ts(3,7): error TS2322        |
      | additional type checks | passed  | 0         | adws: 0 errors                       |
      | lint                   | passed  | 0         | 0 problems                           |
      | build                  | failed  | 1         | error: Could not resolve './missing' |

  @adw-988 @adw-84aif7-feat-static-checks-r
  Scenario: With unit tests switched on and every static check green, the unit-test phase runs the type check, the additional type checks, the lint and the build before it starts the test agent, and completes
    Given a workflow for issue 9881 whose worktree's ".adw/commands.md" configures these static checks, in this order:
      | check                  | command                             |
      | type check             | prints "src: 0 errors" and exits 0  |
      | additional type checks | prints "adws: 0 errors" and exits 0 |
      | lint                   | prints "0 problems" and exits 0     |
      | build                  | prints "build finished" and exits 0 |
    And the worktree's ".github/adw.yml" holds:
      """
      unitTests: true
      """
    And the test agent writes a JUnit report in which every unit test passes
    When the workflow's unit-test phase runs
    Then exactly these static checks ran, in this order:
      | check                  |
      | type check             |
      | additional type checks |
      | lint                   |
      | build                  |
    And the test agent was started once, after every static check had finished
    And the unit-test phase completed

  @adw-988 @adw-84aif7-feat-static-checks-r @adw-989
  Scenario: With unit tests switched on, a lint that exits 1 goes to the static-check fix agent and never to the test agent, with the lint's output in the execution log, and a round that leaves the lint's output unchanged parks the workflow
    Given a workflow for issue 9882 whose worktree's ".adw/commands.md" configures these static checks, in this order:
      | check                  | command                                                                    |
      | type check             | prints "src: 0 errors" and exits 0                                         |
      | additional type checks | N/A                                                                        |
      | lint                   | prints "src/utils.ts:1:10 'unused' is defined but never used" and exits 1 |
      | build                  | prints "build finished" and exits 0                                        |
    And the worktree's ".github/adw.yml" holds:
      """
      unitTests: true
      """
    And the test agent writes a JUnit report in which every unit test passes
    And the static-check fix agent's rounds change nothing
    When the workflow's unit-test phase runs
    Then the static-check fix agent was started 1 time
    And the test agent was not started
    And the unit-test phase did not complete
    And the workflow's execution log holds "src/utils.ts:1:10 'unused' is defined but never used"
    And the workflow for issue 9882 is parked as "human_gated"
    And the park comment posted on issue 9882 names the failing check "lint"

  @adw-988 @adw-84aif7-feat-static-checks-r
  Scenario: With unitTests false in ".github/adw.yml", the unit-test phase still runs every configured static check, skips the test run, and completes
    Given a workflow for issue 9883 whose worktree's ".adw/commands.md" configures these static checks, in this order:
      | check                  | command                             |
      | type check             | prints "src: 0 errors" and exits 0  |
      | additional type checks | N/A                                 |
      | lint                   | prints "0 problems" and exits 0     |
      | build                  | prints "build finished" and exits 0 |
    And the worktree's ".github/adw.yml" holds:
      """
      unitTests: false
      """
    When the workflow's unit-test phase runs
    Then exactly these static checks ran, in this order:
      | check      |
      | type check |
      | lint       |
      | build      |
    And no agent was started
    And the unit-test phase completed

  @adw-988 @adw-84aif7-feat-static-checks-r @adw-989
  Scenario: With unitTests false in ".github/adw.yml", a build that exits 1 still blocks the unit-test phase: it goes to the static-check fix agent, what the build wrote to standard error is in the execution log, and a round that leaves the build's output unchanged parks the workflow
    Given a workflow for issue 9884 whose worktree's ".adw/commands.md" configures these static checks, in this order:
      | check                  | command                                                                       |
      | type check             | prints "src: 0 errors" and exits 0                                            |
      | additional type checks | N/A                                                                           |
      | lint                   | prints "0 problems" and exits 0                                               |
      | build                  | prints "error: Could not resolve './missing'" to standard error and exits 1 |
    And the worktree's ".github/adw.yml" holds:
      """
      unitTests: false
      """
    And the static-check fix agent's rounds change nothing
    When the workflow's unit-test phase runs
    Then the static-check fix agent was started 1 time
    And the test agent was not started
    And the unit-test phase did not complete
    And the workflow's execution log holds "error: Could not resolve './missing'"
    And the workflow for issue 9884 is parked as "human_gated"
    And the park comment posted on issue 9884 names the failing check "build"
