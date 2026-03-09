# Feature: Multi-Agent Review with Externalized Proof

## Metadata
issueNumber: `90`
adwId: `fix-review-process-8aatht`
issueJson: `{"number":90,"title":"Fix review process","body":"## Summary\nThe /review command is supposed to provide proof that the issue has been resolved precisely as the plan has stipulated. Both the review process itself and the proof are not sufficient.\n\n## Externalising the proof\nThe burden of proof is different for each application and therefore specifying it is the task of the application itself. Instead of hard coding the requirement of screenshots in .claude/commands/review.md, a .adw/review_proof.md should provide the /review command the necessary specs on what proof to produce and how to attach it to a pull request for a human reviewer to check.\n\n## Multiple agents\nLet 3 separate agents do the review in parallel, collect the results and findings. If there are blocking issues, fix those with /patch - a single agent is sufficient - and run the review again with 3 new agents. After each iteration, collect the proof of each agent and shut down the agent.\nOnce there are no blocking issues left, collate the proof, deduplicate it and make it available in the pull request.\n","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-06T14:21:31Z","comments":[],"actionableComment":null}`

## Feature Description
This feature overhauls the review process in ADW to address two key shortcomings:

1. **Externalized proof requirements**: Instead of hardcoding screenshot-based proof in `.claude/commands/review.md`, each target application defines its own proof requirements in `.adw/review_proof.md`. This file specifies what evidence to produce (screenshots, test output, API responses, etc.) and how to attach it to a pull request for human review.

2. **Multi-agent parallel review**: Instead of a single review agent, 3 independent review agents run in parallel for each review iteration. Their results are collected, deduplicated, and collated. If any blockers are found, a single patch agent fixes them, and a new round of 3 review agents runs. This continues until no blockers remain or max retries are exhausted.

## User Story
As a developer using ADW
I want the review process to use application-specific proof requirements and run multiple independent review agents in parallel
So that the review is more thorough, the proof is tailored to the application, and blockers are caught more reliably

