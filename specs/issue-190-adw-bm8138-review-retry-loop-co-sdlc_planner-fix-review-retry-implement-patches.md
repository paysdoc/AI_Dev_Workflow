# Bug: Review retry loop patches are never implemented (plan-only cycle)

## Metadata
issueNumber: `190`
adwId: `bm8138-review-retry-loop-co`
issueJson: `{"number":190,"title":"Review retry loop: consolidate patch plans and implement before re-review","body":"## Problem\n\nThe review retry loop in `reviewRetry.ts` has two issues:\n\n1. **Patch plans are never implemented.** `runPatchAgent()` invokes the `/patch` command which only writes a plan file to `specs/patch/` — it does not make any code changes. The loop then calls `runCommitAgent()` + `pushBranch()`, which only commits the plan file itself. The subsequent re-review finds the same blockers, creating an endless cycle of plan-only patches. (The standalone `adwPatch.tsx` workflow correctly chains `runPatchAgent()` → `runBuildAgent()`, but `reviewRetry.ts` skips the build step.)\n\n2. **No consolidation across review agents.** Three review agents run in parallel and their issues are deduplicated by description, but each blocker still gets its own `runPatchAgent()` call. When multiple blockers are related or overlapping, this produces redundant patch plans that may conflict.\n\n## Expected Behavior\n\n1. **Consolidate** — after merging/deduplicating blocker issues from the 3 review agents, group them into the minimum set of unique patches needed.\n2. **Plan** — generate one patch plan per unique issue (as today, via `runPatchAgent()`).\n3. **Implement** — run `runBuildAgent()` for each patch plan to apply actual code changes, mirroring what `adwPatch.tsx` already does.\n4. **Commit + push** — commit the real code changes (not just the plan files).\n5. **Re-review** — loop back to the parallel review agents.\n\n## Scope\n\n- `adws/agents/reviewRetry.ts` — add `runBuildAgent()` after each `runPatchAgent()` call, passing the patch plan output as the plan file\n- Consider whether multiple related blockers can be batched into a single patch plan to reduce agent invocations and avoid conflicting changes\n- Ensure cost tracking includes the new build agent calls\n\n## References\n\n- Standalone patch workflow (correct pattern): `adws/adwPatch.tsx` lines 109–133\n- Review retry loop (missing build step): `adws/agents/reviewRetry.ts` lines 211–225\n- Patch command (plan-only): `.claude/commands/patch.md`","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-16T09:45:17Z","comments":[],"actionableComment":null}`

## Bug Description
The review retry loop in `adws/agents/reviewRetry.ts` calls `runPatchAgent()` to resolve review blockers, but this only generates a patch **plan file** in `specs/patch/` — it never implements the plan. The subsequent `runCommitAgent()` + `pushBranch()` only commits the plan file itself, not actual code changes. The re-review then finds the same blockers, creating an endless cycle of plan-only patches.

The standalone `adwPatch.tsx` workflow correctly chains `runPatchAgent()` → `runBuildAgent()`, but `reviewRetry.ts` skips the build step entirely.

**Actual behavior:** Review loop endlessly generates patch plan files without making code changes.
**Expected behavior:** After generating each patch plan, the build agent implements the plan, producing real code changes that are committed and pushed before re-review.

## Problem Statement
`reviewRetry.ts` lines 211–225 call `runPatchAgent()` for each blocker issue but never call `runBuildAgent()` to implement the resulting patch plan. This means only plan files (not code changes) are committed and pushed, causing the review to find the same blockers on every retry iteration.

## Solution Statement
Mirror the `adwPatch.tsx` pattern: after each `runPatchAgent()` call in the review retry loop, call `runBuildAgent()` with the patch plan output as the plan content. This requires:
1. Adding `runBuildAgent` import to `reviewRetry.ts`
2. Adding a `GitHubIssue` field to `ReviewRetryOptions` so the build agent has the issue context it needs
3. Calling `runBuildAgent()` after each successful `runPatchAgent()` call
4. Tracking cost for the new build agent invocations
5. Updating the caller in `workflowCompletion.ts` to pass the issue object

## Steps to Reproduce
1. Run any ADW workflow that reaches the review phase (e.g., `adwPlanBuildReview.tsx`)
2. Review agents find blocker issues
3. `runPatchAgent()` runs and creates a plan file in `specs/patch/`
4. `runCommitAgent()` commits only the plan file (no code changes)
5. `pushBranch()` pushes the plan file
6. Re-review finds the same blockers because no code was actually changed
7. Loop repeats until `maxRetries` is exhausted

## Root Cause Analysis
In `reviewRetry.ts` lines 211–225, the patching loop calls only `runPatchAgent()` which invokes the `/patch` slash command. The `/patch` command (`.claude/commands/patch.md`) explicitly creates a **plan file** and returns its path — it does not implement the plan. The `adwPatch.tsx` orchestrator correctly chains `runPatchAgent()` → `runBuildAgent()` (lines 109–133), but `reviewRetry.ts` was never updated to include the build step after the patch plan is generated.

