# Bug: Token limit fires after agent completion causing infinite continuation loop

## Metadata
issueNumber: `19`
adwId: `adw-unknown`
issueJson: `{}`

## Bug Description

When the build agent completes its work normally, the token limit mechanism incorrectly fires and returns `tokenLimitExceeded: true`, causing the build phase to restart with a continuation prompt. This repeats every 2–3 minutes until `MAX_TOKEN_CONTINUATIONS` is exhausted.

**Symptoms from the logs:**
```
[16:20:52] Starting Build agent...
[16:34:54] Build: Token limit threshold reached (312782/63999 tokens, 90%). Terminating agent.
[16:37:12] Build: Token limit threshold reached (134446/63999 tokens, 90%). Terminating agent.
[16:39:48] Build: Token limit threshold reached (117081/63999 tokens, 90%). Terminating agent.
[16:42:19] Build: Token limit threshold reached (116061/63999 tokens, 90%). Terminating agent.
```

- First build runs for 14 minutes (normal, completes its implementation)
- Then every 2–3 minutes a restart fires (continuation agents also complete, then same false positive triggers)
- Token counts do not reset to zero between restarts — they remain above the threshold every run

**Expected behaviour:** When the build agent completes normally (emits a `result` message and exits 0), the workflow should treat it as a success, not as a token-limit interruption.

**Actual behaviour:** The token limit fires after the agent's final `result` message is parsed, even though the agent already finished. Each continuation agent also finishes normally and triggers the same false positive.

## Problem Statement

Two separate issues combine to produce this bug:

1. **Token threshold fires post-completion.** `state.totalTokens` in `claudeAgent.ts` is updated **only** when the JSONL `result` message is parsed (i.e. at the very end of an agent run). The data-handler threshold check fires immediately after that update. By this point the Claude process has already completed its work. Setting `tokenLimitReached = true` and calling `claude.kill('SIGTERM')` on an already-finishing process causes the `close` handler to return `{ tokenLimitExceeded: true }` even though `code === 0` and `state.lastResult` exists.

2. **Token counts include all model tiers.** `computeTotalTokens` in `tokenManager.ts` sums tokens from every key in `ModelUsageMap` (opus + haiku + sonnet subagents). When `MAX_THINKING_TOKENS` is set to a low value (e.g. 63999 in the bug report), the inflated multi-model total exceeds the threshold far more easily than the primary opus model alone.

## Solution Statement

1. **Fix the close-handler logic** in `claudeAgent.ts`: when `tokenLimitReached` is set but the agent exited successfully (`code === 0` **and** `state.lastResult !== null`), return a normal success result — not `tokenLimitExceeded`. The `result` message is the canonical signal that the agent completed.

2. **Add a model-scoped token counter** in `tokenManager.ts`: `computeModelTokens(modelUsage, modelName)` sums tokens only for models whose key contains `modelName` (e.g. `'opus'`). Thread the `model` parameter through `handleAgentProcess` and use this scoped count for the threshold comparison so subagent (haiku/sonnet) tokens do not inflate the threshold check.

3. **Track `resultReceived` in `JsonlParserState`**: set a flag when the `result` message arrives so the `close` handler (and future code) can distinguish "agent completed normally with high token count" from "agent was truly killed mid-run".

## Steps to Reproduce

1. Set `MAX_THINKING_TOKENS=63999` in `.env`
2. Run `npx tsx adws/adwPlanBuild.tsx <issue>` against a non-trivial issue
3. Observe the build agent complete its work in ~14 minutes
4. Observe the token limit log firing immediately after completion
5. Observe continuation restarts every 2–3 minutes until `MAX_TOKEN_CONTINUATIONS` is exhausted

## Root Cause Analysis

**In `adws/agents/claudeAgent.ts` → `handleAgentProcess`:**

```typescript
// state.totalTokens is only set here — at end of session
if (parsed.type === 'result') {        // ← in parseJsonlOutput
  state.totalTokens = totals.total;
}

// Threshold check runs immediately after parseJsonlOutput
if (!tokenLimitReached && state.totalTokens >= tokenThreshold) {
  tokenLimitReached = true;
  claude.kill('SIGTERM');   // ← process may already be done
}

// close handler
if (tokenLimitReached) {
  resolve({ success: true, tokenLimitExceeded: true, ... });  // ← false positive
  return;
}
```

The `close` handler does not check whether the agent actually completed (`state.lastResult !== null`, `code === 0`). Any agent whose cumulative token count exceeds the threshold in its final `result` message will always be reported as token-limit-exceeded, even if it finished successfully.

**In `adws/agents/tokenManager.ts` → `computeTotalTokens`:**

All model keys in `ModelUsageMap` are summed unconditionally. If the build agent (opus) spawns haiku/sonnet subagents, their tokens inflate the total beyond the configured threshold.

## Relevant Files

- `adws/agents/claudeAgent.ts` — contains `handleAgentProcess` where the false-positive `tokenLimitExceeded` path lives; needs `model` threaded in and the close-handler fix applied
- `adws/agents/tokenManager.ts` — contains `computeTotalTokens`; needs `computeModelTokens` added to filter by model tier
- `adws/agents/jsonlParser.ts` — defines `JsonlParserState`; needs `resultReceived: boolean` field added and set when the `result` message arrives
- `adws/__tests__/claudeAgent.test.ts` — unit tests for `computeTotalTokens`; needs new tests for the close-handler fix
- `adws/__tests__/tokenLimitRecovery.test.ts` — integration tests for `executeBuildPhase`; needs a test that confirms a normally-completed agent (high token count, code 0) is NOT returned as `tokenLimitExceeded`