## Problem Statement
The current review process has two problems:
1. The proof requirements (screenshots) are hardcoded in `.claude/commands/review.md`, but different applications need different types of proof (CLI apps don't need screenshots, API projects need response validation, etc.)
2. A single review agent may miss issues or produce incomplete proof. Running multiple agents in parallel increases coverage and confidence.

## Solution Statement
1. Create a new `.adw/review_proof.md` config file that target repositories can use to define their proof requirements. The `/review` command reads this file at runtime and follows its instructions instead of the hardcoded screenshot logic.
2. Refactor `reviewRetry.ts` to launch 3 review agents in parallel per iteration. Collect all results, merge and deduplicate findings. If blockers exist, patch them with a single patch agent, then launch 3 new review agents. Collate all proof across iterations and make it available in the PR.

## Relevant Files
Use these files to implement the feature:

- `guidelines/coding_guidelines.md` - Coding guidelines to follow strictly
- `.claude/commands/review.md` - The review slash command that needs to read `.adw/review_proof.md` instead of hardcoding screenshot proof. Core file being modified.
- `adws/agents/reviewAgent.ts` - The review agent runner. Needs to support parallel execution with distinct agent names.
- `adws/agents/reviewRetry.ts` - The review-patch retry loop. Needs major refactoring to run 3 agents in parallel, collect/merge results, and deduplicate proof.
- `adws/phases/workflowLifecycle.ts` - Contains `executeReviewPhase()` which calls `runReviewWithRetry()`. May need updates for new return shape.
- `adws/core/projectConfig.ts` - The project config loader. Needs to load `.adw/review_proof.md` content.
- `adws/core/jsonParser.ts` - JSON extraction utility used to parse review output.
- `adws/__tests__/reviewAgent.test.ts` - Existing tests for reviewAgent. Must be updated.
- `adws/__tests__/reviewRetry.test.ts` - Existing tests for reviewRetry. Must be updated for parallel agent logic.
- `adws/__tests__/projectConfig.test.ts` - Existing tests for projectConfig. Must be updated for review_proof.md loading.
- `adws/agents/claudeAgent.ts` - The Claude CLI runner. No changes expected, but important for understanding how agents are spawned.
- `adws/agents/patchAgent.ts` - The patch agent. No changes expected, but important for understanding the patch flow.
- `adws/core/retryOrchestrator.ts` - Retry utility functions (`trackCost`, `initAgentState`). No changes expected.
- `adws/agents/index.ts` - Agent barrel exports. May need new exports.
- `adws/phases/index.ts` - Phase barrel exports.

### New Files
- `.adw/review_proof.md` - Default review proof configuration for the ADW project itself. Serves as the reference example.
- `adws/__tests__/multiAgentReview.test.ts` - Tests for the new parallel review orchestration logic.

## Implementation Plan
### Phase 1: Foundation - Externalize Proof Requirements
- Add `.adw/review_proof.md` loading to `projectConfig.ts`
- Create the default `.adw/review_proof.md` for the ADW project
- Update `.claude/commands/review.md` to read and use `.adw/review_proof.md` instead of hardcoded screenshot instructions

### Phase 2: Core Implementation - Multi-Agent Parallel Review
- Refactor `reviewAgent.ts` to support unique agent names for parallel execution
- Create parallel review orchestration in `reviewRetry.ts`:
  - Launch 3 review agents concurrently with `Promise.all()`
  - Each agent gets a unique name (e.g., `review_agent_1`, `review_agent_2`, `review_agent_3`)
  - Collect all `ReviewAgentResult` objects
  - Merge and deduplicate `ReviewIssue` arrays across agents
  - Merge and deduplicate screenshots/proof across agents
  - Determine pass/fail from merged blocker issues
- If blockers found, run a single patch agent, commit, push, then launch 3 new review agents
- Once no blockers remain, collate all proof from all iterations

### Phase 3: Integration
- Update `executeReviewPhase()` in `workflowLifecycle.ts` if return shape changes
- Ensure cost tracking correctly aggregates across all 3 parallel agents per iteration
- Ensure model usage maps are merged across all agents
- Update all existing tests and add new tests for parallel review logic

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add review_proof.md loading to projectConfig.ts
- Read `adws/core/projectConfig.ts`
- Add a `reviewProofMd` field to the `ProjectConfig` interface (type: `string`, default: `''`)
- Update `getDefaultProjectConfig()` to include `reviewProofMd: ''`
- Update `loadProjectConfig()` to read `.adw/review_proof.md` from the target repo's `.adw/` directory
- Follow the same pattern as `conditionalDocsMd` loading (try-catch, empty string on missing)
- Update existing tests in `adws/__tests__/projectConfig.test.ts` to cover the new field

### Step 2: Create .adw/review_proof.md for the ADW project
- Create `.adw/review_proof.md` in the project root
- This file defines the proof requirements for the ADW project itself
- Content should specify:
  - What proof to produce: since ADW is a CLI/automation tool (no UI), proof should be code-diff verification, test output summaries, and spec compliance checks rather than screenshots
  - How to format the proof: structured text summaries in the review JSON output
  - How it gets attached to the PR: via the `reviewSummary` and `screenshots` fields in the review JSON
- This serves as the reference example for other projects that want to customize their review proof

### Step 3: Update .claude/commands/review.md to use externalized proof
- Read `.claude/commands/review.md`
- Replace the hardcoded screenshot-focused proof instructions with logic that reads `.adw/review_proof.md`
- Add a new section in the Instructions that:
  - Reads `.adw/review_proof.md` from the current working directory
  - If the file exists, follows its instructions for what proof to produce and how
  - If the file does not exist, falls back to the current default behavior (screenshot-based proof)
- Keep the JSON output structure (`ReviewResult`) unchanged so downstream consumers are not affected
- The `screenshots` array in the output can contain paths to any proof artifacts (not just screenshots)

### Step 4: Refactor reviewAgent.ts for parallel execution support
- Read `adws/agents/reviewAgent.ts`
- Update `runReviewAgent()` to accept an optional `agentIndex` parameter (number) for unique naming
  - When provided, use `review_agent_${agentIndex}` as the agent name
  - Use unique log file names: `review-agent-${agentIndex}.jsonl`
  - This ensures parallel agents don't write to the same log file or state path
- Update `formatReviewArgs()` to use the indexed agent name when `agentIndex` is provided
- Update tests in `adws/__tests__/reviewAgent.test.ts`

### Step 5: Implement parallel review in reviewRetry.ts
- Read `adws/agents/reviewRetry.ts`
- Add a constant `REVIEW_AGENT_COUNT = 3` for the number of parallel review agents
- Create a helper function `mergeReviewResults(results: ReviewAgentResult[]): { mergedIssues: ReviewIssue[]; mergedScreenshots: string[]; passed: boolean; blockerIssues: ReviewIssue[] }` that:
  - Collects all `reviewIssues` from all agents
  - Deduplicates issues by `issueDescription` similarity (exact match on trimmed lowercase)
  - Merges all `screenshots` arrays and deduplicates by path
  - Determines `passed` based on merged blocker count
  - Returns the merged blocker issues
- Refactor `runReviewWithRetry()`:
  - In each iteration of the retry loop, launch `REVIEW_AGENT_COUNT` review agents in parallel using `Promise.all()`
  - Each agent gets a unique index (1, 2, 3) passed to `runReviewAgent()`
  - Track cost for each agent result
  - Call `mergeReviewResults()` on all results
  - If no blockers: return success with merged proof
  - If blockers: run single patch agent per blocker (sequential, as today), commit, push, re-review
- Add a `collatedProof` field to `ReviewRetryResult` that accumulates all proof (screenshots, summaries) across iterations
- Update `ReviewRetryResult` interface to include `allScreenshots: string[]` and `allSummaries: string[]`
- Update tests in `adws/__tests__/reviewRetry.test.ts`

### Step 6: Create dedicated tests for multi-agent review
- Create `adws/__tests__/multiAgentReview.test.ts`
- Test `mergeReviewResults()`:
  - Merges issues from multiple agents
  - Deduplicates identical issues
  - Merges and deduplicates screenshots
  - Correctly identifies blockers from merged set
- Test parallel review flow:
  - 3 agents all pass on first try
  - 2 pass, 1 finds blocker -> patch -> 3 new agents all pass
  - All 3 find same blocker (deduplication)
  - Max retries exhausted
  - Cost accumulation across parallel agents

### Step 7: Update executeReviewPhase if needed
- Read `adws/phases/workflowLifecycle.ts` (the `executeReviewPhase` function)
- If `ReviewRetryResult` gained new fields (`allScreenshots`, `allSummaries`), surface them:
  - Pass screenshot paths to the document phase (already done via `getReviewScreenshotsDir`)
  - Ensure collated proof is available for PR comments
- Verify cost tracking still works correctly with parallel agents

### Step 8: Update agent barrel exports
- Read `adws/agents/index.ts`
- Ensure any new exports from `reviewAgent.ts` or `reviewRetry.ts` are re-exported
- Read `adws/phases/index.ts` and verify exports are complete

### Step 9: Run validation commands
- Run `bun run lint` to check for code quality issues
- Run `bunx tsc --noEmit` to verify no TypeScript errors
- Run `bunx tsc --noEmit -p adws/tsconfig.json` for additional type checks
- Run `bun run test` to validate all tests pass with zero regressions

## Testing Strategy
### Unit Tests
- **projectConfig.test.ts**: Test that `loadProjectConfig()` reads `.adw/review_proof.md` and populates `reviewProofMd`. Test fallback to empty string when file is missing.
- **reviewAgent.test.ts**: Test that `runReviewAgent()` with `agentIndex` uses unique agent names and log files. Test backward compatibility without `agentIndex`.
- **reviewRetry.test.ts**: Test parallel launch of 3 agents, result merging, deduplication, cost accumulation, and retry behavior.
- **multiAgentReview.test.ts**: Dedicated tests for `mergeReviewResults()` — deduplication logic, blocker detection from merged set, screenshot merging.

### Edge Cases
- `.adw/review_proof.md` does not exist — falls back to default screenshot-based behavior
- `.adw/review_proof.md` exists but is empty — uses default behavior
- All 3 review agents find the same blocker — deduplication produces 1 blocker
- One agent returns unparseable output (null reviewResult) — other agents' results are still used
- All 3 agents return unparseable output — treated as passed (matches current single-agent behavior)
- Cost tracking when one parallel agent fails but others succeed
- Max retries exhausted with parallel agents — returns all remaining blockers from merged results

## Acceptance Criteria
- `.adw/review_proof.md` is read by the `/review` command to determine proof requirements
- When `.adw/review_proof.md` is absent, the review falls back to the current default behavior
- `ProjectConfig` includes the `reviewProofMd` field populated from `.adw/review_proof.md`
- 3 review agents run in parallel per review iteration (not sequentially)
- Review issues from all agents are collected and deduplicated
- Screenshots/proof from all agents are merged and deduplicated
- A single patch agent handles blockers between iterations (not 3 patch agents)
- Cost and model usage are correctly accumulated across all parallel agents
- All existing tests pass with zero regressions
- New tests cover the parallel review logic and proof externalization

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` - Run linter to check for code quality issues
- `bunx tsc --noEmit` - Type check the main project
- `bunx tsc --noEmit -p adws/tsconfig.json` - Type check the adws module
- `bun run test` - Run all tests to validate zero regressions

## Notes
- IMPORTANT: The `guidelines/coding_guidelines.md` must be followed strictly. Key points: strict TypeScript, immutability, pure functions, files under 300 lines, declarative over imperative.
- The `REVIEW_AGENT_COUNT = 3` should be a named constant, not a magic number (per coding guidelines on enums/constants).
- The `mergeReviewResults()` function should be a pure function with no side effects, taking agent results as input and returning merged results.
- Deduplication of issues uses exact match on trimmed lowercase `issueDescription`. This is a simple approach; future iterations could use semantic similarity.
- The `screenshots` field in `ReviewResult` is repurposed to hold any proof artifact paths, not just screenshots. This is a semantic broadening that doesn't require a schema change.
- The `.adw/review_proof.md` file follows the same pattern as other `.adw/` config files (markdown with sections, loaded by `projectConfig.ts`).
