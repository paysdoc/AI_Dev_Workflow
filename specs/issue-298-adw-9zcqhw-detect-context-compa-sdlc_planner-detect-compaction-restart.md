# Feature: Detect context compaction and restart build agent with fresh context

## Metadata
issueNumber: `298`
adwId: `9zcqhw-detect-context-compa`
issueJson: `{"number":298,"title":"Detect context compaction and restart build agent with fresh context","body":"## Problem\n\nWhen the build agent runs long enough for Claude Code to hit its context window limit, Claude Code automatically compacts (compresses) the conversation context. This is lossy — the agent continues working with a degraded summary of prior context instead of the full conversation history. This leads to lower quality output: the agent may redo work, miss context, or make incorrect assumptions.\n\nThe compaction sequence in the JSONL stream looks like:\n```json\n{\"type\":\"system\",\"subtype\":\"status\",\"status\":\"compacting\",...}\n{\"type\":\"system\",\"subtype\":\"status\",\"status\":null,...}\n{\"type\":\"system\",\"subtype\":\"compact_boundary\",\"compact_metadata\":{\"trigger\":\"auto\",\"pre_tokens\":167101},...}\n{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"This session is being continued from a previous conversation...\"}]},\"isSynthetic\":true}\n```\n\n## Solution\n\nDetect context compaction in the JSONL stream and restart the build agent with fresh context, reusing the existing token-limit continuation mechanism.\n\n### Implementation\n\n1. **agentProcessHandler.ts** — In the claude.stdout.on('data') handler (alongside existing auth error and token limit detection), detect \"subtype\":\"compact_boundary\" in the stream. Set a compactionDetected flag and kill the process with SIGTERM.\n\n2. **AgentResult type** — Add compactionDetected?: boolean field to the AgentResult interface.\n\n3. **buildPhase.ts** — Handle buildResult.compactionDetected in the existing continuation while loop, identically to tokenLimitExceeded:\n   - Increment the shared continuation counter\n   - Call buildContinuationPrompt(planContent, buildResult.output) to pass the original plan + partial output to the new agent\n   - The new agent reads the current working tree state to determine what's already been done\n   - Reuse MAX_TOKEN_CONTINUATIONS as the retry limit\n\n4. **Issue comment** — Add a new comment type (e.g. compaction_recovery) distinct from token_limit_recovery, so observers can see that the restart was triggered by context compaction rather than token exhaustion.\n\n### Why this works\n\nThe build agent's plan spec lives on disk and is read fresh each time. The working tree contains all changes made by the previous agent run. The new agent receives the plan + partial output via buildContinuationPrompt(), reads the codebase, and picks up where the old agent left off — without the lossy summarization that compaction introduces.\n\n### Scope\n\n- Build agent only (the only long-running agent where compaction has been observed in practice)\n- Reuses existing continuation loop infrastructure — no new retry mechanisms needed","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-25T11:46:51Z","comments":[],"actionableComment":null}`

## Feature Description
Detect context compaction in the Claude Code JSONL output stream and restart the build agent with fresh context. When Claude Code hits its context window limit, it automatically compacts the conversation, which is lossy and degrades agent output quality. This feature detects the `compact_boundary` event in the stream, terminates the agent, and restarts it using the existing token-limit continuation mechanism — giving the new agent a fresh context with the original plan and partial output summary.

## User Story
As an ADW operator
I want the build agent to automatically restart with fresh context when compaction is detected
So that the agent continues with full-fidelity context instead of a degraded compacted summary

## Problem Statement
When the build agent runs long enough for Claude Code to hit its context window limit, Claude Code compacts the conversation context. This compaction is lossy — the agent continues with a degraded summary instead of the full conversation history, leading to repeated work, missed context, and incorrect assumptions. There is currently no detection or recovery mechanism for this event.

## Solution Statement
Detect the `"subtype":"compact_boundary"` event in the JSONL stream within `agentProcessHandler.ts`, terminate the agent with SIGTERM, and return a new `compactionDetected` flag in `AgentResult`. In `buildPhase.ts`, handle this flag identically to `tokenLimitExceeded` — incrementing the shared continuation counter, posting a distinct `compaction_recovery` issue comment, and spawning a fresh agent with the plan and partial output via `buildContinuationPrompt()`. This reuses the existing continuation loop infrastructure with no new retry mechanisms.

## Relevant Files
Use these files to implement the feature:

- `adws/agents/agentProcessHandler.ts` — The stdout handler where compaction detection will be added alongside existing auth error and token limit detection (lines 78-113). Also the close handler (lines 121-243) where the `compactionDetected` flag must be returned in the `AgentResult`.
- `adws/types/agentTypes.ts` — Contains the `AgentResult` interface (line 9) where the new `compactionDetected?: boolean` field will be added.
- `adws/types/workflowTypes.ts` — Contains the `WorkflowStage` type union (line 6) where the new `'compaction_recovery'` stage must be added.
- `adws/phases/buildPhase.ts` — Contains the continuation `while` loop (line 71) with the `tokenLimitExceeded` handling block (lines 186-216) that will be extended to also handle `compactionDetected`.
- `adws/phases/planPhase.ts` — Contains `buildContinuationPrompt()` (line 166) which will be refactored to accept a `reason` parameter so the continuation context message is accurate for both token limit and compaction cases.
- `adws/github/workflowCommentsIssue.ts` — Contains `formatTokenLimitRecoveryComment()` (line 158) and `formatWorkflowComment()` switch (line 275). A new `formatCompactionRecoveryComment()` function and case will be added.
- `adws/core/workflowCommentParsing.ts` — Contains `STAGE_HEADER_MAP` (line 32) where the new compaction recovery header must be mapped.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow during implementation.

### New Files
No new files are required. All changes are additions to existing files.

## Implementation Plan
### Phase 1: Foundation
Extend the type system to support the new compaction detection signal. Add `compactionDetected?: boolean` to `AgentResult`, add `'compaction_recovery'` to `WorkflowStage`, and update `STAGE_HEADER_MAP` to map the new comment header.

### Phase 2: Core Implementation
Add compaction detection in `agentProcessHandler.ts` alongside the existing auth error and token limit detection. Detect `"subtype":"compact_boundary"` in the stdout stream, set a flag, and kill the process. Return the flag in the `AgentResult` from the close handler. Refactor `buildContinuationPrompt()` to accept a reason parameter so the continuation context message accurately reflects whether the restart was triggered by token limit or compaction.

### Phase 3: Integration
Handle `compactionDetected` in the `buildPhase.ts` continuation loop identically to `tokenLimitExceeded`. Add the `formatCompactionRecoveryComment()` function and wire it into the `formatWorkflowComment()` switch. Post the distinct `compaction_recovery` comment so observers can distinguish between token limit and compaction restarts.

## Step by Step Tasks

### Step 1: Add `compactionDetected` field to `AgentResult`
- In `adws/types/agentTypes.ts`, add `compactionDetected?: boolean` to the `AgentResult` interface, next to the existing `tokenLimitExceeded` field (after line 19).
- Add a JSDoc comment: `/** True when the agent was terminated due to context compaction detection. */`

### Step 2: Add `'compaction_recovery'` to `WorkflowStage`
- In `adws/types/workflowTypes.ts`, add `| 'compaction_recovery'` to the `WorkflowStage` type union, adjacent to the existing `'token_limit_recovery'` entry (after line 38).
- Add a comment grouping it: `// Context compaction recovery`

