# Feature: Generic Pipeline Runner with Rate Limit Pause/Resume

## Metadata
issueNumber: `314`
adwId: `chpy1a-orchestrator-refacto`
issueJson: `{"number":314,"title":"Orchestrator refactor: generic pipeline runner with rate limit pause/resume","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-25T23:28:40Z"}`

## Feature Description
Refactor all 12 ADW orchestrators into a single generic pipeline runner with declarative phase definitions, add rate limit detection and pause/resume mechanics so that workflows survive API outages without losing progress, and fix the cron trigger to re-evaluate previously-deferred and failed issues.

The current architecture has two problems: (1) the 12 orchestrator scripts contain significant duplication (modern ones already use `CostTracker + runPhase()`, but 4 outliers use manual state management), and (2) rate limits, API outages, and auth failures cause the workflow to crash and lose all progress.

## User Story
As an ADW operator
I want workflows to pause on rate limits and resume automatically when capacity returns
So that multi-phase workflows don't lose progress from transient API failures

## Problem Statement
When Claude CLI returns rate limit, billing limit, API outage, or auth failure messages, the ADW workflow posts an error comment and exits, wasting all prior phase progress. The 4 outlier orchestrators (adwBuild, adwPatch, adwPrReview, adwTest) don't use the modern `CostTracker + runPhase()` pattern, making it impossible to add cross-cutting concerns uniformly. The cron trigger's blanket `!hasAdwWorkflowComment(issue)` filter prevents re-evaluation of failed or paused workflows.

## Solution Statement
1. Extend `agentProcessHandler.ts` to detect rate limit strings and surface a `rateLimited` flag on `AgentResult`
2. Propagate that flag through `claudeAgent.ts` to callers
3. Add `handleRateLimitPause()` to `workflowCompletion.ts` that writes pause state and enqueues the workflow
4. Enhance the `runPhase()` function in `core/pipelineRunner.ts` to catch rate-limit errors and trigger the pause mechanism
5. Add resume logic to the cron trigger: probe for rate limit clearance, then respawn the orchestrator
6. Fix cron trigger filtering to re-evaluate issues with `error`, `paused`, `review_failed`, `build_failed` status comments
7. Add verbose poll logging and improve dependency extraction with keyword proximity parsing and in-memory caching
8. Migrate the 4 outlier orchestrators to the modern `CostTracker + runPhase()` pattern (minimum viable — they must use `initializeWorkflow` + `runPhase()`)

## Relevant Files
Use these files to implement the feature:

- `adws/agents/agentProcessHandler.ts` — Add rate limit string detection alongside existing auth and compaction detection
- `adws/agents/claudeAgent.ts` — Propagate `rateLimited` flag from `AgentResult` to callers (parallel to `authExpired` handling)
- `adws/types/agentTypes.ts` — Add `rateLimited?: boolean` to `AgentResult` interface
- `adws/core/phaseRunner.ts` — Enhance `runPhase()` to detect rate-limited phase results and trigger pause; add `OrchestratorDefinition` type
- `adws/phases/workflowCompletion.ts` — Add `handleRateLimitPause()` function for writing pause state + queue entry + GitHub comment
- `adws/phases/workflowInit.ts` — Read `completedPhases` from state.json on resume to support skip-completed-phases logic
- `adws/core/stateHelpers.ts` — Add helpers for reading/writing pause queue entries
- `adws/core/constants.ts` — Add `PROBE_INTERVAL_CYCLES` and `MAX_UNKNOWN_PROBE_FAILURES` config constants
- `adws/core/config.ts` — Add env var accessors for the new config constants
- `adws/triggers/trigger_cron.ts` — Add pause queue scanning, probing, resume spawning; fix issue re-evaluation filtering; add verbose poll logging
- `adws/triggers/issueDependencies.ts` — Add keyword proximity parser, `## Blocked by` heading, in-memory cache
- `adws/triggers/issueEligibility.ts` — No changes needed (already clean)
- `adws/github/workflowCommentsIssue.ts` — Add `paused` and `resumed` comment templates
- `adws/core/workflowCommentParsing.ts` — Add `paused` and `resumed` to `STAGE_ORDER` and `STAGE_HEADER_MAP`
- `adws/types/workflowTypes.ts` — Add `paused` and `resumed` to `WorkflowStage` union
- `adws/adwBuild.tsx` — Migrate to modern `initializeWorkflow + CostTracker + runPhase()` pattern
- `adws/adwPatch.tsx` — Migrate to modern pattern
- `adws/adwTest.tsx` — Migrate to modern pattern
- `adws/adwPrReview.tsx` — Migrate to modern pattern (keep `PRReviewWorkflowConfig` specifics)
- `adws/adwPlanBuild.tsx` — Reference implementation (already uses modern pattern)
- `adws/adwSdlc.tsx` — Reference implementation for parallel phases
- `guidelines/coding_guidelines.md` — Coding guidelines to follow

