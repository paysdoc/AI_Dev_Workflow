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
