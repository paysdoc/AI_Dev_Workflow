# Core Type Definitions

## Overview

`adws/types/` is the central type registry for the ADW framework, defining the TypeScript interfaces, enums, and union types that cross module boundaries. It covers agent execution state, workflow lifecycle stages, issue classification, slash command routing, GitHub data models, and orchestrator dispatch maps.

## Responsibilities

- Define `AgentState` — the schema for `agents/{adwId}/state.json`, carrying adwId, issue number, branch name, plan file, PID liveness fields, workflow stage, phase map, and metadata.
- Define `AgentResult` — the structured return value of `runClaudeAgentWithCommand`, including success, output, cost, model usage, and interruption flags.
- Define error classes `RateLimitError`, `AgentTimeoutError`, and `AuthRequiredError` that propagate through the phase runner to trigger pause/resume, timeout handling, and auth-gate mechanics respectively.
- Define `AgentIdentifier` union (the complete set of named agents in the system) and `AgentExecutionStatus` / `AgentExecutionState` for per-agent tracking.
- Define `PhaseExecutionState` — per-phase status stored in `AgentState.phases`.
- Define `WorkflowStage` union — all valid lifecycle stage strings persisted in `workflowStage` field of `AgentState`.
- Define `PRReviewWorkflowStage` for the PR review sub-workflow.
- Define `IssueClassSlashCommand` (`/chore`, `/bug`, `/feature`, `/pr_review`, `/adw_init`) and `SlashCommand` (all commands understood by the agent framework).
- Define `VALID_ISSUE_TYPES` — the four issue types valid for automated workflow dispatch (`/adw_init` excluded).
- Define `issueTypeToOrchestratorMap`, `commitPrefixMap`, `branchPrefixMap`, and `branchPrefixAliases` routing tables.
- GitHub payload shapes (`GitHubUser`, `GitHubLabel`, `GitHubMilestone`, `GitHubComment`, `GitHubIssue`, `GitHubIssueListItem`, `IssueCommentSummary`, `PRReviewComment`, `PRDetails`, `PRListItem`, `RawPR`) moved to `adws/providers/github/domain/` in #817 — `adws/types/` keeps `PullRequestWebhookPayload` and `TargetRepoInfo`, which are ADW-domain shapes, not raw forge payloads.
- Define `RecoveryState` for resuming a workflow from a previous run.
- Define `TokenUsageSnapshot` for token-limit interruption bookkeeping.

## Contracts & Invariants

- `WorkflowStage` is a closed union; orchestrators must use only members of this union as `workflowStage` values in state writes.
- `/adw_init` is in `IssueClassSlashCommand` but excluded from `VALID_ISSUE_TYPES`; the classifier must never assign it, and orchestrator dispatch maps do not include it.
- `AgentIdentifier` is a closed string union; new agent types require an addition to the union to be accepted by `AgentState.agentName`.
- `AgentState.pid` is paired with `pidStartedAt` for PID-reuse-safe liveness; callers must record both atomically.
- `RateLimitError` carries a `phaseName` for log context; `AgentTimeoutError` carries `agentName`, `phaseName`, and `timeoutMs`; `AuthRequiredError` carries `agentName`.
- `branchPrefixAliases` maps each issue type to alternative prefixes that `findWorktreeForIssue` accepts when scanning existing worktrees.

## Configuration

No configuration. All types are static compile-time definitions.

## Gotchas

- `dataTypes.ts` is a stub re-export barrel for backward compatibility; its content is identical to `types/index.ts`. Prefer importing from specific source files (`issueTypes.ts`, `agentTypes.ts`, `workflowTypes.ts`, `issueRouting.ts`).
- `stack_incoherent` is a `WorkflowStage` member used only as a comment-stage discriminator; it is explicitly noted as "never persisted as workflowStage" in the source.
- `branchPrefixMap` uses conventional Git prefixes (`feature`, `bugfix`, `chore`, `review`, `adwinit`), but the LLM may produce aliases from `branchPrefixAliases` (e.g., `feat` for features).
- `AgentResult.costSource` distinguishes `'extractor_finalized'` (result message received, actual usage available) from `'extractor_estimated'` (streaming estimates only); callers that need precise cost must check this field.