### Step 3: Update `STAGE_HEADER_MAP` in `workflowCommentParsing.ts`
- In `adws/core/workflowCommentParsing.ts`, add a new entry to `STAGE_HEADER_MAP` (after line 49):
  ```typescript
  ':warning: Context Compaction Recovery': 'compaction_recovery',
  ```

### Step 4: Add compaction detection in `agentProcessHandler.ts`
- In `adws/agents/agentProcessHandler.ts`, inside the `claude.stdout.on('data')` handler (after the auth error detection block ending at line 93, before the token limit block starting at line 95):
  - Add a `compactionDetected` flag variable (initialized `false`) alongside `authErrorDetected` and `tokenLimitReached`.
  - Add a detection block:
    ```typescript
    if (!compactionDetected && text.includes('"subtype":"compact_boundary"')) {
      compactionDetected = true;
      log(`${agentName}: Context compaction detected — killing process to restart with fresh context.`, 'info');
      if (statePath) {
        AgentStateManager.appendLog(statePath, 'Terminated: Context compaction detected');
      }
      claude.kill('SIGTERM');
    }
    ```
- In the `claude.on('close')` handler, add a `compactionDetected` resolution block (after the `tokenLimitReached` block ending at line 189, before the `code === 0` block at line 192):
  ```typescript
  if (compactionDetected) {
    log(`${agentName} terminated due to context compaction`, 'info');
    resolve({
      success: true,
      compactionDetected: true,
      output: state.lastResult?.result || state.fullOutput,
      partialOutput: state.fullOutput,
      totalCostUsd,
      modelUsage: resolvedModelUsage,
      estimatedUsage,
      actualUsage: extractorFinalized ? extractorUsage : undefined,
      costSource,
      statePath,
    });
    return;
  }
  ```

