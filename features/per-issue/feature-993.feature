@adw-993 @adw-1pdkov-feat-a-dev-server-th
Feature: In a "web" repository a dev server that will not start on the issue's branch is a failed review, and the count of failed reviews resets once it starts

  A start is the dev-server lifecycle's up to 3 tries of the start command; it fails when none of them gets an answer from the health check.

  Background:
    Given the ADW codebase is checked out

  @adw-993 @adw-1pdkov-feat-a-dev-server-th
  Scenario Outline: In <orchestrator>, a dev server that does not start on the issue's branch gets no scenario run: the review patch agent is handed a blocker quoting the server's output, and after the patch the dev server is started again, the issue's scenarios run against it and the review follows
    Given a target repository whose default branch "dev" has a ".adw/commands.md" under which every static check passes
    And the default branch's ".adw/project.md" declares the application type "web"
    And the default branch's ".adw/commands.md" declares a dev server that starts and answers its health check
    And the build leaves the issue's branch with a dev server that prints "Error: Cannot find module './routes'" to standard error and exits 1 instead of starting
    And the review patch agent makes the dev server on the issue's branch start and answer its health check
    And the issue's scenarios pass when they run against a dev server that answers its health check, and fail without one
    And the review agent finds no blocker
    And a workflow of the "<orchestrator>" orchestrator for issue <issue> under adwId "<adwId>" in that repository
    When the workflow runs
    Then the dev server's start command ran 3 times on the issue's branch before the review patch agent was started
    And no scenario was run on the issue's branch before the review patch agent was started
    And the scenario fix agent was not started
    And the review patch agent was handed a blocker that quotes "Error: Cannot find module './routes'" 1 time
    And after the review patch the dev server was started on the issue's branch again, and answered its health check
    And the issue's scenarios ran against that dev server and passed
    And the workflow started the review agent 1 time
    And the workflow only ever started the review agent after the issue's scenarios had passed against a dev server started on the issue's branch
    And the state file for adwId "<adwId>" records workflowStage "awaiting_merge"

    Examples:
      | orchestrator           | issue | adwId                |
      | adwSdlc                | 9961  | throwaway9961-bdd993 |
      | adwPlanBuildReview     | 9962  | throwaway9962-bdd993 |
      | adwPlanBuildTestReview | 9963  | throwaway9963-bdd993 |
      | adwPrReview            | 9964  | throwaway9964-bdd993 |

  @adw-993 @adw-1pdkov-feat-a-dev-server-th
  Scenario: A dev server that never starts on the issue's branch uses one review attempt per failed start: after the third failed start the workflow stops at "review_failed", with no scenario run, no review, and a "review_failed" comment that quotes the server's output
    Given a target repository whose default branch "dev" has a ".adw/commands.md" under which every static check passes
    And the default branch's ".adw/project.md" declares the application type "web"
    And the default branch's ".adw/commands.md" declares a dev server that starts and answers its health check
    And the build leaves the issue's branch with a dev server that prints "Error: Cannot find module './routes'" to standard error and exits 1 instead of starting
    And no review patch makes the dev server on the issue's branch start
    And the issue's scenarios pass when they run against a dev server that answers its health check, and fail without one
    And the review agent finds no blocker
    And a workflow of the "adwSdlc" orchestrator for issue 9965 under adwId "throwaway9965-bdd993" in that repository
    When the workflow runs
    Then the dev server failed 3 starts on the issue's branch
    And the review patch agent ran once between each failed start and the next, and not after the last
    And the review patch agent was handed a blocker that quotes "Error: Cannot find module './routes'" 2 times
    And no scenario was run on the issue's branch
    And the workflow never started the review agent
    And the scenario fix agent was not started
    And the state file for adwId "throwaway9965-bdd993" records workflowStage "review_failed"
    And the "review_failed" comment posted on issue 9965 quotes "Error: Cannot find module './routes'"

  @adw-993 @adw-1pdkov-feat-a-dev-server-th
  Scenario: A dev server that starts again after a failed start sets the count of failed reviews back to zero: a review that then finds a blocker on every attempt still gets all 3 attempts before the workflow stops at "review_failed"
    Given a target repository whose default branch "dev" has a ".adw/commands.md" under which every static check passes
    And the default branch's ".adw/project.md" declares the application type "web"
    And the default branch's ".adw/commands.md" declares a dev server that starts and answers its health check
    And the build leaves the issue's branch with a dev server that prints "Error: Cannot find module './routes'" to standard error and exits 1 instead of starting
    And the review patch agent makes the dev server on the issue's branch start and answer its health check
    And the issue's scenarios pass when they run against a dev server that answers its health check, and fail without one
    And the review agent finds the blocker "The cart total ignores the delivery fee" on every attempt
    And a workflow of the "adwSdlc" orchestrator for issue 9966 under adwId "throwaway9966-bdd993" in that repository
    When the workflow runs
    Then the dev server failed 1 start on the issue's branch
    And the review patch agent was handed a blocker that quotes "Error: Cannot find module './routes'" 1 time
    And the workflow started the review agent 3 times
    And the workflow only ever started the review agent after the issue's scenarios had passed against a dev server started on the issue's branch
    And the review patch agent was handed a blocker that quotes "The cart total ignores the delivery fee" 2 times
    And the state file for adwId "throwaway9966-bdd993" records workflowStage "review_failed"

  @adw-993 @adw-1pdkov-feat-a-dev-server-th
  Scenario: Failed starts use the same review attempts as failed reviews: a review that finds a blocker, then 2 failed starts after the patch for it broke the dev server, stop the workflow at "review_failed"
    Given a target repository whose default branch "dev" has a ".adw/commands.md" under which every static check passes
    And the default branch's ".adw/project.md" declares the application type "web"
    And the default branch's ".adw/commands.md" declares a dev server that starts and answers its health check
    And the review patch agent leaves the issue's branch with a dev server that prints "TypeError: app.listen is not a function" to standard error and exits 1 instead of starting
    And the issue's scenarios pass when they run against a dev server that answers its health check, and fail without one
    And the review agent finds the blocker "The cart total ignores the delivery fee" on every attempt
    And a workflow of the "adwSdlc" orchestrator for issue 9967 under adwId "throwaway9967-bdd993" in that repository
    When the workflow runs
    Then the workflow started the review agent 1 time
    And the workflow only ever started the review agent after the issue's scenarios had passed against a dev server started on the issue's branch
    And the review patch agent was handed a blocker that quotes "The cart total ignores the delivery fee" 1 time
    And the dev server failed 2 starts on the issue's branch
    And the review patch agent was handed a blocker that quotes "TypeError: app.listen is not a function" 1 time
    And the state file for adwId "throwaway9967-bdd993" records workflowStage "review_failed"

  @adw-993 @adw-1pdkov-feat-a-dev-server-th
  Scenario: In a "web" repository a dev server that does not start on the base branch still parks the issue as "human_gated" before the plan phase, and is not a failed review
    Given a target repository whose default branch "dev" has a ".adw/commands.md" under which every static check passes
    And the default branch's ".adw/project.md" declares the application type "web"
    And the default branch's ".adw/commands.md" declares a dev server that prints "Error: Cannot find module './routes'" to standard error and exits 1 instead of starting
    And a workflow of the "adwSdlc" orchestrator for issue 9968 under adwId "throwaway9968-bdd993" in that repository
    When the workflow runs
    Then the state file for adwId "throwaway9968-bdd993" records workflowStage "human_gated"
    And the plan phase did not run
    And the park comment posted on issue 9968 quotes "Error: Cannot find module './routes'"

  @adw-993 @adw-1pdkov-feat-a-dev-server-th
  Scenario: The ADW TypeScript type-check passes once a dev server that will not start on the issue's branch is a failed review
    Then the ADW TypeScript type-check passes
