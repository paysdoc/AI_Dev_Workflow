@adw-bm8138-review-retry-loop-co
Feature: Review retry loop consolidates blockers and implements patches before re-review

  The review retry loop must implement patch plans (not just generate them) and consolidate
  related blockers into the minimum set of patch invocations. Without the build step the loop
  commits only plan files and the re-review finds the same blockers indefinitely.

  Background:
    Given the ADW workflow is running a review-retry loop
    And the review retry loop has reached the patching phase

  @adw-bm8138-review-retry-loop-co @crucial
  Scenario: Build agent is called after each patch agent to implement the patch plan
    Given a blocker issue has been identified by the review agents
    And runPatchAgent has produced a patch plan file in "specs/patch/"
    When the patch phase processes the blocker
    Then runBuildAgent is called with the patch plan file as the plan argument
    And the build agent applies actual code changes to the repository
    And the subsequent commit contains code changes, not only a plan file

  @adw-bm8138-review-retry-loop-co @crucial
  Scenario: Re-review does not find the same blockers after a patch cycle
    Given a previous review iteration identified blocker issues
    And the patch phase ran runPatchAgent and runBuildAgent for each blocker
    When the next review iteration runs
    Then the previously identified blockers are no longer present
    And the retry loop makes forward progress toward a passing review

  @adw-bm8138-review-retry-loop-co @crucial
  Scenario: Related blocker issues are consolidated into a single patch invocation
    Given three review agents report overlapping blocker issues
    And two of the blockers share the same root cause or affected file
    When blockers are merged and deduplicated
    Then the overlapping blockers are grouped into a single patch invocation
    And runPatchAgent is called once for the consolidated group
    And runBuildAgent is called once for the consolidated patch plan

  @adw-bm8138-review-retry-loop-co
  Scenario: Distinct unrelated blocker issues each receive their own patch invocation
    Given three review agents report two distinct unrelated blocker issues
    When blockers are merged and deduplicated
    Then runPatchAgent is called once per distinct blocker issue
    And runBuildAgent is called once for each resulting patch plan
    And the patch invocations do not conflict with each other

  @adw-bm8138-review-retry-loop-co @crucial
  Scenario: Cost tracking includes build agent calls in the review retry loop
    Given the review retry loop has patched one blocker issue
    And runPatchAgent was called for the blocker
    And runBuildAgent was called for the resulting patch plan
    When the loop accumulates cost state
    Then the cost state includes the token usage from the build agent call
    And the final ReviewRetryResult.costUsd reflects both patch and build agent costs

  @adw-bm8138-review-retry-loop-co
  Scenario: Patch cycle commits real code changes before pushing
    Given a blocker issue has been patched and built
    When the commit and push step executes
    Then the committed files include the code changes applied by the build agent
    And the commit is not limited to plan files under "specs/patch/"
    And the pushed branch contains the implemented fix for the blocker

  @adw-bm8138-review-retry-loop-co
  Scenario: Patch agent failure does not prevent subsequent build agent calls for other blockers
    Given two blocker issues are queued for patching
    And runPatchAgent succeeds for the first blocker
    And runPatchAgent fails for the second blocker
    When the patch phase processes both blockers
    Then runBuildAgent is called for the first blocker's patch plan
    And runBuildAgent is not called for the second blocker (no plan to build)
    And the loop continues to the commit step with whatever changes were applied
