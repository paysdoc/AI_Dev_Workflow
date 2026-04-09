# PR Review: Distribute Board Move to Commit+Push Phase

**ADW ID:** f1f94g-pr-review-distribute
**Date:** 2026-04-09
**Specification:** specs/issue-421-adw-f1f94g-pr-review-distribute-sdlc_planner-distribute-board-move.md

## Overview

The PR review workflow's `BoardStatus.Review` move was centralized in `completePRReviewWorkflow`, contradicting the "completion handlers contain only terminal-state work" principle established by the test/review refactor PRD. This change moves the board move to `executePRReviewCommitPushPhase`, the natural "PR is now ready for review" boundary — consistent with how `prPhase.ts` handles the same transition in the main workflow.

## What Was Built

- `BoardStatus.Review` move relocated from `completePRReviewWorkflow` to `executePRReviewCommitPushPhase`
- Board move wrapped in try/catch for resilience (matching `prPhase.ts` pattern)
- `BoardStatus` import removed from `prReviewCompletion.ts`
- `completePRReviewWorkflow` docstring updated to remove stale "moves board status" claim
- Incidental: `AgentStateManager.initializeState` calls in `reviewPhase.ts` and `scenarioFixPhase.ts` replaced with direct `path.join` for agent state paths; `review-patch` and `scenario-fix` removed from `AgentIdentifier` union type

## Technical Implementation

### Files Modified

- `adws/phases/prReviewPhase.ts`: Added `BoardStatus` import; added board move block with try/catch after `postPRStageComment` in `executePRReviewCommitPushPhase`
- `adws/phases/prReviewCompletion.ts`: Removed `BoardStatus` import, removed board move block from `completePRReviewWorkflow`, updated JSDoc
- `adws/phases/reviewPhase.ts`: Replaced `AgentStateManager.initializeState` calls with `path.join('agents', adwId, '<agent-name>')` for review-agent, patch-agent, build-agent, and review-patch state paths
- `adws/phases/scenarioFixPhase.ts`: Same `AgentStateManager.initializeState` → `path.join` replacement for scenario-fix state paths
- `adws/types/agentTypes.ts`: Removed `'review-patch'` and `'scenario-fix'` from `AgentIdentifier` union

### Key Changes

- Board move now fires at the `executePRReviewCommitPushPhase` boundary — after `pushBranch` and `postPRStageComment('pr_review_pushed')` — so the tracker reflects "Review" as soon as the PR branch is pushed
- try/catch guard prevents a tracker API failure from crashing the commit+push phase, matching the resilience pattern in `prPhase.ts:91-96`
- `completePRReviewWorkflow` is now a pure terminal handler: cost section, state write, completion comment, and banner — no side effects on board status
- Agent state paths for review/patch/scenario phases now use `path.join` directly instead of `AgentStateManager.initializeState`, removing implicit coupling to the orchestrator state path

## How to Use

No API changes. The board move happens automatically during `executePRReviewCommitPushPhase`. After this change:

1. Run a PR review workflow as normal
2. The connected issue moves to `Review` board status when the PR branch is pushed (commit+push phase)
3. If the issue tracker API fails, the error is logged but the workflow continues

## Configuration

No configuration changes. Behaviour is gated on `repoContext && config.base.issueNumber`, same conditions as before.

## Testing

- `bun run lint` — zero lint errors
- `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json` — zero type errors
- `bun run build` — clean build
- Manual smoke test: run a PR review workflow against a real PR with a connected issue tracker and confirm the board moves to `Review` at the commit+push phase boundary, not at the completion phase

## Notes

- The original `completePRReviewWorkflow` code did not wrap the board move in try/catch; the new code in `prReviewPhase.ts` does, aligning it with the `prPhase.ts` pattern.
- `review-patch` and `scenario-fix` were removed from `AgentIdentifier` because those agent state paths are now constructed directly; they were no longer registered identifiers.
