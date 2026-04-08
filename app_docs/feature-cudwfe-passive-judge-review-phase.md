# Passive Judge Review Phase

**ADW ID:** cudwfe-review-phase-rewrite
**Date:** 2026-04-08
**Specification:** specs/issue-401-adw-cudwfe-review-phase-rewrite-sdlc_planner-passive-judge-review-phase.md

## Overview

Rewrites the ADW review phase from a multi-agent, dev-server-launching executor into a single passive judge. The review agent now reads the `scenario_proof.md` artifact produced by `scenarioTestPhase`, calls one agent to judge the proof against issue requirements, and returns — no dev server, no screenshot capture, no UI navigation. The patch+retest retry loop moves out of the deleted `reviewRetry.ts` and into each calling orchestrator.

## What Was Built

- `adws/phases/reviewPhase.ts` — new passive judge review phase (`executeReviewPhase`) and patch cycle helper (`executeReviewPatchCycle`)
- Simplified `agents/reviewAgent.ts` — single-agent invocation, no `agentIndex`, no `applicationUrl`, no `screenshotPath`
- Deleted `agents/reviewRetry.ts` — retry logic is now orchestrator-level
- Rewritten `.claude/commands/review.md` — Strategy A+B only (no `prepare_app`, no UI navigation, no Strategy C)
- Orchestrator-level review retry loop wired into `adwSdlc`, `adwPlanBuildReview`, `adwPlanBuildTestReview`, `adwPrReview`, and `adwChore`
- Removed `REVIEW_AGENT_COUNT` constant from `core/config.ts`, `core/index.ts`, `README.md`, and `.env.sample`
- Removed `executeReviewPhase` from `workflowCompletion.ts` (now terminal-state handlers only)

## Technical Implementation

### Files Modified

- `adws/phases/reviewPhase.ts` *(new)*: passive judge (`executeReviewPhase`) + patch cycle helper (`executeReviewPatchCycle`)
- `adws/agents/reviewAgent.ts`: removed `agentIndex`, `applicationUrl`, `screenshotPath`; single agent invocation
- `adws/agents/reviewRetry.ts` *(deleted)*: retry loop moved to orchestrators
- `adws/agents/index.ts`: removed `reviewRetry` exports
- `adws/core/config.ts`: deleted `REVIEW_AGENT_COUNT` constant
- `.claude/commands/review.md`: Strategy A+B only; `scenarioProofPath` is `$3`
- `adws/phases/workflowCompletion.ts`: removed `executeReviewPhase`; only terminal handlers remain
- `adws/adwSdlc.tsx`: added scenario test/fix loop + review retry loop
- `adws/adwPlanBuildReview.tsx`: added scenario test phase + review retry loop
- `adws/adwPlanBuildTestReview.tsx`: added review retry loop, removed `executeReviewWithoutScenarios`
- `adws/adwPrReview.tsx`: added review phase + retry loop after scenario test/fix loop
- `adws/adwChore.tsx`: added review retry loop inside `regression_possible` path

### Key Changes

- **Single agent, no parallelism**: `runReviewAgent` no longer takes `agentIndex` or `applicationUrl`; always named `'Review'`, always one invocation.
- **Proof-file driven**: `executeReviewPhase` receives `scenarioProofPath` from the calling orchestrator (output of `scenarioTestPhase`). When empty, the review agent falls through to Strategy B or code-diff-only review.
- **`executeReviewPatchCycle` helper**: shared across all five orchestrators — patches each blocker via `runPatchAgent` → `runBuildAgent`, then commits and pushes once via `runCommitAgent` + `pushBranch`. Follows the same pattern as `scenarioFixPhase.ts`.
- **Orchestrator-level retry loop**: bounded by `MAX_REVIEW_RETRY_ATTEMPTS`. On failure: call `executeReviewPatchCycle` → re-run `scenarioTestPhase` → re-run `executeReviewPhase`.
- **No screenshots**: `screenshotPath` removed from `ReviewIssue`; `screenshots` in `ReviewResult` now contains the proof file path, not image paths.

## How to Use

The review phase is invoked automatically by each orchestrator after `scenarioTestPhase`. The orchestrator-level loop handles retries transparently.

1. `scenarioTestPhase` produces a `scenarioProofPath` (path to `scenario_proof.md`).
2. The orchestrator calls `executeReviewPhase(config, proofPath)`.
3. If `reviewPassed` is `false` and retries remain, the orchestrator calls `executeReviewPatchCycle(config, blockerIssues)`, re-runs `scenarioTestPhase`, then re-runs `executeReviewPhase`.
4. After `MAX_REVIEW_RETRY_ATTEMPTS` exhausted with failures, the orchestrator propagates the failed state.

To add the review retry loop to a new orchestrator, follow the pattern in `adwPlanBuildReview.tsx:72–104`:

```typescript
let reviewRetries = 0;
let reviewPassed = false;
let reviewBlockers: ReviewIssue[] = [];
for (let attempt = 0; attempt < MAX_REVIEW_RETRY_ATTEMPTS; attempt++) {
  const reviewFn = (cfg: WorkflowConfig) => executeReviewPhase(cfg, proofPath);
  const reviewResult = await runPhase(config, tracker, reviewFn);
  reviewPassed = reviewResult.reviewPassed;
  reviewBlockers = reviewResult.reviewIssues.filter(i => i.issueSeverity === 'blocker');
  if (reviewPassed) break;
  reviewRetries++;
  if (attempt < MAX_REVIEW_RETRY_ATTEMPTS - 1) {
    const patchWrapper = (cfg: WorkflowConfig) => executeReviewPatchCycle(cfg, reviewBlockers);
    await runPhase(config, tracker, patchWrapper);
    const retestResult = await runPhase(config, tracker, executeScenarioTestPhase);
    proofPath = retestResult.scenarioProof?.resultsFilePath ?? '';
  }
}
```

## Configuration

- `MAX_REVIEW_RETRY_ATTEMPTS` (env var, default: 3) — max iterations of the review → patch → retest loop per orchestrator run
- `REVIEW_AGENT_COUNT` is **removed** — no longer applicable

## Testing

The BDD acceptance scenarios for this feature are in `features/passive_judge_review_phase.feature` with step definitions in `features/step_definitions/passiveJudgeReviewPhaseSteps.ts`.

Run the full test suite:
```
bun run test
bun run lint
bunx tsc --noEmit
```

## Notes

- `totalRetries` in the `executeReviewPhase` return value is always `0` — the orchestrator's loop variable tracks the actual retry count.
- `applicationUrl` remains on `WorkflowConfig` for phases that need it (e.g., `scenarioTestPhase`); it is no longer consumed by review.
- The `getReviewScreenshotsDir` helper in `adwSdlc.tsx` has been deleted — review produces no screenshots.
- Edge case: when `adwPlanBuildReview` has no prior scenarios, `executeScenarioTestPhase` returns immediately with a passing result, so the retry loop still terminates cleanly.