### Step 5: Refactor `buildContinuationPrompt()` to accept a reason
- In `adws/phases/planPhase.ts`, update `buildContinuationPrompt()` signature to accept an optional `reason` parameter:
  ```typescript
  export function buildContinuationPrompt(
    originalPlanContent: string,
    previousOutput: string,
    reason: 'token_limit' | 'compaction' = 'token_limit',
  ): string
  ```
- Update the continuation context message to use the reason:
  - For `'token_limit'`: keep the existing message ("terminated because it approached the token usage limit")
  - For `'compaction'`: use "terminated because Claude Code compacted the conversation context, which is lossy"
- Existing callers in `buildPhase.ts` pass `'token_limit'` (or rely on the default), so no other callers break.

### Step 6: Add `formatCompactionRecoveryComment()` in `workflowCommentsIssue.ts`
- In `adws/github/workflowCommentsIssue.ts`, add a new function after `formatTokenLimitRecoveryComment()` (after line 165):
  ```typescript
  function formatCompactionRecoveryComment(ctx: WorkflowContext): string {
    const continuationNumber = ctx.tokenContinuationNumber ?? 1;
    return `## :warning: Context Compaction Recovery\n\nThe build agent's context was compacted by Claude Code, which is lossy. Terminating and spawning a continuation agent with fresh context.\n\n**Continuation:** #${continuationNumber}\n**ADW ID:** \`${ctx.adwId}\`${formatRunningTokenFooter(ctx.runningTokenTotal)}${ADW_SIGNATURE}`;
  }
  ```
- Add the case to the `formatWorkflowComment()` switch (after line 293):
  ```typescript
  case 'compaction_recovery': return formatCompactionRecoveryComment(ctx);
  ```

### Step 7: Handle `compactionDetected` in `buildPhase.ts` continuation loop
- In `adws/phases/buildPhase.ts`, add a `compactionDetected` handling block immediately after the `tokenLimitExceeded` block (after line 216, before the `!buildResult.success` check at line 218):
  ```typescript
  if (buildResult.compactionDetected) {
    continuationNumber++;
    continuationCount++;
    log(`Build agent context compacted (continuation ${continuationNumber}/${MAX_TOKEN_CONTINUATIONS})`, 'info');

    AgentStateManager.writeState(buildAgentStatePath, {
      output: buildResult.output.substring(0, 1000),
      metadata: { compactionDetected: true },
      execution: AgentStateManager.completeExecution(
        AgentStateManager.createExecutionState('running'),
        true
      ),
    });
    AgentStateManager.appendLog(orchestratorStatePath, `Build agent context compacted (continuation ${continuationNumber})`);

    if (continuationNumber > MAX_TOKEN_CONTINUATIONS) {
      throw new Error(`Build agent exceeded maximum continuations (${MAX_TOKEN_CONTINUATIONS}) due to context compaction. Last partial output: ${buildResult.output.substring(0, 500)}`);
    }

    ctx.tokenContinuationNumber = continuationNumber;
    if (repoContext) {
      postIssueStageComment(repoContext, issueNumber, 'compaction_recovery', ctx);
    }

    currentPlanContent = buildContinuationPrompt(planContent, buildResult.output, 'compaction');
    continue;
  }
  ```
- Update the existing `tokenLimitExceeded` block's `buildContinuationPrompt` call (line 214) to explicitly pass `'token_limit'`:
  ```typescript
  currentPlanContent = buildContinuationPrompt(planContent, buildResult.output, 'token_limit');
  ```

### Step 8: Run validation commands
- Run `bun run lint` to check for linting errors.
- Run `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json` to check for type errors.
- Run `bun run build` to verify no build errors.

## Testing Strategy

### Edge Cases
- **Compaction and token limit in same run**: If compaction fires first, the `compactionDetected` flag should take precedence since the process is killed immediately — the token limit check won't trigger after the process is dead.
- **Multiple compactions across continuations**: Each continuation agent may also trigger compaction. The shared `MAX_TOKEN_CONTINUATIONS` limit prevents infinite restarts.
- **Partial JSONL line split across chunks**: The `compact_boundary` string may be split across two `data` events. However, this matches the existing pattern used for auth error detection (`"subtype":"api_retry"`) which also uses `text.includes()` and has been reliable in practice. The JSONL lines are typically emitted as complete JSON objects.
- **Compaction during non-build agents**: Only the build phase continuation loop handles `compactionDetected`. Other agents (plan, review, etc.) will continue normally after compaction — this matches the stated scope since compaction has only been observed to be problematic for the long-running build agent.
- **Close handler ordering**: The `compactionDetected` block in the close handler must appear after `tokenLimitReached` but before the normal `code === 0` path, since a killed process may exit with code 0 or non-zero depending on signal handling.

## Acceptance Criteria
- When `"subtype":"compact_boundary"` appears in the build agent's JSONL stream, the agent process is killed with SIGTERM.
- The `AgentResult` returned has `compactionDetected: true`.
- The build phase continuation loop detects `compactionDetected` and spawns a new agent with fresh context via `buildContinuationPrompt()` with reason `'compaction'`.
- A `compaction_recovery` issue comment is posted, distinct from `token_limit_recovery`.
- The continuation prompt accurately states that the restart was due to context compaction.
- The shared `MAX_TOKEN_CONTINUATIONS` limit applies to both token limit and compaction continuations combined.
- All existing token limit recovery behavior remains unchanged.
- TypeScript compiles without errors (`bunx tsc --noEmit`).
- Linter passes (`bun run lint`).
- Build succeeds (`bun run build`).

## Validation Commands

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Run type checker
- `bunx tsc --noEmit -p adws/tsconfig.json` — Run type checker against adws tsconfig
- `bun run build` — Build the application to verify no build errors

## Notes
- The `buildContinuationPrompt()` refactoring to accept a `reason` parameter is a minor enhancement that makes the continuation context message accurate. The default value `'token_limit'` ensures backward compatibility.
- The `compactionDetected` check in the close handler is placed between `tokenLimitReached` and the normal success path. If both `tokenLimitReached` and `compactionDetected` are set (unlikely since both kill the process, but theoretically possible if compaction fires just before the token limit), `tokenLimitReached` takes precedence.
- Strictly adhere to the coding guidelines in `guidelines/coding_guidelines.md` — clarity over cleverness, single responsibility, type safety, immutability, and isolating side effects.