## Step by Step Tasks

### 1. Add `resultReceived` to `JsonlParserState` in `jsonlParser.ts`

- In `adws/agents/jsonlParser.ts`, add `resultReceived: boolean` to the `JsonlParserState` interface
- In `parseJsonlOutput`, set `state.resultReceived = true` inside the `if (parsed.type === 'result')` block (alongside the existing `state.totalTokens` update)
- In `adws/agents/claudeAgent.ts`, initialise `resultReceived: false` in the `state` object created inside `handleAgentProcess`

### 2. Add `computeModelTokens` to `tokenManager.ts`

- In `adws/agents/tokenManager.ts`, add a new exported function:
  ```typescript
  export function computeModelTokens(modelUsage: ModelUsageMap, modelName: string): TokenTotals
  ```
  - Iterate `Object.entries(modelUsage)` and **only** include entries whose key (lowercased) contains `modelName.toLowerCase()` (e.g. `'opus'`)
  - Sum `inputTokens + outputTokens + cacheCreationInputTokens` for matching entries
  - Return the same `TokenTotals` shape as `computeTotalTokens`

### 3. Thread `model` through `handleAgentProcess` and use scoped token count

- In `adws/agents/claudeAgent.ts`, add a `model: string` parameter to `handleAgentProcess`
- Inside the `data` handler, replace:
  ```typescript
  if (!tokenLimitReached && state.totalTokens >= tokenThreshold)
  ```
  with a model-scoped check using `computeModelTokens(state.modelUsage, model)` when `state.modelUsage` is available:
  ```typescript
  const scopedTokens = state.modelUsage
    ? computeModelTokens(state.modelUsage, model).total
    : state.totalTokens;
  if (!tokenLimitReached && scopedTokens >= tokenThreshold)
  ```
- Update both call-sites (`runClaudeAgent` and `runClaudeAgentWithCommand`) to pass `model` to `handleAgentProcess`

### 4. Fix the `close` handler to not return `tokenLimitExceeded` for normally completed agents

- In `adws/agents/claudeAgent.ts` inside the `close` handler, change the `if (tokenLimitReached)` block to:
  ```typescript
  if (tokenLimitReached) {
    // If the agent completed normally (result received + exit 0), treat as success.
    // tokenLimitReached may have been set by the result message itself, not a mid-run kill.
    if (code === 0 && state.lastResult) {
      log(`${agentName} completed normally despite high token count`, 'info');
      resolve({
        success: !state.lastResult.isError,
        output: state.lastResult.result || state.fullOutput,
        sessionId: state.lastResult.sessionId,
        totalCostUsd: state.lastResult.totalCostUsd,
        modelUsage: state.modelUsage,
        statePath,
      });
      return;
    }
    // Agent was truly killed mid-run (no result message or non-zero exit).
    log(`${agentName} terminated due to token limit`, 'info');
    const tokenTotals = state.modelUsage ? computeTotalTokens(state.modelUsage) : undefined;
    const snapshot: TokenUsageSnapshot | undefined = tokenTotals ? { ... } : undefined;
    resolve({
      success: true,
      tokenLimitExceeded: true,
      output: state.lastResult?.result || state.fullOutput,
      partialOutput: state.fullOutput,
      tokenUsage: snapshot,
      totalCostUsd: state.lastResult?.totalCostUsd,
      modelUsage: state.modelUsage,
      statePath,
    });
    return;
  }
  ```
  The key condition is: **`code === 0 && state.lastResult !== null`** → success, not tokenLimitExceeded.

### 5. Add unit tests in `claudeAgent.test.ts`

- Add tests that verify:
  - `computeModelTokens` with `'opus'` only counts keys containing `'opus'`
  - `computeModelTokens` with no matching keys returns zeros
  - `computeModelTokens` is consistent with `computeTotalTokens` for single-model maps

### 6. Add integration tests in `tokenLimitRecovery.test.ts`

- Add a test: **"does not return tokenLimitExceeded when agent completes normally with high token count"**
  - Mock `runBuildAgent` to return `{ success: true, output: 'Done', totalCostUsd: 1.0, modelUsage: { 'claude-opus-4-6': { inputTokens: 200000, ... } } }` (no `tokenLimitExceeded` flag)
  - Confirm `executeBuildPhase` completes without restarts (1 build agent call)
  - Confirm no `token_limit_recovery` comment is posted

### 7. Run Validation Commands

- Run all validation commands listed below to confirm zero regressions.

## Validation Commands

Execute every command to validate the bug is fixed with zero regressions.

- Reproduce the false-positive scenario by checking the close-handler logic path: when `code === 0` and `lastResult` is set, `tokenLimitExceeded` must NOT be returned
- `npm run lint` — Run linter to check for code quality issues
- `npm run build` — Build the application to verify no build errors
- `npm test` — Run tests to validate the bug is fixed with zero regressions

## Notes

- No new npm dependencies required.
- The `computeTotalTokens` function is kept unchanged for cost-reporting purposes (we still want the full multi-model total for costs). Only the **threshold comparison** uses the model-scoped count.
- The `MAX_THINKING_TOKENS` / `TOKEN_LIMIT_THRESHOLD` configuration is unchanged.
- The continuation mechanism in `buildPhase.ts` is unchanged — it is correct for genuine mid-run kills; the fix is in `claudeAgent.ts` which is the sole source of `tokenLimitExceeded`.
- The `adws/README.md` should be read before implementation since this task operates in `adws/`.
