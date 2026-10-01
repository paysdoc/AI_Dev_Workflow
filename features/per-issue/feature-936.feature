@adw-936 @adw-i9m7zh-bug-cost-records-hol
Feature: Cost records hold the CLI's reported cost and the token estimates, and a release merge that touches a Worker deploys it

  Computed cost: local pricing tables, the source of truth. Reported cost: the CLI's own figure.

  @adw-936 @adw-i9m7zh-bug-cost-records-hol
  Scenario: A cost record holds the CLI's figure as its reported cost, so the divergence check fires when the two costs differ by more than 5%
    Given cost comments are enabled
    And an agent run of the "plan" phase whose Claude CLI result message reports:
      | model                      | input | output | cache_read | cache_write | costUSD |
      | claude-sonnet-4-5-20250929 | 10000 | 2000   | 50000      | 4000        | 0.1200  |
    When the "plan" phase builds its cost records from its agent run
    Then the "plan" cost record for model "claude-sonnet-4-5-20250929" holds a reported cost of $0.1200
    And the "plan" cost record for model "claude-sonnet-4-5-20250929" holds a computed cost of $0.0900
    And the divergence check fires for the "plan" cost record for model "claude-sonnet-4-5-20250929"
    And the completion comment's cost section warns that "plan" on "claude-sonnet-4-5-20250929" computed $0.0900 against a reported $0.1200, a 25.0% difference

  @adw-936 @adw-i9m7zh-bug-cost-records-hol
  Scenario: The divergence check stays silent when the CLI's figure is within 5% of the computed cost
    Given cost comments are enabled
    And an agent run of the "plan" phase whose Claude CLI result message reports:
      | model                      | input | output | cache_read | cache_write | costUSD |
      | claude-sonnet-4-5-20250929 | 10000 | 2000   | 50000      | 4000        | 0.0920  |
    When the "plan" phase builds its cost records from its agent run
    Then the "plan" cost record for model "claude-sonnet-4-5-20250929" holds a reported cost of $0.0920
    And the "plan" cost record for model "claude-sonnet-4-5-20250929" holds a computed cost of $0.0900
    And the divergence check does not fire for the "plan" cost record for model "claude-sonnet-4-5-20250929"
    And the completion comment's cost section carries no cost divergence warning

  @adw-936 @adw-i9m7zh-bug-cost-records-hol
  Scenario: Each model's cost record reports that model's own figure from the result message, not the run's total cost
    Given an agent run of the "build" phase whose Claude CLI result message reports:
      | model                     | input | output | cache_read | cache_write | costUSD |
      | claude-opus-4-6           | 4000  | 1600   | 20000      | 3200        | 0.0900  |
      | claude-haiku-4-5-20251001 | 2000  | 400    | 10000      | 800         | 0.0060  |
    And that result message reports a total cost of $0.0960
    When the "build" phase builds its cost records from its agent run
    Then the "build" cost record for model "claude-opus-4-6" holds a reported cost of $0.0900
    And the "build" cost record for model "claude-haiku-4-5-20251001" holds a reported cost of $0.0060
    And the divergence check fires for no "build" cost record

  @adw-936 @adw-i9m7zh-bug-cost-records-hol
  Scenario: A phase whose model ran twice sums the CLI's figures, the computed costs and the actual token counts of both runs
    Given a first agent run of the "review" phase whose Claude CLI result message reports:
      | model                      | input | output | cache_read | cache_write | costUSD |
      | claude-sonnet-4-5-20250929 | 10000 | 2000   | 50000      | 4000        | 0.0920  |
    And a second agent run of the "review" phase whose Claude CLI result message reports:
      | model                      | input | output | cache_read | cache_write | costUSD |
      | claude-sonnet-4-5-20250929 | 5000  | 1000   | 25000      | 2000        | 0.0460  |
    When the "review" phase builds its cost records from its agent runs
    Then the "review" cost record for model "claude-sonnet-4-5-20250929" holds a reported cost of $0.1380
    And the "review" cost record for model "claude-sonnet-4-5-20250929" holds a computed cost of $0.1350
    And the "review" cost record for model "claude-sonnet-4-5-20250929" carries actual tokens:
      | input | output | cache_read | cache_write |
      | 15000 | 3000   | 75000      | 6000        |

  @adw-936 @adw-i9m7zh-bug-cost-records-hol
  Scenario: A run stopped before the CLI's result message holds no reported cost, so the divergence check does not compare the computed cost with itself
    Given an agent run of the "build" phase that streams these assistant turns for model "claude-sonnet-4-5-20250929" and is stopped before the Claude CLI writes its result message:
      | message id | input | cache_write | cache_read | text characters |
      | msg_1      | 6000  | 4000        | 30000      | 4000            |
    When the "build" phase builds its cost records from its agent run
    Then the "build" cost record for model "claude-sonnet-4-5-20250929" holds no reported cost
    And the "build" cost record for model "claude-sonnet-4-5-20250929" holds a computed cost of $0.0570
    And the divergence check does not fire for the "build" cost record for model "claude-sonnet-4-5-20250929"

  @adw-936 @adw-i9m7zh-bug-cost-records-hol
  Scenario: The cost API receives the CLI's figure as reported_cost_usd and the local computation as computed_cost_usd
    Given a cost API that records the cost records posted to it
    And an agent run of the "plan" phase whose Claude CLI result message reports:
      | model                      | input | output | cache_read | cache_write | costUSD |
      | claude-sonnet-4-5-20250929 | 10000 | 2000   | 50000      | 4000        | 0.1200  |
    When the "plan" phase builds its cost records from its agent run
    And the phase runner posts the "plan" phase's cost records to the cost API
    Then the cost API received a "plan" record for model "claude-sonnet-4-5-20250929" with reported_cost_usd 0.12 and computed_cost_usd 0.09

  @adw-936 @adw-i9m7zh-bug-cost-records-hol
  Scenario: The cost API totals a project's costs from the computed cost, never from the CLI's figure
    Given the cost API stores for project "acme-widgets" a "plan" record of issue 936 for model "claude-sonnet-4-5-20250929" with computed_cost_usd 0.09 and reported_cost_usd 0.12
    When the cost breakdown and the per-issue costs of project "acme-widgets" are requested from the cost API
    Then the cost API's cost breakdown gives model "claude-sonnet-4-5-20250929" a cost of $0.0900
    And the cost API's per-issue costs give the "plan" phase of issue 936 a cost of $0.0900

  @adw-936 @adw-i9m7zh-bug-cost-records-hol
  Scenario: A finished run's cost record carries the streamed estimate and the CLI's actual counts, and the completion comment reports one against the other
    Given cost comments are enabled
    And an agent run of the "plan" phase that streams these assistant turns for model "claude-sonnet-4-5-20250929":
      | message id | input | cache_write | cache_read | text characters |
      | msg_1      | 6000  | 4000        | 30000      | 4000            |
      | msg_2      | 4000  | 0           | 20000      | 2400            |
    And the agent run ends with a Claude CLI result message that reports:
      | model                      | input | output | cache_read | cache_write | costUSD |
      | claude-sonnet-4-5-20250929 | 10000 | 2000   | 50000      | 4000        | 0.0900  |
    When the "plan" phase builds its cost records from its agent run
    Then the "plan" cost record for model "claude-sonnet-4-5-20250929" carries estimated tokens:
      | input | output | cache_read | cache_write |
      | 10000 | 1600   | 50000      | 4000        |
    And the "plan" cost record for model "claude-sonnet-4-5-20250929" carries actual tokens:
      | input | output | cache_read | cache_write |
      | 10000 | 2000   | 50000      | 4000        |
    And the completion comment's cost section reports estimated against actual tokens for "plan" on "claude-sonnet-4-5-20250929":
      | token type  | estimated | actual | delta | delta % |
      | input       | 10,000    | 10,000 | +0    | 0.0%    |
      | output      | 1,600     | 2,000  | +400  | 25.0%   |
      | cache_read  | 50,000    | 50,000 | +0    | 0.0%    |
      | cache_write | 4,000     | 4,000  | +0    | 0.0%    |

  @adw-936 @adw-i9m7zh-bug-cost-records-hol
  Scenario: A run stopped before the CLI's result message carries its estimated tokens but no actual tokens, and the completion comment does not pass the estimate off as an actual count
    Given cost comments are enabled
    And an agent run of the "build" phase that streams these assistant turns for model "claude-sonnet-4-5-20250929" and is stopped before the Claude CLI writes its result message:
      | message id | input | cache_write | cache_read | text characters |
      | msg_1      | 6000  | 4000        | 30000      | 4000            |
    When the "build" phase builds its cost records from its agent run
    Then the "build" cost record for model "claude-sonnet-4-5-20250929" carries estimated tokens:
      | input | output | cache_read | cache_write |
      | 6000  | 1000   | 30000      | 4000        |
    And the "build" cost record for model "claude-sonnet-4-5-20250929" carries no actual tokens
    And the completion comment's cost section reports no estimated against actual tokens for "build" on "claude-sonnet-4-5-20250929"

  @adw-936 @adw-i9m7zh-bug-cost-records-hol
  Scenario: Replaying the release of 2026-07-30 — a release merge that changes both Workers marks both for deployment, although "main" then holds the same files as the default branch
    Given a throwaway repository whose default branch is "dev" and whose "main" holds the previous release
    And a commit on "dev" that is not yet on "main" changes "workers/cost-api/wrangler.toml"
    And a commit on "dev" that is not yet on "main" changes "workers/screenshot-router/wrangler.toml"
    When "dev" is merged into "main" with a merge commit, the way releases are merged
    And the change-detection step of the deploy workflow runs for the push of that merge to "main"
    Then a comparison of "main" with the default branch "dev" finds no changed file
    And the change detection marks the "cost-api" Worker for deployment
    And the change detection marks the "screenshot-router" Worker for deployment

  @adw-936 @adw-i9m7zh-bug-cost-records-hol
  Scenario Outline: A release merge that changes a file of one Worker marks that Worker, and only that Worker, for deployment
    Given a throwaway repository whose default branch is "dev" and whose "main" holds the previous release
    And a commit on "dev" that is not yet on "main" changes "<changed file>"
    When "dev" is merged into "main" with a merge commit, the way releases are merged
    And the change-detection step of the deploy workflow runs for the push of that merge to "main"
    Then the change detection marks the "<deployed>" Worker for deployment
    And the change detection leaves the "<not deployed>" Worker out of the deployment

    Examples:
      | changed file                           | deployed          | not deployed      |
      | workers/cost-api/src/queries.ts        | cost-api          | screenshot-router |
      | workers/screenshot-router/src/index.ts | screenshot-router | cost-api          |

  @adw-936 @adw-i9m7zh-bug-cost-records-hol
  Scenario: A release merge that changes neither a Worker nor the deploy workflow leaves both Workers out of the deployment
    Given a throwaway repository whose default branch is "dev" and whose "main" holds the previous release
    And a commit on "dev" that is not yet on "main" changes "README.md"
    When "dev" is merged into "main" with a merge commit, the way releases are merged
    And the change-detection step of the deploy workflow runs for the push of that merge to "main"
    Then the change detection leaves the "cost-api" Worker out of the deployment
    And the change detection leaves the "screenshot-router" Worker out of the deployment

  @adw-936 @adw-i9m7zh-bug-cost-records-hol
  Scenario: A release that brings several pull requests marks a Worker changed by an earlier one, not only by the last
    Given a throwaway repository whose default branch is "dev" and whose "main" holds the previous release
    And a pull request that changes "workers/screenshot-router/src/index.ts" has been merged into "dev" with a merge commit
    And a later pull request that changes "README.md" has been merged into "dev" with a merge commit
    When "dev" is merged into "main" with a merge commit, the way releases are merged
    And the change-detection step of the deploy workflow runs for the push of that merge to "main"
    Then the change detection marks the "screenshot-router" Worker for deployment
    And the change detection leaves the "cost-api" Worker out of the deployment

  @adw-936 @adw-i9m7zh-bug-cost-records-hol
  Scenario: A release that changes the deploy workflow marks both Workers for deployment, so the release carrying this fix deploys the cost API configuration of 2026-07-30
    Given a throwaway repository whose default branch is "dev" and whose "main" holds the previous release
    And a commit on "dev" that is not yet on "main" changes ".github/workflows/deploy-workers.yml"
    When "dev" is merged into "main" with a merge commit, the way releases are merged
    And the change-detection step of the deploy workflow runs for the push of that merge to "main"
    Then the change detection marks the "cost-api" Worker for deployment
    And the change detection marks the "screenshot-router" Worker for deployment

  @adw-936 @adw-i9m7zh-bug-cost-records-hol
  Scenario: A checkout that holds only the pushed merge commit never turns a Worker change into a silent skip
    Given a throwaway repository whose default branch is "dev" and whose "main" holds the previous release
    And a commit on "dev" that is not yet on "main" changes "workers/cost-api/wrangler.toml"
    When "dev" is merged into "main" with a merge commit, the way releases are merged
    And the change-detection step of the deploy workflow runs for the push of that merge to "main" in a checkout that holds only the pushed commit
    Then the change detection either fails or marks the "cost-api" Worker for deployment

  @adw-936 @adw-i9m7zh-bug-cost-records-hol
  Scenario: TypeScript type-check passes with cost records carrying the CLI's figure and the token estimates
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes

  @adw-936 @adw-i9m7zh-bug-cost-records-hol
  Scenario: The git/gh guard stays green with the deploy workflow's change detection in the repository
    When the git/gh guard is run across the repository
    Then the git/gh guard reports no violations
