@adw-989 @adw-i5ekhk-feat-static-check-fi
Feature: Red static checks go to a fix loop without a cap that stops on no progress, every fix round passes a suppression guard, and a park comment says what to do

  A fix round is one run of the static-check fix agent; its diff is what that run changed.

  Background:
    Given the ADW codebase is checked out

  @adw-989 @adw-i5ekhk-feat-static-check-fi
  Scenario Outline: The fix-round guard rejects a fix round that adds "<added line>" to a <language> file
    Given a target repository whose ".adw/" names the test framework "<test framework>" and the BDD framework "<bdd framework>"
    And a fix round whose diff adds the line "<added line>" to "<file>"
    When the fix-round guard judges the fix round for that repository
    Then the fix-round guard rejects the fix round with a reason that names "<file>"

    Examples:
      | language   | test framework | bdd framework | file        | added line                                                    |
      | TypeScript | vitest         | cucumber-js   | src/app.ts  | // eslint-disable-next-line @typescript-eslint/no-unused-vars |
      | TypeScript | vitest         | cucumber-js   | src/app.ts  | const total = input; // eslint-disable-line prefer-const      |
      | TypeScript | vitest         | cucumber-js   | src/app.ts  | /* eslint-disable */                                          |
      | TypeScript | vitest         | cucumber-js   | src/app.ts  | // @ts-ignore                                                 |
      | TypeScript | vitest         | cucumber-js   | src/app.ts  | // @ts-expect-error                                           |
      | TypeScript | vitest         | cucumber-js   | src/app.ts  | // @ts-nocheck                                                |
      | Python     | pytest         | behave        | app/main.py | import os  # noqa: F401                                       |
      | Python     | pytest         | behave        | app/main.py | total: int = compute()  # type: ignore                        |
      | Python     | pytest         | behave        | app/main.py | # pylint: disable=unused-import                               |
      | Go         | go test        | godog         | cmd/main.go | defer file.Close() //nolint:errcheck                          |
      | Rust       | cargo test     | cucumber-rs   | src/lib.rs  | #[allow(dead_code)]                                           |
      | Rust       | cargo test     | cucumber-rs   | src/lib.rs  | #![allow(clippy::all)]                                        |
      | Ruby       | rspec          | cucumber-ruby | lib/cart.rb | # rubocop:disable Metrics/MethodLength                        |

  @adw-989 @adw-i5ekhk-feat-static-check-fi
  Scenario Outline: The fix-round guard rejects a fix round that <change> the protected file "<path>"
    Given a target repository whose ".adw/" names the test framework "<test framework>" and the BDD framework "<bdd framework>"
    And a fix round whose diff <change> "<path>"
    When the fix-round guard judges the fix round for that repository
    Then the fix-round guard rejects the fix round with a reason that names "<path>"

    Examples:
      | path                          | change  | test framework | bdd framework |
      | .adw/commands.md              | edits   | vitest         | cucumber-js   |
      | features/playwright.config.ts | edits   | vitest         | cucumber-js   |
      | eslint.config.js              | edits   | vitest         | cucumber-js   |
      | eslint.config.js              | deletes | vitest         | cucumber-js   |
      | src/legacy/.eslintrc.json     | creates | vitest         | cucumber-js   |
      | .eslintignore                 | creates | vitest         | cucumber-js   |
      | tsconfig.json                 | edits   | vitest         | cucumber-js   |
      | adws/tsconfig.json            | edits   | vitest         | cucumber-js   |
      | vite.config.ts                | edits   | vitest         | cucumber-js   |
      | ruff.toml                     | edits   | pytest         | behave        |
      | mypy.ini                      | edits   | pytest         | behave        |
      | .golangci.yml                 | edits   | go test        | godog         |
      | clippy.toml                   | edits   | cargo test     | cucumber-rs   |
      | .rubocop.yml                  | edits   | rspec          | cucumber-ruby |

  @adw-989 @adw-i5ekhk-feat-static-check-fi
  Scenario Outline: The fix-round guard accepts a fix round that adds only ordinary code to a <language> file
    Given a target repository whose ".adw/" names the test framework "<test framework>" and the BDD framework "<bdd framework>"
    And a fix round whose diff adds the line "<added line>" to "<file>"
    When the fix-round guard judges the fix round for that repository
    Then the fix-round guard accepts the fix round

    Examples:
      | language   | test framework | bdd framework | file        | added line                                                  |
      | TypeScript | vitest         | cucumber-js   | src/app.ts  | export const total: number = sum(values);                   |
      | Python     | pytest         | behave        | app/main.py | total = sum(values)                                         |
      | Go         | go test        | godog         | cmd/main.go | defer file.Close()                                          |
      | Rust       | cargo test     | cucumber-rs   | src/lib.rs  | pub fn total(values: &[i64]) -> i64 { values.iter().sum() } |
      | Ruby       | rspec          | cucumber-ruby | lib/cart.rb | def total = items.sum(&:price)                              |
      | Elixir     | ExUnit         | cabbage       | lib/cart.ex | def total(items), do: Enum.sum(items)                       |

  @adw-989 @adw-i5ekhk-feat-static-check-fi
  Scenario: Only the lines a fix round adds are judged: suppression comments the diff shows as context or as removed lines, and an ordinary comment it adds, do not get the round rejected
    Given a target repository whose ".adw/" names the test framework "vitest" and the BDD framework "cucumber-js"
    And a fix round whose diff is:
      """
      diff --git a/src/app.ts b/src/app.ts
      --- a/src/app.ts
      +++ b/src/app.ts
      @@ -1,5 +1,4 @@
       // @ts-ignore
       import legacy from './legacy';
      -// eslint-disable-next-line prefer-const
      -let total = legacy.sum();
      +const total = legacy.sum();
       export { total };
      diff --git a/src/report.ts b/src/report.ts
      --- a/src/report.ts
      +++ b/src/report.ts
      @@ -2,3 +2,4 @@
       // Sums the values the report shows.
       export function sum(values: number[]): number {
      +  // Start from zero, so that an empty report sums to zero.
         return values.reduce((total, value) => total + value, 0);
      """
    When the fix-round guard judges the fix round for that repository
    Then the fix-round guard accepts the fix round

  @adw-989 @adw-i5ekhk-feat-static-check-fi
  Scenario Outline: A suppression pattern the repository adds in ".adw/commands.md" is honoured, and its entry "<entry>", which tries to remove the framework pattern "@ts-ignore", has no effect
    Given a target repository whose ".adw/" names the test framework "vitest" and the BDD framework "cucumber-js"
    And the repository's ".adw/commands.md" lists these entries as its own suppression patterns:
      | entry             |
      | widgets-lint: off |
      | <entry>           |
    And a fix round whose diff makes these changes:
      | file          | change                               |
      | src/app.ts    | adds the line "// @ts-ignore"        |
      | src/report.ts | adds the line "// widgets-lint: off" |
    When the fix-round guard judges the fix round for that repository
    Then the fix-round guard rejects the fix round with reasons that name each of:
      | file          |
      | src/app.ts    |
      | src/report.ts |

    Examples:
      | entry             |
      | !@ts-ignore       |
      | -@ts-ignore       |
      | allow: @ts-ignore |

  @adw-989 @adw-i5ekhk-feat-static-check-fi
  Scenario: In a repository whose language has no entry in the framework table, the guard still rejects an edit of a protected file and a pattern the repository adds itself, and names each in its reasons
    Given a target repository whose ".adw/" names the test framework "ExUnit" and the BDD framework "cabbage"
    And the repository's ".adw/commands.md" lists these entries as its own suppression patterns:
      | entry         |
      | credo:disable |
    And a fix round whose diff makes these changes:
      | file             | change                                                                         |
      | lib/cart.ex      | adds the line "# credo:disable-for-next-line Credo.Check.Readability.ModuleDoc" |
      | .adw/commands.md | edits the file                                                                 |
    When the fix-round guard judges the fix round for that repository
    Then the fix-round guard rejects the fix round with reasons that name each of:
      | file             |
      | lib/cart.ex      |
      | .adw/commands.md |

  @adw-989 @adw-i5ekhk-feat-static-check-fi
  Scenario: The loop stops when a round leaves the static checks' output identical to the previous round's, and parks the workflow as "human_gated" with a comment that names the failing check and says what "## Retry" does
    Given a workflow for issue 9891 whose worktree's ".adw/commands.md" configures these static checks, in this order:
      | check                  | command                                                             |
      | type check             | N/A                                                                 |
      | additional type checks | N/A                                                                 |
      | lint                   | prints "src/app.ts: 2 problems (2 errors, 0 warnings)" and exits 1 |
      | build                  | N/A                                                                 |
    And the static-check fix agent's rounds go as follows:
      | round | changes                                        | lint afterwards                                                   |
      | 1     | adds "export const total = 0;" to "src/app.ts" | prints "src/app.ts: 1 problem (1 error, 0 warnings)" and exits 1 |
      | 2     | adds "export const count = 0;" to "src/app.ts" | prints "src/app.ts: 1 problem (1 error, 0 warnings)" and exits 1 |
      | 3     | adds "export const sum = 0;" to "src/app.ts"   | prints "0 problems" and exits 0                                   |
    When the workflow's unit-test phase runs
    Then the static-check fix agent was started 2 times
    And the test agent was not started
    And the unit-test phase did not complete
    And the workflow for issue 9891 is parked as "human_gated"
    And the park comment posted on issue 9891 names the failing check "lint"
    And the park comment posted on issue 9891 says that "## Retry" continues the static-check fix loop

  @adw-989 @adw-i5ekhk-feat-static-check-fi
  Scenario: While each round changes the lint's output the loop carries on with no cap, handing every round the lint's latest output, for seven rounds here, until the lint passes and the unit-test phase goes on to the test run
    Given a workflow for issue 9892 whose worktree's ".adw/commands.md" configures these static checks, in this order:
      | check                  | command                                     |
      | type check             | N/A                                         |
      | additional type checks | N/A                                         |
      | lint                   | prints "src/app.ts: 7 problems" and exits 1 |
      | build                  | N/A                                         |
    And the static-check fix agent's rounds go as follows:
      | round | changes                                    | lint afterwards                             |
      | 1     | adds "export const a = 1;" to "src/app.ts" | prints "src/app.ts: 6 problems" and exits 1 |
      | 2     | adds "export const b = 2;" to "src/app.ts" | prints "src/app.ts: 5 problems" and exits 1 |
      | 3     | adds "export const c = 3;" to "src/app.ts" | prints "src/app.ts: 4 problems" and exits 1 |
      | 4     | adds "export const d = 4;" to "src/app.ts" | prints "src/app.ts: 3 problems" and exits 1 |
      | 5     | adds "export const e = 5;" to "src/app.ts" | prints "src/app.ts: 2 problems" and exits 1 |
      | 6     | adds "export const f = 6;" to "src/app.ts" | prints "src/app.ts: 1 problem" and exits 1  |
      | 7     | adds "export const g = 7;" to "src/app.ts" | prints "0 problems" and exits 0             |
    And the test agent writes a JUnit report in which every unit test passes
    When the workflow's unit-test phase runs
    Then the static-check fix agent was started 7 times
    And the static-check fix agent's round 1 was handed the failing check "lint" with the output "src/app.ts: 7 problems"
    And the static-check fix agent's round 7 was handed the failing check "lint" with the output "src/app.ts: 1 problem"
    And the test agent was started once, after the last static-check fix round
    And the unit-test phase completed
    And no park comment was posted on issue 9892

  @adw-989 @adw-i5ekhk-feat-static-check-fi
  Scenario: Progress is judged on the static checks' combined output: a round that leaves the type check's output as it was but changes the lint's is progress
    Given a workflow for issue 9893 whose worktree's ".adw/commands.md" configures these static checks, in this order:
      | check                  | command                                                                                              |
      | type check             | prints "src/app.ts(4,3): error TS2322: Type 'string' is not assignable to type 'number'." and exits 2 |
      | additional type checks | N/A                                                                                                  |
      | lint                   | prints "src/app.ts: 2 problems (2 errors, 0 warnings)" and exits 1                                  |
      | build                  | N/A                                                                                                  |
    And the static-check fix agent's rounds go as follows:
      | round | changes                                                | type check afterwards                                                                                | lint afterwards                                                   |
      | 1     | adds "export const label = 'total';" to "src/app.ts"   | prints "src/app.ts(4,3): error TS2322: Type 'string' is not assignable to type 'number'." and exits 2 | prints "src/app.ts: 1 problem (1 error, 0 warnings)" and exits 1 |
      | 2     | adds "export const total: number = 0;" to "src/app.ts" | prints "src: 0 errors" and exits 0                                                                   | prints "0 problems" and exits 0                                   |
    And the test agent writes a JUnit report in which every unit test passes
    When the workflow's unit-test phase runs
    Then the static-check fix agent was started 2 times
    And the unit-test phase completed
    And no park comment was posted on issue 9893

  @adw-989 @adw-i5ekhk-feat-static-check-fi
  Scenario Outline: A round the fix-round guard rejects is no progress even though the lint would pass after it: the loop parks the workflow and does not leave the rejected change in the worktree (<what round 2 does>)
    Given a workflow for issue <issue> whose worktree's ".adw/commands.md" configures these static checks, in this order:
      | check                  | command                                                             |
      | type check             | N/A                                                                 |
      | additional type checks | N/A                                                                 |
      | lint                   | prints "src/app.ts: 2 problems (2 errors, 0 warnings)" and exits 1 |
      | build                  | N/A                                                                 |
    And the worktree's ".adw/" names the test framework "vitest" and the BDD framework "cucumber-js"
    And the static-check fix agent's rounds go as follows:
      | round | changes                                        | lint afterwards                                                   |
      | 1     | adds "export const total = 0;" to "src/app.ts" | prints "src/app.ts: 1 problem (1 error, 0 warnings)" and exits 1 |
      | 2     | adds "<added line>" to "<file>"                | prints "0 problems" and exits 0                                   |
    And the test agent writes a JUnit report in which every unit test passes
    When the workflow's unit-test phase runs
    Then the static-check fix agent was started 2 times
    And the test agent was not started
    And the unit-test phase did not complete
    And the workflow for issue <issue> is parked as "human_gated"
    And the park comment posted on issue <issue> names the failing check "lint"
    And the park comment posted on issue <issue> says that the fix-round guard rejected a change to "<file>"
    And the file "<file>" in the workflow's worktree does not hold the line "<added line>"

    Examples:
      | issue | what round 2 does                          | file             | added line                                             |
      | 9895  | adds an eslint-disable comment             | src/app.ts       | // eslint-disable-next-line prefer-const               |
      | 9896  | turns a rule off in the lint configuration | eslint.config.js | export default [{ rules: { 'prefer-const': 'off' } }]; |

  @adw-989 @adw-i5ekhk-feat-static-check-fi
  Scenario: The guard judges only what a fix round changed: a "tsconfig.json" change the build phase committed earlier does not get a fix round rejected
    Given a workflow for issue 9897 whose worktree's ".adw/commands.md" configures these static checks, in this order:
      | check                  | command                                                                               |
      | type check             | N/A                                                                                   |
      | additional type checks | N/A                                                                                   |
      | lint                   | prints "src/app.ts:3:7 'total' is never reassigned. Use 'const' instead" and exits 1 |
      | build                  | N/A                                                                                   |
    And the build phase has committed a change to "tsconfig.json" on the workflow's branch
    And the static-check fix agent's rounds go as follows:
      | round | changes                                        | lint afterwards                 |
      | 1     | adds "export const total = 0;" to "src/app.ts" | prints "0 problems" and exits 0 |
    And the test agent writes a JUnit report in which every unit test passes
    When the workflow's unit-test phase runs
    Then the static-check fix agent was started 1 time
    And the test agent was started once, after the last static-check fix round
    And the unit-test phase completed
    And no park comment was posted on issue 9897

  @adw-989 @adw-i5ekhk-feat-static-check-fi
  Scenario: "## Retry" on a workflow the stalled loop parked resumes the loop: the resumed unit-test phase starts a new round although the lint prints what it printed when the loop stopped
    Given a workflow for issue 9898 whose worktree's ".adw/commands.md" configures these static checks, in this order:
      | check                  | command                                                                               |
      | type check             | N/A                                                                                   |
      | additional type checks | N/A                                                                                   |
      | lint                   | prints "src/app.ts:3:7 'total' is never reassigned. Use 'const' instead" and exits 1 |
      | build                  | N/A                                                                                   |
    And the static-check fix agent's rounds go as follows:
      | round | changes                               | lint afterwards                                                                       |
      | 1     | adds "let total = 0;" to "src/app.ts" | prints "src/app.ts:3:7 'total' is never reassigned. Use 'const' instead" and exits 1 |
      | 2     | adds "total += 1;" to "src/app.ts"    | prints "0 problems" and exits 0                                                       |
    And the test agent writes a JUnit report in which every unit test passes
    And the workflow's unit-test phase has run and parked the workflow as "human_gated"
    When "## Retry" is posted on issue 9898
    And the resumed workflow's unit-test phase runs
    Then the static-check fix agent was started 2 times
    And the static-check fix agent's round 2 was handed the failing check "lint" with the output "src/app.ts:3:7 'total' is never reassigned. Use 'const' instead"
    And the test agent was started once, after the last static-check fix round
    And the unit-test phase completed

  @adw-989 @adw-i5ekhk-feat-static-check-fi
  Scenario: The unit-test fix loop keeps its cap: with every static check green, a unit test that fails on every run ends the run with an error once the cap is spent, and the workflow is not parked
    Given a workflow for issue 9890 whose worktree's ".adw/commands.md" configures these static checks, in this order:
      | check                  | command                             |
      | type check             | prints "src: 0 errors" and exits 0  |
      | additional type checks | N/A                                 |
      | lint                   | prints "0 problems" and exits 0     |
      | build                  | prints "build finished" and exits 0 |
    And the test agent writes a JUnit report in which a unit test fails on every run
    When the workflow's unit-test phase runs
    Then the test agent was started as many times as the unit-test fix loop's cap allows
    And the unit-test phase ended the workflow with exit code 1
    And the unit-test phase posted a comment headed "ADW Workflow Error" on issue 9890
    And no park comment was posted on issue 9890

  @adw-989 @adw-i5ekhk-feat-static-check-fi
  Scenario: The park comment for a stalled static-check fix loop names the failing check and quotes its output, says that "## Retry" continues the fix loop, and says what "## Continue" does
    Given a park for the reason "fix_loop_stalled" whose evidence is:
      | failing check | lint                                        |
      | output        | src/app.ts: 1 problem (1 error, 0 warnings) |
    When the park comment is built
    Then the park comment names "lint"
    And the park comment quotes "src/app.ts: 1 problem (1 error, 0 warnings)"
    And the park comment says that "## Retry" continues the static-check fix loop
    And the park comment says what "## Continue" does for this park

  @adw-989 @adw-i5ekhk-feat-static-check-fi @adw-990
  Scenario: The park comment for a red baseline names the failing check, says that it fails on the base branch, and says that "## Retry" re-runs the baseline while "## Continue" waives it
    Given a park for the reason "baseline_red" whose evidence is:
      | failing check | type check                                                                                                  |
      | output        | src/cart.ts(12,5): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'. |
      | base branch   | trunk                                                                                                       |
    When the park comment is built
    Then the park comment names "type check"
    And the park comment quotes "src/cart.ts(12,5): error TS2345"
    And the park comment says that it fails on the base branch "trunk"
    And the park comment says that "## Retry" re-runs the baseline and parks the issue again if it is still red
    And the park comment says that "## Continue" waives the baseline, so that this run fixes the pre-existing failures too

  @adw-989 @adw-i5ekhk-feat-static-check-fi @adw-990
  Scenario: The park comment for a regression scenario that also fails on the base branch names the scenario, says that it fails on the base branch, and says what "## Retry" does and that "## Continue" lets this run fix it
    Given a park for the reason "pre_existing_regression" whose evidence is:
      | failing scenario | The cron launches one orchestrator per eligible issue |
      | base branch      | trunk                                                 |
    When the park comment is built
    Then the park comment names "The cron launches one orchestrator per eligible issue"
    And the park comment says that it fails on the base branch "trunk"
    And the park comment says what "## Retry" does for this park
    And the park comment says that "## Continue" lets this run fix the pre-existing failure too

  @adw-989 @adw-i5ekhk-feat-static-check-fi @adw-990
  Scenario: The park comment for a dev server that does not start on the base branch quotes the server's output, says that it fails on the base branch, and says that "## Retry" re-runs the baseline while "## Continue" waives it
    Given a park for the reason "base_server_down" whose evidence is:
      | server output | Error: listen EADDRINUSE: address already in use :::3000 |
      | base branch   | trunk                                                    |
    When the park comment is built
    Then the park comment names "dev server"
    And the park comment quotes "Error: listen EADDRINUSE: address already in use :::3000"
    And the park comment says that it fails on the base branch "trunk"
    And the park comment says that "## Retry" re-runs the baseline and parks the issue again if it is still red
    And the park comment says that "## Continue" waives the baseline, so that this run fixes the pre-existing failures too

  @adw-989 @adw-i5ekhk-feat-static-check-fi @adw-991
  Scenario: The park comment for an application type ADW does not know names "## Application Type" and the value it found, says to re-run "adw_init", and says what "## Retry" and "## Continue" each do
    Given a park for the reason "missing_application_type" whose evidence is:
      | application type | desktop |
    When the park comment is built
    Then the park comment names "## Application Type"
    And the park comment names "desktop"
    And the park comment says to re-run "adw_init"
    And the park comment says what "## Retry" does for this park
    And the park comment says what "## Continue" does for this park

  @adw-989 @adw-i5ekhk-feat-static-check-fi @adw-990
  Scenario: ADW would take none of the park comments for a directive, although each of them explains "## Retry" and "## Continue"
    When a park comment is built, with sample evidence, for each of these reasons:
      | reason                   |
      | baseline_red             |
      | pre_existing_regression  |
      | fix_loop_stalled         |
      | missing_application_type |
      | base_server_down         |
    Then each of those park comments mentions "## Retry" and "## Continue"
    And ADW would take none of them, as the latest comment on an issue, for a "## Retry", "## Continue" or "## Cancel" directive
