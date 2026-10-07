@adw-994 @adw-eflw7o-feat-per-issue-scena
Feature: The proof assembler selects the images of the per-issue scenarios, and exactly those images reach the reviewer, the issue comment of each review attempt and the pull request

  A per-issue scenario is one its feature file tags "@adw-<issue>"; a regression scenario is one it tags "@regression".

  Background:
    Given the ADW codebase is checked out

  @adw-994 @adw-eflw7o-feat-per-issue-scena
  Scenario: The proof assembler selects the images the JUnit reports attach to per-issue scenarios, and leaves out regression images, attachments that are not images and files no test case attaches
    Given a scenario run for issue 9941 in a "web" repository
    And the scenario run's worktree holds the feature file "features/per-issue/feature-9941.feature":
      """
      @adw-9941
      Feature: Order total

        Scenario: The cart shows the order total
          Given the cart holds a lamp and a chair
          When the shopper opens the cart
          Then the cart shows the sum of their prices

        Scenario: The checkout page asks for a delivery address
          Given the cart holds a lamp
          When the shopper goes to the checkout
          Then the checkout page asks for a delivery address
      """
    And the scenario run's worktree holds the feature file "features/regression/cart.feature":
      """
      @regression
      Feature: Cart

        Scenario: The cart page loads
          When the shopper opens the cart
          Then the cart page shows its heading
      """
    And the scenario run's JUnit reports record these test cases, each named as the repository's scenario runner names it:
      | feature file                            | scenario                                      | outcome | attachments               |
      | features/per-issue/feature-9941.feature | The cart shows the order total                | passed  | cart-total.png, trace.zip |
      | features/per-issue/feature-9941.feature | The checkout page asks for a delivery address | passed  | checkout-address.jpeg     |
      | features/regression/cart.feature        | The cart page loads                           | passed  | cart-page.png             |
    And the scenario run of the tag "@adw-9941" also left "stray.png" and ".last-run.json" in its proof directory, attached to no test case
    When the proof assembler assembles the proof of the scenario run
    Then the proof assembler selects exactly these images:
      | image                 |
      | cart-total.png        |
      | checkout-address.jpeg |
    And the scenario proof does not state "no scenario opened a page"
    And the scenario proof does not state "no per-issue scenarios"

  @adw-994 @adw-eflw7o-feat-per-issue-scena
  Scenario: The proof assembler takes each scenario's tags from its feature file, the tags of its Feature included, so it selects per scenario and tells apart same-named scenarios of different features
    Given a scenario run for issue 9942 in a "web" repository
    And the scenario run's worktree holds the feature file "features/per-issue/feature-9942.feature":
      """
      @adw-9942
      Feature: Wish list

        Scenario: The page shows the saved products
          Given the shopper has saved a lamp
          When the shopper opens the wish list
          Then the wish list shows the lamp
      """
    And the scenario run's worktree holds the feature file "features/cart.feature":
      """
      Feature: Cart

        @regression
        Scenario: The page shows the saved products
          Given the cart holds a lamp
          When the shopper opens the cart
          Then the cart shows the lamp

        @adw-9942
        Scenario: The cart offers to move a product to the wish list
          Given the cart holds a lamp
          When the shopper opens the cart
          Then the lamp offers to move to the wish list
      """
    And the scenario run's JUnit reports record these test cases, each named as the repository's scenario runner names it:
      | feature file                            | scenario                                           | outcome | attachments   |
      | features/per-issue/feature-9942.feature | The page shows the saved products                  | passed  | wish-list.png |
      | features/cart.feature                   | The page shows the saved products                  | passed  | cart.png      |
      | features/cart.feature                   | The cart offers to move a product to the wish list | passed  | cart-move.png |
    When the proof assembler assembles the proof of the scenario run
    Then the proof assembler selects exactly these images:
      | image         |
      | wish-list.png |
      | cart-move.png |

  @adw-994 @adw-eflw7o-feat-per-issue-scena
  Scenario: The proof assembler selects the images of a Scenario Outline's rows by the tags of their Examples, so only the rows the issue added are evidence
    Given a scenario run for issue 9943 in a "web" repository
    And the scenario run's worktree holds the feature file "features/products.feature":
      """
      Feature: Product pages

        Scenario Outline: The <product> page shows its price
          When the shopper opens the page of the <product>
          Then the page shows the price of the <product>

          @adw-9943
          Examples: Added by this issue
            | product |
            | lamp    |
            | chair   |

          @regression
          Examples: Already covered
            | product |
            | table   |
      """
    And the scenario run's JUnit reports record these test cases, each named as the repository's scenario runner names it:
      | feature file              | scenario                       | outcome | attachments |
      | features/products.feature | The lamp page shows its price  | passed  | lamp.png    |
      | features/products.feature | The chair page shows its price | passed  | chair.png   |
      | features/products.feature | The table page shows its price | passed  | table.png   |
    When the proof assembler assembles the proof of the scenario run
    Then the proof assembler selects exactly these images:
      | image     |
      | lamp.png  |
      | chair.png |

  @adw-994 @adw-eflw7o-feat-per-issue-scena
  Scenario: In a "web" repository exactly the per-issue scenarios' images are uploaded, shown in the "Review Passed" comment and on the pull request, and handed to the review agent with the proof
    Given a workflow for issue 9944 in a "web" repository, with a recording issue tracker, code host and screenshot store
    And the workflow's worktree holds these scenarios, which the stand-in scenario runner reports with these outcomes and attachments:
      | feature file                            | scenario tags | scenario                                      | outcome | attachments          |
      | features/per-issue/feature-9944.feature | @adw-9944     | The cart shows the order total                | passed  | cart-total.png       |
      | features/per-issue/feature-9944.feature | @adw-9944     | The checkout page asks for a delivery address | passed  | checkout-address.png |
      | features/per-issue/feature-9944.feature | @adw-9944     | The cart API answers with the order total     | passed  |                      |
      | features/regression/cart.feature        | @regression   | The cart page loads                           | passed  | cart-page.png        |
    And every run of the stand-in scenario runner also leaves "stray.png" in its proof directory, attached to no test case
    And the stand-in review agent's verdict on every review is a pass
    When the scenario test phase runs and the review phase judges its proof
    And the proof is published on pull request 4944
    Then the screenshot store received exactly these images, and nothing else:
      | image                |
      | cart-total.png       |
      | checkout-address.png |
    And the "Review Passed" comment on issue 9944 shows exactly these images, each embedded from a URL the screenshot store returned for it:
      | image                |
      | cart-total.png       |
      | checkout-address.png |
    And the comments on pull request 4944 show exactly these images, each embedded from a URL the screenshot store returned for it:
      | image                |
      | cart-total.png       |
      | checkout-address.png |
    And the review agent received, with the proof, the paths of exactly these images:
      | image                |
      | cart-total.png       |
      | checkout-address.png |

  @adw-994 @adw-eflw7o-feat-per-issue-scena
  Scenario: After a failed review the re-test's images replace the earlier ones, and the comment of each review attempt shows exactly the per-issue images of the run it judged
    Given a workflow for issue 9945 in a "web" repository, with a recording issue tracker, code host and screenshot store
    And the workflow's worktree holds these scenarios, which the stand-in scenario runner reports with these outcomes and attachments:
      | feature file                            | scenario tags | scenario                       | outcome | attachments    |
      | features/per-issue/feature-9945.feature | @adw-9945     | The cart shows the order total | passed  | cart-total.png |
      | features/regression/cart.feature        | @regression   | The cart page loads            | passed  | cart-page.png  |
    And the stand-in review agent's verdict on its first review is the blocker "The order total leaves out the discount", and on every later review a pass
    When the scenario test phase runs and the review phase judges its proof
    And the stand-in scenario runner's next runs report these outcomes and attachments instead:
      | scenario                       | outcome | attachments               |
      | The cart shows the order total | passed  | cart-total-discounted.png |
      | The cart page loads            | passed  | cart-page-again.png       |
    And the scenario test phase runs again and the review phase judges its new proof
    Then the "Review Failed" comment on issue 9945 shows exactly these images, each embedded from a URL the screenshot store returned for it:
      | image          |
      | cart-total.png |
    And the "Review Passed" comment on issue 9945 shows exactly these images, each embedded from a URL the screenshot store returned for it:
      | image                     |
      | cart-total-discounted.png |

  @adw-994 @adw-eflw7o-feat-per-issue-scena
  Scenario: In a "web" repository whose per-issue scenarios opened no page, the gate passes, nothing is uploaded, the "Review Passed" comment shows no image and the proof the review agent receives states "no scenario opened a page"
    Given a workflow for issue 9946 in a "web" repository, with a recording issue tracker, code host and screenshot store
    And the workflow's worktree holds these scenarios, which the stand-in scenario runner reports with these outcomes and attachments:
      | feature file                            | scenario tags | scenario                                  | outcome | attachments   |
      | features/per-issue/feature-9946.feature | @adw-9946     | The cart API answers with the order total | passed  |               |
      | features/regression/cart.feature        | @regression   | The cart page loads                       | passed  | cart-page.png |
    And the stand-in review agent's verdict on every review is a pass
    When the scenario test phase runs and the review phase judges its proof
    Then the scenario proof records no blocker failures
    And nothing was uploaded to the screenshot store
    And the "Review Passed" comment on issue 9946 shows no image
    And the review agent received no image path with the proof
    And the proof the review agent received states "no scenario opened a page"

  @adw-994 @adw-eflw7o-feat-per-issue-scena
  Scenario: In a "cli" repository nothing is uploaded and no comment shows an image, even when the per-issue scenarios attach images, and the review agent receives no image path and no "no scenario opened a page" line
    Given a workflow for issue 9947 in a "cli" repository, with a recording issue tracker, code host and screenshot store
    And the workflow's worktree holds these scenarios, which the stand-in scenario runner reports with these outcomes and attachments:
      | feature file                            | scenario tags | scenario                          | outcome | attachments  |
      | features/per-issue/feature-9947.feature | @adw-9947     | The report command prints a total | passed  | terminal.png |
      | features/regression/report.feature      | @regression   | The report command starts         | passed  | report.png   |
    And the stand-in review agent's verdict on every review is a pass
    When the scenario test phase runs and the review phase judges its proof
    And the proof is published on pull request 4947
    Then nothing was uploaded to the screenshot store
    And the "Review Passed" comment on issue 9947 shows no image
    And no comment on pull request 4947 shows an image
    And the review agent received no image path with the proof
    And the proof the review agent received does not state "no scenario opened a page"

  @adw-994 @adw-eflw7o-feat-per-issue-scena
  Scenario Outline: In a "<type>" repository a failed scenario tagged "<failed tag>" is a blocker failure for that tag
    Given a workflow for issue <issue> in a "<type>" repository, with a recording issue tracker, code host and screenshot store
    And the workflow's worktree holds these scenarios, which the stand-in scenario runner reports with these outcomes and attachments:
      | feature file                               | scenario tags | scenario                       | outcome              | attachments |
      | features/per-issue/feature-<issue>.feature | @adw-<issue>  | The cart shows the order total | <per-issue outcome>  |             |
      | features/regression/cart.feature           | @regression   | The cart page loads            | <regression outcome> |             |
    When the scenario test phase runs
    Then the scenario proof records a blocker failure for the tag "<failed tag>"

    Examples:
      | issue | type | failed tag  | per-issue outcome | regression outcome |
      | 9951  | cli  | @adw-9951   | failed            | passed             |
      | 9952  | cli  | @regression | passed            | failed             |
      | 9953  | web  | @adw-9953   | failed            | passed             |
      | 9954  | web  | @regression | passed            | failed             |

  @adw-994 @adw-eflw7o-feat-per-issue-scena
  Scenario: The scenario test phase runs only "@regression" and the issue's own tag, and a failed per-issue scenario is a blocker failure, whatever the repository's ".adw/review_proof.md" configures
    Given a workflow for issue 9955 in a "cli" repository, with a recording issue tracker, code host and screenshot store
    And the workflow's ".adw/review_proof.md" holds:
      """
      # Review Proof

      ## Tags

      | Tag                | Required  | Optional |
      | ------------------ | --------- | -------- |
      | @review-proof      | blocker   | no       |
      | @adw-{issueNumber} | tech-debt | yes      |
      """
    And the workflow's worktree holds these scenarios, which the stand-in scenario runner reports with these outcomes and attachments:
      | feature file                            | scenario tags | scenario                       | outcome | attachments |
      | features/per-issue/feature-9955.feature | @adw-9955     | The cart shows the order total | failed  |             |
      | features/regression/cart.feature        | @regression   | The cart page loads            | passed  |             |
      | features/review.feature                 | @review-proof | The review page loads          | passed  |             |
    When the scenario test phase runs
    Then the stand-in scenario runner was asked for the tags "@regression" and "@adw-9955", and for no other tag
    And the scenario proof records a blocker failure for the tag "@adw-9955"

  @adw-994 @adw-eflw7o-feat-per-issue-scena
  Scenario Outline: An issue without per-issue scenarios never fails the gate in a "<type>" repository whose scenario runner, asked for the issue's tag, <answers>, and its proof states "no per-issue scenarios"
    Given a workflow for issue <issue> in a "<type>" repository, with a recording issue tracker, code host and screenshot store
    And the workflow's worktree holds these scenarios, which the stand-in scenario runner reports with these outcomes and attachments:
      | feature file                     | scenario tags | scenario            | outcome | attachments   |
      | features/regression/cart.feature | @regression   | The cart page loads | passed  | cart-page.png |
    And the stand-in scenario runner, asked for a tag no scenario carries, <answers>
    When the scenario test phase runs
    Then the scenario proof records no blocker failures
    And the scenario proof states "no per-issue scenarios"
    And the scenario proof <page line> "no scenario opened a page"

    Examples:
      | issue | type | answers                                                                          | page line      |
      | 9956  | cli  | exits 0 and writes a JUnit report with no test case                              | does not state |
      | 9957  | web  | exits 1 with "Error: No tests found" and writes a JUnit report with no test case | states         |
      | 9958  | web  | exits 1 with "Error: No tests found" and writes no JUnit report                  | states         |

  @adw-994 @adw-eflw7o-feat-per-issue-scena
  Scenario Outline: In a "<type>" repository a run of the issue's tag that ends without a JUnit report, while per-issue scenarios exist, is a blocker failure for that tag
    Given a workflow for issue <issue> in a "<type>" repository, with a recording issue tracker, code host and screenshot store
    And the workflow's worktree holds these scenarios, which the stand-in scenario runner reports with these outcomes and attachments:
      | feature file                               | scenario tags | scenario                       | outcome | attachments |
      | features/per-issue/feature-<issue>.feature | @adw-<issue>  | The cart shows the order total | passed  |             |
      | features/regression/cart.feature           | @regression   | The cart page loads            | passed  |             |
    And the stand-in scenario runner, asked for the tag "@adw-<issue>", exits 1 without printing anything or writing a JUnit report
    When the scenario test phase runs
    Then the scenario proof records a blocker failure for the tag "@adw-<issue>"

    Examples:
      | issue | type |
      | 9961  | cli  |
      | 9962  | web  |

  @adw-994 @adw-eflw7o-feat-per-issue-scena
  Scenario: The ADW TypeScript type-check passes once the proof assembler selects the visual evidence
    Then the ADW TypeScript type-check passes
