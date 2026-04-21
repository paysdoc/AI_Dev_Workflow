@adw-jm6pnw-push-adw-kpis
Feature: KPI phase commits and pushes the updated agentic_kpis.md file

  After the KPI agent writes updates to `app_docs/agentic_kpis.md`, the changes
  must be committed and pushed to the remote branch. Without a push, the KPI
  tracking data is lost when the worktree is cleaned up.

  Background:
    Given the ADW workflow has completed at least the plan and build phases
    And the KPI agent has successfully written updates to "app_docs/agentic_kpis.md"

  @adw-jm6pnw-push-adw-kpis @regression
  Scenario: KPI phase commits the updated agentic_kpis.md after agent completion
    Given the KPI agent has written changes to "app_docs/agentic_kpis.md"
    And the file has uncommitted changes in the working tree
    When the KPI phase finishes executing the agent
    Then a git commit is created that includes "app_docs/agentic_kpis.md"
    And the commit message references KPI tracking

  @adw-jm6pnw-push-adw-kpis @adw-486 @regression
  Scenario: KPI phase pushes the commit to the remote branch
    Given the KPI agent has written and committed changes to "app_docs/agentic_kpis.md"
    When the KPI phase push step executes
    Then the commit is pushed to the remote tracking branch
    And "app_docs/agentic_kpis.md" is visible on the remote branch

  @adw-jm6pnw-push-adw-kpis @regression
  Scenario: agentic_kpis.md is present in remote branch after full SDLC run
    Given an ADW SDLC workflow (plan + build + test + review + document + KPI) has completed
    When the remote branch is inspected
    Then "app_docs/agentic_kpis.md" exists in the remote branch
    And the file contains the ADW run entry for the current adwId

  @adw-jm6pnw-push-adw-kpis @adw-486
  Scenario: KPI commit and push failure is non-fatal and does not block workflow completion
    Given the KPI agent has written changes to "app_docs/agentic_kpis.md"
    And the git push command fails (e.g. network error or permission denied)
    When the KPI phase attempts to commit and push
    Then the error is caught and logged as a warning
    And the workflow continues to the completion step without throwing
    And the workflow completes successfully despite the push failure

  @adw-jm6pnw-push-adw-kpis
  Scenario: No commit is created when KPI agent produces no changes
    Given the KPI agent runs but "app_docs/agentic_kpis.md" already reflects the current run
    And there are no uncommitted changes to "app_docs/agentic_kpis.md"
    When the KPI phase commit step executes
    Then no new git commit is created
    And the push step is skipped

  @adw-jm6pnw-push-adw-kpis
  Scenario: No commit is created when the KPI agent itself fails
    Given the KPI agent fails to produce output
    When the KPI phase completes with a failed agent result
    Then no commit or push is attempted for "app_docs/agentic_kpis.md"
    And the KPI phase still returns without throwing (non-fatal)
