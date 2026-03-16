# Conditional Documentation

- README.md
  - Conditions:
    - When first understanding the project structure
    - When learning how to run ADW orchestrators

- adws/README.md
  - Conditions:
    - When you're operating in the `adws/` directory

- app_docs/feature-the-adw-is-too-speci-tf7slv-generalize-adw-project-config.md
  - Conditions:
    - When working with `.adw/` project configuration files
    - When implementing support for new target repository types
    - When troubleshooting ADW command generalization or project config loading
    - When modifying `adws/core/projectConfig.ts` or `.claude/commands/*.md` templates

- app_docs/feature-trigger-should-commi-f8jwcf-commit-push-cost-csv.md
  - Conditions:
    - When working with cost CSV tracking or cost file commit/push logic
    - When modifying `adws/github/gitOperations.ts` commit or push functions
    - When working on `handlePullRequestEvent()` in `adws/triggers/webhookHandlers.ts`
    - When using or modifying the `/commit_cost` slash command
    - When troubleshooting missing or uncommitted cost data after PR close

- app_docs/feature-add-resoning-effort-4wna6z-reasoning-effort-slash-commands.md
  - Conditions:
    - When working with `SLASH_COMMAND_EFFORT_MAP` or reasoning effort configuration
    - When modifying `runClaudeAgent()` or `runClaudeAgentWithCommand()` signatures
    - When adding a new slash command that needs an effort level assigned
    - When troubleshooting `--effort` flag not being passed to Claude CLI
    - When implementing fast/cheap mode effort overrides

- app_docs/feature-automatically-ccommi-wdlirj-auto-commit-cost-on-pr.md
  - Conditions:
    - When working with cost CSV rebuild or commit logic
    - When modifying `rebuildProjectCostCsv` in `adws/core/costCsvWriter.ts`
    - When working on PR close or issue close webhook handlers
    - When troubleshooting cost CSVs that were not rebuilt after a PR was rejected or closed
    - When implementing cost tracking changes that affect the merged vs closed-without-merge flow

- app_docs/feature-fix-review-process-8aatht-multi-agent-review-external-proof.md
  - Conditions:
    - When working with the review process or multi-agent review
    - When modifying `adws/agents/reviewAgent.ts` or `adws/agents/reviewRetry.ts`
    - When troubleshooting review proof generation or review failures

- app_docs/feature-8ar0fo-user-story-integrate-kpi-tracking.md
  - Conditions:
    - When working with KPI tracking or agentic metrics
    - When modifying workflow completion or reporting logic

- app_docs/feature-1773072529842-bmkqrg-jira-issue-tracker-provider.md
  - Conditions:
    - When working with Jira integration or issue tracker providers
    - When modifying `adws/providers/` provider types or interfaces

- app_docs/feature-1773073910340-o5ncqk-repo-context-factory.md
  - Conditions:
    - When working with the RepoContext factory or repo context abstraction
    - When modifying how agents interact with code host or issue tracker providers

- app_docs/feature-1773312009789-vruh95-migrate-phases-to-repo-context.md
  - Conditions:
    - When working with phase implementations in `adws/phases/`
    - When migrating phases to use RepoContext instead of direct GitHub calls

- app_docs/feature-1773328453611-p5xexp-running-token-totals.md
  - Conditions:
    - When working with token counting or cost tracking
    - When modifying `adws/core/tokenManager.ts` or cost reporting logic

- app_docs/feature-1773341233172-9jw507-gitlab-codehost-provider.md
  - Conditions:
    - When working with GitLab integration or CodeHost providers
    - When adding or modifying provider implementations in `adws/providers/`

- app_docs/feature-1773386463517-mvb88d-bdd-scenario-config.md
  - Conditions:
    - When working with `.adw/scenarios.md` or BDD scenario configuration
    - When implementing scenario-driven test phases
    - When working with `@adw-{issueNumber}` or `@crucial` tagging conventions

- app_docs/feature-1773073902212-9l2nv9-repo-context-factory.md
  - Conditions:
    - When working with `RepoContext`, `createRepoContext`, or `adws/providers/repoContext.ts`
    - When implementing workflow entry points that need validated repo context
    - When adding support for new provider platforms (IssueTracker or CodeHost)
    - When troubleshooting git remote validation or working directory validation errors
    - When configuring `.adw/providers.md` for a target repository

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

- app_docs/feature-implement-scenario-p-hpq6cn-scenario-planner-agent.md
  - Conditions:
    - When working with BDD scenario generation or the scenario agent
    - When modifying `adws/agents/scenarioAgent.ts` or `adws/phases/scenarioPhase.ts`
    - When working with `.adw/scenarios.md` configuration
    - When adding or modifying `@crucial` tag maintenance logic

- app_docs/feature-9emriw-bdd-scenario-review-proof.md
  - Conditions:
    - When working with the review proof mechanism or `crucialScenarioProof.ts`
    - When modifying `reviewRetry.ts` or `ReviewRetryOptions` scenario-related fields
    - When adding or changing `@crucial` / `@adw-{issueNumber}` scenario classification in review
    - When configuring `runCrucialScenarios` or `runScenariosByTag` commands in `.adw/commands.md`
    - When troubleshooting review proof fallback behaviour for repos without `.adw/scenarios.md`