### New Files
- `adws/core/pauseQueue.ts` — Pause queue read/write/remove operations on `agents/paused_queue.json`
- `adws/triggers/pauseQueueScanner.ts` — Probe logic for paused workflows: spawn ping, evaluate result, resume or retry

## Implementation Plan
### Phase 1: Foundation — Rate Limit Detection + Types
Extend the agent layer to detect rate limit strings in Claude CLI output and propagate a `rateLimited` flag through the result chain. Add the `paused`/`resumed` workflow stages to the type system and comment templates. Add pause queue types and file operations.

### Phase 2: Core Implementation — Pause Mechanism + Pipeline Enhancement
Add `handleRateLimitPause()` to `workflowCompletion.ts`. Enhance `runPhase()` in `core/pipelineRunner.ts` to detect rate-limited results thrown by phases and trigger the pause. Create `pauseQueue.ts` for atomic file operations on the queue. The pipeline runner becomes the single point where all orchestrators get pause/resume behavior.

### Phase 3: Resume Mechanism — Cron Probe + Respawn
Add pause queue scanning to the cron trigger. Every N cycles, probe paused entries with a cheap Claude CLI ping. On success, respawn the original orchestrator script with the same adwId; it reads `completedPhases` from state.json and skips them. Handle stale entries (missing worktree/branch).

### Phase 4: Cron Trigger Fixes — Re-evaluation + Logging + Dependencies
Fix the blanket `!hasAdwWorkflowComment` filter to allow re-evaluation of failed/paused issues. Add verbose one-liner poll logging. Improve dependency extraction with keyword proximity parsing, `## Blocked by` heading support, and in-memory caching.

### Phase 5: Outlier Orchestrator Migration
Migrate adwBuild, adwPatch, adwTest to use `initializeWorkflow + CostTracker + runPhase()`. Keep adwPrReview's custom config but wire it through the same `runPhase()` for cost tracking. This ensures all orchestrators benefit from the pause/resume mechanism.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Task 1: Add `rateLimited` flag to AgentResult
- In `adws/types/agentTypes.ts`, add `rateLimited?: boolean` to the `AgentResult` interface (next to existing `authExpired` field)

### Task 2: Detect rate limit strings in agentProcessHandler.ts
- In `adws/agents/agentProcessHandler.ts`, add a `rateLimitDetected` boolean (same pattern as `authErrorDetected` and `compactionDetected`)
- In the `claude.stdout.on('data')` handler, check for these strings in the output text:
  - `"You've hit your limit"` — rate limit
  - `"You're out of extra usage"` — billing limit
  - `"502 Bad Gateway"` — Cloudflare outage
  - `"Invalid authentication credentials"` — transient API auth failure
- When detected, set `rateLimitDetected = true`, log the detection, and kill the process with SIGTERM
- In the `claude.on('close')` handler, when `rateLimitDetected` is true, resolve with `rateLimited: true` in the AgentResult (before the normal exit code checks, parallel to `tokenLimitReached` and `compactionDetected` blocks)

### Task 3: Propagate rateLimited in claudeAgent.ts
- In `adws/agents/claudeAgent.ts`, after the existing `authExpired` retry block, add a block that checks `result.rateLimited`
- Do NOT retry on rate limit — the whole point is to pause the workflow
- Just return the result as-is so the caller (phase) sees `rateLimited: true`

### Task 4: Add paused/resumed workflow stages
- In `adws/types/workflowTypes.ts`, add `'paused'` and `'resumed'` to the `WorkflowStage` union type
- In `adws/core/workflowCommentParsing.ts`:
  - Add `'paused'` and `'resumed'` to `STAGE_ORDER` (after `'error'`)
  - Add entries in `STAGE_HEADER_MAP`: `'⏸️ Paused'` → `'paused'` and `'▶️ Resumed'` → `'resumed'`
- In `adws/github/workflowCommentsIssue.ts`, add comment template functions for the `paused` and `resumed` stages:
  - `paused`: Show which phases completed, which phase was paused at, and the pause reason
  - `resumed`: Show that the workflow is resuming from the paused phase

