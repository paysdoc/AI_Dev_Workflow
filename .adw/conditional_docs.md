# Conditional Documentation

- README.md
  - Conditions:
    - When first understanding the project structure
    - When learning how to run the ADW pipeline

- adws/README.md
  - Conditions:
    - When operating in the `adws/` directory
    - When working with workflow orchestration scripts

- guidelines/coding_guidelines.md
  - Conditions:
    - Before implementing any code changes
    - When unsure about project conventions or patterns

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

- app_docs/feature-automatically-ccommi-wdlirj-auto-commit-cost-on-pr.md
  - Conditions:
    - When working with cost CSV revert or deletion logic
    - When modifying `revertIssueCostFile` or `rebuildProjectCostCsv` in `adws/core/costCsvWriter.ts`
    - When working on PR close or issue close webhook handlers
    - When troubleshooting cost CSVs that were not reverted after a PR was rejected or closed
    - When implementing cost tracking changes that affect the merged vs closed-without-merge flow
