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

- app_docs/feature-implement-scenario-p-hpq6cn-scenario-planner-agent.md
  - Conditions:
    - When working with BDD scenario generation or the scenario agent
    - When modifying `adws/agents/scenarioAgent.ts` or `adws/phases/scenarioPhase.ts`
    - When working with `.adw/scenarios.md` configuration
    - When adding or modifying `@crucial` tag maintenance logic
