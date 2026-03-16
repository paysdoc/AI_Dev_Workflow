@adw-3yayf1-cron-pr-polling-re-t
Feature: Cron PR polling filters ADW's own review submissions

  The cron trigger's `checkPRsForReviewComments()` must not treat ADW's own
  review submissions as unaddressed human feedback. Because ADW submits reviews
  via `gh` CLI authenticated as the user's personal GitHub account, those reviews
  have `user.type === 'User'` and bypass the existing bot filter. The fix must
  identify and exclude ADW-authored reviews so `adwPrReview` is only spawned
  when genuine human reviewers have left comments.

  Background:
    Given the cron trigger is running against a repository
    And ADW has completed a full workflow (plan → build → review) on a PR
    And the PR has no human review comments

  @adw-3yayf1-cron-pr-polling-re-t @regression
  Scenario: ADW review submission is not treated as unaddressed human feedback
    Given ADW has submitted a review on PR #42 from the authenticated user account
    And the review has `user.type` equal to "User" (not "Bot")
    And the review was submitted after the last ADW commit on the branch
    When `checkPRsForReviewComments()` polls PR #42
    Then `hasUnaddressedComments()` returns false for PR #42
    And `adwPrReview` is not spawned for PR #42

  @adw-3yayf1-cron-pr-polling-re-t @regression
  Scenario: Cron does not re-trigger adwPrReview after cron restart when only ADW reviews exist
    Given ADW has submitted a review on PR #42 and `processedPRs` is empty (fresh start)
    And there are no human review comments on PR #42
    When the cron trigger starts and `checkPRsForReviewComments()` runs for the first time
    Then `adwPrReview` is not spawned for PR #42
    And PR #42 is not added to `processedPRs`

  @adw-3yayf1-cron-pr-polling-re-t @regression
  Scenario: Genuine human review after ADW review does trigger adwPrReview
    Given ADW has submitted a review on PR #42
    And a human reviewer has subsequently left a review comment on PR #42
    And the human comment was submitted after the last ADW commit on the branch
    When `checkPRsForReviewComments()` polls PR #42
    Then `hasUnaddressedComments()` returns true for PR #42
    And `adwPrReview` is spawned for PR #42

  @adw-3yayf1-cron-pr-polling-re-t
  Scenario: ADW review author is identified by matching the authenticated GitHub login
    Given the authenticated GitHub user login is "adw-bot-user"
    And PR #42 has a review submitted by "adw-bot-user" with `user.type === 'User'`
    When `fetchPRReviewComments()` fetches comments for PR #42
    And the bot filter is applied in `getUnaddressedComments()`
    Then the review by "adw-bot-user" is excluded from human comments
    And the unaddressed comment count is 0

  @adw-3yayf1-cron-pr-polling-re-t
  Scenario: Non-ADW user review with matching type is still treated as human feedback
    Given the authenticated GitHub user login is "adw-bot-user"
    And PR #42 has a review submitted by "alice" with `user.type === 'User'`
    And the review was submitted after the last ADW commit on the branch
    When the bot filter is applied in `getUnaddressedComments()`
    Then the review by "alice" is included in human comments
    And `hasUnaddressedComments()` returns true for PR #42

  @adw-3yayf1-cron-pr-polling-re-t
  Scenario: ADW line-level review comments are also excluded from unaddressed count
    Given the authenticated GitHub user login is "adw-bot-user"
    And PR #42 has line-level comments submitted by "adw-bot-user" after the last ADW commit
    When `fetchPRReviewComments()` fetches all comments for PR #42
    And the bot filter is applied in `getUnaddressedComments()`
    Then line-level comments by "adw-bot-user" are excluded from the unaddressed count
    And `hasUnaddressedComments()` returns false for PR #42

  @adw-3yayf1-cron-pr-polling-re-t
  Scenario: Existing Bot-typed accounts continue to be filtered correctly
    Given PR #42 has a review submitted by a GitHub App account with `user.type === 'Bot'`
    When the bot filter is applied in `getUnaddressedComments()`
    Then the Bot-typed review is excluded from human comments
    And the existing bot filter behaviour is preserved
