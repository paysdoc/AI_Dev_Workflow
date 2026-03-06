# Multi-Agent Review with Externalized Proof

**ADW ID:** fix-review-process-8aatht
**Date:** 2026-03-06
**Specification:** specs/issue-90-adw-fix-review-process-8aatht-sdlc_planner-multi-agent-review-with-external-proof.md

## Overview

This feature overhauls the ADW review process by externalizing proof requirements into a per-project `.adw/review_proof.md` config file and replacing the single review agent with 3 parallel agents per iteration. The merged, deduplicated results from all agents determine whether blockers exist, and a single patch agent handles fixes between iterations.

## What Was Built

- **`.adw/review_proof.md`** — New config file that target repositories use to define their proof requirements (code-diff verification, test output summaries, type-check, lint, spec compliance checklist)
- **Externalized proof in `/review` command** — `.claude/commands/review.md` now reads `.adw/review_proof.md` at runtime and follows its instructions instead of hardcoded screenshot logic; falls back to screenshots when the file is absent
- **`agentIndex` support in `reviewAgent.ts`** — `runReviewAgent()` accepts an optional `agentIndex` for unique naming (`review_agent_1`, `review_agent_2`, `review_agent_3`) and separate log files
- **`mergeReviewResults()` pure function** — Deduplicates review issues (by trimmed lowercase `issueDescription`) and screenshots (by path) from multiple agent results
- **Parallel review in `reviewRetry.ts`** — `runReviewWithRetry()` launches `REVIEW_AGENT_COUNT = 3` agents concurrently via `Promise.all()`, merges their results, patches blockers with a single patch agent, and accumulates all screenshots/summaries across iterations
- **`ReviewRetryResult` updated** — Replaces `reviewSummary?: string` with `allScreenshots: string[]` and `allSummaries: string[]`
- **`ProjectConfig` updated** — `loadProjectConfig()` now reads `.adw/review_proof.md` into a new `reviewProofMd` field
- **New agent identifiers** — `AgentIdentifier` type extended with `review-agent-1`, `review-agent-2`, `review-agent-3`
- **New test suite** — `adws/__tests__/multiAgentReview.test.ts` covers `mergeReviewResults()` and the parallel review flow

## Technical Implementation

### Files Modified

- `.claude/commands/review.md`: Added `Proof Requirements` section; `/review` reads `.adw/review_proof.md` and overrides default screenshot instructions when present
- `adws/agents/reviewAgent.ts`: Added optional `agentIndex` parameter for unique agent naming and log file per parallel instance
- `adws/agents/reviewRetry.ts`: Major refactor — parallel agent launch with `Promise.all()`, `mergeReviewResults()` pure function, `REVIEW_AGENT_COUNT` constant, updated `ReviewRetryResult` and `ReviewRetryOptions` interfaces
- `adws/core/projectConfig.ts`: Added `reviewProofMd` field to `ProjectConfig`; `loadProjectConfig()` reads `.adw/review_proof.md`
- `adws/phases/workflowLifecycle.ts`: Simplified `executeReviewPhase()` — removed `onPatchingIssue` callback and context properties that are no longer relevant
- `adws/types/agentTypes.ts`: Extended `AgentIdentifier` union with `review-agent-1`, `review-agent-2`, `review-agent-3`

### New Files

- `.adw/review_proof.md`: ADW project's own proof requirements (code-diff, test output, type-check, lint, spec compliance)
- `adws/__tests__/multiAgentReview.test.ts`: Dedicated tests for parallel review orchestration

### Updated Test Files

- `adws/__tests__/reviewAgent.test.ts`: Updated for `agentIndex` parameter
- `adws/__tests__/reviewRetry.test.ts`: Updated for parallel agent flow, result merging, and new `ReviewRetryResult` shape
- `adws/__tests__/projectConfig.test.ts`: Updated to cover `reviewProofMd` field loading
- `adws/__tests__/workflowPhases.test.ts`: Updated for simplified `executeReviewPhase` signatures

### Removed

- `adws/github/workflowCommentsIssue.ts`: Removed (issue comment functionality cleaned up)
- `adws/__tests__/workflowCommentsIssueReview.test.ts`: Removed with the above

### Key Changes

- **3 agents in parallel per review iteration** — `Promise.all()` over `agentIndices.map(index => runReviewAgent(..., index))`; cost is accumulated across all 3 results
- **Deduplication by exact lowercase match** — `mergeReviewResults()` uses a `Set<string>` on `issue.issueDescription.trim().toLowerCase()` and a `Set<string>` on screenshot paths
- **Fallback behavior preserved** — when `.adw/review_proof.md` is absent or empty, `/review` falls back to the original screenshot-based UI validation
- **Single patch agent between iterations** — only one patch agent runs per retry cycle regardless of how many agents found blockers
- **`screenshots` field semantically broadened** — now holds any proof artifact paths, not just screenshots; no schema change required

## How to Use

### For ADW itself (CLI project)

The `.adw/review_proof.md` already exists with the correct proof requirements. The `/review` command will automatically:

1. Run `bun run test` and summarize pass/fail results
2. Run `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json`
3. Run `bun run lint`
4. Verify the git diff matches spec acceptance criteria
5. Produce a spec compliance checklist in the `reviewSummary` field

### For other target projects

1. Create `.adw/review_proof.md` in the target repo's `.adw/` directory
2. Define your proof type (screenshots, test output, API responses, etc.)
3. Specify proof format and how artifacts are attached to the PR
4. On the next `/review` run, the command reads and follows your custom instructions

### Parallel review behavior (automatic)

The review process now automatically:

1. Launches 3 review agents concurrently for each review iteration
2. Merges their issues (deduplicating identical ones)
3. If blockers exist, runs one patch agent, commits, pushes, and starts a new parallel round
4. On success, returns `allScreenshots` and `allSummaries` accumulated across all iterations

## Configuration

- **`REVIEW_AGENT_COUNT`** (exported constant in `reviewRetry.ts`): Number of parallel agents per iteration, defaults to `3`
- **`.adw/review_proof.md`**: Per-project proof requirements; absent = screenshot fallback
- **`ProjectConfig.reviewProofMd`**: Populated by `loadProjectConfig()` from `.adw/review_proof.md`; empty string when file is missing

## Testing

```bash
bun run test                             # All tests including new multiAgentReview.test.ts
bunx tsc --noEmit                        # Type-check main project
bunx tsc --noEmit -p adws/tsconfig.json  # Type-check adws module
bun run lint                             # Lint check
```

Key test scenarios covered in `multiAgentReview.test.ts`:
- All 3 agents pass on first try
- 2 pass, 1 finds a blocker → patch → 3 new agents all pass
- All 3 agents find the same blocker (deduplication produces 1 blocker)
- Max retries exhausted
- Cost accumulation across parallel agents
- `mergeReviewResults()` deduplication logic

## Notes

- The `screenshots` array in `ReviewResult` is now semantically "proof artifacts", not exclusively screenshots. Downstream consumers are unaffected as the field type (`string[]`) and JSON key are unchanged.
- Deduplication uses exact trimmed lowercase match on `issueDescription`. Semantic deduplication is a future improvement.
- `onPatchingIssue` callback was removed from `ReviewRetryOptions` as context tracking of per-issue patch state is no longer needed with the merged approach.
- When all 3 agents return unparseable output (`reviewResult === null`), the iteration is treated as passed — consistent with the original single-agent behavior.