### Task 5: Create pause queue module
- Create `adws/core/pauseQueue.ts` with:
  - `PausedWorkflow` interface: `{ adwId, issueNumber, orchestratorScript, pausedAtPhase, pauseReason: 'rate_limited' | 'unknown_error', pausedAt: string, lastProbeAt?: string, probeFailures?: number, worktreePath, branchName }`
  - `PAUSE_QUEUE_PATH` constant: `'agents/paused_queue.json'`
  - `readPauseQueue(): PausedWorkflow[]` — reads the file, returns empty array if missing
  - `appendToPauseQueue(entry: PausedWorkflow): void` — reads existing, appends, writes back atomically
  - `removeFromPauseQueue(adwId: string): void` — filters out the entry by adwId and writes back
  - `updatePauseQueueEntry(adwId: string, updates: Partial<PausedWorkflow>): void` — updates fields on a specific entry

### Task 6: Add pause config constants
- In `adws/core/config.ts`, add:
  - `PROBE_INTERVAL_CYCLES`: read from `process.env.PROBE_INTERVAL_CYCLES`, default `15` (= 5 min at 20s poll)
  - `MAX_UNKNOWN_PROBE_FAILURES`: read from `process.env.MAX_UNKNOWN_PROBE_FAILURES`, default `3`
- Export these from `adws/core/index.ts`

### Task 7: Implement handleRateLimitPause in workflowCompletion.ts
- Add `handleRateLimitPause(config: WorkflowConfig, pausedAtPhase: string, pauseReason: 'rate_limited' | 'unknown_error', costUsd?: number, modelUsage?: ModelUsageMap): never`
- Write `completedPhases` list and `pausedAtPhase` to state.json metadata
- Persist accumulated cost/tokens (same as `handleWorkflowError` does)
- Call `appendToPauseQueue()` with the workflow entry
- Post `paused` stage comment on the GitHub issue via `postIssueStageComment`
- Move issue board status to `InProgress`
- Write orchestrator state with execution status `'paused'` (new status — add to `AgentExecutionStatus` type in `agentTypes.ts`)
- Log and `process.exit(0)` (graceful exit, not error)

### Task 8: Create a RateLimitError class
- In `adws/core/phaseRunner.ts`, add a `RateLimitError` class extending `Error` with a `phaseName: string` field
- Phases that detect a rate-limited `AgentResult` should throw `RateLimitError` — but since phases don't currently check `rateLimited`, the detection needs to happen in the agent layer
- Instead: modify the relevant build/test/review agent runners to check `result.rateLimited` and throw `RateLimitError` when true. This is cleaner than modifying every phase.
- Key agent runners to modify: `runBuildAgent`, `runPatchAgent`, `runPullRequestAgent`, `runReviewWithRetry`, `runUnitTestsWithRetry`, `runBddScenariosWithRetry` — add a check after `handleAgentProcess` returns: if `result.rateLimited`, throw `new RateLimitError('phase-name')`
- Actually, simpler approach: modify `runClaudeAgentWithCommand` in `claudeAgent.ts` to throw `RateLimitError` when the result has `rateLimited: true`. This way ALL agents automatically get the behavior without changing each one individually.

### Task 9: Enhance runPhase to catch RateLimitError
- In `adws/core/phaseRunner.ts`, wrap the `fn(config)` call in `runPhase()` with a try/catch
- If the caught error is a `RateLimitError`:
  - Call `handleRateLimitPause(config, error.phaseName, 'rate_limited', tracker.totalCostUsd, tracker.totalModelUsage)`
  - This exits the process gracefully
- All other errors propagate normally to the orchestrator's catch block (which calls `handleWorkflowError`)

### Task 10: Support skip-completed-phases on resume
- In `adws/phases/workflowInit.ts`, when `recoveryState.canResume` is true, read the orchestrator state.json to check for `completedPhases` array in metadata
- Store the `completedPhases` list on `WorkflowConfig` (add `completedPhases?: string[]` field to `WorkflowConfig` interface)
- In `adws/core/phaseRunner.ts`, modify `runPhase()` to check if `config.completedPhases` includes the phase function's name before executing it. Challenge: PhaseFn doesn't carry a name.
- Better approach: add a `phaseName` parameter to `runPhase()`. When `config.completedPhases?.includes(phaseName)`, skip the phase and return a zero-cost `PhaseResult`. Log the skip.
- Update all orchestrator call sites to pass the phase name string as third argument (e.g., `runPhase(config, tracker, executeInstallPhase, 'install')`)
- Also update `runPhasesParallel()` to accept phase names

### Task 11: Record completedPhases in state.json after each phase
- In `CostTracker.persist()` (or in `runPhase`), after a phase completes successfully, append the phase name to a running `completedPhases` array and write it to state.json metadata
- This way, on resume, the pipeline knows which phases to skip

