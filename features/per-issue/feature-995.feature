@adw-995 @adw-zxqs2z-feat-the-reviewer-ru
Feature: Review is reached only once the scenarios are green, in adwPlanBuildReview as in the other orchestrators; the review agent is started with the per-issue images and the guidance section of its application type; and a ".adw/review_proof.md" configures nothing

  The review agent's prompt is the "/review" command line ADW starts the Claude CLI with.

  Background:
    Given the ADW codebase is checked out

  @adw-995 @adw-zxqs2z-feat-the-reviewer-ru
  Scenario: adwPlanBuildReview sends a failing per-issue scenario to the scenario fix agent, and starts the review agent only once every scenario has passed its last run
    Given a target repository whose default branch "dev" has a ".adw/commands.md" under which every static check passes
    And the default branch's ".adw/commands.md" declares no dev server
    And the target repository's scenarios have these outcomes:
      | scenario                                 | tag         | on the issue's branch | on the base branch |
      | The order summary shows the delivery fee | @adw-99501  | fails                 | does not exist     |
      | An empty cart has a total of zero        | @regression | passes                | passes             |
    And the scenario fix agent makes every failing scenario it is handed pass on the issue's branch
    And a workflow of the "adwPlanBuildReview" orchestrator for issue 99501 in that repository
    When the workflow runs
    Then the scenario fix agent was handed the failing scenario "The order summary shows the delivery fee"
    And the review agent was started once, after the last start of the scenario fix agent
    And every scenario passed its last run before the review agent was started
    And the workflow ended with exit code 0

  @adw-995 @adw-zxqs2z-feat-the-reviewer-ru
  Scenario Outline: In <orchestrator>, a per-issue scenario that still fails after the last round of the scenario fix agent ends the run with an error, and the review agent is never started
    Given a target repository whose default branch "dev" has a ".adw/commands.md" under which every static check passes
    And the default branch's ".adw/commands.md" declares no dev server
    And the target repository's scenarios have these outcomes:
      | scenario                                 | tag          | on the issue's branch | on the base branch |
      | The order summary shows the delivery fee | @adw-<issue> | fails                 | does not exist     |
    And the scenario fix agent changes nothing
    And a workflow of the "<orchestrator>" orchestrator for issue <issue> in that repository
    When the workflow runs
    Then the scenario fix agent was handed the failing scenario "The order summary shows the delivery fee"
    And the review agent was not started
    And the workflow ended with exit code 1
    And no park comment was posted on issue <issue>

    Examples:
      | orchestrator           | issue |
      | adwPlanBuildReview     | 99502 |
      | adwPlanBuildTestReview | 99503 |
      | adwSdlc                | 99504 |

  @adw-995 @adw-zxqs2z-feat-the-reviewer-ru
  Scenario: In adwPlanBuildReview a regression scenario that also fails when it is run on its own on the base branch parks the issue as "human_gated" before any review: neither the scenario fix agent nor the review agent is started
    Given a target repository whose default branch "dev" has a ".adw/commands.md" under which every static check passes
    And the default branch's ".adw/commands.md" declares no dev server
    And the target repository's scenarios have these outcomes:
      | scenario                                 | tag         | on the issue's branch | on the base branch |
      | The cart total includes the delivery fee | @regression | fails                 | fails              |
    And a workflow of the "adwPlanBuildReview" orchestrator for issue 99505 in that repository
    When the workflow runs
    Then the scenario "The cart total includes the delivery fee" was run on its own on the worktree of the base branch "dev"
    And the scenario fix agent was not started
    And the review agent was not started
    And the workflow for issue 99505 is parked as "human_gated"
    And the park comment posted on issue 99505 names the scenario "The cart total includes the delivery fee"

  @adw-995 @adw-zxqs2z-feat-the-reviewer-ru
  Scenario: In a "web" repository the review agent is started with the paths of exactly the per-issue scenarios' images in its prompt, and with no regression image or stray file
    Given a workflow for issue 99511 in a "web" repository, with a recording issue tracker, code host and screenshot store
    And the workflow's worktree holds these scenarios, which the stand-in scenario runner reports with these outcomes and attachments:
      | feature file                             | scenario tags | scenario                                      | outcome | attachments          |
      | features/per-issue/feature-99511.feature | @adw-99511    | The cart shows the order total                | passed  | cart-total.png       |
      | features/per-issue/feature-99511.feature | @adw-99511    | The checkout page asks for a delivery address | passed  | checkout-address.png |
      | features/regression/cart.feature         | @regression   | The cart page loads                           | passed  | cart-page.png        |
    And every run of the stand-in scenario runner also leaves "stray.png" in its proof directory, attached to no test case
    And the stand-in review agent's verdict on every review is a pass
    When the scenario test phase runs and the review phase judges its proof
    Then the review agent was started on review attempt 1 with the paths of exactly these images in its prompt, each of which existed when it started:
      | image                |
      | cart-total.png       |
      | checkout-address.png |

  @adw-995 @adw-zxqs2z-feat-the-reviewer-ru
  Scenario: After a failed review, the review agent of the next attempt is started with the paths of the re-test's images in its prompt, and with none of the earlier run's
    Given a workflow for issue 99512 in a "web" repository, with a recording issue tracker, code host and screenshot store
    And the workflow's worktree holds these scenarios, which the stand-in scenario runner reports with these outcomes and attachments:
      | feature file                             | scenario tags | scenario                       | outcome | attachments    |
      | features/per-issue/feature-99512.feature | @adw-99512    | The cart shows the order total | passed  | cart-total.png |
    And the stand-in review agent's verdict on its first review is the blocker "The order total leaves out the discount", and on every later review a pass
    When the scenario test phase runs and the review phase judges its proof
    And the stand-in scenario runner's next runs report these outcomes and attachments instead:
      | scenario                       | outcome | attachments               |
      | The cart shows the order total | passed  | cart-total-discounted.png |
    And the scenario test phase runs again and the review phase judges its new proof
    Then the review agent was started on review attempt 1 with the paths of exactly these images in its prompt, each of which existed when it started:
      | image          |
      | cart-total.png |
    And the review agent was started on review attempt 2 with the paths of exactly these images in its prompt, each of which existed when it started:
      | image                     |
      | cart-total-discounted.png |

  @adw-995 @adw-zxqs2z-feat-the-reviewer-ru
  Scenario Outline: In a "<type>" repository whose per-issue scenario <leaves>, the review agent is started with no image path in its prompt
    Given a workflow for issue <issue> in a "<type>" repository, with a recording issue tracker, code host and screenshot store
    And the workflow's worktree holds these scenarios, which the stand-in scenario runner reports with these outcomes and attachments:
      | feature file                               | scenario tags | scenario                    | outcome | attachments   |
      | features/per-issue/feature-<issue>.feature | @adw-<issue>  | The order total is reported | passed  | <attachments> |
      | features/regression/cart.feature           | @regression   | The cart page loads         | passed  | cart-page.png |
    And the stand-in review agent's verdict on every review is a pass
    When the scenario test phase runs and the review phase judges its proof
    Then the review agent was started on review attempt 1 with no image path in its prompt

    Examples:
      | issue | type | leaves            | attachments  |
      | 99513 | web  | opened no page    |              |
      | 99514 | cli  | attaches an image | terminal.png |

  @adw-995 @adw-zxqs2z-feat-the-reviewer-ru
  Scenario Outline: The review agent of a "<type>" repository is started with the review guidance section "<section>" in its prompt, and without the guidance section of the other application type
    Given a workflow for issue <issue> in a "<type>" repository, with a recording issue tracker, code host and screenshot store
    And the workflow's worktree holds these scenarios, which the stand-in scenario runner reports with these outcomes and attachments:
      | feature file                               | scenario tags | scenario                       | outcome | attachments |
      | features/per-issue/feature-<issue>.feature | @adw-<issue>  | The cart shows the order total | passed  |             |
    And the stand-in review agent's verdict on every review is a pass
    When the scenario test phase runs and the review phase judges its proof
    Then the review agent was started on review attempt 1 with the review guidance section "<section>" in its prompt
    And the review agent was started on review attempt 1 without the review guidance section "<other section>" in its prompt

    Examples:
      | issue | type | section          | other section    |
      | 99515 | cli  | CLI applications | Web applications |
      | 99516 | web  | Web applications | CLI applications |

  @adw-995 @adw-zxqs2z-feat-the-reviewer-ru
  Scenario: A ".adw/review_proof.md" left in a repository configures nothing: ADW reads the same project configuration with it as without it
    Given a repository whose ".adw/" holds a complete ADW configuration
    And a second repository whose ".adw/" holds the same configuration and also a ".adw/review_proof.md" that reads:
      """
      # Review Proof

      ## Tags

      | Tag                | Required  | Optional |
      | ------------------ | --------- | -------- |
      | @review-proof      | blocker   | no       |
      | @adw-{issueNumber} | tech-debt | yes      |

      ## Supplementary Checks

      | Name       | Command           | Severity |
      | ---------- | ----------------- | -------- |
      | Lint       | bun run lint      | blocker  |
      | Type check | bunx tsc --noEmit | blocker  |
      """
    When ADW reads the project configuration of each repository
    Then ADW read the same project configuration from both repositories

  @adw-995 @adw-zxqs2z-feat-the-reviewer-ru
  Scenario: The ADW TypeScript type-check passes once the reviewer runs nothing and the parser of ".adw/review_proof.md" is gone
    Then the ADW TypeScript type-check passes
