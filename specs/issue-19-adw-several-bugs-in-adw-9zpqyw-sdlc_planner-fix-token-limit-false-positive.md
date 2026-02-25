# Feature: Fix Token Limit False Positive in ADW Agent Runner

## Metadata
issueNumber: `19`
adwId: `several-bugs-in-adw-9zpqyw`
issueJson: `{"number":19,"title":"Several bugs in adw flow","body":"Firstly, it would appear that token count is not reset correctly when the token limit is reached:\nThe build starts at 16:20:\n[2026-02-25T16:20:52.483Z] [the-adw-is-too-speci-5trqm8] Starting Build agent...\n\nThen the first token limit is reached after 14 minutes. After that every 2 to 3 minutes.\n\n[2026-02-25T16:34:54.762Z] [the-adw-is-too-speci-5trqm8] Build: Token limit threshold reached (312782/63999 tokens, 90%). Terminating agent.\n[2026-02-25T16:37:12.389Z] [the-adw-is-too-speci-5trqm8] Build: Token limit threshold reached (134446/63999 tokens, 90%). Terminating agent.\n[2026-02-25T16:39:48.894Z] [the-adw-is-too-speci-5trqm8] Build: Token limit threshold reached (117081/63999 tokens, 90%). Terminating agent.\n[2026-02-25T16:42:19.933Z] [the-adw-is-too-speci-5trqm8] Build: Token limit threshold reached (116061/63999 tokens, 90%). Terminating agent.\n\nToken counts should only include those of the running agent and they should be limited to the opus model.","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-02-25T19:10:06Z","comments":[],"actionableComment":null}`

## Feature Description
Fix false positive token limit terminations in the ADW agent runner. Currently, the token limit check in `claudeAgent.ts` sums tokens across ALL models reported in the Claude CLI's `modelUsage` output. When the primary agent (e.g., opus) spawns internal subagents (haiku for Task tool, sonnet for classification), those tokens inflate the count. This causes the agent to be terminated prematurely — often within 2-3 minutes of a continuation — because the total across all models exceeds the token budget even though the primary model alone is well within limits.

## User Story
As an ADW operator
I want the token limit check to only count tokens from the primary model (the model passed via `--model` to the CLI)
So that subagent token usage (haiku/sonnet) does not cause false positive terminations of the build agent

## Problem Statement
The `computeTotalTokens` function in `tokenManager.ts` aggregates tokens from ALL models in the `ModelUsageMap`. When the Claude CLI runs with `--model opus`, it internally uses cheaper models (haiku, sonnet) for subagent tasks. The `modelUsage` field in the JSONL result message includes usage from all these models. The token limit check in `handleAgentProcess` (`claudeAgent.ts:69`) compares this inflated total against `MAX_THINKING_TOKENS`, causing false positive terminations. The logs show:
- First trigger: 312,782 tokens (all models combined) vs 63,999 limit after 14 min
- Subsequent triggers: 117K-134K tokens after only 2-3 min each continuation

The primary opus model likely only used a fraction of those tokens. The remaining tokens come from haiku/sonnet subagents and should not count against the opus token budget.

## Solution Statement
1. Add a new function `computePrimaryModelTokens(modelUsage, primaryModel)` to `tokenManager.ts` that filters the `ModelUsageMap` to only include entries whose key matches the primary model tier (e.g., key containing "opus" when model is "opus").
2. Modify `handleAgentProcess` in `claudeAgent.ts` to accept the `model` parameter and use the filtered computation for the token limit check.
3. Keep the existing `computeTotalTokens` function unchanged for cost reporting (which correctly needs ALL models).
4. Update the JSONL parser to use the filtered computation when updating `state.totalTokens`.

## Relevant Files
Use these files to implement the feature:

- `adws/agents/tokenManager.ts` — Contains `computeTotalTokens` which sums ALL models. Add the new `computePrimaryModelTokens` function here that filters by the primary model tier.
- `adws/agents/claudeAgent.ts` — Contains `handleAgentProcess` which checks token limits (line 69). Must pass the `model` parameter through and use the filtered token computation.
- `adws/agents/jsonlParser.ts` — Contains `parseJsonlOutput` which updates `state.totalTokens` via `computeTotalTokens`. Must use the filtered computation instead, receiving the primary model name.
- `adws/core/costTypes.ts` — Contains `ModelUsageMap` type definition. Referenced for understanding model key format.
- `adws/core/config.ts` — Contains `MAX_THINKING_TOKENS`, `TOKEN_LIMIT_THRESHOLD` constants and model tier types.
- `adws/__tests__/claudeAgent.test.ts` — Existing tests for `computeTotalTokens`. Add tests for the new filtered function.
- `adws/__tests__/tokenLimitRecovery.test.ts` — Existing tests for token limit recovery in the build phase.

### New Files
- `adws/__tests__/tokenManagerFiltered.test.ts` — Tests for the new `computePrimaryModelTokens` function and model name matching logic.

## Implementation Plan
### Phase 1: Foundation
Add the model-filtered token computation function to `tokenManager.ts`. This requires:
1. A helper function `isModelMatch(modelKey: string, modelTier: string): boolean` that checks if a full model ID (e.g., `claude-opus-4-6`) matches a model tier shorthand (e.g., `opus`). The match is done by checking if the key contains the tier name.
2. A new function `computePrimaryModelTokens(modelUsage: ModelUsageMap, primaryModel: string): TokenTotals` that filters the usage map to only include matching entries before summing.

