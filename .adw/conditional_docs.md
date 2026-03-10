# Conditional Documentation

- README.md
  - Conditions:
    - When operating on anything under src/
    - When first understanding the project structure
    - When you want to learn how to start the dev server

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

- app_docs/feature-add-provider-configu-te97mz-provider-config-adw.md
  - Conditions:
    - When working with `.adw/providers.md` or provider configuration
    - When modifying `adws/providers/repoContextFactory.ts`
    - When adding a new provider implementation

- app_docs/feature-add-issue-comments-f-6vrgn2-review-issue-comments.md
  - Conditions:
    - When working with review workflow stage comments (`review_running`, `review_passed`, `review_failed`, `review_patching`)
    - When modifying `formatWorkflowComment()` or `WorkflowContext` in `adws/github/workflowCommentsIssue.ts`
    - When modifying `runReviewWithRetry()` or `ReviewRetryOptions` in `adws/agents/reviewRetry.ts`
    - When troubleshooting missing or generic review-stage GitHub issue comments
    - When adding new review-related context fields to the workflow orchestrator
