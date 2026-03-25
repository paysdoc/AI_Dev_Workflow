# Compaction Recovery for Test and Review Phases

**ADW ID:** u7lut9-extend-compaction-re
**Date:** 2026-03-25
**Specification:** specs/issue-299-adw-u7lut9-extend-compaction-re-sdlc_planner-compaction-recovery-test-review.md

## Overview

Issue #298 added compaction detection and restart for the build agent only. This feature extends the same recovery mechanism to the test and review phases, which are also long-running and can hit Claude Code context compaction. When compaction fires in these phases, the affected agent is killed, a phase-specific recovery comment is posted on the GitHub issue, and the agent is restarted with fresh context — without consuming a retry attempt.

## What Was Built

- Compaction detection in the **unit test retry loop** (`retryWithResolution`) — restarts the test runner or resolver agent without incrementing the retry counter
- Compaction detection in the **E2E test retry loop** — per-test-file restart loop mirrors the build-phase pattern
- Compaction detection in the **BDD scenario retry loop** — same per-scenario restart loop
- Compaction detection in the **review retry loop** (`runReviewWithRetry`) — individual per-agent restart for parallel review agents, patch agents, and build agents
- Two new `WorkflowStage` values: `test_compaction_recovery` and `review_compaction_recovery`
- New `PRReviewWorkflowStage` value: `pr_review_compaction_recovery`
- New GitHub issue comment formatters for each phase-specific compaction recovery event
- `continuationCount` propagated into phase cost records for both test and review phases
- `MAX_TOKEN_CONTINUATIONS` guard applied across all compaction restarts within a phase

## Technical Implementation

### Files Modified

- `adws/types/workflowTypes.ts`: Added `test_compaction_recovery`, `review_compaction_recovery` to `WorkflowStage`; added `pr_review_compaction_recovery` to `PRReviewWorkflowStage`
- `adws/core/workflowCommentParsing.ts`: Added `STAGE_HEADER_MAP` entries for the two new issue-workflow stages
- `adws/github/workflowCommentsIssue.ts`: Added `formatCompactionRecoveryComment`, `formatTestCompactionRecoveryComment`, `formatReviewCompactionRecoveryComment`; wired all three into `formatWorkflowComment()`
- `adws/core/retryOrchestrator.ts`: Added `compactionDetected` to `AgentRunResult`; added `onCompactionDetected` and `maxContinuations` to `RetryConfig`; added compaction detection after both `run()` and `resolveFailures()` in the retry loop; added `continuationCount` to `RetryResult`
- `adws/agents/testRetry.ts`: Added `onCompactionDetected` to `TestRetryOptions`; propagated compaction callback through all three test retry functions; added `continuationCount` to `TestRetryResult`; added per-resolver compaction while-loop in E2E and BDD paths
- `adws/agents/reviewRetry.ts`: Added `onCompactionDetected` to `ReviewRetryOptions`; added per-review-agent restart loop; added patch agent and build agent compaction restart loops; added `continuationCount` to `ReviewRetryResult`
- `adws/phases/testPhase.ts`: Passes `onCompactionDetected` callback to `runUnitTestsWithRetry`; posts `test_compaction_recovery` comment; propagates `continuationCount` into `createPhaseCostRecords`
- `adws/phases/workflowCompletion.ts`: Passes `onCompactionDetected` callback to `runReviewWithRetry`; posts `review_compaction_recovery` comment; propagates `continuationCount` into `createPhaseCostRecords`
- `adws/phases/prReviewCompletion.ts`: Passes `onCompactionDetected` callback to both `runUnitTestsWithRetry` and `runE2ETestsWithRetry`; posts `test_compaction_recovery` on the associated issue

### Key Changes

- **Opt-in via callback**: Compaction handling is only activated when `onCompactionDetected` is provided to a retry function. Phases that don't pass a callback behave identically to before (zero regression).
- **Shared continuation counter**: The `MAX_TOKEN_CONTINUATIONS` limit applies across all compaction and token-limit restarts in a single phase. The counter is threaded through `RetryConfig.maxContinuations` and returned in `RetryResult.continuationCount`.
- **Individual agent restarts for parallel review**: When one of N parallel review agents hits compaction, only that agent is restarted. The other agents' results are preserved and merged normally.
- **No continuation prompt for test/review**: Unlike the build phase (which builds a `buildContinuationPrompt`), test and review agents are simply re-invoked from scratch — they re-read the working tree and resolve tests/blockers fresh.
- **Cost accumulation preserved**: All `trackCost` calls execute before any continuation decision, so no cost data is lost across restarts.

## How to Use

This feature is automatic — no configuration is required. When a test or review agent hits context compaction:

1. The affected agent exits with `compactionDetected: true` on its result.
2. The retry loop detects the flag and increments the shared continuation counter.
3. A `test_compaction_recovery` or `review_compaction_recovery` comment appears on the GitHub issue, including the continuation number and ADW ID.
4. The agent is re-spawned with fresh context (the retry counter is not incremented).
5. If the restart limit (`MAX_TOKEN_CONTINUATIONS`) is exceeded, the phase throws a descriptive error.

## Configuration

No new configuration options are required. The `MAX_TOKEN_CONTINUATIONS` constant in `adws/core/config.ts` controls the maximum number of combined token-limit and compaction continuations per phase.

## Testing

The BDD feature file `features/compaction_recovery_test_review_phases.feature` covers the main scenarios with `@regression` tags:

```bash
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
```

Key scenarios exercised:
- Test phase restarts resolver on `compactionDetected = true`
- Test phase respects `MAX_TOKEN_CONTINUATIONS`
- Review phase restarts resolver on `compactionDetected = true`
- Review phase respects `MAX_TOKEN_CONTINUATIONS`
- `WorkflowStage` type includes both new stages
- Type checks pass with `bunx tsc --noEmit`

## Notes

- This feature depends on #298 (`compactionDetected` on `AgentResult` from `agentProcessHandler.ts`). The field was added there; no changes to `agentProcessHandler.ts` are needed here.
- The `pr_review_compaction_recovery` stage posts on the associated issue (via `config.issueNumber`), not on the PR itself, to keep recovery visibility on the issue timeline.
- For the review phase, `reviewContinuationCount` is initially set from the `onCompactionDetected` callback and then overwritten by `reviewResult.continuationCount` after the retry loop completes — the final value is always the authoritative count from the loop.