### Phase 2: Core Implementation
Thread the `model` parameter through the agent execution pipeline:
1. Update `JsonlParserState` in `jsonlParser.ts` to include a `primaryModel` field.
2. Update `parseJsonlOutput` to accept and use the primary model when computing `state.totalTokens`, calling `computePrimaryModelTokens` instead of `computeTotalTokens`.
3. Update `handleAgentProcess` in `claudeAgent.ts` to accept the `model` parameter and pass it through when initializing the parser state.
4. Update `runClaudeAgent` and `runClaudeAgentWithCommand` to pass the model to `handleAgentProcess`.

### Phase 3: Integration
1. Write comprehensive unit tests for the new functions.
2. Update existing tests that mock or test token counting behavior.
3. Verify that cost reporting (`computeTotalTokens`) still uses ALL models — only the token limit check is filtered.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add model matching helper and filtered token computation to `tokenManager.ts`
- Add `isModelMatch(modelKey: string, modelTier: string): boolean` — checks if the full model ID key contains the model tier name (case-insensitive). For example, `isModelMatch('claude-opus-4-6', 'opus')` returns `true`, `isModelMatch('claude-haiku-4-5-20251001', 'opus')` returns `false`.
- Add `computePrimaryModelTokens(modelUsage: ModelUsageMap, primaryModel: string): TokenTotals` — iterates over `ModelUsageMap` entries, filters to only those matching the primary model, then sums the same way `computeTotalTokens` does.
- Export both new functions.

### Step 2: Update `JsonlParserState` and `parseJsonlOutput` in `jsonlParser.ts`
- Add `primaryModel?: string` field to the `JsonlParserState` interface.
- In `parseJsonlOutput`, when computing `state.totalTokens` (line 170-171), check if `state.primaryModel` is set:
  - If set, call `computePrimaryModelTokens(state.modelUsage, state.primaryModel)` instead of `computeTotalTokens(state.modelUsage)`.
  - If not set (backward compatibility), fall back to `computeTotalTokens`.

### Step 3: Thread the `model` parameter through `claudeAgent.ts`
- Update `handleAgentProcess` signature to accept a `model` parameter (string).
- When initializing the `JsonlParserState` object (line 50-57), set `primaryModel: model`.
- Update all calls to `handleAgentProcess` in `runClaudeAgent` and `runClaudeAgentWithCommand` to pass the `model` parameter.

### Step 4: Update backward-compatible re-exports in `claudeAgent.ts`
- Export `computePrimaryModelTokens` and `isModelMatch` from `claudeAgent.ts` for external consumers.

### Step 5: Write unit tests for new functions
- Create `adws/__tests__/tokenManagerFiltered.test.ts` with tests for:
  - `isModelMatch` — matching "opus" against "claude-opus-4-6", not matching against "claude-haiku-4-5", case insensitivity, etc.
  - `computePrimaryModelTokens` — filtering to only opus tokens when multiple models present, returning zeros when no match, handling single model map, handling empty map.
- Update `adws/__tests__/claudeAgent.test.ts` to verify `computeTotalTokens` still sums ALL models (regression).

### Step 6: Run Validation Commands
- Run `npm run lint` to check for code quality issues.
- Run `npm run build` to verify no build errors.
- Run `npm test` to validate all tests pass with zero regressions.

## Testing Strategy
### Unit Tests
- `tokenManagerFiltered.test.ts`: Test `isModelMatch` with various model ID formats and tier names. Test `computePrimaryModelTokens` with mixed model usage maps (opus + haiku + sonnet) ensuring only the primary model tokens are counted.
- `claudeAgent.test.ts`: Verify existing `computeTotalTokens` tests still pass (regression). The existing function must continue to sum ALL models for cost reporting.
- Verify that the `JsonlParserState` correctly uses filtered computation when `primaryModel` is set.

### Edge Cases
- Model usage map contains only the primary model (no subagents used) — should behave identically to `computeTotalTokens`.
- Model usage map contains no matching models — should return zero totals, avoiding false termination.
- Model usage map is empty — should return zero totals.
- `primaryModel` is undefined/not set on `JsonlParserState` — should fall back to `computeTotalTokens` for backward compatibility.
- Model ID format variations: `claude-opus-4-6`, `claude-opus-4-6-20260101`, etc. — the contains-check should handle all these.

## Acceptance Criteria
- Token limit check in `handleAgentProcess` only counts tokens from the primary model (the model passed via `--model` CLI flag).
- Subagent tokens (haiku, sonnet) do NOT trigger false positive token limit terminations when the primary model is opus.
- Cost reporting (`computeTotalTokens`) continues to aggregate ALL models correctly.
- All existing tests pass without modification (except tests that directly test the token limit behavior, which are updated).
- New unit tests cover `isModelMatch` and `computePrimaryModelTokens` thoroughly.
- The `JsonlParserState` interface is backward compatible — existing callers that don't set `primaryModel` get the previous behavior.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `npm run lint` - Run linter to check for code quality issues
- `npm run build` - Build the application to verify no build errors
- `npm test` - Run tests to validate the feature works with zero regressions

## Notes
- The `computeTotalTokens` function must remain unchanged as it is used for cost reporting which legitimately needs to sum all models.
- Model tier names used in the codebase: `'opus'`, `'sonnet'`, `'haiku'` (from `config.ts` `ModelTier` type).
- Full model IDs seen in test fixtures: `'claude-opus-4-6'`, `'claude-sonnet-4-5-20250929'`, `'claude-haiku-3-5-20241022'`.
- The `isModelMatch` function should use a simple case-insensitive `includes` check so it works with any versioned model ID format.
- No new npm packages required.