### Task 12: Create pauseQueueScanner.ts for cron
- Create `adws/triggers/pauseQueueScanner.ts` with:
  - `scanPauseQueue(cycleCount: number): Promise<void>` — main entry point called from cron
  - Every `PROBE_INTERVAL_CYCLES` cycles, iterate through paused entries
  - For each entry, run probe: `claude --print "ping" --model haiku --max-turns 1`
  - If probe succeeds (exit 0): rate limit lifted — call `resumeWorkflow(entry)`
  - If probe fails with rate limit text: still limited — update `lastProbeAt`, continue
  - If probe fails without rate limit text: increment `probeFailures`. If `>= MAX_UNKNOWN_PROBE_FAILURES`, remove from queue and post error comment
  - `resumeWorkflow(entry: PausedWorkflow)`: remove from queue, post `▶️ Resumed` comment, spawn the orchestrator script with `[issueNumber, adwId, --issue-type ...]` detached
  - Handle stale entries: if worktree path doesn't exist or branch is gone, remove from queue, post warning comment, optionally restart from scratch

### Task 13: Wire pause queue scanner into cron trigger
- In `adws/triggers/trigger_cron.ts`:
  - Import `scanPauseQueue` from `./pauseQueueScanner`
  - Add a `cycleCount` counter that increments each poll interval
  - Call `scanPauseQueue(cycleCount)` at the start of each `checkAndTrigger()` cycle

### Task 14: Fix cron trigger issue re-evaluation filtering
- In `adws/triggers/trigger_cron.ts`:
  - Remove the blanket `!hasAdwWorkflowComment(issue)` filter from `filterEligibleIssues()`
  - Replace with a status-aware check: parse the latest ADW comment on each issue to determine its stage
  - Re-eligible statuses: `error`, `paused`, `review_failed`, `build_failed` — these issues should be re-evaluated
  - `completed` issues should be excluded regardless
  - Issues with active/in-progress ADW comments (e.g., `implementing`, `review_running`) should still be excluded
  - Don't add dependency-deferred issues to the `processedIssues` set — only add issues that were actually spawned via `classifyAndSpawnWorkflow`

### Task 15: Add verbose poll logging to cron trigger
- In `adws/triggers/trigger_cron.ts`, replace the generic log messages in `checkAndTrigger()` with a one-liner per cycle:
  ```
  POLL: {total} open, {candidates} candidates [{issue list}], filtered: {filtered issue list with reasons}
  ```
- Build the filtered reasons map during filtering so each excluded issue has an annotation like `#299(active)`, `#298(processed)`, `#306(grace_period)`, `#300(completed)`

### Task 16: Improve dependency extraction with keyword proximity
- In `adws/triggers/issueDependencies.ts`:
  - Add a new `parseKeywordProximityDependencies(issueBody: string): number[]` function:
    - Find all `#N` references in the entire body
    - For each reference, check if any dependency keyword appears within N words (e.g., 10 words) before the reference: `blocked by`, `depends on`, `requires`, `prerequisite`, `after`, `waiting on`
    - Also extend the heading regex to match `## Blocked by`
  - Modify `extractDependencies()`:
    - First, try keyword proximity parsing (fast, no LLM)
    - Count total `#N` references in the body
    - If keyword proximity found fewer dependencies than total references, fall back to LLM extraction
    - This eliminates unnecessary LLM calls on every 20s poll cycle
  - Add in-memory cache keyed by `issueNumber + hash(body)`:
    - `const dependencyCache = new Map<string, number[]>()`
    - Before any extraction, check cache. On cache hit, return immediately.
    - After extraction, store in cache.

### Task 17: Migrate adwBuild.tsx to modern pattern
- Rewrite `adws/adwBuild.tsx` to use `initializeWorkflow()`, `CostTracker`, and `runPhase()`
- It should become ~30-40 lines, similar to `adwPlanBuild.tsx`
- Keep the same behavior: verify plan exists, run build agent, commit
- Remove all manual `AgentStateManager`, `postWorkflowComment`, and `persistTokenCounts` calls
- Note: adwBuild needs a custom "verify plan exists" pre-check before calling `executeBuildPhase`. This can be a simple inline check before the runPhase calls

### Task 18: Migrate adwPatch.tsx to modern pattern
- Rewrite `adws/adwPatch.tsx` to use `initializeWorkflow()`, `CostTracker`, and `runPhase()`
- Create a thin wrapper phase function for the patch step (call `runPatchAgent` + wrap result as `PhaseResult`)
- Phases: Patch → Build → Commit → PR
- Remove all manual state management

