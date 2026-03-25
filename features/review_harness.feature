@review-harness @regression
Feature: Review Phase End-to-End with Mock Infrastructure
  Exercises the review phase against a fixture target repo with all
  mock boundaries (Claude CLI stub, GitHub API mock, git remote mock)
  wired together by the test harness.

  Background:
    Given the mock infrastructure is running
    And the fixture repo "cli-tool" is initialized as a git repo

  @review-harness @regression
  Scenario: Review agent returns structured review result via CLI stub
    Given the Claude CLI stub is configured with the "review-agent-structured" payload
    When the Claude CLI stub is invoked with "/review" command
    Then the JSONL output should contain a valid assistant message
    And the assistant message text should contain a parseable ReviewResult JSON
    And the ReviewResult should have "success" equal to true
    And the ReviewResult should have 1 review issue with severity "tech-debt"

  @review-harness @regression
  Scenario: Review comment is posted to mock GitHub API
    Given the GitHub mock server has issue "42" configured
    When a review comment is posted to issue "42" with review proof data
    Then the mock server should have recorded a POST request to the issue comments endpoint
    And the recorded comment body should contain "Review passed"

  @review-harness @regression
  Scenario: Full review flow with fixture repo and all mocks
    Given the Claude CLI stub is configured with the "review-agent-structured" payload
    And the GitHub mock server has issue "42" configured
    When the review agent runs against the fixture repo for issue "42"
    Then the review should produce a structured ReviewResult
    And the ReviewResult should classify issues with correct severities
    And a comment should be posted to the mock GitHub API for issue "42"
    And the mock server recordings should contain the review proof data
