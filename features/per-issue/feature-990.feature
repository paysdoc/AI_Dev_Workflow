@adw-990 @adw-y9z5ie-feat-baseline-on-the
Feature: Before any work the base branch is checked on a worktree of its own, and a red base, or a regression scenario that also fails there, parks the issue instead of going to the fix agent

  The baseline is the static checks, and the dev server where ".adw/commands.md" declares one, run on a worktree of the base branch before the plan phase.

  Background:
    Given the ADW codebase is checked out

  @adw-990 @adw-y9z5ie-feat-baseline-on-the
  Scenario Outline: In <orchestrator>, static checks that fail on the base branch park the issue as "human_gated" before the plan phase, with a park comment that names and quotes each failing check, says that it fails on the base branch and says what "## Retry" and "## Continue" do
    Given a target repository whose default branch "dev" has a ".adw/commands.md" that configures these static checks, in this order:
      | check                  | command                                                                                                                          |
      | type check             | prints "src/cart.ts(12,5): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'." and exits 2 |
      | additional type checks | N/A                                                                                                                              |
      | lint                   | prints "src/cart.ts:3:7 'total' is never reassigned. Use 'const' instead" and exits 1                                            |
      | build                  | prints "build finished" and exits 0                                                                                              |
    And the default branch's ".adw/commands.md" declares no dev server
    And a workflow of the "<orchestrator>" orchestrator for issue <issue> in that repository
    When the workflow runs
    Then the workflow for issue <issue> is parked as "human_gated"
    And the plan phase did not run
    And the park comment posted on issue <issue> names the failing check "type check"
    And the park comment posted on issue <issue> quotes "src/cart.ts(12,5): error TS2345"
    And the park comment posted on issue <issue> names the failing check "lint"
    And the park comment posted on issue <issue> quotes "src/cart.ts:3:7 'total' is never reassigned. Use 'const' instead"
    And the park comment posted on issue <issue> says that it fails on the base branch "dev"
    And the park comment posted on issue <issue> says that "## Retry" re-runs the baseline and parks the issue again if it is still red
    And the park comment posted on issue <issue> says that "## Continue" waives the baseline, so that this run fixes the pre-existing failures too
    And the worktree of the base branch "dev" that the baseline ran in has been removed

    Examples:
      | orchestrator           | issue |
      | adwSdlc                | 9901  |
      | adwChore               | 9902  |
      | adwPlanBuild           | 9903  |
      | adwPlanBuildTest       | 9904  |
      | adwPlanBuildReview     | 9905  |
      | adwPlanBuildTestReview | 9906  |
      | adwPlanBuildDocument   | 9907  |
      | adwPrReview            | 9908  |

  @adw-990 @adw-y9z5ie-feat-baseline-on-the
  Scenario: In adwTest, which has no plan phase, static checks that fail on the base branch park the issue as "human_gated" before the unit-test phase runs, with a park comment that names the failing check and says that it fails on the base branch
    Given a target repository whose default branch "dev" has a ".adw/commands.md" that configures these static checks, in this order:
      | check                  | command                                                                               |
      | type check             | N/A                                                                                   |
      | additional type checks | N/A                                                                                   |
      | lint                   | prints "src/cart.ts:3:7 'total' is never reassigned. Use 'const' instead" and exits 1 |
      | build                  | N/A                                                                                   |
    And the default branch's ".adw/commands.md" declares no dev server
    And a workflow of the "adwTest" orchestrator for issue 9909 in that repository
    When the workflow runs
    Then the workflow for issue 9909 is parked as "human_gated"
    And the unit-test phase did not run
    And the park comment posted on issue 9909 names the failing check "lint"
    And the park comment posted on issue 9909 quotes "src/cart.ts:3:7 'total' is never reassigned. Use 'const' instead"
    And the park comment posted on issue 9909 says that it fails on the base branch "dev"
    And the worktree of the base branch "dev" that the baseline ran in has been removed

  @adw-990 @adw-y9z5ie-feat-baseline-on-the
  Scenario: A dev server that does not start on the base branch parks the issue as "human_gated" before the plan phase, with a park comment that quotes the server's output and says that it fails on the base branch
    Given a target repository whose default branch "dev" has a ".adw/commands.md" under which every static check passes
    And the default branch's ".adw/commands.md" declares a dev server that prints "Error: Cannot find module './routes'" to standard error and exits 1 instead of starting
    And a workflow of the "adwSdlc" orchestrator for issue 9911 in that repository
    When the workflow runs
    Then the workflow for issue 9911 is parked as "human_gated"
    And the plan phase did not run
    And the park comment posted on issue 9911 names "dev server"
    And the park comment posted on issue 9911 quotes "Error: Cannot find module './routes'"
    And the park comment posted on issue 9911 says that it fails on the base branch "dev"
    And the park comment posted on issue 9911 says that "## Retry" re-runs the baseline and parks the issue again if it is still red
    And the park comment posted on issue 9911 says that "## Continue" waives the baseline, so that this run fixes the pre-existing failures too
    And the worktree of the base branch "dev" that the baseline ran in has been removed

  @adw-990 @adw-y9z5ie-feat-baseline-on-the
  Scenario: A green baseline runs the static checks on a worktree of its own checked out at the base branch, runs no scenario there, records that it passed and lets the plan phase run, and the worktree is removed when the run ends
    Given a target repository whose default branch "dev" has a ".adw/commands.md" that configures these static checks, in this order:
      | check                  | command                             |
      | type check             | prints "src: 0 errors" and exits 0  |
      | additional type checks | N/A                                 |
      | lint                   | prints "0 problems" and exits 0     |
      | build                  | prints "build finished" and exits 0 |
    And the default branch's ".adw/commands.md" declares no dev server
    And a workflow of the "adwSdlc" orchestrator for issue 9912 in that repository
    When the workflow runs
    Then the baseline ran these static checks on a worktree of its own, checked out at the base branch "dev", in this order:
      | check      |
      | type check |
      | lint       |
      | build      |
    And no scenario was run on the base branch
    And the workflow's state records that the baseline passed on the base branch "dev"
    And the plan phase ran after the baseline
    And no park comment was posted on issue 9912
    And the worktree of the base branch "dev" that the baseline ran in has been removed

  @adw-990 @adw-y9z5ie-feat-baseline-on-the
  Scenario: Where ".adw/commands.md" declares a dev server, the baseline starts it on its worktree of the base branch, and the server has stopped again before the plan phase runs
    Given a target repository whose default branch "dev" has a ".adw/commands.md" under which every static check passes
    And the default branch's ".adw/commands.md" declares a dev server that starts and answers its health check
    And a workflow of the "adwSdlc" orchestrator for issue 9913 in that repository
    When the workflow runs
    Then the baseline started the dev server on its worktree of the base branch "dev"
    And the dev server the baseline started had stopped before the plan phase ran
    And the workflow's state records that the baseline passed on the base branch "dev"
    And the plan phase ran after the baseline
    And no park comment was posted on issue 9913

  @adw-990 @adw-y9z5ie-feat-baseline-on-the
  Scenario: "## Retry" on an issue parked for a red baseline runs the baseline again, and parks the issue again while the base branch is still red
    Given a target repository whose default branch "dev" has a ".adw/commands.md" that configures these static checks, in this order:
      | check                  | command                                                                               |
      | type check             | N/A                                                                                   |
      | additional type checks | N/A                                                                                   |
      | lint                   | prints "src/cart.ts:3:7 'total' is never reassigned. Use 'const' instead" and exits 1 |
      | build                  | N/A                                                                                   |
    And the default branch's ".adw/commands.md" declares no dev server
    And a workflow of the "adwSdlc" orchestrator for issue 9921 in that repository
    And the workflow has run and parked the issue as "human_gated" with the "baseline_red" park comment
    When the owner comments "## Retry" on issue 9921
    And the workflow runs again
    Then the baseline has run 2 times on a worktree of the base branch "dev"
    And the workflow for issue 9921 is parked as "human_gated"
    And the plan phase did not run
    And a second park comment was posted on issue 9921, naming the failing check "lint"

  @adw-990 @adw-y9z5ie-feat-baseline-on-the
  Scenario: "## Retry" after a commit has fixed the base branch runs the baseline on the base branch as it is now: the baseline passes and the plan phase runs
    Given a target repository whose default branch "dev" has a ".adw/commands.md" that configures these static checks, in this order:
      | check                  | command                                                                               |
      | type check             | N/A                                                                                   |
      | additional type checks | N/A                                                                                   |
      | lint                   | prints "src/cart.ts:3:7 'total' is never reassigned. Use 'const' instead" and exits 1 |
      | build                  | N/A                                                                                   |
    And the default branch's ".adw/commands.md" declares no dev server
    And a workflow of the "adwSdlc" orchestrator for issue 9922 in that repository
    And the workflow has run and parked the issue as "human_gated" with the "baseline_red" park comment
    And a commit pushed to "dev" since then makes the lint print "0 problems" and exit 0
    When the owner comments "## Retry" on issue 9922
    And the workflow runs again
    Then the baseline has run 2 times on a worktree of the base branch "dev"
    And the workflow's state records that the baseline passed on the base branch "dev"
    And the plan phase ran after the baseline
    And no second park comment was posted on issue 9922

  @adw-990 @adw-y9z5ie-feat-baseline-on-the
  Scenario: "## Continue" on an issue parked for a red baseline records a waiver, and the run goes on to the plan phase although the base branch is still red
    Given a target repository whose default branch "dev" has a ".adw/commands.md" that configures these static checks, in this order:
      | check                  | command                                                                               |
      | type check             | N/A                                                                                   |
      | additional type checks | N/A                                                                                   |
      | lint                   | prints "src/cart.ts:3:7 'total' is never reassigned. Use 'const' instead" and exits 1 |
      | build                  | N/A                                                                                   |
    And the default branch's ".adw/commands.md" declares no dev server
    And a workflow of the "adwSdlc" orchestrator for issue 9923 in that repository
    And the workflow has run and parked the issue as "human_gated" with the "baseline_red" park comment
    When the owner comments "## Continue" on issue 9923
    And the workflow runs again
    Then the workflow's state records a waiver of the baseline
    And the plan phase ran
    And no second park comment was posted on issue 9923

  @adw-990 @adw-y9z5ie-feat-baseline-on-the
  Scenario: A regression scenario that fails on the issue's branch and again when it is run on its own on the base branch is pre-existing: it never reaches the scenario fix agent, and the issue parks as "human_gated" with a park comment that names it
    Given a target repository whose default branch "dev" has a ".adw/commands.md" under which every static check passes
    And the default branch's ".adw/commands.md" declares no dev server
    And the target repository's scenarios have these outcomes:
      | scenario                                 | tag         | on the issue's branch | on the base branch |
      | The cart total includes the delivery fee | @regression | fails                 | fails              |
      | An empty cart has a total of zero        | @regression | passes                | passes             |
    And a workflow of the "adwSdlc" orchestrator for issue 9931 in that repository
    When the workflow runs
    Then the scenario "The cart total includes the delivery fee" was run on its own on the worktree of the base branch "dev"
    And no other scenario was run on the base branch
    And the scenario fix agent was not started
    And the workflow for issue 9931 is parked as "human_gated"
    And the park comment posted on issue 9931 names the scenario "The cart total includes the delivery fee"
    And the park comment posted on issue 9931 says that it fails on the base branch "dev"
    And the park comment posted on issue 9931 says that "## Retry" re-runs the scenario on the base branch and parks the issue again if it still fails there
    And the park comment posted on issue 9931 says that "## Continue" lets this run fix the pre-existing failure too
    And the worktree of the base branch "dev" that the baseline ran in has been removed

  @adw-990 @adw-y9z5ie-feat-baseline-on-the
  Scenario: A regression scenario that fails on the issue's branch but passes when it is run on its own on the base branch was broken by the change, and goes to the scenario fix agent as before
    Given a target repository whose default branch "dev" has a ".adw/commands.md" under which every static check passes
    And the default branch's ".adw/commands.md" declares no dev server
    And the target repository's scenarios have these outcomes:
      | scenario                                 | tag         | on the issue's branch | on the base branch |
      | The cart total includes the delivery fee | @regression | fails                 | passes             |
    And the scenario fix agent makes every failing scenario it is handed pass on the issue's branch
    And a workflow of the "adwSdlc" orchestrator for issue 9932 in that repository
    When the workflow runs
    Then the scenario "The cart total includes the delivery fee" was run on its own on the worktree of the base branch "dev"
    And the scenario fix agent was handed the failing scenario "The cart total includes the delivery fee"
    And no park comment was posted on issue 9932

  @adw-990 @adw-y9z5ie-feat-baseline-on-the
  Scenario: Of two regression scenarios that fail on the issue's branch, the one that also fails on the base branch never reaches the scenario fix agent, and the issue parks naming it
    Given a target repository whose default branch "dev" has a ".adw/commands.md" under which every static check passes
    And the default branch's ".adw/commands.md" declares no dev server
    And the target repository's scenarios have these outcomes:
      | scenario                                 | tag         | on the issue's branch | on the base branch |
      | The cart total includes the delivery fee | @regression | fails                 | fails              |
      | Removing the last item empties the cart  | @regression | fails                 | passes             |
    And the scenario fix agent changes nothing
    And a workflow of the "adwSdlc" orchestrator for issue 9933 in that repository
    When the workflow runs
    Then the scenario "The cart total includes the delivery fee" was run on its own on the worktree of the base branch "dev"
    And the scenario fix agent was never handed the failing scenario "The cart total includes the delivery fee"
    And the workflow for issue 9933 is parked as "human_gated"
    And the park comment posted on issue 9933 names the scenario "The cart total includes the delivery fee"

  @adw-990 @adw-y9z5ie-feat-baseline-on-the
  Scenario: A failing scenario of the issue itself, which the base branch does not have, is not run on the base branch: it goes to the scenario fix agent, and the issue is not parked
    Given a target repository whose default branch "dev" has a ".adw/commands.md" under which every static check passes
    And the default branch's ".adw/commands.md" declares no dev server
    And the target repository's scenarios have these outcomes:
      | scenario                                 | tag         | on the issue's branch | on the base branch |
      | The order summary shows the delivery fee | @adw-9934   | fails                 | does not exist     |
      | An empty cart has a total of zero        | @regression | passes                | passes             |
    And the scenario fix agent makes every failing scenario it is handed pass on the issue's branch
    And a workflow of the "adwSdlc" orchestrator for issue 9934 in that repository
    When the workflow runs
    Then no scenario was run on the base branch
    And the scenario fix agent was handed the failing scenario "The order summary shows the delivery fee"
    And no park comment was posted on issue 9934

  @adw-990 @adw-y9z5ie-feat-baseline-on-the
  Scenario: Where ".adw/commands.md" declares a dev server, a regression scenario run on its own on the base branch runs against a dev server started on that worktree, so a scenario that needs the server is not taken for a pre-existing failure
    Given a target repository whose default branch "dev" has a ".adw/commands.md" under which every static check passes
    And the default branch's ".adw/commands.md" declares a dev server that starts and answers its health check
    And every scenario of the target repository fails when it runs without a dev server started on its own worktree
    And the target repository's scenarios have these outcomes:
      | scenario                                 | tag         | on the issue's branch | on the base branch |
      | The cart total includes the delivery fee | @regression | fails                 | passes             |
    And the scenario fix agent makes every failing scenario it is handed pass on the issue's branch
    And a workflow of the "adwSdlc" orchestrator for issue 9935 in that repository
    When the workflow runs
    Then the scenario "The cart total includes the delivery fee" was run on its own on the worktree of the base branch "dev"
    And the scenario fix agent was handed the failing scenario "The cart total includes the delivery fee"
    And no park comment was posted on issue 9935

  @adw-990 @adw-y9z5ie-feat-baseline-on-the
  Scenario: After "## Continue" has waived a red baseline, a regression scenario that also fails on the base branch goes to the scenario fix agent, and the issue does not park again
    Given a target repository whose default branch "dev" has a ".adw/commands.md" that configures these static checks, in this order:
      | check                  | command                                                                               |
      | type check             | N/A                                                                                   |
      | additional type checks | N/A                                                                                   |
      | lint                   | prints "src/cart.ts:3:7 'total' is never reassigned. Use 'const' instead" and exits 1 |
      | build                  | N/A                                                                                   |
    And the default branch's ".adw/commands.md" declares no dev server
    And the target repository's scenarios have these outcomes:
      | scenario                                 | tag         | on the issue's branch | on the base branch |
      | The cart total includes the delivery fee | @regression | fails                 | fails              |
    And the scenario fix agent makes every failing scenario it is handed pass on the issue's branch
    And a workflow of the "adwSdlc" orchestrator for issue 9941 in that repository
    And the workflow has run and parked the issue as "human_gated" with the "baseline_red" park comment
    When the owner comments "## Continue" on issue 9941
    And the workflow runs again
    Then the scenario fix agent was handed the failing scenario "The cart total includes the delivery fee"
    And no second park comment was posted on issue 9941

  @adw-990 @adw-y9z5ie-feat-baseline-on-the
  Scenario: "## Continue" on an issue parked for a pre-existing regression failure lets the run send that scenario to the scenario fix agent, and the issue does not park again
    Given a target repository whose default branch "dev" has a ".adw/commands.md" under which every static check passes
    And the default branch's ".adw/commands.md" declares no dev server
    And the target repository's scenarios have these outcomes:
      | scenario                                 | tag         | on the issue's branch | on the base branch |
      | The cart total includes the delivery fee | @regression | fails                 | fails              |
    And the scenario fix agent makes every failing scenario it is handed pass on the issue's branch
    And a workflow of the "adwSdlc" orchestrator for issue 9942 in that repository
    And the workflow has run and parked the issue as "human_gated" with the "pre_existing_regression" park comment
    When the owner comments "## Continue" on issue 9942
    And the workflow runs again
    Then the scenario fix agent was handed the failing scenario "The cart total includes the delivery fee"
    And no second park comment was posted on issue 9942

  @adw-990 @adw-y9z5ie-feat-baseline-on-the
  Scenario: "## Retry" on an issue parked for a pre-existing regression failure runs the scenario on its own on the base branch again, and parks the issue again while it still fails there
    Given a target repository whose default branch "dev" has a ".adw/commands.md" under which every static check passes
    And the default branch's ".adw/commands.md" declares no dev server
    And the target repository's scenarios have these outcomes:
      | scenario                                 | tag         | on the issue's branch | on the base branch |
      | The cart total includes the delivery fee | @regression | fails                 | fails              |
    And a workflow of the "adwSdlc" orchestrator for issue 9943 in that repository
    And the workflow has run and parked the issue as "human_gated" with the "pre_existing_regression" park comment
    When the owner comments "## Retry" on issue 9943
    And the workflow runs again
    Then the scenario "The cart total includes the delivery fee" has been run on its own on a worktree of the base branch "dev" 2 times
    And the scenario fix agent was not started
    And the workflow for issue 9943 is parked as "human_gated"
    And a second park comment was posted on issue 9943, naming the scenario "The cart total includes the delivery fee"

  @adw-990 @adw-y9z5ie-feat-baseline-on-the
  Scenario: When a phase after the baseline fails the run with an error, the worktree of the base branch is removed all the same
    Given a target repository whose default branch "dev" has a ".adw/commands.md" under which every static check passes
    And the default branch's ".adw/commands.md" declares no dev server
    And a workflow of the "adwSdlc" orchestrator for issue 9951 in that repository
    And the build phase of that workflow fails with the error "Build agent exited with code 1"
    When the workflow runs
    Then the workflow ended with exit code 1
    And the worktree of the base branch "dev" that the baseline ran in has been removed