The `runBuildAgent()` function (in `buildAgent.ts`) accepts a `GitHubIssue`, `logsDir`, and `planContent` string, then invokes `/implement` to apply the plan as actual code changes. This is the missing step in the review retry loop.

## Relevant Files
Use these files to fix the bug:

- `adws/agents/reviewRetry.ts` — **Primary fix target.** The review retry loop that needs `runBuildAgent()` added after `runPatchAgent()`. Lines 211–225 contain the patching section.
- `adws/agents/buildAgent.ts` — Contains `runBuildAgent()` which will be called to implement patch plans. Needs to be imported into `reviewRetry.ts`. Read to understand the function signature: `runBuildAgent(issue: GitHubIssue, logsDir: string, planContent: string, onProgress?, statePath?, cwd?)`.
- `adws/agents/patchAgent.ts` — Contains `runPatchAgent()`. Read to understand the return type (`AgentResult` with `output` containing the patch plan path/content).
- `adws/adwPatch.tsx` — **Reference implementation.** Lines 109–133 show the correct `runPatchAgent()` → `runBuildAgent()` chain to mirror.
- `adws/phases/workflowCompletion.ts` — Caller of `runReviewWithRetry()`. Needs to pass the `issue` object in the options.
- `adws/core/retryOrchestrator.ts` — Contains `trackCost()` and `initAgentState()` helpers used for cost tracking.
- `adws/types/issueTypes.ts` — Contains `GitHubIssue` type definition (lines 220–237).
- `app_docs/feature-fix-review-process-8aatht-multi-agent-review-external-proof.md` — Context doc for the multi-agent review architecture.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add `issue` field to `ReviewRetryOptions` interface
- In `adws/agents/reviewRetry.ts`, add a new required field `issue: GitHubIssue` to the `ReviewRetryOptions` interface (around line 38)
- Add the import for `GitHubIssue` from `../core` (it is re-exported through `adws/core/index.ts`)
- This provides the build agent with the issue context it needs (number, title, url, body)

### Step 2: Import `runBuildAgent` in `reviewRetry.ts`
- Add `import { runBuildAgent } from './buildAgent';` to the imports section of `adws/agents/reviewRetry.ts`

### Step 3: Add `runBuildAgent()` call after each `runPatchAgent()` in the retry loop
- In the patching loop (lines 211–225), after the `runPatchAgent()` call and its cost tracking, add a call to `runBuildAgent()` following the `adwPatch.tsx` pattern:
  - Only call `runBuildAgent()` if `patchResult.success` is true (the patch plan was generated successfully)
  - Pass the `issue` object (destructured from `opts` at the top of the function), `logsDir`, `patchResult.output` as `planContent`, `undefined` for `onProgress`, `initAgentState(statePath, 'build-agent')` for state tracking, and `cwd`
  - Track cost for the build result using `trackCost(buildResult as AgentRunResult, costState, statePath)`
  - Log the build agent outcome (success/failure) using the same pattern as the patch agent logging
- This mirrors the `adwPatch.tsx` pattern at lines 131–133:
  ```typescript
  const buildResult = await runBuildAgent(issue, logsDir, patchResult.output, undefined, undefined, cwd || undefined);
  ```

### Step 4: Update the caller in `workflowCompletion.ts` to pass the `issue` object
- In `adws/phases/workflowCompletion.ts`, in the `executeReviewPhase()` function, add `issue` to the `runReviewWithRetry()` options object (around line 94–122)
- The `issue` object is already available in the function scope from `config.issue` (destructured at line 81)

### Step 5: Update the `runReviewWithRetry` function to destructure the new `issue` field
- In the destructuring at the top of `runReviewWithRetry()` (line 107–111), add `issue` to the destructured fields from `opts`

### Step 6: Run validation commands
- Run the validation commands listed below to confirm the fix compiles, lints, and passes all checks with zero regressions.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bunx tsc --noEmit` — Type-check main project to verify no compilation errors from new imports and interface changes
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check adws module specifically
- `bun run lint` — Run linter to check for code quality issues
- `bun run build` — Build the application to verify no build errors

## Notes
- **Guidelines compliance:** All changes follow `guidelines/coding_guidelines.md` — pure functions, type safety, modularity, and clarity over cleverness.
- **No new libraries required.** All needed functions (`runBuildAgent`, `GitHubIssue` type) already exist in the codebase.
- **Consolidation note:** The issue mentions consolidating related blockers into fewer patch plans. The existing `mergeReviewResults()` already deduplicates by exact description match. True semantic grouping of related-but-different blockers would require an LLM call or fuzzy matching — this is a separate enhancement, not part of this bug fix. The current dedup already prevents identical blockers from producing duplicate patches.
- **Cost tracking:** The new `runBuildAgent()` calls are tracked via the same `trackCost()` helper used for patch and review agents, ensuring cost reporting is complete.
- **Agent identifier:** Use `'build-agent'` as the `AgentIdentifier` for `initAgentState()`. Verify this identifier exists in the `AgentIdentifier` union type in `adws/types/dataTypes.ts`; if not, add it.
