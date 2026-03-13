# Conditional Documentation Guide

This prompt helps you determine what documentation you should read based on the specific changes you need to make in the codebase.

## Instructions
- Read `.adw/conditional_docs.md` from the current working directory for project-specific conditional documentation
- If `.adw/conditional_docs.md` does not exist, there are no conditional documentation requirements for this project
- Review the task you've been asked to perform
- Check each documentation path in the conditional documentation
- For each path, evaluate if any of the listed conditions apply to your task
- IMPORTANT: Only read the documentation if any one of the conditions match your task
- IMPORTANT: You don't want to excessively read documentation. Only read the documentation if it's relevant to your task.

- app_docs/feature-1773072529842-bmkqrg-jira-issue-tracker-provider.md
  - Conditions:
    - When working with the Jira IssueTracker provider (`adws/providers/jira/`)
    - When implementing or extending IssueTracker providers for non-GitHub issue trackers
    - When configuring ADW to use Jira as the issue tracking backend
    - When troubleshooting Jira API authentication, ADF conversion, or status transitions
    - When adding support for a new issue tracker platform following the IssueTracker interface

- app_docs/feature-fix-review-process-8aatht-multi-agent-review-external-proof.md
  - Conditions:
    - When working with the review process or `reviewRetry.ts`
    - When implementing or modifying parallel agent orchestration
    - When adding or changing proof requirements for a target project (`.adw/review_proof.md`)
    - When troubleshooting multi-agent review failures or cost accumulation issues
    - When modifying `ProjectConfig` or `loadProjectConfig()` in `projectConfig.ts`

- app_docs/feature-1773073910340-o5ncqk-repo-context-factory.md
  - Conditions:
    - When working with `RepoContext`, `createRepoContext`, or `adws/providers/repoContext.ts`
    - When implementing workflow entry points that need validated repo context
    - When adding support for new provider platforms (IssueTracker or CodeHost)
    - When troubleshooting git remote validation or working directory validation errors
    - When configuring `.adw/providers.md` for a target repository

- app_docs/feature-1773073902212-9l2nv9-repo-context-factory.md
  - Conditions:
    - When working with `RepoContext`, `createRepoContext`, or `adws/providers/repoContext.ts`
    - When implementing workflow entry points that need validated repo context
    - When adding support for new provider platforms (IssueTracker or CodeHost)
    - When troubleshooting git remote validation or working directory validation errors
    - When configuring `.adw/providers.md` for a target repository

- app_docs/feature-1773312009789-vruh95-migrate-phases-to-repo-context.md
  - Conditions:
    - When working with workflow phases (`planPhase`, `buildPhase`, `testPhase`, `prPhase`, `documentPhase`, `workflowCompletion`, `prReviewPhase`, `prReviewCompletion`)
    - When adding a new workflow stage comment in any phase
    - When migrating or extending `WorkflowConfig` or `PRReviewWorkflowConfig` fields
    - When troubleshooting comment posting failures or missing status updates in workflows
    - When updating phase tests to use `makeRepoContext()` mock helper

- app_docs/feature-1773328453611-p5xexp-running-token-totals.md
  - Conditions:
    - When working with `WorkflowContext` or `PRReviewWorkflowContext` comment formatting
    - When adding a new field to issue or PR workflow comments
    - When implementing token or cost visibility features in ADW comments
    - When troubleshooting missing or unexpected running token footers in comments
    - When modifying orchestrators to thread data into `ctx` between phases

- app_docs/feature-8ar0fo-user-story-integrate-kpi-tracking.md
  - Conditions:
    - When working with the `/track_agentic_kpis` slash command or `app_docs/agentic_kpis.md`
    - When adding or modifying a KPI agent or KPI phase (`kpiAgent.ts`, `kpiPhase.ts`)
    - When troubleshooting missing KPI rows or incorrect metric calculations after a workflow run
    - When configuring the package manager used for inline KPI calculations (`.adw/commands.md`)
    - When implementing a new non-fatal workflow phase following the KPI phase pattern

- app_docs/feature-1773341233172-9jw507-gitlab-codehost-provider.md
  - Conditions:
    - When working with the GitLab CodeHost provider (`adws/providers/gitlab/`)
    - When implementing or extending CodeHost providers for non-GitHub code hosts
    - When configuring ADW to use GitLab as the code hosting backend
    - When troubleshooting GitLab API authentication, merge request creation, or review fetching
    - When adding support for a new code host platform following the CodeHost interface

- app_docs/feature-sinbtg-plan-scenario-validation-resolution.md
  - Conditions:
    - When working with `planValidationPhase`, `validationAgent`, or `resolutionAgent`
    - When implementing or modifying the plan-scenario alignment gate between planning and build
    - When adding new workflow stages related to BDD scenario validation
    - When troubleshooting plan-scenario mismatch failures or resolution loop exhaustion
    - When integrating the validation phase into a new orchestrator

- app_docs/feature-74itmf-dependency-logging.md
  - Conditions:
    - When working with `findOpenDependencies()` or `checkIssueEligibility()` in `adws/triggers/`
    - When adding or modifying logging in the dependency resolution pipeline
    - When troubleshooting why an issue was deferred due to blocking dependencies
    - When diagnosing silent failures in `getIssueState()` dependency lookups

- app_docs/feature-q9kms5-bdd-scenarios-before-pr.md
  - Conditions:
    - When working with `testPhase.ts` or the test phase execution order
    - When adding or modifying BDD scenario execution in workflows (`bddScenarioRunner.ts`, `runBddScenariosWithRetry`)
    - When configuring `## Run BDD Scenarios` in `.adw/commands.md` or `## Unit Tests` in `.adw/project.md`
    - When troubleshooting BDD scenario failures, retries, or the PR gate being blocked
    - When updating orchestrators to include or reorder the test phase relative to PR creation

- app_docs/feature-ak5lea-trigger-cron-process-prevent-duplicate-cron.md
  - Conditions:
    - When working with `trigger_cron.ts`, `webhookGatekeeper.ts`, or `cronProcessGuard.ts`
    - When troubleshooting duplicate cron processes running for the same repository
    - When implementing or modifying cron process lifecycle management in ADW
    - When the webhook server restarts and cron processes behave unexpectedly
    - When adding PID-file-based process deduplication to new trigger types

- app_docs/feature-hpq6cn-implement-scenario-p-scenario-planner-agent.md
  - Conditions:
    - When working with BDD scenario generation or the scenario agent
    - When modifying `adws/agents/scenarioAgent.ts` or `adws/phases/scenarioPhase.ts`
    - When working with `.adw/scenarios.md` configuration or scenario directory setup
    - When adding or modifying `@crucial` tag maintenance logic
    - When implementing a new non-fatal workflow phase following the scenario or KPI phase pattern

- app_docs/feature-9emriw-bdd-scenario-review-proof.md
  - Conditions:
    - When working with the review proof mechanism or `crucialScenarioProof.ts`
    - When modifying `reviewRetry.ts` or `ReviewRetryOptions` scenario-related fields
    - When adding or changing `@crucial` / `@adw-{issueNumber}` scenario classification in review
    - When configuring `runCrucialScenarios` or `runScenariosByTag` commands in `.adw/commands.md`
    - When troubleshooting review proof fallback behaviour for repos without `.adw/scenarios.md`
