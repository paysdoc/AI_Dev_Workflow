# Classifier & Workflow Routing

## Overview

This module classifies GitHub issues into ADW workflow types and routes them to the correct orchestrator script and Claude model tier. It is the single chokepoint through which all four trigger paths (cron, issues.opened, issue_comment, dependency-closure) determine what to spawn and at what cost.

## Responsibilities

- Classifies issues via the `/classify_issue` AI skill (`classifyIssueForTrigger`, `classifyGitHubIssue`). Since #820, `classifyIssueForTrigger(issueNumber, deps)` takes a required, port-shaped `deps.fetchIssue: (issueNumber) => Promise<ClassifiableIssue>` (`ClassifiableIssue` = `Pick<Issue, 'number'|'title'|'body'|'labels'|'comments'>`, forge-neutral string labels) — no `repoInfo` parameter and no legacy default; the trigger caller (`webhookGatekeeper.ts`) supplies its own legacy-backed `fetchIssue` closure until #821 replaces it with a boundary tracker
- `adws/core/adwLabels.ts` (#820, moved from the now-deleted `adws/github/labelManager.ts`) holds the pure ADW label vocabulary the adw:* override reads: `ADW_*_LABEL` constants, `ADW_LABEL_DEFINITIONS`, `readAdwLabelNames`/`readAdwLabels`, `scenarioAuthoringSkipReason`, `shouldSkipScenarioAuthoring`, `hasRegressionPromotionLabel`, `hasWontFixLabelName`, `resolveAdwLabelDefinition`, `issueTypeToAdwLabel` — no I/O, no forge operation. `labelManager.ts` and `prApi.ts` are gone outright (#821, no re-export shim) — every caller (e.g. `adws/triggers/issueOpenedRouter.ts`, `adws/forge/adwLabelProvisioning.ts`) imports `adws/core/adwLabels.ts` directly
- `scenarioAuthoringSkipReason(labels)` returns which label (`regression-promotion` or `adw:none`) makes scenario authoring skip for an issue, or `null` when authoring should run; `shouldSkipScenarioAuthoring(labels)` is its boolean face. Both are pure reads of labels the caller already holds — no forge call. Consumed by `alignmentPhase.ts` and `scenarioPhase.ts` (`app_docs/feature-9gjajh-build-and-plan-phases.md` / `feature-9gjajh-test-and-scenario-phases.md`)
- Enforces deterministic `adw:*` label overrides before falling through to AI classification
- Scans existing issue comments for a previously-assigned ADW ID on retry paths
- Maps every slash command to a Claude model tier (opus / sonnet / haiku) and reasoning effort level
- Selects cost-optimized model and effort maps when the issue body contains `/fast` or `/cheap`
- Resolves which orchestrator script to spawn for a classified issue type (`getWorkflowScript`)
- Parses workflow stage, ADW ID, branch name, plan path, and PR URL out of GitHub comment bodies (pure, no API calls)
- Detects recovery state from a comment history to support workflow resume
- Identifies human directive comments: `## Continue`, `## Cancel`, `## Retry`

## Contracts & Invariants

- `classifyIssueForTrigger` never throws to callers — all errors default to `{ issueType: '/feature', success: false }`
- A single uncontested `adw:*` classification label always wins over AI classification; conflicting labels fall through to the LLM
- The last occurrence of a valid slash command in the AI output is used; earlier mentions are ignored
- `getWorkflowScript` always returns a string — unmapped types fall back to `adws/adwPlanBuildTest.tsx`
- `SLASH_COMMAND_MODEL_MAP` and `SLASH_COMMAND_EFFORT_MAP` are exhaustive over all `SlashCommand` values; both maps must stay in sync when new commands are added
- Haiku models must have `undefined` effort (the Claude API does not support the `--effort` flag for Haiku)
- `/patch`, `/resolve_failed_test`, `/resolve_failed_scenario`, `/validate_plan_scenarios`, and `/resolve_plan_scenarios` are not downgraded in fast mode
- `workflowCommentParsing.ts` is pure — it carries no GitHub API dependency; all GitHub I/O lives in `github/workflowCommentsBase.ts`
- `detectRecoveryState` treats a `completed` most-recent stage as non-resumable regardless of prior comment history
- ADW comments are identified by either the `## :emoji: Title` heading pattern or the `<!-- adw-bot -->` HTML marker

## Configuration

Fast/cheap mode is activated per-issue by the presence of `/fast` or `/cheap` (case-insensitive, whole-word) anywhere in the issue body. No external configuration file is read; all model and effort maps are static constants in `modelRouting.ts`.

## Gotchas

- `classifyGitHubIssue` does not apply the `adw:*` label override — only `classifyIssueForTrigger` does. Callers that use `classifyGitHubIssue` directly (e.g. bulk scans) bypass the label chokepoint.
- `classifyGitHubIssue(issue: ClassifiableIssue)` (#844) takes the same forge-neutral `ClassifiableIssue` shape `classifyIssueForTrigger`'s `deps.fetchIssue` already returned — `Pick<Issue, 'number'|'title'|'body'|'labels'|'comments'>`, string labels — not the GitHub-shaped record the pre-#844 `WorkflowConfig.issue` carried. Its only caller is `workflowInit.ts`, which now reads the issue through the boundary's `IssueTracker.fetchIssue`.
- The AI output parser takes the _last_ match of a valid slash command in the output, not the first. Preamble reasoning that mentions a command does not set the classification.
- `extractAdwIdFromComment` matches the `**ADW ID:** \`{id}\`` markdown pattern exactly; ADW IDs written in plain text or without backtick formatting are silently skipped.
- `detectRecoveryState` skips `error`, `paused`, and `resumed` stages when computing the highest completed stage, so a workflow paused mid-build correctly resumes from the build stage.
- `## Retry` only re-enters `merge_blocked` issues into `awaiting_merge`; it cannot recover issues stranded in `abandoned` state (see memory note on `adwMerge` abandoned/branchName issue).
- Branch name extraction in `extractBranchNameFromComment` only matches the canonical prefixes `feat`, `bug`, `chore`, `review`, `test`; non-canonical prefixes generated by the Claude skill are not matched here (see `branchPrefixAliases` in `issueRouting.ts` for the broader alias set used elsewhere).