### Task 19: Migrate adwTest.tsx to modern pattern
- Rewrite `adws/adwTest.tsx` to use `initializeWorkflow()`, `CostTracker`, and `runPhase()`
- Wrap the existing test logic (unit tests + BDD scenarios) in `executeTestPhase()` which already exists
- This orchestrator is standalone (no PR, no plan), so it's essentially: Init → Test → Complete

### Task 20: Migrate adwPrReview.tsx to modern pattern
- `adwPrReview.tsx` uses a custom `PRReviewWorkflowConfig` — keep this but wire it through the same `runPhase()` for cost tracking consistency
- The migration here is lighter: ensure it uses `CostTracker` for cost accumulation so the pause mechanism can capture accumulated costs on exit
- If full migration to `WorkflowConfig` is too invasive, at minimum ensure the catch block calls `handleWorkflowError` and the rate limit path can trigger `handleRateLimitPause`

### Task 21: Run validation commands
- Run `bun run lint` to check for code quality issues
- Run `bunx tsc --noEmit` to verify TypeScript compiles without errors
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to verify the adws-specific TypeScript config
- Run `bun run build` to verify no build errors

## Testing Strategy
### Edge Cases
- Rate limit detected during the first phase (no completed phases to record)
- Rate limit detected during a parallel phase (both parallel phases should be treated as incomplete)
- Stale pause queue entry where worktree has been cleaned up
- Multiple paused workflows in the queue at once
- Probe succeeds but the orchestrator script is gone (deleted)
- Issue body changes between pause and resume (dependency cache should not return stale results)
- Cron trigger encounters an issue that was paused, then manually re-triggered while paused (duplicate queue entries)
- Resume with the same adwId when the state.json has completedPhases

## Acceptance Criteria
- [ ] Rate limit strings detected in Claude CLI output set `rateLimited: true` on `AgentResult`
- [ ] `claudeAgent.ts` does NOT retry on rate limit (unlike `authExpired`)
- [ ] `runPhase()` catches `RateLimitError` and triggers `handleRateLimitPause`
- [ ] Paused workflows write `completedPhases` and `pausedAtPhase` to state.json
- [ ] Paused workflows append to `agents/paused_queue.json`
- [ ] GitHub issue gets a `⏸️ Paused` comment with phase progress
- [ ] Cron trigger probes paused entries every 15 cycles (5 min)
- [ ] Successful probe triggers resume: removes from queue, posts `▶️ Resumed`, spawns orchestrator
- [ ] Resumed orchestrator reads `completedPhases` and skips them
- [ ] Cron re-evaluates issues with `error`, `paused`, `review_failed`, `build_failed` status
- [ ] Cron logs verbose one-liner per cycle with candidates and filter reasons
- [ ] Dependency extraction uses keyword proximity parsing before LLM fallback
- [ ] Dependency extraction results are cached in-memory per issue body hash
- [ ] All 4 outlier orchestrators (adwBuild, adwPatch, adwTest, adwPrReview) use CostTracker + runPhase()
- [ ] No regression: existing workflows (adwPlanBuild, adwSdlc, etc.) work unchanged
- [ ] TypeScript compiles without errors
- [ ] Linter passes

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type-check root TypeScript configuration
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check adws-specific TypeScript configuration
- `bun run build` — Build the application to verify no build errors

## Notes
- Follow `guidelines/coding_guidelines.md` strictly: prefer immutability, use `const` over `let`, avoid decorators, use pure functions where possible
- The `runPhase()` signature change (adding `phaseName` parameter) is a breaking change for all existing orchestrator call sites — update them all in the same commit to avoid partial breakage
- The `RateLimitError` approach (thrown from `runClaudeAgentWithCommand`) means ALL agent invocations automatically get rate limit detection — no need to modify each individual agent runner
- The `completedPhases` mechanism is phase-name-based, not stage-based. This is orthogonal to the existing `RecoveryState` which uses GitHub comment parsing. Both can coexist: `RecoveryState` handles resuming from a crash (no clean exit), while `completedPhases` handles resuming from a clean pause
- `handleRateLimitPause` exits with code 0 (graceful), unlike `handleWorkflowError` which exits with code 1. This distinction matters for cron process management
- The pause queue file (`agents/paused_queue.json`) is shared across all repos/workflows. Use atomic read-modify-write to avoid race conditions between concurrent cron processes
- The `adwPrReview.tsx` migration is intentionally lighter than the other 3 outliers because it uses `PRReviewWorkflowConfig` which has a different shape than `WorkflowConfig`. Full unification of these config types is out of scope for this issue.
