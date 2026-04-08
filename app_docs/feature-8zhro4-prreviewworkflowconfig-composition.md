# PRReviewWorkflowConfig Composition Refactor

**ADW ID:** 8zhro4-prreviewworkflowconf
**Date:** 2026-04-08
**Specification:** specs/issue-396-adw-8zhro4-prreviewworkflowconf-sdlc_planner-prreviewworkflowconfig-composition.md

## Overview

Restructured `PRReviewWorkflowConfig` from a flat interface to a composition-based interface with a `base: WorkflowConfig` property. This pure type refactor removes field duplication between `PRReviewWorkflowConfig` and `WorkflowConfig`, and unblocks the next slice: migrating `adwPrReview` to use `phaseRunner`.

## What Was Built

- Redefined `PRReviewWorkflowConfig` to compose `WorkflowConfig` via a `base` field
- Updated `initializePRReviewWorkflow` to construct a full `WorkflowConfig` object as `base`
- Updated all phase functions in `prReviewPhase.ts` and `prReviewCompletion.ts` to destructure shared fields from `config.base`
- Updated `adwPrReview.tsx` orchestrator to access shared fields via `config.base.<field>`

## Technical Implementation

### Files Modified

- `adws/phases/prReviewPhase.ts`: Redefined `PRReviewWorkflowConfig` interface; updated `initializePRReviewWorkflow` to build a `WorkflowConfig` stub and return the composed shape; updated `executePRReviewPlanPhase` and `executePRReviewBuildPhase` destructuring patterns
- `adws/phases/prReviewCompletion.ts`: Updated `executePRReviewTestPhase`, `buildPRReviewCostSection`, `completePRReviewWorkflow`, and `handlePRReviewWorkflowError` to access shared fields via `config.base`
- `adws/adwPrReview.tsx`: Updated all shared-field accesses (`adwId`, `logsDir`, `orchestratorStatePath`, `worktreePath`, `installContext`, `totalModelUsage`) to use `config.base.<field>`

### Key Changes

- **New interface shape**: `PRReviewWorkflowConfig` now has `{ base: WorkflowConfig; prNumber; prDetails; unaddressedComments; ctx }` — PR-specific fields only at the top level
- **`base` construction**: `initializePRReviewWorkflow` builds a `WorkflowConfig` with a `GitHubIssue` stub from PR details, `issueNumber ?? 0` (to satisfy the `number` type), `defaultBranch` from `prDetails.baseBranch`, `branchName` from `prDetails.headBranch`, and an empty `RecoveryState`
- **`issueType` sentinel**: Uses `'/pr_review' as IssueClassSlashCommand` since PR reviews don't have a native issue type
- **Dual `ctx`**: `ctx: PRReviewWorkflowContext` is kept at the top level (shadowing `base.ctx`) so phase functions retain access to the PR-specific subtype; both point to the same object
- **Destructuring pattern**: All phase functions split their destructuring into `const { prNumber, prDetails, ... } = config;` (PR-specific) and `const { adwId, worktreePath, ... } = config.base;` (shared), preserving all local variable names so downstream code is unchanged

## How to Use

This is a structural refactor — the PR review workflow is invoked identically:

```bash
bunx tsx adws/adwPrReview.tsx <prNumber>
```

No behavioral change. The refactor is transparent to callers.

When **reading** `PRReviewWorkflowConfig` fields:
- PR-specific fields (`prNumber`, `prDetails`, `unaddressedComments`, `ctx`): access directly as `config.prNumber`
- Shared workflow fields (`adwId`, `logsDir`, `worktreePath`, `orchestratorStatePath`, `applicationUrl`, `repoContext`, `installContext`, `totalModelUsage`, `issueNumber`, etc.): access via `config.base.<field>`

## Configuration

No configuration changes. Existing `.env` variables and `.adw/config.json` remain unchanged.

## Testing

```bash
bunx tsc --noEmit                        # root type check
bunx tsc --noEmit -p adws/tsconfig.json  # ADW-specific type check
bun run lint
bun run build
```

Manual smoke test: run a PR review workflow against a real PR and confirm identical behavior to before the refactor.

## Notes

- This is a prerequisite for migrating `adwPrReview.tsx` to use `phaseRunner` (next slice), which requires `WorkflowConfig` to be separable from PR-specific fields.
- The `issueNumber ?? 0` pattern in `base` is intentional: `WorkflowConfig.issueNumber` requires `number`, but PR reviews may have no associated issue. Zero is a safe sentinel value.
- `base.ctx` and `config.ctx` point to the same `PRReviewWorkflowContext` object. Phase functions should use `config.ctx` to retain the PR-specific type; `base.ctx` exists only to satisfy `WorkflowConfig`'s shape.
